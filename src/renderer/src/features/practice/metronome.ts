/**
 * The click that runs over the stems.
 *
 * A short sine burst rather than a sample: it starts exactly on the scheduled
 * AudioContext time, needs no file to load, and is easy to keep out of the way
 * of a distorted guitar by sitting above it.
 */
export interface Metronome {
  /** Where the clicks come out; the caller decides what they feed into. */
  output: GainNode
  /**
   * Schedule one click.
   *
   * `ratio` pre-compensates the pitch shift the click is about to go through
   * when it is routed into the time-stretcher — the processor multiplies
   * everything by `2^(semitones/12) ÷ playbackRate`, so dividing the oscillator
   * frequency by that keeps the click sounding the same at every speed.
   */
  click: (at: number, accent: boolean, ratio?: number) => void
  dispose: () => void
}

const BEAT_HZ = 1050
const ACCENT_HZ = 1560

export function createMetronome(ctx: AudioContext): Metronome {
  const output = ctx.createGain()
  output.gain.value = 0.5

  const click = (at: number, accent: boolean, ratio = 1): void => {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'sine'
    const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    osc.frequency.value = (accent ? ACCENT_HZ : BEAT_HZ) / safeRatio

    // a 1 ms attack instead of a step: a hard gate on a sine is a broadband pop
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.7, at + 0.001)
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.045)

    osc.connect(env)
    env.connect(output)
    osc.start(at)
    osc.stop(at + 0.06)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }

  return {
    output,
    click,
    dispose: () => {
      try {
        output.disconnect()
      } catch {
        /* context already closed */
      }
    }
  }
}

/**
 * A metronome with nothing to stay in sync with.
 *
 * The stem player's click hangs off the audio bus, because there it has to land
 * on the beat of a recording that is already playing. On stage there is no
 * recording — the band is the recording — so this one runs on its own clock and
 * only has to be steady.
 *
 * Clicks are queued a quarter second ahead from a `setInterval` rather than
 * fired one at a time, for the same reason as in the player: a timer callback
 * arrives late whenever the window is busy, and a metronome that drops a beat
 * while someone scrolls a chart is worse than no metronome at all. The
 * AudioContext clock is what the beats are actually pinned to; the interval
 * only decides how far ahead to fill it.
 */
export function startFreeMetronome(
  bpm: number,
  beatsPerBar: number
): { stop: () => void } {
  const ctx = new AudioContext()
  const metronome = createMetronome(ctx)
  metronome.output.connect(ctx.destination)

  const period = 60 / (bpm > 0 ? bpm : 120)
  const lookahead = 0.25
  const bar = Math.max(1, Math.round(beatsPerBar))

  // start a beat away, so the first click is scheduled rather than late
  let nextAt = ctx.currentTime + 0.12
  let beat = 0

  const pump = (): void => {
    while (nextAt < ctx.currentTime + lookahead) {
      metronome.click(nextAt, beat % bar === 0)
      nextAt += period
      beat++
    }
  }
  pump()
  const timer = setInterval(pump, 100)

  return {
    stop: () => {
      clearInterval(timer)
      metronome.dispose()
      void ctx.close()
    }
  }
}
