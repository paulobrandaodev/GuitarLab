/**
 * Chord-track helpers, shared by the main process (which stores what the lab
 * detected) and the renderer (which draws and transposes it). Free of Node and
 * DOM imports so both sides — and the test script — can use it.
 */

import type { ChordSpan } from './types'

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** The detector answers in sharps; a pasted chart may not. */
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#'
}

/** Silence, or a stretch with no chord the detector would commit to. */
export const NO_CHORD = 'N'

/**
 * Move a chord symbol by `semitones`, keeping its quality.
 *
 * "F#m7" is root "F#" plus quality "m7" — only the root moves, which is why the
 * split happens before any arithmetic. Anything unparseable is returned as-is
 * rather than mangled.
 */
export function transposeChord(label: string, semitones: number): string {
  if (!label || label === NO_CHORD) return label
  if (semitones === 0) return label

  const match = /^([A-G][#b]?)(.*)$/.exec(label)
  if (!match) return label
  const [, rawRoot, quality] = match
  const root = FLAT_TO_SHARP[rawRoot] ?? rawRoot
  const index = SHARP.indexOf(root)
  if (index === -1) return label
  return `${SHARP[(index + ((semitones % 12) + 12)) % 12]}${quality}`
}

/** Index of the chord sounding at `ms`, or -1 before the first / after the last. */
export function spanAt(spans: ChordSpan[], ms: number): number {
  for (let i = 0; i < spans.length; i++) {
    if (ms >= spans[i].startMs && ms < spans[i].endMs) return i
  }
  return -1
}

/**
 * Turn whatever the container sent into spans that can be trusted.
 *
 * The analysis job is the one place where foreign JSON reaches the database, so
 * every field is coerced and every degenerate span (missing label, zero or
 * negative length, non-numeric bounds) is dropped here rather than blowing up
 * the screen later.
 */
export function normalizeChordSpans(raw: unknown): ChordSpan[] {
  if (!Array.isArray(raw)) return []
  const spans: ChordSpan[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (typeof item.label !== 'string' || !item.label) continue
    const startMs = Number(item.startMs)
    const endMs = Number(item.endMs)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    const confidence = Number(item.confidence)
    spans.push({
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      label: item.label,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
    })
  }
  return spans.sort((a, b) => a.startMs - b.startMs)
}

/** Distinct chords in the order they first appear — the song's vocabulary. */
export function distinctChords(spans: ChordSpan[], semitones = 0): string[] {
  const out: string[] = []
  for (const span of spans) {
    if (span.label === NO_CHORD) continue
    const label = transposeChord(span.label, semitones)
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/**
 * Collapse runs of the same chord into a single span.
 *
 * The detector answers one span per beat, so a bar of Em arrives as four
 * identical blocks. That is exactly right for the Chordify-style grid, and
 * exactly wrong for anything that reads as "what comes next" — the HUD over the
 * stems and the generated cifra both need the chord *changes*, not the beats.
 *
 * With `dropSilence` the `N` blocks are removed before merging, so a chord that
 * is interrupted by a short silence and comes back reads as one chord. That is
 * what a written cifra wants; the grid keeps its silences.
 */
export function mergeChordSpans(
  spans: ChordSpan[],
  opts: { dropSilence?: boolean } = {}
): ChordSpan[] {
  const source = opts.dropSilence ? spans.filter((s) => s.label !== NO_CHORD) : spans
  const out: ChordSpan[] = []
  for (const span of source) {
    const last = out[out.length - 1]
    if (last && last.label === span.label) {
      const lastMs = last.endMs - last.startMs
      const thisMs = span.endMs - span.startMs
      const total = lastMs + thisMs
      // duration-weighted, so one confident bar is not dragged down by a short
      // uncertain tail of the same chord
      last.confidence =
        total > 0 ? (last.confidence * lastMs + span.confidence * thisMs) / total : last.confidence
      last.endMs = Math.max(last.endMs, span.endMs)
      continue
    }
    out.push({ ...span })
  }
  return out
}
