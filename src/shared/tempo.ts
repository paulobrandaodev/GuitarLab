/**
 * Tempo maths for the stem player.
 *
 * Three things need the same grid and must never disagree about it: the
 * metronome that clicks over the stems, the A/B loop that snaps to the beat,
 * and the playhead that has to stay honest while the audio runs at 70% inside a
 * two-bar loop. They all read from here.
 *
 * Free of Node and DOM imports so the renderer and the test script can both use
 * it.
 */

/** The beat grid the metronome clicks on. Times are in seconds. */
export interface BeatGrid {
  /** Beat times in seconds, ascending. */
  times: number[]
  /** How many beats make a bar — the first beat of each bar is accented. */
  beatsPerBar: number
  /** `analysis` when the lab tracked real beats, `bpm` when it is a flat grid. */
  source: 'analysis' | 'bpm'
  bpm: number
}

/** "4/4" → 4. Anything unreadable falls back to four, which is nearly always right. */
export function parseBeatsPerBar(timeSignature: string | null | undefined): number {
  if (!timeSignature) return 4
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(timeSignature)
  if (!match) return 4
  const beats = Number.parseInt(match[1], 10)
  if (!Number.isFinite(beats) || beats < 1 || beats > 32) return 4
  return beats
}

/** Middle value of a list, used to read a tempo out of jittery beat spacing. */
function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Build the grid the metronome runs on.
 *
 * The beats the lab tracked win over the declared BPM: a real recording drifts,
 * speeds up into the chorus and sits a few milliseconds off a perfect grid, and
 * a click that ignores that drifts away from the band inside of a minute. The
 * flat BPM grid is the fallback for songs that only have a tempo number.
 *
 * Detected beats that stop before the end of the track are extended at their own
 * median spacing, so the click does not simply give up two thirds of the way in.
 */
export function buildBeatGrid(input: {
  bpm: number | null | undefined
  durationS: number
  beatsMs?: number[] | null
  timeSignature?: string | null
}): BeatGrid | null {
  const beatsPerBar = parseBeatsPerBar(input.timeSignature)
  const duration = Number.isFinite(input.durationS) && input.durationS > 0 ? input.durationS : 0

  const detected = (input.beatsMs ?? [])
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .map((ms) => ms / 1000)
    .sort((a, b) => a - b)

  if (detected.length >= 4) {
    const gaps: number[] = []
    for (let i = 1; i < detected.length; i++) {
      const gap = detected[i] - detected[i - 1]
      if (gap > 0.05 && gap < 4) gaps.push(gap)
    }
    const step = median(gaps)
    const times = [...detected]
    if (step > 0 && duration > 0) {
      let next = times[times.length - 1] + step
      // a guard on the count as well as on the time: a corrupt grid must not
      // spin here forever
      for (let i = 0; next < duration && i < 20_000; i++) {
        times.push(next)
        next += step
      }
    }
    return {
      times,
      beatsPerBar,
      source: 'analysis',
      bpm: step > 0 ? 60 / step : (input.bpm ?? 0)
    }
  }

  const bpm = input.bpm ?? 0
  if (!Number.isFinite(bpm) || bpm <= 0 || duration <= 0) return null
  const step = 60 / bpm
  const times: number[] = []
  for (let t = 0, i = 0; t < duration && i < 20_000; t += step, i++) times.push(t)
  return { times, beatsPerBar, source: 'bpm', bpm }
}

/** Index of the first beat at or after `seconds`, or `times.length` past the end. */
export function nextBeatIndex(grid: BeatGrid, seconds: number): number {
  let lo = 0
  let hi = grid.times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (grid.times[mid] < seconds) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The beat nearest `seconds` — what the A/B handles land on when snap is on. */
export function snapToBeat(grid: BeatGrid | null, seconds: number): number {
  if (!grid || !grid.times.length) return seconds
  const i = nextBeatIndex(grid, seconds)
  const after = grid.times[Math.min(i, grid.times.length - 1)]
  const before = grid.times[Math.max(0, i - 1)]
  return Math.abs(after - seconds) < Math.abs(seconds - before) ? after : before
}

/* ------------------------------------------------------------- playhead */

/** Where playback was, and how fast it is running, as one fixed reference. */
export interface PlayAnchor {
  /** AudioContext time at which `offset` was the sounding position. */
  ctxTime: number
  /** Song position, in seconds, sounding at `ctxTime`. */
  offset: number
  /** Song seconds per real second — the speed control, 0.7 for 70%. */
  rate: number
}

export interface LoopRegion {
  start: number
  end: number
}

/**
 * The playhead position now, and the anchor to keep using.
 *
 * The loop is native (`AudioBufferSourceNode.loop`), so nothing restarts when it
 * wraps and the clock has to work out the wrap on its own. When it does, the
 * anchor is moved to the *exact instant* the wrap happened rather than to "now":
 * moving it to now would round the wrap up to one animation frame every lap, and
 * a two-bar loop practised for five minutes would have the metronome a beat off
 * the audio by the end.
 *
 * The returned anchor is the same object when nothing wrapped, so callers can
 * use identity to tell a lap apart from an ordinary frame.
 */
export function resolvePosition(
  anchor: PlayAnchor,
  now: number,
  loop: LoopRegion | null
): { position: number; anchor: PlayAnchor } {
  const raw = anchor.offset + (now - anchor.ctxTime) * anchor.rate
  if (!loop) return { position: raw, anchor }

  const length = loop.end - loop.start
  if (length <= 0 || raw < loop.end) return { position: raw, anchor }

  const extra = raw - loop.end
  const cycles = Math.floor(extra / length)
  const position = loop.start + (extra - cycles * length)
  const wrappedAt = anchor.ctxTime + (loop.end - anchor.offset + cycles * length) / anchor.rate
  return { position, anchor: { ctxTime: wrappedAt, offset: loop.start, rate: anchor.rate } }
}

/** AudioContext time at which the song reaches `position` under this anchor. */
export function ctxTimeAt(anchor: PlayAnchor, position: number): number {
  return anchor.ctxTime + (position - anchor.offset) / anchor.rate
}
