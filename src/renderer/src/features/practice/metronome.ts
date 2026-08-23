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
