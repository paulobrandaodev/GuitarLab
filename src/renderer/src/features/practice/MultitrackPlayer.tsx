import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { NeuButton, IconButton, Spinner, Badge, cx } from '../../components/ui'
import { IconPlay, IconPause, IconStop, IconLoop, IconMetronome } from '../../components/ui/icons'
import { ChordHud } from './ChordHud'
import { createMetronome, type Metronome } from './metronome'
import { createStretcher, type SoundTouchNode } from './stretcher'
import { api } from '../../lib/api'
import type { ChordMapView, MediaAssetView, SongView } from '@shared/types'
import { mergeChordSpans } from '@shared/chords'
import {
  buildBeatGrid,
  ctxTimeAt,
  nextBeatIndex,
  resolvePosition,
  snapToBeat,
  type BeatGrid,
  type LoopRegion,
  type PlayAnchor
} from '@shared/tempo'

/**
 * A small DAW-style transport for the separated stems plus the original mix.
 *
 * Every track is decoded into an AudioBuffer and played from one shared
 * AudioContext clock, so they stay sample-accurate against each other — an
 * <audio> element per stem drifts apart within seconds. Mute/solo are gain
 * changes, which is why they are instant and never desynchronise anything.
 *
 * The signal path is: source → per-track gain → bus → (time-stretcher) → out.
 * Everything that has to stay in time with the music hangs off the *bus*,
 * metronome included: the stretcher adds tens of milliseconds of latency, and a
 * click that skipped it would land ahead of the beat it is supposed to mark.
 */

export interface TrackSpec {
  id: string
  label: string
  path: string
  /** The full mix, shown first and muted by default when stems exist. */
  isOriginal?: boolean
}

interface LoadedTrack extends TrackSpec {
  buffer: AudioBuffer
  /** Downsampled absolute peaks, one value per pixel column. */
  peaks: Float32Array
}

const PEAK_RESOLUTION = 900
/** How far ahead of the audio clock metronome clicks are queued, in seconds. */
const LOOKAHEAD_S = 0.25
/** Shorter than this and an A/B loop is a machine gun, not a practice tool. */
const MIN_LOOP_S = 0.3
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

/** Collapse a decoded buffer into per-column peaks for the waveform. */
function computePeaks(buffer: AudioBuffer, columns = PEAK_RESOLUTION): Float32Array {
  const data = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(data.length / columns))
  const peaks = new Float32Array(columns)
  let max = 0
  for (let i = 0; i < columns; i++) {
    const start = i * block
    const end = Math.min(data.length, start + block)
    let peak = 0
    // stride keeps very long files cheap without visibly changing the shape
    const stride = Math.max(1, Math.floor((end - start) / 256))
    for (let j = start; j < end; j += stride) {
      const v = Math.abs(data[j])
      if (v > peak) peak = v
    }
    peaks[i] = peak
    if (peak > max) max = peak
  }
  // normalise so a quiet stem is still readable next to a loud one
  if (max > 0) for (let i = 0; i < columns; i++) peaks[i] /= max
  return peaks
}

const TRACK_COLORS: Record<string, string> = {
  original: '#8b8b98',
  vocals: '#ff4e8a',
  drums: '#ffd15c',
  bass: '#5cc8ff',
  guitar: '#ff8a5c',
  piano: '#3ddc84',
  other: '#a78bfa'
}

function colorFor(id: string): string {
  return TRACK_COLORS[id] ?? '#8b8b98'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/* --------------------------------------------------------------- waveform */

interface RegionControl {
  a: number | null
  b: number | null
  onChange: (a: number | null, b: number | null) => void
  /** Applied to every dragged value; identity when snap is off. */
  snap: (seconds: number) => number
}

/**
 * Waveform strip with the playhead drawn over it.
 *
 * The original mix gets a `region`, which turns the strip into the A/B loop
 * editor: drag across it to mark a stretch, drag either edge to trim it, click
 * anywhere else to seek. The distinction between a click and a drag is three
 * pixels of travel — without it, every attempt to seek would wipe the loop.
 */
function Waveform({
  peaks,
  color,
  progress,
  dimmed,
  duration,
  onSeek,
  region
}: {
  peaks: Float32Array
  color: string
  progress: number
  dimmed: boolean
  duration: number
  onSeek: (ratio: number) => void
  region?: RegionControl
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{
    mode: 'a' | 'b' | 'new'
    startX: number
    moved: boolean
    origin: number
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const width = parent.clientWidth
      const height = parent.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      const mid = height / 2
      const step = width / peaks.length
      ctx.globalAlpha = dimmed ? 0.28 : 1
      ctx.fillStyle = color
      for (let i = 0; i < peaks.length; i++) {
        const h = Math.max(1, peaks[i] * (height * 0.46))
        ctx.fillRect(i * step, mid - h, Math.max(1, step - 0.4), h * 2)
      }
      ctx.globalAlpha = 1
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [peaks, color, dimmed])

  const secondsAt = (clientX: number, element: HTMLElement): number => {
    const rect = element.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    const seconds = secondsAt(event.clientX, element)
    if (!region) {
      onSeek(duration > 0 ? seconds / duration : 0)
      return
    }

    const pxPerSecond = element.getBoundingClientRect().width / Math.max(0.001, duration)
    const nearA = region.a !== null && Math.abs((region.a - seconds) * pxPerSecond) <= 7
    const nearB = region.b !== null && Math.abs((region.b - seconds) * pxPerSecond) <= 7
    const mode: 'a' | 'b' | 'new' = nearA ? 'a' : nearB ? 'b' : 'new'

    element.setPointerCapture(event.pointerId)
    dragRef.current = { mode, startX: event.clientX, moved: false, origin: region.snap(seconds) }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || !region) return
    if (Math.abs(event.clientX - drag.startX) > 3) drag.moved = true
    if (!drag.moved) return

    const seconds = region.snap(secondsAt(event.clientX, event.currentTarget))
    if (drag.mode === 'new') {
      const start = Math.min(drag.origin, seconds)
      const end = Math.max(drag.origin, seconds)
      if (end - start >= MIN_LOOP_S) region.onChange(start, end)
      return
    }
    if (drag.mode === 'a') {
      const limit = (region.b ?? duration) - MIN_LOOP_S
      region.onChange(Math.max(0, Math.min(seconds, limit)), region.b)
      return
    }
    const floor = (region.a ?? 0) + MIN_LOOP_S
    region.onChange(region.a, Math.min(duration, Math.max(seconds, floor)))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || !region) return
    // a press that never travelled is a seek, whatever it landed on
    if (!drag.moved) onSeek(duration > 0 ? secondsAt(event.clientX, event.currentTarget) / duration : 0)
  }

  const percent = (seconds: number): number =>
    duration > 0 ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0
  const hasRegion = region && region.a !== null && region.b !== null

  return (
    <div
      className={cx(
        'neu-inset-sm relative h-12 flex-1 overflow-hidden rounded-[10px]',
        region ? 'cursor-crosshair' : 'cursor-pointer'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {hasRegion && region.a !== null && region.b !== null && (
        <div
          className="border-accent-2 pointer-events-none absolute top-0 bottom-0 border-x-2"
          style={{
            left: `${percent(region.a)}%`,
            width: `${percent(region.b) - percent(region.a)}%`,
            background: 'rgba(255,138,92,0.14)'
          }}
        >
          <span className="text-accent-2 absolute top-0 left-0.5 text-[9px] font-bold">A</span>
          <span className="text-accent-2 absolute top-0 right-0.5 text-[9px] font-bold">B</span>
        </div>
      )}

      <div
        className="bg-accent-2 pointer-events-none absolute top-0 bottom-0 w-px"
        style={{ left: `${progress * 100}%`, boxShadow: '0 0 6px rgba(255,138,92,0.9)' }}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- player */

export function MultitrackPlayer({
  song,
  media
}: {
  song: SongView
  media: MediaAssetView[]
}): ReactNode {
  const [tracks, setTracks] = useState<LoadedTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [soloed, setSoloed] = useState<Set<string>>(new Set())
  const [volumes, setVolumes] = useState<Record<string, number>>({})

  const [speed, setSpeed] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [stretcherReady, setStretcherReady] = useState(false)

  const [looping, setLooping] = useState(false)
  const [markA, setMarkA] = useState<number | null>(null)
  const [markB, setMarkB] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(true)

  const [metronomeOn, setMetronomeOn] = useState(false)
  const [metronomeVolume, setMetronomeVolume] = useState(0.5)

  const [chordMap, setChordMap] = useState<ChordMapView | null>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const busRef = useRef<GainNode | null>(null)
  const stretcherRef = useRef<SoundTouchNode | null>(null)
  const metronomeRef = useRef<Metronome | null>(null)
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  /** Where the playhead was, when, and how fast it is running. */
  const anchorRef = useRef<PlayAnchor>({ ctxTime: 0, offset: 0, rate: 1 })
  /** Bumped on every seek, restart and loop lap, to drop stale click schedules. */
  const genRef = useRef(0)
  const loopRef = useRef<LoopRegion | null>(null)
  const sourceRateRef = useRef(1)

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    const stems = media.filter((m) => m.kind.startsWith('stem_'))
    const master = media.find((m) => m.kind === 'audio_master')

    const specs: TrackSpec[] = []
    if (master) {
      specs.push({ id: 'original', label: 'Original', path: master.path, isOriginal: true })
    }
    for (const s of stems) {
      const id = s.kind.replace('stem_', '')
      specs.push({ id, label: id.charAt(0).toUpperCase() + id.slice(1), path: s.path })
    }

    if (!specs.length) {
      setLoading(false)
      setTracks([])
      return
    }

    let cancelled = false
    const ctx = new AudioContext()
    ctxRef.current = ctx
    const bus = ctx.createGain()
    busRef.current = bus
    bus.connect(ctx.destination)
    const metronome = createMetronome(ctx)
    metronome.output.connect(bus)
    metronomeRef.current = metronome
    setLoading(true)
    setError(null)

    // the worklet loads in parallel with the audio; until it answers, speed and
    // pitch fall back to plain resampling
    void createStretcher(ctx).then((node) => {
      if (cancelled || !node) return
      stretcherRef.current = node
      setStretcherReady(true)
    })

    void (async () => {
      const loaded: LoadedTrack[] = []
      try {
        for (const spec of specs) {
          if (cancelled) return
          setLoadingLabel(spec.label)
          const res = await fetch(api.mediaUrl(spec.path))
          if (!res.ok) throw new Error(`${spec.label}: HTTP ${res.status}`)
          const bytes = await res.arrayBuffer()
          // decodeAudioData detaches the buffer, so nothing else may touch it
          const buffer = await ctx.decodeAudioData(bytes)
          loaded.push({ ...spec, buffer, peaks: computePeaks(buffer) })
        }
        if (cancelled) return

        for (const t of loaded) {
          const gain = ctx.createGain()
          gain.connect(bus)
          gainsRef.current.set(t.id, gain)
        }
        setTracks(loaded)
        setDuration(Math.max(...loaded.map((t) => t.buffer.duration)))
        // with stems present the full mix starts muted, so soloing a stem is
        // audible immediately instead of buried under the original
        setMuted(loaded.length > 1 ? new Set(['original']) : new Set())
        setVolumes(Object.fromEntries(loaded.map((t) => [t.id, 1])))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      for (const node of sourcesRef.current) {
        try {
          node.stop()
        } catch {
          /* already stopped */
        }
      }
      sourcesRef.current = []
      gainsRef.current.clear()
      metronome.dispose()
      metronomeRef.current = null
      stretcherRef.current = null
      busRef.current = null
      setStretcherReady(false)
      void ctx.close()
      ctxRef.current = null
    }
  }, [media])

  /** The chord track, when the lab has already listened to this song. */
  useEffect(() => {
    let cancelled = false
    void api.chords.get(song.id).then((map) => {
      if (!cancelled) setChordMap(map)
    })
    return () => {
      cancelled = true
    }
  }, [song.id])

  /* ------------------------------------------------------------- mixing */

  /** Solo wins over mute: with anything soloed, everything else is silent. */
  const gainFor = useCallback(
    (id: string): number => {
      const vol = volumes[id] ?? 1
      if (soloed.size > 0) return soloed.has(id) ? vol : 0
      return muted.has(id) ? 0 : vol
    },
    [muted, soloed, volumes]
  )

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    for (const [id, gain] of gainsRef.current) {
      // a short ramp instead of a step, so toggling does not click
      gain.gain.setTargetAtTime(gainFor(id), ctx.currentTime, 0.01)
    }
  }, [gainFor])

  useEffect(() => {
    const ctx = ctxRef.current
    const metronome = metronomeRef.current
    if (!ctx || !metronome) return
    metronome.output.gain.setTargetAtTime(metronomeOn ? metronomeVolume : 0, ctx.currentTime, 0.01)
  }, [metronomeOn, metronomeVolume])

  /* ------------------------------------------------------------ playhead */

  /**
   * The position now, keeping the anchor honest across loop laps.
   *
   * Deliberately dependency-free so the animation frame and the click scheduler
   * share one instance and can never disagree about which lap they are on.
   */
  const advance = useCallback((): { position: number; anchor: PlayAnchor } => {
    const ctx = ctxRef.current
    const anchor = anchorRef.current
    if (!ctx || ctx.currentTime < anchor.ctxTime) return { position: anchor.offset, anchor }
    const resolved = resolvePosition(anchor, ctx.currentTime, loopRef.current)
    if (resolved.anchor !== anchor) {
      anchorRef.current = resolved.anchor
      genRef.current += 1
    }
    return resolved
  }, [])

  const stopSources = useCallback(() => {
    for (const node of sourcesRef.current) {
      try {
        node.stop()
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = []
  }, [])

  /**
   * The last instant every track can still wrap at together.
   *
   * Looping is native (`AudioBufferSourceNode.loop`), and the spec clamps
   * `loopEnd` to each buffer's own length. The master mix and the stems come out
   * of different encoders and differ by a few tens of milliseconds, so an
   * unclamped whole-song loop would send the short ones round early and leave
   * the mix smeared for the rest of the lap.
   */
  const loopLimit = useMemo(
    () => (tracks.length ? Math.min(...tracks.map((t) => t.buffer.duration)) : 0),
    [tracks]
  )

  const loopRegion = useMemo<LoopRegion | null>(() => {
    if (!looping || loopLimit <= 0) return null
    if (markA !== null && markB !== null) {
      // clamp first, then check the length: a B marked in the last few
      // milliseconds of the longest track must not collapse onto A
      const start = Math.min(markA, loopLimit)
      const end = Math.min(markB, loopLimit)
      if (end - start >= MIN_LOOP_S) return { start, end }
    }
    return { start: 0, end: loopLimit }
  }, [looping, markA, markB, loopLimit])

  const startAt = useCallback(
    (offset: number) => {
      const ctx = ctxRef.current
      if (!ctx || !tracks.length) return
      stopSources()

      const loop = loopRef.current
      // starting behind the loop is fine — it plays in and then wraps — but
      // starting past its end would never come back
      const from = loop && offset >= loop.end ? loop.start : Math.max(0, offset)
      const rate = sourceRateRef.current
      const when = ctx.currentTime + 0.06 // small lead so every source starts together

      for (const track of tracks) {
        const gain = gainsRef.current.get(track.id)
        if (!gain) continue
        const node = ctx.createBufferSource()
        node.buffer = track.buffer
        node.playbackRate.value = rate
        if (loop) {
          // the same bounds on every source: the region is already clamped to
          // the shortest track, so nobody wraps ahead of anybody else
          node.loop = true
          node.loopStart = loop.start
          node.loopEnd = loop.end
        }
        node.connect(gain)
        node.start(when, Math.min(from, track.buffer.duration))
        sourcesRef.current.push(node)
      }

      anchorRef.current = { ctxTime: when, offset: from, rate }
      genRef.current += 1
    },
    [tracks, stopSources]
  )

  const play = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !tracks.length) return
    void ctx.resume()
    startAt(position >= duration ? 0 : position)
    setPlaying(true)
  }, [startAt, position, duration, tracks.length])

  const pause = useCallback(() => {
    stopSources()
    setPlaying(false)
  }, [stopSources])

  const stop = useCallback(() => {
    stopSources()
    setPlaying(false)
    setPosition(0)
    const ctx = ctxRef.current
    anchorRef.current = {
      ctxTime: ctx?.currentTime ?? 0,
      offset: 0,
      rate: sourceRateRef.current
    }
    genRef.current += 1
  }, [stopSources])

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.min(Math.max(0, seconds), duration)
      setPosition(clamped)
      if (playing) {
        startAt(clamped)
        return
      }
      const ctx = ctxRef.current
      anchorRef.current = {
        ctxTime: ctx?.currentTime ?? 0,
        offset: clamped,
        rate: sourceRateRef.current
      }
      genRef.current += 1
    },
    [duration, playing, startAt]
  )

  /* --------------------------------------------------- speed, pitch, loop */

  /**
   * Rebuild the output path.
   *
   * The stretcher is only inserted when it has something to do: at 100% and no
   * transposition it would add its latency and its artefacts for nothing.
   */
  useEffect(() => {
    const ctx = ctxRef.current
    const bus = busRef.current
    if (!ctx || !bus) return
    const stretcher = stretcherRef.current
    const active = Boolean(stretcher) && (speed !== 1 || pitch !== 0)
    try {
      bus.disconnect()
      stretcher?.disconnect()
    } catch {
      /* nothing was connected */
    }
    if (active && stretcher) {
      bus.connect(stretcher)
      stretcher.connect(ctx.destination)
    } else {
      bus.connect(ctx.destination)
    }
  }, [speed, pitch, stretcherReady, tracks])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const stretcher = stretcherRef.current
    // without the worklet the source itself has to carry the transposition,
    // which drags the tempo along with it
    const rate = stretcher ? speed : speed * Math.pow(2, pitch / 12)
    sourceRateRef.current = rate

    const now = ctx.currentTime
    if (stretcher) {
      stretcher.playbackRate.setValueAtTime(speed, now)
      stretcher.pitchSemitones.setValueAtTime(pitch, now)
    }
    if (!sourcesRef.current.length) return

    // re-anchor on the position that is sounding right now, or the playhead
    // jumps by however long the old rate had been running
    const { position: current } = advance()
    for (const node of sourcesRef.current) node.playbackRate.setValueAtTime(rate, now)
    anchorRef.current = { ctxTime: now, offset: current, rate }
    genRef.current += 1
  }, [speed, pitch, stretcherReady, advance])

  useEffect(() => {
    loopRef.current = loopRegion
    for (const node of sourcesRef.current) {
      if (!loopRegion || !node.buffer) {
        node.loop = false
        continue
      }
      node.loop = true
      node.loopStart = loopRegion.start
      node.loopEnd = loopRegion.end
    }
    // a region set behind the playhead would never be reached: native looping
    // only wraps when playback runs into loopEnd
    if (loopRegion && sourcesRef.current.length) {
      const { position: current } = advance()
      if (current >= loopRegion.end) startAt(loopRegion.start)
    }
  }, [loopRegion, advance, startAt])

  /* ------------------------------------------------------------ the clock */

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      const { position: current } = advance()
      if (!loopRef.current && current >= duration) {
        stopSources()
        setPlaying(false)
        setPosition(duration)
        return
      }
      setPosition(Math.min(current, duration))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration, advance, stopSources])

  /* ----------------------------------------------------------- metronome */

  const grid = useMemo<BeatGrid | null>(
    () =>
      buildBeatGrid({
        bpm: song.bpm ?? chordMap?.bpm ?? null,
        durationS: duration,
        beatsMs: chordMap?.beatsMs,
        timeSignature: song.timeSignature
      }),
    [song.bpm, song.timeSignature, chordMap, duration]
  )

  const stretchActive = stretcherReady && (speed !== 1 || pitch !== 0)

  /**
   * Queue clicks a quarter second ahead of the audio clock.
   *
   * Scheduling from `setInterval` and not from the animation frame on purpose:
   * a frame is skipped whenever the window is busy or hidden, and a metronome
   * that drops a beat when you scroll is worse than none.
   */
  useEffect(() => {
    const ctx = ctxRef.current
    const metronome = metronomeRef.current
    if (!playing || !metronomeOn || !grid || !ctx || !metronome) return

    const ratio = stretchActive ? Math.pow(2, pitch / 12) / speed : 1
    const scheduled = new Set<number>()
    let generation = -1

    const id = window.setInterval(() => {
      const { position: current, anchor } = advance()
      if (generation !== genRef.current) {
        scheduled.clear()
        generation = genRef.current
      }
      const now = ctx.currentTime
      const loop = loopRef.current
      const horizon = current + LOOKAHEAD_S * anchor.rate
      const limit = Math.min(horizon, loop ? loop.end : duration)

      for (
        let i = nextBeatIndex(grid, current);
        i < grid.times.length && grid.times[i] < limit;
        i++
      ) {
        if (scheduled.has(i)) continue
        scheduled.add(i)
        const at = ctxTimeAt(anchor, grid.times[i])
        if (at >= now) metronome.click(at, i % grid.beatsPerBar === 0, ratio)
      }
    }, 25)

    return () => window.clearInterval(id)
  }, [playing, metronomeOn, grid, speed, pitch, duration, stretchActive, advance])

  /* --------------------------------------------------------------- chords */

  const hudSpans = useMemo(
    () => (chordMap ? mergeChordSpans(chordMap.spans, { dropSilence: true }) : []),
    [chordMap]
  )

  const snap = useCallback(
    (seconds: number) => (snapping && grid ? snapToBeat(grid, seconds) : seconds),
    [snapping, grid]
  )

  const setMark = (which: 'a' | 'b'): void => {
    const value = snap(position)
    if (which === 'a') {
      setMarkA(value)
      if (markB !== null && markB - value < MIN_LOOP_S) setMarkB(null)
      else if (markB !== null) setLooping(true)
      return
    }
    setMarkB(value)
    if (markA !== null && value - markA < MIN_LOOP_S) setMarkA(null)
    else if (markA !== null) setLooping(true)
  }

  const clearMarks = (): void => {
    setMarkA(null)
    setMarkB(null)
  }

  /* ------------------------------------------------------------- render */

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={24} />
          <span className="micro-label">Decodificando {loadingLabel}</span>
          <span className="text-txt-micro text-[11px]">
            As faixas são carregadas inteiras para tocarem em sincronia.
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-danger mb-1 text-sm font-semibold">Não consegui carregar as faixas</p>
          <p className="text-txt-micro text-[11px]">{error}</p>
        </div>
      </div>
    )
  }

  if (!tracks.length) return null

  const progress = duration > 0 ? position / duration : 0
  const anySolo = soloed.size > 0
  const region: RegionControl = {
    a: markA,
    b: markB,
    onChange: (a, b) => {
      setMarkA(a)
      setMarkB(b)
      if (a !== null && b !== null) setLooping(true)
    },
    snap
  }

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const bpmNow = grid ? grid.bpm * speed : null

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      {/* the chord you are on, over everything else */}
      {hudSpans.length > 0 && (
        <ChordHud spans={hudSpans} positionMs={position * 1000} semitones={pitch} />
      )}

      {/* transport */}
      <div className="flex flex-wrap items-center gap-3">
        <IconButton
          title={playing ? 'Pausar' : 'Tocar'}
          onClick={playing ? pause : play}
          active={playing}
        >
          {playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
        </IconButton>
        <IconButton title="Parar" onClick={stop}>
          <IconStop width={16} height={16} />
        </IconButton>
        <IconButton
          title={
            markA !== null && markB !== null
              ? `Repetir o trecho A–B (${formatTime(markA)}–${formatTime(markB)})`
              : 'Repetir a música inteira'
          }
          onClick={() => setLooping((v) => !v)}
          active={looping}
        >
          <IconLoop width={16} height={16} />
        </IconButton>
        <IconButton
          title={
            grid
              ? `Metrônomo em ${Math.round(grid.bpm)} bpm (${
                  grid.source === 'analysis' ? 'batidas do laboratório' : 'grade do bpm'
                })`
              : 'Sem andamento detectado — rode a análise de ritmo no laboratório'
          }
          onClick={() => setMetronomeOn((v) => !v)}
          active={metronomeOn}
          disabled={!grid}
        >
          <IconMetronome width={16} height={16} />
        </IconButton>
        {metronomeOn && grid && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={metronomeVolume}
            onChange={(e) => setMetronomeVolume(Number.parseFloat(e.target.value))}
            className="accent-accent-2 w-16"
            title="Volume do metrônomo"
          />
        )}

        <span className="text-txt-dim ml-1 text-xs tabular-nums">
          {formatTime(position)} <span className="text-txt-micro">/ {formatTime(duration)}</span>
        </span>
        {bpmNow !== null && <Badge>{Math.round(bpmNow)} bpm</Badge>}

        <div className="ml-auto flex items-center gap-2">
          {anySolo && (
            <NeuButton className="!px-3 !py-1.5 !text-[11px]" onClick={() => setSoloed(new Set())}>
              limpar solo
            </NeuButton>
          )}
          {muted.size > 0 && (
            <NeuButton className="!px-3 !py-1.5 !text-[11px]" onClick={() => setMuted(new Set())}>
              tirar mudos
            </NeuButton>
          )}
        </div>
      </div>

      {/* speed, pitch and the A/B loop */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="micro-label">velocidade</span>
          <div className="neu-inset flex items-center gap-1 rounded-[12px] p-1">
            {SPEEDS.map((value) => (
              <button
                key={value}
                onClick={() => setSpeed(value)}
                className={cx(
                  'rounded-[8px] px-2 py-1 text-[11px] font-bold tabular-nums transition-all',
                  speed === value ? 'neu-raised-sm gradient-text' : 'text-txt-micro hover:text-txt-dim'
                )}
                title={`Tocar a ${Math.round(value * 100)}% do andamento original`}
              >
                {Math.round(value * 100)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="micro-label">tom</span>
          <div className="neu-inset flex items-center gap-1 rounded-[12px] px-1.5 py-1">
            <button
              onClick={() => setPitch((v) => Math.max(-12, v - 1))}
              disabled={!stretcherReady}
              className="gradient-text grid h-6 w-6 place-items-center rounded-[8px] text-base font-bold disabled:opacity-30"
              title="Descer meio tom"
            >
              −
            </button>
            <button
              onClick={() => setPitch(0)}
              disabled={!stretcherReady}
              className="w-16 text-center text-[11px] font-semibold tabular-nums disabled:opacity-40"
              title="Voltar ao tom original"
            >
              {pitch > 0 ? `+${pitch}` : pitch} semi
            </button>
            <button
              onClick={() => setPitch((v) => Math.min(12, v + 1))}
              disabled={!stretcherReady}
              className="gradient-text grid h-6 w-6 place-items-center rounded-[8px] text-base font-bold disabled:opacity-30"
              title="Subir meio tom"
            >
              +
            </button>
          </div>
          {!stretcherReady && (
            <span className="text-txt-micro text-[10px]" title="O worklet de time-stretch não carregou">
              tom fixo
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="micro-label">loop</span>
          <NeuButton
            className="!px-2.5 !py-1.5 !text-[11px] tabular-nums"
            onClick={() => setMark('a')}
            title="Marcar o início do trecho aqui"
          >
            A {markA !== null ? formatTime(markA) : '—'}
          </NeuButton>
          <NeuButton
            className="!px-2.5 !py-1.5 !text-[11px] tabular-nums"
            onClick={() => setMark('b')}
            title="Marcar o fim do trecho aqui"
          >
            B {markB !== null ? formatTime(markB) : '—'}
          </NeuButton>
          {(markA !== null || markB !== null) && (
            <NeuButton className="!px-2.5 !py-1.5 !text-[11px]" onClick={clearMarks}>
              limpar
            </NeuButton>
          )}
          <button
            onClick={() => setSnapping((v) => !v)}
            disabled={!grid}
            className={cx(
              'rounded-[10px] px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-30',
              snapping && grid ? 'neu-glow gradient-text' : 'neu-press text-txt-micro'
            )}
            title={
              grid
                ? 'Encaixar as marcações na batida mais próxima'
                : 'Precisa do andamento detectado para encaixar na batida'
            }
          >
            snap
          </button>
        </div>
      </div>

      {/* tracks */}
      <div className="scroll-area min-h-0 flex-1 space-y-2 pr-1">
        {tracks.map((track) => {
          const isMuted = muted.has(track.id)
          const isSolo = soloed.has(track.id)
          const silent = anySolo ? !isSolo : isMuted
          return (
            <div
              key={track.id}
              className={cx(
                'neu-raised-sm flex items-center gap-2.5 rounded-[14px] p-2',
                track.isOriginal && 'ring-edge ring-1'
              )}
            >
              <div className="w-20 shrink-0">
                <div
                  className="truncate text-[11px] font-bold"
                  style={{ color: silent ? 'var(--color-txt-micro)' : colorFor(track.id) }}
                  title={track.label}
                >
                  {track.label}
                </div>
                <div className="text-txt-micro text-[9px]">
                  {track.isOriginal ? 'arraste p/ marcar A–B' : formatTime(track.buffer.duration)}
                </div>
              </div>

              <button
                onClick={() => setMuted((m) => toggle(m, track.id))}
                className={cx(
                  'h-6 w-6 shrink-0 rounded-[7px] text-[10px] font-bold',
                  isMuted ? 'bg-danger text-void' : 'neu-press text-txt-micro'
                )}
                title="Mudo"
              >
                M
              </button>
              <button
                onClick={() => setSoloed((s) => toggle(s, track.id))}
                className={cx(
                  'h-6 w-6 shrink-0 rounded-[7px] text-[10px] font-bold',
                  isSolo ? 'bg-accent-1 text-void' : 'neu-press text-txt-micro'
                )}
                title="Solo"
              >
                S
              </button>

              <Waveform
                peaks={track.peaks}
                color={colorFor(track.id)}
                progress={progress}
                dimmed={silent}
                duration={duration}
                onSeek={(ratio) => seek(ratio * duration)}
                region={track.isOriginal ? region : undefined}
              />

              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volumes[track.id] ?? 1}
                onChange={(e) =>
                  setVolumes((v) => ({ ...v, [track.id]: Number.parseFloat(e.target.value) }))
                }
                className="accent-accent-2 w-16 shrink-0"
                title="Volume"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
