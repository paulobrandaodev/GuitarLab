import { eq, and, desc, asc, isNull, sql } from 'drizzle-orm'
import { getDb, getSqlite, schema } from './client'
import { deleteSetlistRow, syncSetlistItems, type SyncResult } from './setlists'
import { findDuplicateSong, insertSongRow, type DuplicateSong } from './songs'
import { computeMastery, rollupMastery, setlistReadiness, statusFromMastery } from '../practice/readiness'
import { buildDailyQueue, gradeFromSession, reviewSrs, type QueueCandidate } from '../practice/srs'
import { PRACTICE_INSTRUMENT } from '@shared/types'
import type {
  ChordMapView,
  DailyQueueItem,
  Instrument,
  NewSetlistInput,
  NewSongInput,
  ProgressStatus,
  ProgressView,
  SectionView,
  SetlistItemView,
  SetlistView,
  SongView,
  TuningView,
  YoutubeRefView,
  MediaAssetView
} from '@shared/types'

function parseTuning(row: typeof schema.tunings.$inferSelect | undefined | null): TuningView | null {
  if (!row) return null
  let strings: string[] = []
  try {
    strings = JSON.parse(row.stringsJson) as string[]
  } catch {
    strings = []
  }
  return {
    id: row.id,
    name: row.name,
    instrument: row.instrument,
    stringCount: row.stringCount,
    strings
  }
}

interface SongRow {
  id: number
  title: string
  artist: string | null
  artistId: number | null
  album: string | null
  year: number | null
  genre: string | null
  durationMs: number | null
  musicalKey: string | null
  keySource: string | null
  bpm: number | null
  bpmSource: string | null
  timeSignature: string | null
  capo: number
  difficulty: number | null
  notes: string | null
  loudnessLufs: number | null
  tuningId: number | null
}

/** One pass over progress + assets so the list view never issues N+1 queries. */
function decorate(rows: SongRow[]): SongView[] {
  if (!rows.length) return []
  const sqlite = getSqlite()
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')

  const progressRows = sqlite
    .prepare(
      /*
       * Guitar only. A Guitar Pro file carries every track in the band, and the
       * importer used to open a progress row for each of them — so a song whose
       * guitar was solid still showed 30% because the untouched drum and bass
       * rows were averaged in. This app is for practising guitar; the other
       * instruments are not part of the number on screen.
       */
      `SELECT song_id, section_id, instrument, status, mastery, best_bpm, target_bpm, last_practiced_at
       FROM progress WHERE instrument = '${PRACTICE_INSTRUMENT}' AND song_id IN (${placeholders})`
    )
    .all(...ids) as Array<{
    song_id: number
    section_id: number | null
    instrument: Instrument
    status: ProgressStatus
    mastery: number
    best_bpm: number | null
    target_bpm: number | null
    last_practiced_at: number | null
  }>

  const assetRows = sqlite
    .prepare(`SELECT song_id, kind FROM media_assets WHERE song_id IN (${placeholders})`)
    .all(...ids) as Array<{ song_id: number; kind: string }>

  const tuningRows = getDb().select().from(schema.tunings).all()
  const tuningById = new Map(tuningRows.map((t) => [t.id, t]))

  const byId = new Map<number, { mastery: number[]; last: number | null; kinds: Set<string> }>()
  for (const id of ids) byId.set(id, { mastery: [], last: null, kinds: new Set() })

  for (const p of progressRows) {
    const bucket = byId.get(p.song_id)
    if (!bucket) continue
    const m = computeMastery(p.status, p.best_bpm, p.target_bpm)
    // stored mastery wins when it was set explicitly above the derived value
    bucket.mastery.push(Math.max(m, p.mastery ?? 0))
    if (p.last_practiced_at && (!bucket.last || p.last_practiced_at > bucket.last)) {
      bucket.last = p.last_practiced_at
    }
  }
  for (const a of assetRows) byId.get(a.song_id)?.kinds.add(a.kind)

  return rows.map((r) => {
    const bucket = byId.get(r.id)!
    const mastery = rollupMastery(bucket.mastery.map((m) => ({ mastery: m })))
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      artistId: r.artistId,
      album: r.album,
      year: r.year,
      genre: r.genre,
      durationMs: r.durationMs,
      musicalKey: r.musicalKey,
      keySource: r.keySource,
      bpm: r.bpm,
      bpmSource: r.bpmSource,
      timeSignature: r.timeSignature,
      capo: r.capo,
      difficulty: r.difficulty,
      notes: r.notes,
      loudnessLufs: r.loudnessLufs,
      tuning: parseTuning(r.tuningId ? tuningById.get(r.tuningId) : null),
      mastery,
      status: statusFromMastery(mastery),
      hasGuitarPro: bucket.kinds.has('guitarpro'),
      hasAudio: bucket.kinds.has('audio_master'),
      hasStems: [...bucket.kinds].some((k) => k.startsWith('stem_')),
      lastPracticedAt: bucket.last
    } satisfies SongView
  })
}

const SONG_SELECT = {
  id: schema.songs.id,
  title: schema.songs.title,
  artist: schema.artists.name,
  artistId: schema.songs.artistId,
  album: schema.songs.album,
  year: schema.songs.year,
  genre: schema.songs.genre,
  durationMs: schema.songs.durationMs,
  musicalKey: schema.songs.musicalKey,
  keySource: schema.songs.keySource,
  bpm: schema.songs.bpm,
  bpmSource: schema.songs.bpmSource,
  timeSignature: schema.songs.timeSignature,
  capo: schema.songs.capo,
  difficulty: schema.songs.difficulty,
  notes: schema.songs.notes,
  loudnessLufs: schema.songs.loudnessLufs,
  tuningId: schema.songs.tuningId
}

/* ------------------------------------------------------------------ songs */

export function listSongs(): SongView[] {
  const rows = getDb()
    .select(SONG_SELECT)
    .from(schema.songs)
    .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
    .orderBy(asc(schema.songs.title))
    .all()
  return decorate(rows as SongRow[])
}

export function getSong(id: number): SongView | null {
  const rows = getDb()
    .select(SONG_SELECT)
    .from(schema.songs)
    .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
    .where(eq(schema.songs.id, id))
    .all()
  return decorate(rows as SongRow[])[0] ?? null
}

export function updateSong(id: number, patch: Partial<typeof schema.songs.$inferInsert>): SongView | null {
  getDb()
    .update(schema.songs)
    .set({ ...patch, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.songs.id, id))
    .run()
  return getSong(id)
}

export function deleteSong(id: number): void {
  getDb().delete(schema.songs).where(eq(schema.songs.id, id)).run()
}

/** A song typed in by hand. Title and artist are required; the rest is not. */
export function createSong(input: NewSongInput): SongView {
  const id = insertSongRow(getSqlite(), input, PRACTICE_INSTRUMENT)
  if (input.setlistId) addSongToSetlist(input.setlistId, id)
  return getSong(id)!
}

/** The library song a hand-typed title and artist would duplicate, if any. */
export function findSongDuplicate(title: string, artist: string): DuplicateSong | null {
  return findDuplicateSong(getSqlite(), title, artist)
}

/* --------------------------------------------------------------- sections */

export function listSections(songId: number): SectionView[] {
  return getDb()
    .select()
    .from(schema.songSections)
    .where(eq(schema.songSections.songId, songId))
    .orderBy(asc(schema.songSections.position))
    .all() as SectionView[]
}

export function createSection(
  values: typeof schema.songSections.$inferInsert
): SectionView {
  return getDb().insert(schema.songSections).values(values).returning().get() as SectionView
}

export function updateSection(id: number, patch: Partial<typeof schema.songSections.$inferInsert>): void {
  getDb().update(schema.songSections).set(patch).where(eq(schema.songSections.id, id)).run()
}

/**
 * Swap a song's whole section list for a new one, in one transaction.
 *
 * Sections are what the practice loop, the per-trecho progress and the study
 * queue hang off, so this deletes rows that other tables point at — the
 * cascades take the progress and the queue pins with them. That is the intended
 * behaviour (the old trechos no longer exist) but it is destructive enough that
 * the screen asks before calling it.
 */
export function replaceSections(
  songId: number,
  sections: Array<Omit<typeof schema.songSections.$inferInsert, 'songId' | 'position'>>
): SectionView[] {
  const sqlite = getSqlite()
  const tx = sqlite.transaction(() => {
    getDb().delete(schema.songSections).where(eq(schema.songSections.songId, songId)).run()
    sections.forEach((values, position) => {
      getDb()
        .insert(schema.songSections)
        .values({ ...values, songId, position })
        .run()
    })
  })
  tx()
  return listSections(songId)
}

export function deleteSection(id: number): void {
  getDb().delete(schema.songSections).where(eq(schema.songSections.id, id)).run()
}

/* --------------------------------------------------------------- setlists */

export function listSetlists(): SetlistView[] {
  const db = getDb()
  const lists = db.select().from(schema.setlists).orderBy(desc(schema.setlists.isActive)).all()
  return lists.map((l) => {
    const items = db
      .select(SONG_SELECT)
      .from(schema.setlistItems)
      .innerJoin(schema.songs, eq(schema.setlistItems.songId, schema.songs.id))
      .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
      .where(eq(schema.setlistItems.setlistId, l.id))
      .all()
    const songs = decorate(items as SongRow[])
    return {
      id: l.id,
      name: l.name,
      band: l.band,
      spotifyPlaylistId: l.spotifyPlaylistId,
      eventDate: l.eventDate,
      venue: l.venue,
      notes: l.notes,
      targetReadyDate: l.targetReadyDate,
      isActive: l.isActive,
      songCount: songs.length,
      totalDurationMs: songs.reduce((a, s) => a + (s.durationMs ?? 0), 0),
      readiness: setlistReadiness(songs.map((s) => s.mastery))
    } satisfies SetlistView
  })
}

export function getSetlistItems(setlistId: number): SetlistItemView[] {
  const db = getDb()
  const rows = db
    .select({
      itemId: schema.setlistItems.id,
      position: schema.setlistItems.position,
      plannedKey: schema.setlistItems.plannedKey,
      transitionNote: schema.setlistItems.transitionNote,
      ...SONG_SELECT
    })
    .from(schema.setlistItems)
    .innerJoin(schema.songs, eq(schema.setlistItems.songId, schema.songs.id))
    .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
    .where(eq(schema.setlistItems.setlistId, setlistId))
    .orderBy(asc(schema.setlistItems.position))
    .all()

  const songs = decorate(rows as unknown as SongRow[])
  return rows.map((r, i) => ({
    itemId: r.itemId,
    position: r.position,
    plannedKey: r.plannedKey,
    transitionNote: r.transitionNote,
    song: songs[i]
  }))
}

/**
 * A new, empty setlist.
 *
 * Only the name is required — a set typed in the morning of the show has a
 * name and nothing else, and the date, the venue and the notes are things the
 * user fills in when they know them.
 */
export function createSetlist(
  name: string,
  band?: string | null,
  spotifyPlaylistId?: string | null,
  extra?: Omit<NewSetlistInput, 'name' | 'band'>
): SetlistView {
  const row = getDb()
    .insert(schema.setlists)
    .values({
      name,
      band: band ?? null,
      spotifyPlaylistId: spotifyPlaylistId ?? null,
      eventDate: extra?.eventDate ?? null,
      venue: extra?.venue ?? null,
      notes: extra?.notes ?? null
    })
    .returning()
    .get()
  return listSetlists().find((s) => s.id === row.id)!
}

/** Delete a setlist without touching the songs it points at. */
export function deleteSetlist(id: number): void {
  deleteSetlistRow(getSqlite(), id)
}

/** The setlist already imported from a given Spotify playlist, if any. */
export function findSetlistBySpotifyPlaylist(playlistId: string): SetlistView | null {
  const row = getDb()
    .select()
    .from(schema.setlists)
    .where(eq(schema.setlists.spotifyPlaylistId, playlistId))
    .get()
  if (!row) return null
  return listSetlists().find((s) => s.id === row.id) ?? null
}

/** Make the setlist hold exactly these songs, in this order. */
export function syncSetlistSongs(setlistId: number, orderedSongIds: number[]): SyncResult {
  return syncSetlistItems(getSqlite(), setlistId, orderedSongIds)
}

/** Distinct band names already in use, for the setlist picker. */
export function listBands(): string[] {
  const rows = getSqlite()
    .prepare("SELECT DISTINCT band FROM setlists WHERE band IS NOT NULL AND band <> '' ORDER BY band")
    .all() as Array<{ band: string }>
  return rows.map((r) => r.band)
}

/** Drop a song from a setlist by song id rather than item id. */
export function removeSongFromSetlist(setlistId: number, songId: number): void {
  getSqlite()
    .prepare('DELETE FROM setlist_items WHERE setlist_id = ? AND song_id = ?')
    .run(setlistId, songId)
}

export function addSongToSetlist(setlistId: number, songId: number): void {
  const db = getDb()
  const max = db
    .select({ m: sql<number>`COALESCE(MAX(${schema.setlistItems.position}), -1)` })
    .from(schema.setlistItems)
    .where(eq(schema.setlistItems.setlistId, setlistId))
    .get()
  db.insert(schema.setlistItems)
    .values({ setlistId, songId, position: (max?.m ?? -1) + 1 })
    .onConflictDoNothing()
    .run()
}

export function removeSetlistItem(itemId: number): void {
  getDb().delete(schema.setlistItems).where(eq(schema.setlistItems.id, itemId)).run()
}

export function reorderSetlist(setlistId: number, orderedItemIds: number[]): void {
  const sqlite = getSqlite()
  const stmt = sqlite.prepare('UPDATE setlist_items SET position = ? WHERE id = ? AND setlist_id = ?')
  const tx = sqlite.transaction(() => {
    orderedItemIds.forEach((id, i) => stmt.run(i, id, setlistId))
  })
  tx()
}

export function setActiveSetlist(setlistId: number): void {
  const sqlite = getSqlite()
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE setlists SET is_active = 0').run()
    sqlite.prepare('UPDATE setlists SET is_active = 1 WHERE id = ?').run(setlistId)
  })
  tx()
}

export function updateSetlist(id: number, patch: Partial<typeof schema.setlists.$inferInsert>): void {
  getDb().update(schema.setlists).set(patch).where(eq(schema.setlists.id, id)).run()
}

/* --------------------------------------------------------------- progress */

export function listProgress(songId: number): ProgressView[] {
  const rows = getDb()
    .select()
    .from(schema.progress)
    // guitar only — see the note in `decorate`
    .where(
      and(
        eq(schema.progress.songId, songId),
        eq(schema.progress.instrument, PRACTICE_INSTRUMENT)
      )
    )
    .all()
  return rows.map((r) => ({
    id: r.id,
    songId: r.songId,
    sectionId: r.sectionId,
    instrument: r.instrument,
    status: r.status,
    mastery: Math.max(r.mastery, computeMastery(r.status, r.bestBpm, r.targetBpm)),
    bestBpm: r.bestBpm,
    targetBpm: r.targetBpm,
    lastPracticedAt: r.lastPracticedAt,
    srsDueAt: r.srsDueAt
  }))
}

export function setProgressStatus(
  songId: number,
  instrument: Instrument,
  sectionId: number | null,
  status: ProgressStatus
): void {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.songId, songId),
        eq(schema.progress.instrument, instrument),
        sectionId === null ? isNull(schema.progress.sectionId) : eq(schema.progress.sectionId, sectionId)
      )
    )
    .get()

  const mastery = computeMastery(status, existing?.bestBpm ?? null, existing?.targetBpm ?? null)
  const now = Math.floor(Date.now() / 1000)

  if (existing) {
    db.update(schema.progress)
      .set({ status, mastery, updatedAt: now })
      .where(eq(schema.progress.id, existing.id))
      .run()
  } else {
    db.insert(schema.progress)
      .values({ songId, instrument, sectionId, status, mastery, updatedAt: now })
      .run()
  }
}

export function setTargetBpm(
  songId: number,
  instrument: Instrument,
  sectionId: number | null,
  targetBpm: number
): void {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.songId, songId),
        eq(schema.progress.instrument, instrument),
        sectionId === null ? isNull(schema.progress.sectionId) : eq(schema.progress.sectionId, sectionId)
      )
    )
    .get()
  if (existing) {
    db.update(schema.progress).set({ targetBpm }).where(eq(schema.progress.id, existing.id)).run()
  } else {
    db.insert(schema.progress).values({ songId, instrument, sectionId, targetBpm }).run()
  }
}

/* -------------------------------------------------------------- sessions */

export interface RecordSessionInput {
  songId: number
  sectionId: number | null
  instrument: Instrument
  durationS: number
  bpmTarget: number | null
  bpmAchieved: number | null
  cleanPasses: number
  totalPasses: number
  mode: 'gp_synth' | 'stems' | 'youtube' | 'spotify' | 'metronome' | 'freeplay'
  notes?: string | null
}

/** Log the session, advance the tempo ladder, and reschedule the SRS card. */
export function recordSession(input: RecordSessionInput): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  db.insert(schema.practiceSessions)
    .values({
      songId: input.songId,
      sectionId: input.sectionId,
      instrument: input.instrument,
      startedAt: now - input.durationS,
      durationS: input.durationS,
      bpmTarget: input.bpmTarget,
      bpmAchieved: input.bpmAchieved,
      cleanPasses: input.cleanPasses,
      totalPasses: input.totalPasses,
      mode: input.mode,
      notes: input.notes ?? null
    })
    .run()

  const existing = db
    .select()
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.songId, input.songId),
        eq(schema.progress.instrument, input.instrument),
        input.sectionId === null
          ? isNull(schema.progress.sectionId)
          : eq(schema.progress.sectionId, input.sectionId)
      )
    )
    .get()

  const grade = gradeFromSession(
    input.cleanPasses,
    input.totalPasses,
    input.bpmAchieved,
    input.bpmTarget
  )
  const srs = reviewSrs(
    {
      ease: existing?.srsEase ?? 2.5,
      intervalDays: existing?.srsIntervalDays ?? 0,
      reps: existing?.srsReps ?? 0,
      dueAt: existing?.srsDueAt ?? null
    },
    grade,
    now
  )

  const bestBpm = Math.max(existing?.bestBpm ?? 0, input.bpmAchieved ?? 0) || null
  const targetBpm = input.bpmTarget ?? existing?.targetBpm ?? null
  const status = existing?.status ?? 'learning'
  const mastery = computeMastery(status, bestBpm, targetBpm)

  if (existing) {
    db.update(schema.progress)
      .set({
        bestBpm,
        targetBpm,
        mastery: Math.max(existing.mastery, mastery),
        lastPracticedAt: now,
        srsEase: srs.ease,
        srsIntervalDays: srs.intervalDays,
        srsReps: srs.reps,
        srsDueAt: srs.dueAt,
        updatedAt: now
      })
      .where(eq(schema.progress.id, existing.id))
      .run()
  } else {
    db.insert(schema.progress)
      .values({
        songId: input.songId,
        sectionId: input.sectionId,
        instrument: input.instrument,
        status: 'learning',
        mastery,
        bestBpm,
        targetBpm,
        lastPracticedAt: now,
        srsEase: srs.ease,
        srsIntervalDays: srs.intervalDays,
        srsReps: srs.reps,
        srsDueAt: srs.dueAt
      })
      .run()
  }
}

/* ------------------------------------------------------------ daily queue */

export function getDailyQueue(budgetMinutes = 30): DailyQueueItem[] {
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT
         p.song_id      AS songId,
         s.title        AS songTitle,
         a.name         AS artist,
         p.section_id   AS sectionId,
         sec.name       AS sectionName,
         p.instrument   AS instrument,
         p.status       AS status,
         p.mastery      AS mastery,
         p.best_bpm     AS bestBpm,
         p.target_bpm   AS targetBpm,
         p.srs_due_at   AS dueAt,
         p.last_practiced_at AS lastPracticedAt,
         CASE WHEN si.id IS NOT NULL THEN 1 ELSE 0 END AS inActiveSetlist,
         sl.event_date  AS eventDate,
         CASE WHEN pq.id IS NOT NULL THEN 1 ELSE 0 END AS pinned
       FROM progress p
       JOIN songs s ON s.id = p.song_id
       LEFT JOIN artists a ON a.id = s.artist_id
       LEFT JOIN song_sections sec ON sec.id = p.section_id
       LEFT JOIN setlists sl ON sl.is_active = 1
       LEFT JOIN setlist_items si ON si.song_id = p.song_id AND si.setlist_id = sl.id
       -- what the user put on the list by hand. IS rather than = so a
       -- whole-song pin (section_id NULL) matches the whole-song progress row
       LEFT JOIN practice_queue pq
              ON pq.song_id = p.song_id AND pq.section_id IS p.section_id
       -- guitar only: a Guitar Pro file creates progress rows for every track it
       -- carries, and a drum row in the practice queue is noise for this user
       WHERE p.instrument = '${PRACTICE_INSTRUMENT}'
       -- pinned items keep the order they were added in; the rest is scored
       ORDER BY pq.position, pq.id`
    )
    .all() as Array<Record<string, unknown>>

  const nowSec = Math.floor(Date.now() / 1000)
  const candidates: QueueCandidate[] = rows.map((r) => {
    const eventDate = r.eventDate as number | null
    return {
      songId: r.songId as number,
      songTitle: r.songTitle as string,
      artist: (r.artist as string) ?? null,
      sectionId: (r.sectionId as number) ?? null,
      sectionName: (r.sectionName as string) ?? null,
      instrument: r.instrument as Instrument,
      status: r.status as ProgressStatus,
      mastery: r.mastery as number,
      bestBpm: (r.bestBpm as number) ?? null,
      targetBpm: (r.targetBpm as number) ?? null,
      dueAt: (r.dueAt as number) ?? null,
      lastPracticedAt: (r.lastPracticedAt as number) ?? null,
      inActiveSetlist: r.inActiveSetlist === 1,
      daysToShow: eventDate ? Math.ceil((eventDate - nowSec) / 86400) : null,
      pinned: r.pinned === 1
    }
  })

  return buildDailyQueue(candidates, budgetMinutes, nowSec)
}

/* ---------------------------------------------------------- queue pinning */

/**
 * Look up one pin. `sectionId` NULL means the whole song.
 *
 * SQLite treats NULLs as distinct inside a UNIQUE constraint, so the table
 * cannot enforce "one pin per song" on its own — every write goes through this
 * lookup instead.
 */
function findPin(songId: number, sectionId: number | null): { id: number } | undefined {
  return getSqlite()
    .prepare(
      'SELECT id FROM practice_queue WHERE song_id = ? AND section_id IS ? LIMIT 1'
    )
    .get(songId, sectionId) as { id: number } | undefined
}

export function isQueued(songId: number, sectionId: number | null = null): boolean {
  return Boolean(findPin(songId, sectionId))
}

/** Everything pinned, in the order it will be practised. */
export function listQueuePins(): Array<{
  songId: number
  sectionId: number | null
  songTitle: string
  artist: string | null
  sectionName: string | null
  addedAt: number
}> {
  return getSqlite()
    .prepare(
      `SELECT pq.song_id AS songId, pq.section_id AS sectionId, s.title AS songTitle,
              a.name AS artist, sec.name AS sectionName, pq.added_at AS addedAt
         FROM practice_queue pq
         JOIN songs s ON s.id = pq.song_id
         LEFT JOIN artists a ON a.id = s.artist_id
         LEFT JOIN song_sections sec ON sec.id = pq.section_id
        ORDER BY pq.position, pq.id`
    )
    .all() as ReturnType<typeof listQueuePins>
}

/**
 * Put a song or one of its sections on today's list.
 *
 * The daily queue is built from `progress`, so a section that was never given a
 * status has no row to be found under and would be pinned into invisibility.
 * Opening the row here is what makes "adicionar à fila" work on a song the user
 * has never touched — which is exactly when they are most likely to use it.
 */
export function addToQueue(songId: number, sectionId: number | null = null): void {
  const db = getDb()
  if (findPin(songId, sectionId)) return

  const existingProgress = db
    .select()
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.songId, songId),
        eq(schema.progress.instrument, PRACTICE_INSTRUMENT),
        sectionId === null
          ? isNull(schema.progress.sectionId)
          : eq(schema.progress.sectionId, sectionId)
      )
    )
    .get()
  if (!existingProgress) {
    db.insert(schema.progress)
      .values({ songId, sectionId, instrument: PRACTICE_INSTRUMENT })
      .run()
  }

  const last = getSqlite()
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM practice_queue')
    .get() as { p: number }
  db.insert(schema.practiceQueue).values({ songId, sectionId, position: last.p + 1 }).run()
}

export function removeFromQueue(songId: number, sectionId: number | null = null): void {
  getSqlite()
    .prepare('DELETE FROM practice_queue WHERE song_id = ? AND section_id IS ?')
    .run(songId, sectionId)
}

/** Take everything off — the "limpar fila" button. */
export function clearQueue(): void {
  getSqlite().prepare('DELETE FROM practice_queue').run()
}

/* ------------------------------------------------------------ media / yt */

export function listMedia(songId: number): MediaAssetView[] {
  const rows = getDb()
    .select()
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.songId, songId))
    .all()
  return rows.map((r) => ({
    id: r.id,
    songId: r.songId,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    meta: r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : null
  }))
}

export function listYoutubeRefs(songId: number): YoutubeRefView[] {
  return getDb()
    .select()
    .from(schema.youtubeRefs)
    .where(eq(schema.youtubeRefs.songId, songId))
    .orderBy(desc(schema.youtubeRefs.pinned), desc(schema.youtubeRefs.confidence))
    .all() as YoutubeRefView[]
}

/* --------------------------------------------------------------- charts */

export function listCharts(songId: number) {
  return getDb().select().from(schema.charts).where(eq(schema.charts.songId, songId)).all()
}

export function upsertChart(
  songId: number,
  kind: 'chords' | 'lyrics' | 'tab_text' | 'notes' | 'chord_map',
  format: 'chordpro' | 'lrc' | 'plain' | 'markdown' | 'json',
  content: string,
  sourceUrl?: string | null
) {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.charts)
    .where(and(eq(schema.charts.songId, songId), eq(schema.charts.kind, kind)))
    .get()
  const now = Math.floor(Date.now() / 1000)
  if (existing) {
    db.update(schema.charts)
      .set({ content, format, sourceUrl: sourceUrl ?? existing.sourceUrl, updatedAt: now })
      .where(eq(schema.charts.id, existing.id))
      .run()
    return existing.id
  }
  const row = db
    .insert(schema.charts)
    .values({ songId, kind, format, content, sourceUrl: sourceUrl ?? null, updatedAt: now })
    .returning()
    .get()
  return row.id
}

/* ------------------------------------------------------------ chord map */

/**
 * The detected chord track. It lives in `charts` as a `chord_map` row holding
 * JSON, next to the human-written ChordPro `chords` row — they answer different
 * questions and the user must be able to keep both.
 */
export function getChordMap(songId: number): ChordMapView | null {
  const row = getDb()
    .select()
    .from(schema.charts)
    .where(and(eq(schema.charts.songId, songId), eq(schema.charts.kind, 'chord_map')))
    .get()
  if (!row) return null
  try {
    const parsed = JSON.parse(row.content) as Omit<ChordMapView, 'songId' | 'updatedAt'>
    return { ...parsed, songId, updatedAt: row.updatedAt }
  } catch {
    return null
  }
}

export function saveChordMap(
  songId: number,
  map: Omit<ChordMapView, 'songId' | 'updatedAt'>
): void {
  upsertChart(songId, 'chord_map', 'json', JSON.stringify(map))
}

export function deleteChordMap(songId: number): void {
  getDb()
    .delete(schema.charts)
    .where(and(eq(schema.charts.songId, songId), eq(schema.charts.kind, 'chord_map')))
    .run()
}

/* --------------------------------------------------------------- tunings */

export function listTunings(): TuningView[] {
  return getDb()
    .select()
    .from(schema.tunings)
    .orderBy(asc(schema.tunings.instrument), asc(schema.tunings.name))
    .all()
    .map((t) => parseTuning(t)!)
}

/* -------------------------------------------------------------- insights */

/**
 * The AI answers, kept so the same question is not paid for twice.
 *
 * Asking the model costs a request, a quota slice and fifteen seconds of
 * waiting, and the answer does not change between one opening of the screen and
 * the next — so it is written down and read back. Everything that asks for one
 * offers a "gerar de novo" button, which is what a real refresh goes through.
 *
 * One row per (song, kind, section): a second answer replaces the first rather
 * than piling up history nobody reads.
 */
export type InsightKind =
  | 'practice_plan'
  | 'technique_breakdown'
  | 'tone_advice'
  | 'structure_summary'
  | 'daily_plan'

export interface InsightView {
  content: string
  provider: string | null
  model: string | null
  createdAt: number
}

export function getInsight(
  songId: number,
  kind: InsightKind,
  sectionId: number | null = null
): InsightView | null {
  const row = getSqlite()
    .prepare(
      `SELECT content_md AS content, provider, model, created_at AS createdAt
         FROM llm_insights
        WHERE song_id = ? AND kind = ? AND section_id IS ?
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(songId, kind, sectionId) as InsightView | undefined
  return row ?? null
}

export function saveInsight(input: {
  songId: number
  kind: InsightKind
  sectionId?: number | null
  content: string
  provider: string | null
  model: string | null
}): void {
  const sqlite = getSqlite()
  const sectionId = input.sectionId ?? null
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare('DELETE FROM llm_insights WHERE song_id = ? AND kind = ? AND section_id IS ?')
      .run(input.songId, input.kind, sectionId)
    sqlite
      .prepare(
        `INSERT INTO llm_insights (song_id, kind, section_id, content_md, provider, model)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.songId, input.kind, sectionId, input.content, input.provider, input.model)
  })
  tx()
}


export function statsOverview() {
  const sqlite = getSqlite()
  const totals = sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM songs) AS songs,
         (SELECT COUNT(*) FROM practice_sessions) AS sessions,
         (SELECT COALESCE(SUM(duration_s),0) FROM practice_sessions) AS totalSeconds,
         (SELECT COUNT(*) FROM media_assets WHERE kind='guitarpro') AS gpFiles,
         (SELECT COUNT(*) FROM media_assets WHERE kind='audio_master') AS audioFiles`
    )
    .get() as Record<string, number>

  const heatmap = sqlite
    .prepare(
      `SELECT date(started_at,'unixepoch') AS day, SUM(duration_s) AS seconds, COUNT(*) AS sessions
       FROM practice_sessions
       WHERE started_at > unixepoch() - 86400*365
       GROUP BY day ORDER BY day`
    )
    .all() as Array<{ day: string; seconds: number; sessions: number }>

  const bpmProgress = sqlite
    .prepare(
      `SELECT s.title AS song, ps.instrument, date(ps.started_at,'unixepoch') AS day,
              MAX(ps.bpm_achieved) AS bpm
       FROM practice_sessions ps JOIN songs s ON s.id = ps.song_id
       WHERE ps.bpm_achieved IS NOT NULL AND ps.instrument = '${PRACTICE_INSTRUMENT}'
       GROUP BY s.title, ps.instrument, day ORDER BY day`
    )
    .all() as Array<{ song: string; instrument: string; day: string; bpm: number }>

  return { totals, heatmap, bpmProgress }
}

/* -------------------------------------------------------- app settings */

export function getSetting(key: string): string | null {
  const row = getDb()
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get()
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    .run()
}

/* --------------------------------------------------------- gear patches */

/**
 * One saved patch per song and instrument: asking the AI again overwrites the
 * previous suggestion rather than piling up near-identical rows.
 */
export function upsertGearPatch(input: {
  songId: number
  instrument: Instrument
  device: string
  patchName: string
  settingsJson: string
  notes?: string | null
}): void {
  const sqlite = getSqlite()
  const existing = sqlite
    .prepare('SELECT id FROM gear_patches WHERE song_id = ? AND instrument = ?')
    .get(input.songId, input.instrument) as { id: number } | undefined

  if (existing) {
    sqlite
      .prepare(
        'UPDATE gear_patches SET device = ?, patch_name = ?, settings_json = ?, notes = ? WHERE id = ?'
      )
      .run(input.device, input.patchName, input.settingsJson, input.notes ?? null, existing.id)
    return
  }
  getDb()
    .insert(schema.gearPatches)
    .values({
      songId: input.songId,
      instrument: input.instrument,
      device: input.device,
      patchName: input.patchName,
      settingsJson: input.settingsJson,
      notes: input.notes ?? null
    })
    .run()
}

export function getGearPatch(
  songId: number,
  instrument: Instrument = 'guitar'
): { device: string | null; patchName: string | null; settingsJson: string | null } | null {
  const row = getSqlite()
    .prepare(
      'SELECT device, patch_name AS patchName, settings_json AS settingsJson FROM gear_patches WHERE song_id = ? AND instrument = ?'
    )
    .get(songId, instrument) as
    | { device: string | null; patchName: string | null; settingsJson: string | null }
    | undefined
  return row ?? null
}
