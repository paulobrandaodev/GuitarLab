import type { CSSProperties, ReactNode } from 'react'

/** Directives that only repeat what the screen already shows in its header. */
const META_DIRECTIVES = new Set([
  'title',
  't',
  'subtitle',
  'st',
  'artist',
  'composer',
  'album',
  'year',
  'key',
  'tempo',
  'time',
  'duration',
  'capo'
])

interface ChordAt {
  /** Column, in characters, of the lyric this chord sits over. */
  col: number
  text: string
}

/**
 * Split one ChordPro line into its lyric and the chords above it.
 *
 * The chord row is built as a padded string rather than as absolutely
 * positioned spans. Overlaying them looked right on a chart with a chord every
 * few words and fell apart on a real one: two chords on the same short word
 * printed on top of each other ("Bmaj7F#5"), and at stage-mode type sizes that
 * is most of the chart. A padded row in a monospace font cannot overlap — the
 * cursor only ever moves forward, so a chord that would land on top of its
 * neighbour is pushed one space to the right instead, which is exactly what a
 * chord sheet typed by hand does.
 */
function splitLine(line: string): { lyric: string; chordRow: string } {
  const parts = line.split(/(\[[^\]]+\])/g).filter(Boolean)
  let lyric = ''
  const chords: ChordAt[] = []

  for (const part of parts) {
    if (part.startsWith('[') && part.endsWith(']')) {
      chords.push({ col: lyric.length, text: part.slice(1, -1) })
    } else {
      lyric += part
    }
  }

  let chordRow = ''
  for (const chord of chords) {
    // never step backwards: a chord that cannot fit where it belongs goes one
    // space after the previous one rather than over it
    const at = Math.max(chord.col, chordRow.length ? chordRow.length + 1 : 0)
    chordRow += ' '.repeat(at - chordRow.length) + chord.text
  }

  return { lyric, chordRow }
}

/**
 * Minimal ChordPro renderer: a monospace chord row above each lyric line, and
 * directives as headings.
 *
 * Sized from one number rather than from Tailwind classes because it is read at
 * two very different distances — at a desk in the song's chart tab, and from a
 * metre and a half away in stage mode, where the player wants to make it
 * bigger. Everything derives from `fontSize`, so the two views cannot drift.
 */
export function ChordProView({
  content,
  fontSize = 13,
  hideMeta = false,
  className
}: {
  content: string
  /** Lyric size in px; the chords ride at 90% of it. */
  fontSize?: number
  /** Drop the title/artist/key/tempo directives — for a screen that already shows them. */
  hideMeta?: boolean
  className?: string
}): ReactNode {
  const lines = content.split(/\r?\n/)
  const style: CSSProperties = { fontSize, lineHeight: 1.35 }
  const chordStyle: CSSProperties = { fontSize: Math.round(fontSize * 0.9) }

  return (
    <div className={className} style={style}>
      {lines.map((line, i) => {
        const directive = line.match(/^\{(\w+)\s*:?\s*(.*)\}$/)
        if (directive) {
          const [, rawKey, value] = directive
          const key = rawKey.toLowerCase()
          if (hideMeta && META_DIRECTIVES.has(key)) return null
          if (key === 'comment' || key === 'c') {
            return (
              <div key={i} className="text-txt-micro my-2 italic" style={chordStyle}>
                {value}
              </div>
            )
          }
          if (key.startsWith('start_of')) {
            return (
              <div key={i} className="micro-label mt-4 mb-1">
                {key.replace('start_of_', '')}
              </div>
            )
          }
          if (key.startsWith('end_of')) return <div key={i} style={{ height: fontSize * 0.6 }} />
          return (
            <div key={i} className="text-txt-dim" style={chordStyle}>
              <span className="micro-label mr-2">{rawKey}</span>
              {value}
            </div>
          )
        }

        if (!line.trim()) return <div key={i} style={{ height: fontSize }} />

        const { lyric, chordRow } = splitLine(line)
        return (
          <div key={i} className="mb-1 overflow-x-auto whitespace-pre">
            {chordRow && (
              <div className="text-accent-2 font-bold" style={chordStyle}>
                {chordRow}
              </div>
            )}
            {lyric.trim() && <div>{lyric}</div>}
          </div>
        )
      })}
    </div>
  )
}
