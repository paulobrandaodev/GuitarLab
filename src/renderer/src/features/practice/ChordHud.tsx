import { type ReactNode } from 'react'
import { cx } from '../../components/ui'
import { transposeChord, spanAt, NO_CHORD } from '@shared/chords'
import type { ChordSpan } from '@shared/types'

/**
 * The chord you are on, big, with the ones around it.
 *
 * This is the head-up display over the stems: the chord sounding right now in
 * the hot gradient, the one before it small and faded, and the next two shrinking
 * away to the right. It reads like a teleprompter — you can see the change coming
 * a bar ahead without taking your eyes off the neck.
 *
 * It wants *changes*, not beats, which is why the caller passes chords that have
 * already been through `mergeChordSpans`: the detector emits one span per beat,
 * and "next chord: Em" while Em is playing helps nobody.
 */
export function ChordHud({
  spans,
  positionMs,
  semitones
}: {
  /** Already merged and transposition-free; `semitones` is applied here. */
  spans: ChordSpan[]
  positionMs: number
  semitones: number
}): ReactNode {
  if (!spans.length) return null

  let current = spanAt(spans, positionMs)
  if (current === -1) {
    // silences are dropped before this gets here, so a miss means either the
    // count-in before the first chord or a gap — in a gap the chord that was
    // last struck is still the one under your fingers
    for (let i = 0; i < spans.length && spans[i].startMs <= positionMs; i++) current = i
  }

  const label = (offset: number): string | null => {
    const span = spans[current + offset]
    if (!span || span.label === NO_CHORD) return null
    return transposeChord(span.label, semitones)
  }

  const now = current >= 0 ? spans[current] : null
  const elapsed = now ? (positionMs - now.startMs) / Math.max(1, now.endMs - now.startMs) : 0
  const progress = Math.max(0, Math.min(1, elapsed))

  const previous = label(-1)
  const next = label(1)
  const after = label(2)
  const nowLabel = current >= 0 ? label(0) : null

  return (
    <div className="neu-inset-sm flex items-center justify-center gap-5 rounded-[16px] px-4 py-2">
      <Slot text={previous} className="text-txt-micro w-16 text-right text-lg opacity-70" />

      <div className="flex min-w-[7rem] flex-col items-center">
        <span
          className={cx(
            'text-4xl leading-none font-black tracking-tight',
            nowLabel ? 'gradient-text' : 'text-txt-micro'
          )}
        >
          {nowLabel ?? (current < 0 ? '…' : '·')}
        </span>
        {/* how much of this chord is left, so the change never arrives as a surprise */}
        <span className="neu-inset-sm mt-1.5 h-1 w-24 overflow-hidden rounded-full">
          <span
            className="gradient-bg block h-full rounded-full"
            style={{ width: `${nowLabel ? progress * 100 : 0}%` }}
          />
        </span>
      </div>

      <Slot text={next} className="text-txt-dim w-16 text-2xl" />
      <Slot text={after} className="text-txt-micro w-14 text-base opacity-80" />
    </div>
  )
}

function Slot({ text, className }: { text: string | null; className: string }): ReactNode {
  return (
    <span className={cx('truncate font-bold tabular-nums', className)}>{text ?? ' '}</span>
  )
}
