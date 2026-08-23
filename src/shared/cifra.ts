/**
 * Writing a cifra out of what the machine already heard.
 *
 * Two analyses land in the database separately and never meet: the chord track
 * the lab detects from the audio (`chord_map`), and the synced lyrics LRCLIB
 * serves (`lyrics`, format `lrc`). Each on its own is half a chart — chords with
 * no words, or words with no chords. Put the two on the same clock and the
 * ChordPro that every cifra site sells falls out of them.
 *
 * The alignment is arithmetic on the timestamps rather than a language-model
 * job on purpose: the timestamps are ground truth, and a model asked to "put
 * the chords in the right place" invents both.
 *
 * Free of Node and DOM imports so the renderer and the test script can use it.
 */

import type { ChordSpan } from './types'
import { mergeChordSpans, transposeChord } from './chords'

export interface CifraLyricLine {
  timeMs: number
  text: string
}

export interface CifraInput {
  title: string
  artist?: string | null
  musicalKey?: string | null
  bpm?: number | null
  /** Raw detector output; repeats and silences are collapsed in here. */
  spans: ChordSpan[]
  /** Timestamped lyrics. Empty means there is nothing to align against. */
  lines?: CifraLyricLine[]
  /** Untimed lyrics, used only when `lines` is empty. */
  plainLyrics?: string | null
  /** Song sections, used as headings when they line up with the lyrics. */
  sections?: Array<{ name: string; startMs: number | null }>
  /** Transpose the whole chart, for a guitar tuned somewhere else. */
  semitones?: number
}

/** How long the last lyric line is assumed to hold chords for. */
const LAST_LINE_TAIL_MS = 8000
/** A hole this big after a sung line is an instrumental, not a breath. */
const INSTRUMENTAL_GAP_MS = 6000
/** Chords per line when they are written without lyrics under them. */
const CHORDS_PER_LINE = 8

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Column indices a chord is allowed to sit on: the start of each word.
 *
 * Dropping a chord in the middle of a word is what makes generated charts look
 * machine-made, and it is unsingable besides — the player reads a chord as
 * landing on the syllable it is printed over.
 */
export function wordStarts(text: string): number[] {
  const starts: number[] = []
  for (let i = 0; i < text.length; i++) {
    const isStart = i === 0 ? /\S/.test(text[0]) : /\s/.test(text[i - 1]) && /\S/.test(text[i])
    if (isStart) starts.push(i)
  }
  if (!starts.length) starts.push(0)
  return starts
}

/** The free word start nearest `index`, or -1 when every column is taken. */
function snapToWord(starts: number[], index: number, taken: Set<number>): number {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (const start of starts) {
    if (taken.has(start)) continue
    const distance = Math.abs(start - index)
    if (distance < bestDistance) {
      bestDistance = distance
      best = start
    }
  }
  return best
}

/** `[Em]Walking [C]down` — chords spliced into one lyric line. */
export function placeChordsOnLine(
  text: string,
  placements: Array<{ label: string; ratio: number }>
): string {
  if (!placements.length) return text
  const starts = wordStarts(text)
  const taken = new Set<number>()
  const chosen: Array<{ label: string; index: number }> = []

  for (const placement of placements) {
    const target = Math.round(Math.max(0, Math.min(1, placement.ratio)) * text.length)
    const index = snapToWord(starts, target, taken)
    if (index === -1) {
      // more chord changes than words: the leftovers ride at the end of the line
      chosen.push({ label: placement.label, index: text.length })
      continue
    }
    taken.add(index)
    chosen.push({ label: placement.label, index })
  }

  // splice from the right so the earlier indices stay valid
  chosen.sort((a, b) => b.index - a.index)
  let out = text
  for (const item of chosen) {
    out = `${out.slice(0, item.index)}[${item.label}]${out.slice(item.index)}`
  }
  return out
}

/**
 * A run of chords with no words under them: intro, solo, instrumental break.
 *
 * The padding is real text and not decoration: the ChordPro reader draws a
 * chord as a label floating over the character that follows it, so a line of
 * bare `[Em][C][G]` stacks all three labels on the same spot. The spaces are
 * what spread them out.
 */
function chordOnlyLines(labels: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < labels.length; i += CHORDS_PER_LINE) {
    out.push(
      labels
        .slice(i, i + CHORDS_PER_LINE)
        .map((l) => `[${l}]      `)
        .join('')
        .trimEnd()
    )
  }
  return out
}

/**
 * Turn the detected chords and the lyrics into a ChordPro chart.
 *
 * Returns null when there is nothing honest to write — no chords at all, or
 * chords with no lyrics of either kind.
 */
export function buildChordPro(input: CifraInput): string | null {
  const semitones = input.semitones ?? 0
  const spans = mergeChordSpans(input.spans, { dropSilence: true }).map((s) => ({
    ...s,
    label: transposeChord(s.label, semitones)
  }))
  if (!spans.length) return null

  const head: string[] = [`{title: ${input.title}}`]
  if (input.artist) head.push(`{artist: ${input.artist}}`)
  if (input.musicalKey) head.push(`{key: ${transposeChord(input.musicalKey, semitones)}}`)
  if (input.bpm) head.push(`{tempo: ${Math.round(input.bpm)}}`)

  const sung = (input.lines ?? [])
    .filter((l) => Number.isFinite(l.timeMs) && l.text.trim().length > 0)
    .sort((a, b) => a.timeMs - b.timeMs)

  if (!sung.length) return [...head, ...gridBody(spans, input.plainLyrics)].join('\n')

  head.push('{comment: cifra gerada dos acordes detectados no áudio com a letra sincronizada}')

  const sections = (input.sections ?? [])
    .filter((s): s is { name: string; startMs: number } => typeof s.startMs === 'number')
    .sort((a, b) => a.startMs - b.startMs)
  let nextSection = 0

  const body: string[] = ['']
  let cursor = 0

  /** Chords starting inside [from, to), consumed in order from the cursor. */
  const takeSpans = (from: number, to: number): ChordSpan[] => {
    const taken: ChordSpan[] = []
    while (cursor < spans.length && spans[cursor].startMs < to) {
      if (spans[cursor].startMs >= from) taken.push(spans[cursor])
      cursor++
    }
    return taken
  }

  const pushSectionsUpTo = (ms: number): void => {
    while (nextSection < sections.length && sections[nextSection].startMs <= ms) {
      body.push(`{comment: ${sections[nextSection].name}}`, '')
      nextSection++
    }
  }

  const pushBlock = (title: string, labels: string[]): void => {
    if (!labels.length) return
    body.push('', `{comment: ${title}}`, ...chordOnlyLines(labels), '')
  }

  // everything before the first sung line is the intro
  pushSectionsUpTo(sung[0].timeMs - 1)
  pushBlock('intro', takeSpans(0, sung[0].timeMs).map((s) => s.label))

  for (let i = 0; i < sung.length; i++) {
    const line = sung[i]
    const next = sung[i + 1]
    const windowEnd = next ? next.timeMs : line.timeMs + LAST_LINE_TAIL_MS
    // a long hole after a line is a solo or a break; only the first stretch of
    // it belongs over the words
    const lineEnd = Math.min(windowEnd, line.timeMs + INSTRUMENTAL_GAP_MS)
    const width = Math.max(1, lineEnd - line.timeMs)

    pushSectionsUpTo(line.timeMs)

    const placements: Array<{ label: string; ratio: number }> = []
    // the chord already sounding when the line starts belongs on the first word
    const sounding = spans.find((s) => s.startMs <= line.timeMs && s.endMs > line.timeMs)
    if (sounding && sounding.startMs < line.timeMs) {
      placements.push({ label: sounding.label, ratio: 0 })
    }
    for (const span of takeSpans(line.timeMs, lineEnd)) {
      placements.push({ label: span.label, ratio: (span.startMs - line.timeMs) / width })
    }

    body.push(placeChordsOnLine(line.text.trim(), placements))

    if (lineEnd < windowEnd) {
      pushBlock('instrumental', takeSpans(lineEnd, windowEnd).map((s) => s.label))
    }
  }

  // chords still standing after the last sung line
  pushBlock('final', spans.slice(cursor).map((s) => s.label))

  return [...head, ...body].join('\n')
}

/** No timed lyrics: a chord grid with the clock in the margin. */
function gridBody(spans: ChordSpan[], plainLyrics: string | null | undefined): string[] {
  const plain = (plainLyrics ?? '').trim()
  const body: string[] = [
    plain
      ? '{comment: acordes detectados no áudio; a letra veio sem marcação de tempo, então os ' +
        'acordes ficam em grade com o tempo ao lado e a letra logo abaixo}'
      : '{comment: acordes detectados no áudio}',
    ''
  ]
  for (let i = 0; i < spans.length; i += CHORDS_PER_LINE) {
    const slice = spans.slice(i, i + CHORDS_PER_LINE)
    body.push(`{comment: ${timestamp(slice[0].startMs)}}`)
    body.push(...chordOnlyLines(slice.map((s) => s.label)))
  }
  if (plain) body.push('', '{comment: letra}', '', ...plain.split(/\r?\n/))
  return body
}

/** Whether a cifra can be generated, and what to say when it cannot. */
export function cifraReadiness(input: {
  hasChords: boolean
  hasLyrics: boolean
  syncedLyrics: boolean
}): { ready: boolean; reason: string } {
  if (!input.hasChords && !input.hasLyrics) {
    return { ready: false, reason: 'Precisa dos acordes detectados e da letra.' }
  }
  if (!input.hasChords) {
    return { ready: false, reason: 'Falta detectar os acordes no áudio.' }
  }
  if (!input.hasLyrics) {
    return { ready: false, reason: 'Falta a letra — busque no LRCLIB.' }
  }
  if (!input.syncedLyrics) {
    return {
      ready: true,
      reason: 'A letra não é sincronizada: sai uma grade de acordes com o tempo, e a letra abaixo.'
    }
  }
  return { ready: true, reason: 'Acordes e letra sincronizada — dá para cifrar linha a linha.' }
}
