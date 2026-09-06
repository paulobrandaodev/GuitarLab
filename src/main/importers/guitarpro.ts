import * as alphaTab from '@coderline/alphatab'
import { readFileSync } from 'node:fs'
import { loadScoreRecovering } from '@shared/gp'
import type { GpParseResult, GpTrackInfo, Instrument, SectionKind } from '@shared/types'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNoteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Circle of fifths: index = number of accidentals, negative = flats. */
const MAJOR_KEYS: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#'
}
const MINOR_KEYS: Record<number, string> = {
  [-7]: 'Abm', [-6]: 'Ebm', [-5]: 'Bbm', [-4]: 'Fm', [-3]: 'Cm', [-2]: 'Gm', [-1]: 'Dm',
  0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m'
}

/**
 * Guitar Pro writes key signature 0 / major by default when the author never set
 * one, which is indistinguishable from a genuine C major. We return null in that
 * case so audio analysis can fill it in instead of us asserting a wrong key.
 */
function readKey(keySignature: number, keySignatureType: number): string | null {
  if (keySignature === 0 && keySignatureType === 0) return null
  const table = keySignatureType === 1 ? MINOR_KEYS : MAJOR_KEYS
  return table[keySignature] ?? null
}

/** General MIDI program ranges, plus the string count as a tie-breaker. */
function mapInstrument(
  program: number,
  isPercussion: boolean,
  stringCount: number,
  lowestMidi: number | null
): Instrument | null {
  if (isPercussion) return 'drums'
  if (program >= 32 && program <= 39) return 'bass'
  if (program >= 24 && program <= 31) return 'guitar'
  // 52-54 choir/voice, 85 "Lead 6 (voice)" — how GP authors usually mark vocals
  if ((program >= 52 && program <= 54) || program === 85) return 'vocals'
  if (stringCount === 4 || stringCount === 5) {
    // 4/5 strings tuned below the guitar range is a bass, whatever the program says
    if (lowestMidi !== null && lowestMidi < 40) return 'bass'
  }
  if (stringCount >= 6) return 'guitar'
  return null
}

/** GP authors use @#chords#@ / @#lyrics#@ pseudo-tracks to carry text, not audio. */
function isPseudoTrack(name: string): boolean {
  return /^@#.*#@$/.test(name.trim())
}

function classifySection(name: string): SectionKind {
  const n = name.toLowerCase()
  if (/intro/.test(n)) return 'intro'
  if (/pre.?chorus/.test(n)) return 'bridge'
  if (/chorus|refr/.test(n)) return 'chorus'
  if (/verse|estrofe/.test(n)) return 'verse'
  if (/solo/.test(n)) return 'solo'
  if (/bridge|ponte|interlude/.test(n)) return 'bridge'
  if (/outro|ending|fade/.test(n)) return 'outro'
  if (/riff/.test(n)) return 'riff'
  if (/breakdown/.test(n)) return 'breakdown'
  return 'other'
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return t.length ? t : null
}

export interface GpFullParse extends GpParseResult {
  /** Lyrics recovered from beat-level syllables, joined per line. */
  lyrics: string | null
  /** Chord symbols in bar order, from a chords track or beat chord annotations. */
  chordSymbols: Array<{ bar: number; name: string }>
}

/** Parse the file, falling back to the legacy code page when UTF-8 comes out broken. */
export function loadScore(path: string): alphaTab.model.Score {
  const bytes = new Uint8Array(readFileSync(path))
  const { score } = loadScoreRecovering((encoding) => {
    const settings = new alphaTab.Settings()
    settings.importer.encoding = encoding
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  })
  return score
}

export function parseGuitarProFile(path: string): GpFullParse {
  const score = loadScore(path)

  const firstBar = score.masterBars[0]
  const timeSignature = firstBar
    ? `${firstBar.timeSignatureNumerator}/${firstBar.timeSignatureDenominator}`
    : null

  const tracks: GpTrackInfo[] = []
  for (const track of score.tracks) {
    const staff = track.staves[0]
    const pi = track.playbackInfo
    // alphaTab returns tuning with the TOP tablature line first, i.e. highest
    // string. Everywhere else in this app tunings run low string first.
    const tuningMidi = [...(staff?.tuning ?? [])].reverse()
    const lowest = tuningMidi.length ? Math.min(...tuningMidi) : null
    const isPerc = Boolean(staff?.isPercussion || pi?.primaryChannel === 9)
    const pseudo = isPseudoTrack(track.name)

    tracks.push({
      index: track.index,
      name: clean(track.name) ?? `Trilha ${track.index + 1}`,
      midiProgram: pi?.program ?? 0,
      isPercussion: isPerc,
      stringCount: tuningMidi.length,
      tuning: tuningMidi.map(midiToNoteName),
      capo: staff?.capo ?? 0,
      instrument: pseudo
        ? null
        : mapInstrument(pi?.program ?? 0, isPerc, tuningMidi.length, lowest)
    })
  }

  // sections come from master bars that carry a section marker
  const sections: GpFullParse['sections'] = []
  const marked = score.masterBars.filter((b) => b.section)
  marked.forEach((bar, i) => {
    const next = marked[i + 1]
    sections.push({
      name: clean(bar.section?.text) ?? clean(bar.section?.marker) ?? `Seção ${i + 1}`,
      startBar: bar.index,
      endBar: next ? next.index - 1 : score.masterBars.length - 1
    })
  })

  return {
    title: clean(score.title),
    artist: clean(score.artist),
    album: clean(score.album),
    tempo: score.tempo || null,
    timeSignature,
    musicalKey: firstBar ? readKey(firstBar.keySignature, firstBar.keySignatureType) : null,
    barCount: score.masterBars.length,
    tracks,
    sections,
    lyrics: extractLyrics(score),
    chordSymbols: extractChords(score)
  }
}

/** Prefer a dedicated @#lyrics#@ track, else any track carrying syllables. */
function extractLyrics(score: alphaTab.model.Score): string | null {
  const candidates = [...score.tracks].sort((a, b) => {
    const aP = /lyrics/i.test(a.name) ? 0 : 1
    const bP = /lyrics/i.test(b.name) ? 0 : 1
    return aP - bP
  })

  for (const track of candidates) {
    const words: string[] = []
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            const syllables = beat.lyrics
            if (syllables?.length) {
              for (const s of syllables) if (s?.trim()) words.push(s.trim())
            }
          }
        }
      }
    }
    if (words.length > 8) {
      // GP stores syllables; '-' marks a mid-word hyphenation to re-join
      let text = words.join(' ')
      text = text.replace(/(\S)-\s+/g, '$1')
      return text.replace(/\s{2,}/g, ' ').trim()
    }
  }
  return null
}

function extractChords(score: alphaTab.model.Score): Array<{ bar: number; name: string }> {
  const out: Array<{ bar: number; name: string }> = []
  const chordTrack =
    score.tracks.find((t) => /chords/i.test(t.name)) ??
    score.tracks.find((t) => t.staves.some((s) => s.bars.length > 0))
  if (!chordTrack) return out

  for (const staff of chordTrack.staves) {
    staff.bars.forEach((bar, barIndex) => {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const name = clean(beat.chord?.name)
          if (name && out[out.length - 1]?.name !== name) {
            out.push({ bar: barIndex, name })
          }
        }
      }
    })
  }
  return out
}

export { classifySection }
