import { readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { eq, and, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { config } from '../config'
import { parseGuitarProFile } from './guitarpro'
import { classifySection } from './guitarpro'
import { matchSong, cleanTitle, type MatchCandidate } from './matcher'
import { probeAudio, measureLoudness, generateWaveformPeaks, ffmpegAvailable } from '../media/ffmpeg'
import { PRACTICE_INSTRUMENT } from '@shared/types'
import type { ImportReport, Instrument } from '@shared/types'

const GP_EXT = new Set(['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.gp7', '.gtp'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma'])

function listFiles(dir: string, allowed: Set<string>): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full, allowed))
    } else if (allowed.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

function emptyReport(): ImportReport {
  return { scanned: 0, created: 0, matched: 0, skipped: 0, errors: [], details: [] }
}

function upsertArtist(name: string | null): number | null {
  if (!name) return null
  const db = getDb()
  const trimmed = name.trim()
  if (!trimmed) return null
  const existing = db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.name, trimmed))
    .get()
  if (existing) return existing.id
  const inserted = db.insert(schema.artists).values({ name: trimmed }).returning().get()
  return inserted.id
}

function candidates(): MatchCandidate[] {
  const db = getDb()
  const rows = db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.artists.name
    })
    .from(schema.songs)
    .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
    .all()
  return rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist ?? null }))
}

function upsertTuning(name: string, instrument: Instrument, strings: string[]): number | null {
  if (!strings.length) return null
  const db = getDb()
  const inst = instrument === 'bass' ? 'bass' : instrument === 'guitar' ? 'guitar' : 'other'
  const existing = db
    .select()
    .from(schema.tunings)
    .where(and(eq(schema.tunings.name, name), eq(schema.tunings.stringCount, strings.length)))
    .get()
  if (existing) return existing.id
  const row = db
    .insert(schema.tunings)
    .values({
      name,
      instrument: inst,
      stringCount: strings.length,
      stringsJson: JSON.stringify(strings),
      isBuiltin: false
    })
    .returning()
    .get()
  return row.id
}

/**
 * Name a tuning by matching its note set against the known standards. Built-in
 * names win over user/auto-created ones, so a tuning first seen as a raw note
 * list gets its proper name once that standard is known.
 */
function nameTuning(strings: string[]): string {
  const db = getDb()
  const key = strings.join(',')
  const matches = db
    .select()
    .from(schema.tunings)
    .all()
    .filter((t) => {
      try {
        return (JSON.parse(t.stringsJson) as string[]).join(',') === key
      } catch {
        return false
      }
    })
  if (!matches.length) return strings.join(' ')
  return (matches.find((t) => t.isBuiltin) ?? matches[0]).name
}

function ensureProgressRows(songId: number, instruments: Instrument[]): void {
  const db = getDb()
  for (const instrument of instruments) {
    const existing = db
      .select()
      .from(schema.progress)
      .where(
        and(
          eq(schema.progress.songId, songId),
          isNull(schema.progress.sectionId),
          eq(schema.progress.instrument, instrument)
        )
      )
      .get()
    if (!existing) {
      db.insert(schema.progress).values({ songId, instrument, sectionId: null }).run()
    }
  }
}

/* ------------------------------------------------------------ guitar pro */

/**
 * Import one Guitar Pro file.
 *
 * `forcedSongId` is what the "baixar tablatura" flow uses: the user already
 * said which song the file belongs to, so the fuzzy matcher must not get a
 * chance to file it under a different one.
 */
async function ingestGuitarProFile(
  file: string,
  report: ImportReport,
  forcedSongId: number | null = null
): Promise<void> {
  const db = getDb()
  try {
    const already = db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.path, file))
      .get()
    if (already) {
      report.skipped++
      report.details.push({ file, action: 'skipped', note: 'já importado' })
      return
    }

    const parsed = parseGuitarProFile(file)
    const title = cleanTitle(parsed.title ?? basename(file, extname(file)))
    const match = forcedSongId
      ? { songId: forcedSongId, score: 1, reason: 'música escolhida na tela' }
      : matchSong(title, parsed.artist, candidates())

    let songId: number
    if (match.songId) {
      songId = match.songId
      report.matched++
    } else {
      const artistId = upsertArtist(parsed.artist)
      const row = db
        .insert(schema.songs)
        .values({
          title,
          artistId,
          album: parsed.album,
          bpm: parsed.tempo,
          bpmSource: parsed.tempo ? 'gp' : null,
          musicalKey: parsed.musicalKey,
          keySource: parsed.musicalKey ? 'gp' : null,
          timeSignature: parsed.timeSignature
        })
        .returning()
        .get()
      songId = row.id
      report.created++
    }

    // fill musical facts the song may still be missing
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
    const patch: Record<string, unknown> = {}
    if (song && song.bpm == null && parsed.tempo) {
      patch.bpm = parsed.tempo
      patch.bpmSource = 'gp'
    }
    if (song && song.musicalKey == null && parsed.musicalKey) {
      patch.musicalKey = parsed.musicalKey
      patch.keySource = 'gp'
    }
    if (song && song.timeSignature == null && parsed.timeSignature) {
      patch.timeSignature = parsed.timeSignature
    }
    if (song && song.album == null && parsed.album) patch.album = parsed.album

    // tuning: take it from the first melodic guitar track, else the first bass
    const tuningTrack =
      parsed.tracks.find((t) => t.instrument === 'guitar' && t.tuning.length) ??
      parsed.tracks.find((t) => t.instrument === 'bass' && t.tuning.length)
    if (tuningTrack && song && song.tuningId == null) {
      const tuningId = upsertTuning(
        nameTuning(tuningTrack.tuning),
        tuningTrack.instrument ?? 'guitar',
        tuningTrack.tuning
      )
      if (tuningId) patch.tuningId = tuningId
      if (tuningTrack.capo) patch.capo = tuningTrack.capo
    }
    if (Object.keys(patch).length) {
      db.update(schema.songs).set(patch).where(eq(schema.songs.id, songId)).run()
    }

    // sections, only when the song has none yet
    const existingSections = db
      .select()
      .from(schema.songSections)
      .where(eq(schema.songSections.songId, songId))
      .all()
    if (existingSections.length === 0 && parsed.sections.length) {
      parsed.sections.forEach((s, i) => {
        db.insert(schema.songSections)
          .values({
            songId,
            name: s.name,
            kind: classifySection(s.name),
            position: i,
            startBar: s.startBar,
            endBar: s.endBar,
            source: 'gp'
          })
          .run()
      })
    }

    // lyrics and chords straight out of the file
    if (parsed.lyrics) {
      const hasLyrics = db
        .select()
        .from(schema.charts)
        .where(and(eq(schema.charts.songId, songId), eq(schema.charts.kind, 'lyrics')))
        .get()
      if (!hasLyrics) {
        db.insert(schema.charts)
          .values({ songId, kind: 'lyrics', format: 'plain', content: parsed.lyrics })
          .run()
      }
    }
    if (parsed.chordSymbols.length) {
      const hasChords = db
        .select()
        .from(schema.charts)
        .where(and(eq(schema.charts.songId, songId), eq(schema.charts.kind, 'chords')))
        .get()
      if (!hasChords) {
        const body = parsed.chordSymbols.map((c) => `[${c.name}]`).join(' ')
        db.insert(schema.charts)
          .values({
            songId,
            kind: 'chords',
            format: 'chordpro',
            content: `{title: ${title}}\n{comment: Acordes extraídos do arquivo Guitar Pro}\n\n${body}`
          })
          .run()
      }
    }

    db.insert(schema.mediaAssets)
      .values({
        songId,
        kind: 'guitarpro',
        path: file,
        bytes: statSync(file).size,
        metaJson: JSON.stringify({
          barCount: parsed.barCount,
          tracks: parsed.tracks,
          sections: parsed.sections.length,
          hasLyrics: Boolean(parsed.lyrics),
          chordCount: parsed.chordSymbols.length
        })
      })
      .run()

    /*
     * One progress row, for the guitar. The file usually carries bass, drums and
     * a vocal line too, and opening a row per track is what made a song sit at
     * 30% mastery while its guitar part was already solid — the untouched drum
     * row was averaged into the ring.
     */
    ensureProgressRows(songId, [PRACTICE_INSTRUMENT])

    report.details.push({
      file,
      action: match.songId ? 'matched' : 'created',
      songId,
      songTitle: title,
      note: `${parsed.tracks.length} trilhas, ${parsed.sections.length} seções${
        match.songId ? ` — casou (${match.reason})` : ''
      }`
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    report.errors.push({ file, message })
    report.details.push({ file, action: 'error', note: message })
  }
}

export async function importGuitarProDir(dir = config.paths.gptabs): Promise<ImportReport> {
  const report = emptyReport()
  const files = listFiles(dir, GP_EXT)
  report.scanned = files.length
  for (const file of files) await ingestGuitarProFile(file, report)
  return report
}

/**
 * Import a tablature that was just downloaded into gptabs/ and hang it on the
 * song the user was looking at.
 */
export async function attachGuitarProFile(songId: number, file: string): Promise<ImportReport> {
  const report = emptyReport()
  report.scanned = 1
  await ingestGuitarProFile(file, report, songId)
  return report
}

/* ----------------------------------------------------------------- audio */

/** Import one audio file, optionally forced onto a song the user picked. */
async function ingestAudioFile(
  file: string,
  report: ImportReport,
  forcedSongId: number | null = null
): Promise<void> {
  const db = getDb()
  try {
    const already = db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.path, file))
      .get()
    if (already) {
      report.skipped++
      report.details.push({ file, action: 'skipped', note: 'já importado' })
      return
    }

    const probe = await probeAudio(file)
    const title = cleanTitle(probe.tags.title ?? basename(file, extname(file)))
    const artist = probe.tags.artist ?? probe.tags.albumArtist ?? null
    const match = forcedSongId
      ? { songId: forcedSongId, score: 1, reason: 'música escolhida na tela' }
      : matchSong(title, artist, candidates())

    let songId: number
    if (match.songId) {
      songId = match.songId
      report.matched++
    } else {
      const artistId = upsertArtist(artist)
      const year = probe.tags.date ? Number.parseInt(probe.tags.date.slice(0, 4), 10) : null
      const row = db
        .insert(schema.songs)
        .values({
          title,
          artistId,
          album: probe.tags.album ?? null,
          year: Number.isFinite(year) ? year : null,
          genre: probe.tags.genre ?? null,
          durationMs: probe.durationMs
        })
        .returning()
        .get()
      songId = row.id
      report.created++
    }

    // duration and tag-derived fields the song may be missing
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
    const patch: Record<string, unknown> = {}
    if (song && song.durationMs == null) patch.durationMs = probe.durationMs
    if (song && song.album == null && probe.tags.album) patch.album = probe.tags.album
    if (song && song.genre == null && probe.tags.genre) patch.genre = probe.tags.genre
    if (song && song.year == null && probe.tags.date) {
      const y = Number.parseInt(probe.tags.date.slice(0, 4), 10)
      if (Number.isFinite(y)) patch.year = y
    }

    const lufs = await measureLoudness(file)
    if (lufs !== null) patch.loudnessLufs = lufs
    if (Object.keys(patch).length) {
      db.update(schema.songs).set(patch).where(eq(schema.songs.id, songId)).run()
    }

    db.insert(schema.mediaAssets)
      .values({
        songId,
        kind: 'audio_master',
        path: file,
        bytes: probe.bytes,
        metaJson: JSON.stringify({
          durationMs: probe.durationMs,
          sampleRate: probe.sampleRate,
          channels: probe.channels,
          codec: probe.codec,
          bitrateKbps: probe.bitrateKbps,
          loudnessLufs: lufs,
          tags: probe.tags
        })
      })
      .run()

    // precompute the waveform so the timeline never decodes a 90 MB wav
    try {
      const { peaks } = await generateWaveformPeaks(file)
      const wavePath = join(config.paths.waveforms, `song-${songId}.json`)
      writeFileSync(wavePath, JSON.stringify({ songId, peaks }), 'utf8')
      db.insert(schema.mediaAssets)
        .values({ songId, kind: 'waveform', path: wavePath, bytes: null })
        .onConflictDoNothing()
        .run()
    } catch {
      /* waveform is a nicety, never fail the import over it */
    }

    ensureProgressRows(songId, [PRACTICE_INSTRUMENT])

    report.details.push({
      file,
      action: match.songId ? 'matched' : 'created',
      songId,
      songTitle: title,
      note: `${probe.codec} ${probe.sampleRate}Hz ${
        probe.bitrateKbps ? probe.bitrateKbps + 'kbps ' : ''
      }${(probe.durationMs / 60000).toFixed(2)}min${
        lufs !== null ? ` · ${lufs.toFixed(1)} LUFS` : ''
      }${match.songId ? ` — casou (${match.reason})` : ''}`
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    report.errors.push({ file, message })
    report.details.push({ file, action: 'error', note: message })
  }
}

export async function importAudioDir(dir = config.paths.songs): Promise<ImportReport> {
  const report = emptyReport()
  if (!(await ffmpegAvailable())) {
    report.errors.push({ file: dir, message: 'FFmpeg não encontrado no PATH' })
    return report
  }
  const files = listFiles(dir, AUDIO_EXT)
  report.scanned = files.length
  mkdirSync(config.paths.waveforms, { recursive: true })
  for (const file of files) await ingestAudioFile(file, report)
  return report
}

/**
 * Import an audio file that was just downloaded into songs/ and hang it on the
 * song the user was looking at. Loudness and waveform are measured here too, so
 * a downloaded track behaves exactly like one the user dropped in the folder.
 */
export async function attachAudioFile(songId: number, file: string): Promise<ImportReport> {
  const report = emptyReport()
  report.scanned = 1
  if (!(await ffmpegAvailable())) {
    report.errors.push({ file, message: 'FFmpeg não encontrado no PATH' })
    return report
  }
  mkdirSync(config.paths.waveforms, { recursive: true })
  await ingestAudioFile(file, report, songId)
  return report
}

/** Guitar Pro first: it carries sections and tunings that audio matching benefits from. */
export async function importAll(): Promise<{ guitarPro: ImportReport; audio: ImportReport }> {
  const guitarPro = await importGuitarProDir()
  const audio = await importAudioDir()
  return { guitarPro, audio }
}
