import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'

/**
 * Independent tempo and pitch for the stem player.
 *
 * Web Audio on its own cannot do this: `playbackRate` and `detune` on a buffer
 * source are both resampling, so half speed is also an octave down — useless for
 * learning a riff. SoundTouch (WSOLA time-stretch + rate transposer) is what
 * separates the two, and it runs on the render thread as an AudioWorklet.
 *
 * The division of labour is not obvious from the names. The *source* still does
 * the speed change with its own `playbackRate`, which drags the pitch along with
 * it; the node's `playbackRate` param tells the processor by how much to push
 * the pitch back (it computes `pitch × 2^(semitones/12) ÷ playbackRate`). So
 * both have to be set to the same number, and `pitchSemitones` is then a free
 * transposition on top.
 */
export type { SoundTouchNode }

/** One module registration per context; a second `addModule` would throw. */
const registrations = new WeakMap<BaseAudioContext, Promise<void>>()

/**
 * A stretcher for this context, or null when the worklet cannot be loaded.
 *
 * Null is a supported state, not a failure to report as an error: the player
 * falls back to plain resampling, where changing the speed also moves the pitch.
 */
export async function createStretcher(ctx: AudioContext): Promise<SoundTouchNode | null> {
  try {
    let pending = registrations.get(ctx)
    if (!pending) {
      pending = SoundTouchNode.register(ctx, processorUrl)
      registrations.set(ctx, pending)
    }
    await pending
    return new SoundTouchNode({ context: ctx, outputChannelCount: 2 })
  } catch (err) {
    // a closed context during unmount lands here too, which is why this is a
    // warning and not something the screen shows
    console.warn('[stems] worklet de time-stretch indisponível:', err)
    registrations.delete(ctx)
    return null
  }
}
