import { useEffect, useRef, useState, useImperativeHandle, forwardRef, type ReactNode } from 'react'
import * as alphaTab from '@coderline/alphatab'
import soundFontUrl from '@coderline/alphatab/soundfont/sonivox.sf3?url'
import { loadScoreRecovering } from '@shared/gp'
import { Spinner } from '../../components/ui'

export interface AlphaTabTrack {
  index: number
  name: string
  isPercussion: boolean
  /** General MIDI program, used to tell guitar from bass from vocals. */
  midiProgram: number
  instrument: 'guitar' | 'bass' | 'drums' | 'vocals' | null
  muted: boolean
  solo: boolean
}

export interface AlphaTabHandle {
  play: () => void
  pause: () => void
  stop: () => void
  setSpeed: (rate: number) => void
  setMetronome: (on: boolean) => void
  setCountIn: (on: boolean) => void
  setLoop: (on: boolean) => void
  /** Restrict playback to a bar range; null clears it. */
  setBarRange: (from: number, to: number) => void
  clearBarRange: () => void
  setTrackMute: (index: number, muted: boolean) => void
  setTrackSolo: (index: number, solo: boolean) => void
  setTrackVolume: (index: number, volume: number) => void
  renderTracks: (indices: number[]) => void
}

/** Same GM mapping the importer uses, so screen and database agree. */
function trackInstrument(
  program: number,
  isPercussion: boolean,
  stringCount: number
): 'guitar' | 'bass' | 'drums' | 'vocals' | null {
  if (isPercussion) return 'drums'
  if (program >= 32 && program <= 39) return 'bass'
  if (program >= 24 && program <= 31) return 'guitar'
  if ((program >= 52 && program <= 54) || program === 85) return 'vocals'
  if (stringCount >= 6) return 'guitar'
  if (stringCount === 4 || stringCount === 5) return 'bass'
  return null
}

/**
 * How far above the viewport middle to place the system being played.
 *
 * alphaTab aligns the top of the current system to the top of the scroll
 * container plus `scrollOffsetY`, so a negative offset of roughly half the
 * viewport leaves the played bar centred instead of pinned to the top edge.
 * One staff system is ~150px tall at scale 0.8, hence the half-system nudge.
 */
function centeringOffset(el: HTMLElement | null): number {
  const height = el?.clientHeight ?? 0
  if (height <= 0) return -30
  return -Math.max(30, Math.round(height / 2 - 75))
}

interface Props {
  /** Raw bytes of the .gp/.gp3/.gp4/.gp5/.gpx file. */
  fileData: ArrayBuffer | null
  /**
   * Which instrument's tracks to show. alphaTab defaults to the first track,
   * which on a full band arrangement is usually the vocal line — not what a
   * guitarist opened the app for.
   */
  preferredInstrument?: 'guitar' | 'bass' | 'drums' | 'vocals'
  onReady?: (info: {
    tracks: AlphaTabTrack[]
    barCount: number
    tempo: number
    /** Track alphaTab chose to display first. */
    initialTrackIndex: number | null
  }) => void
  onPositionChange?: (info: {
    currentTime: number
    endTime: number
    currentBar: number
  }) => void
  onPlayerStateChange?: (playing: boolean) => void
  onError?: (message: string) => void
}

/**
 * alphaTab renderer + AlphaSynth playback.
 *
 * The player needs a SoundFont to make sound. alphaTab publishes one inside the
 * package (`soundfont/sonivox.sf3`); we resolve it through Vite's URL import so
 * it works both in dev and in the packaged build. If it cannot be loaded the
 * score still renders — you just get notation without audio, which is still
 * useful, so we surface a warning rather than failing.
 */
export const AlphaTabView = forwardRef<AlphaTabHandle, Props>(function AlphaTabView(
  { fileData, preferredInstrument = 'guitar', onReady, onPositionChange, onPlayerStateChange, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  /** The element that actually scrolls; must stay an ancestor of the container. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const [loading, setLoading] = useState(true)
  /** Score parsed but not yet painted — a long job on big arrangements. */
  const [rendering, setRendering] = useState(false)
  const [soundFontReady, setSoundFontReady] = useState(false)

  useImperativeHandle(ref, () => ({
    play: () => apiRef.current?.play(),
    pause: () => apiRef.current?.pause(),
    stop: () => apiRef.current?.stop(),
    setSpeed: (rate) => {
      if (apiRef.current) apiRef.current.playbackSpeed = rate
    },
    setMetronome: (on) => {
      if (apiRef.current) apiRef.current.metronomeVolume = on ? 1 : 0
    },
    setCountIn: (on) => {
      if (apiRef.current) apiRef.current.countInVolume = on ? 1 : 0
    },
    setLoop: (on) => {
      if (apiRef.current) apiRef.current.isLooping = on
    },
    setBarRange: (from, to) => {
      const api = apiRef.current
      if (!api?.score) return
      const bars = api.score.masterBars
      const start = bars[Math.max(0, Math.min(from, bars.length - 1))]
      const end = bars[Math.max(0, Math.min(to, bars.length - 1))]
      if (!start || !end) return
      api.playbackRange = {
        startTick: start.start,
        endTick: end.start + end.calculateDuration()
      }
    },
    clearBarRange: () => {
      if (apiRef.current) apiRef.current.playbackRange = null
    },
    setTrackMute: (index, muted) => {
      const api = apiRef.current
      const track = api?.score?.tracks[index]
      if (api && track) api.changeTrackMute([track], muted)
    },
    setTrackSolo: (index, solo) => {
      const api = apiRef.current
      const track = api?.score?.tracks[index]
      if (api && track) api.changeTrackSolo([track], solo)
    },
    setTrackVolume: (index, volume) => {
      const api = apiRef.current
      const track = api?.score?.tracks[index]
      if (api && track) api.changeTrackVolume([track], volume)
    },
    renderTracks: (indices) => {
      const api = apiRef.current
      if (!api?.score) return
      const tracks = indices.map((i) => api.score!.tracks[i]).filter(Boolean)
      if (tracks.length) api.renderTracks(tracks)
    }
  }))

  /*
   * alphaTab measures its container at construction and refuses to lay out when
   * the width is 0, which happens while it mounts inside a flex tree the browser
   * has not sized yet. Wait for a real width once, then stop observing —
   * re-rendering on every resize fights with alphaTab's own resize handling and
   * can loop, because each render changes the scrollbar and thus the width.
   */
  const [hasWidth, setHasWidth] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || hasWidth) return
    if (el.getBoundingClientRect().width > 0) {
      setHasWidth(true)
      return
    }
    const observer = new ResizeObserver((entries) => {
      if ((entries[0]?.contentRect.width ?? 0) > 0) {
        setHasWidth(true)
        observer.disconnect()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasWidth])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !fileData || !hasWidth) return

    let disposed = false
    setLoading(true)

    const settings = new alphaTab.Settings()
    settings.core.engine = 'html5'
    settings.core.logLevel = alphaTab.LogLevel.Warning
    /*
     * alphaTab normally locates its font and worker by inspecting the <script>
     * tag it was loaded from. In a bundled Electron renderer served over
     * file:// that detection fails, so point it at the assets the Vite plugin
     * copied next to index.html. `document.baseURI` covers both the dev server
     * and the packaged build.
     */
    settings.core.fontDirectory = new URL('font/', document.baseURI).toString()
    /*
     * Lazy loading produced an empty surface inside this scroll container, so
     * the score is rendered eagerly. That is affordable because only one staff
     * is drawn at a time (see the track selection in `scoreLoaded`); drawing a
     * whole five-guitar arrangement is what used to take tens of seconds.
     */
    settings.core.enableLazyLoading = false
    settings.display.scale = 0.8
    settings.display.layoutMode = alphaTab.LayoutMode.Page
    settings.player.enablePlayer = true
    settings.player.enableCursor = true
    settings.player.enableAnimatedBeatCursor = true
    settings.player.enableElementHighlighting = true
    settings.player.enableUserInteraction = true
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous
    /*
     * Without this alphaTab scrolls `html,body` (its default), which never move
     * here — the score lives in its own overflow container, so the cursor just
     * walked off the bottom of the view. Point it at the container that actually
     * scrolls and the played bar follows the cursor.
     */
    settings.player.scrollElement = scrollRef.current ?? container
    // negative offset pulls the played system down to the middle of the viewport
    settings.player.scrollOffsetY = centeringOffset(scrollRef.current)

    // dark theme for the rendered score
    settings.display.resources.mainGlyphColor = new alphaTab.model.Color(233, 233, 240)
    settings.display.resources.secondaryGlyphColor = new alphaTab.model.Color(139, 139, 152)
    settings.display.resources.staffLineColor = new alphaTab.model.Color(70, 70, 82)
    settings.display.resources.barSeparatorColor = new alphaTab.model.Color(90, 90, 104)
    settings.display.resources.barNumberColor = new alphaTab.model.Color(255, 138, 92)
    settings.display.resources.scoreInfoColor = new alphaTab.model.Color(242, 242, 245)

    /*
     * Parse once up front, before the api exists.
     *
     * Two things come out of this pass and both have to be settled before
     * alphaTab reads the settings object: the text encoding — GP3-GP5 files are
     * written in a legacy code page and render their titles and section markers
     * as `?` under UTF-8 — and which single track to draw. A full arrangement
     * like Master of Puppets has five guitar tracks over 425 bars, which is both
     * slow to lay out and unreadable; the track panel adds the others on demand.
     */
    const bytes = new Uint8Array(fileData)
    let trackIndexes: number[] | undefined
    try {
      const { score: parsed, encoding } = loadScoreRecovering((enc) => {
        const probe = new alphaTab.Settings()
        probe.importer.encoding = enc
        return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, probe)
      })
      settings.importer.encoding = encoding

      const candidates = parsed.tracks
        .map((t) => {
          const staff = t.staves[0]
          const isPercussion = Boolean(staff?.isPercussion || t.playbackInfo?.primaryChannel === 9)
          const name = t.name?.trim() || ''
          return {
            index: t.index,
            name,
            instrument: /^@#.*#@$/.test(name)
              ? null
              : trackInstrument(
                  t.playbackInfo?.program ?? 0,
                  isPercussion,
                  staff?.tuning?.length ?? 0
                )
          }
        })
        .filter((t) => t.instrument !== null)

      const wanted = candidates.filter((t) => t.instrument === preferredInstrument)
      const pool = wanted.length ? wanted : candidates
      const primary =
        pool.find((t) => /(lead|main|solo)/i.test(t.name)) ??
        pool.find((t) => !/(additional|extra|backing|clean)/i.test(t.name)) ??
        pool[0]
      if (primary) trackIndexes = [primary.index]
    } catch {
      // the pre-parse is an optimisation; fall back to alphaTab's own defaults
    }

    const api = new alphaTab.AlphaTabApi(container, settings)
    apiRef.current = api
    // dev-only handle for poking at the renderer from the devtools console
    if (import.meta.env.DEV) {
      ;(window as unknown as { __alphaTab?: unknown }).__alphaTab = api
    }

    /*
     * Inside this flex/scroll container alphaTab's first render pass reliably
     * completes without painting anything — the surface stays empty. Watch for
     * that and re-issue a single render, which does produce the score. Retrying
     * from `renderFinished` (rather than immediately) matters: an early render()
     * collides with the in-flight first pass and both end up blank.
     */
    let retried = false
    api.renderFinished.on(() => {
      if (disposed) return
      const surface = container.querySelector('.at-surface')
      const painted = (surface?.innerHTML.length ?? 0) > 2000
      if (painted) {
        setRendering(false)
        return
      }
      if (!retried) {
        retried = true
        setTimeout(() => {
          if (!disposed) api.render()
        }, 60)
      } else {
        // give up on the spinner rather than hiding a broken view forever
        setRendering(false)
      }
    })

    api.scoreLoaded.on((score) => {
      if (disposed) return
      setLoading(false)
      setRendering(true)

      const tracks: AlphaTabTrack[] = score.tracks.map((t) => {
        const staff = t.staves[0]
        const isPercussion = Boolean(staff?.isPercussion || t.playbackInfo?.primaryChannel === 9)
        const program = t.playbackInfo?.program ?? 0
        const name = t.name?.trim() || `Trilha ${t.index + 1}`
        return {
          index: t.index,
          name,
          isPercussion,
          midiProgram: program,
          // GP files carry @#chords#@ / @#lyrics#@ helper tracks that are text,
          // not something anyone plays
          instrument: /^@#.*#@$/.test(name)
            ? null
            : trackInstrument(program, isPercussion, staff?.tuning?.length ?? 0),
          muted: false,
          solo: false
        }
      })

      onReady?.({
        tracks,
        barCount: score.masterBars.length,
        tempo: score.tempo,
        initialTrackIndex: api.tracks?.[0]?.index ?? null
      })
    })

    api.soundFontLoaded.on(() => {
      if (!disposed) setSoundFontReady(true)
    })

    api.playerStateChanged.on((e) => {
      if (!disposed) onPlayerStateChange?.(e.state === alphaTab.synth.PlayerState.Playing)
    })

    api.playerPositionChanged.on((e) => {
      if (disposed) return
      onPositionChange?.({
        currentTime: e.currentTime,
        endTime: e.endTime,
        currentBar: e.currentTick
      })
    })

    /*
     * Hand the chosen track to load(). Calling renderTracks() from inside the
     * scoreLoaded handler races alphaTab's own initial render and leaves the
     * surface empty, so the selection has to travel with the load itself.
     */
    try {
      api.load(bytes, trackIndexes)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }

    // load the bundled soundfont so the synth can actually make sound
    void (async () => {
      try {
        const res = await fetch(new URL(soundFontUrl, document.baseURI).toString())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buffer = await res.arrayBuffer()
        if (!disposed) api.loadSoundFont(new Uint8Array(buffer), false)
      } catch (err) {
        console.warn('[alphaTab] soundfont indisponível, seguindo sem áudio:', err)
      }
    })()

    return () => {
      disposed = true
      try {
        api.destroy()
      } catch {
        /* already torn down */
      }
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileData, hasWidth])

  /*
   * The centering offset is a pixel value derived from the viewport height, so
   * it has to be recomputed whenever the panel is resized. alphaTab reads
   * `scrollOffsetY` fresh on every scroll, so mutating the live settings is
   * enough — no re-render needed.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const player = apiRef.current?.settings.player
      if (player) player.scrollOffsetY = centeringOffset(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative h-full">
      {(loading || rendering) && (
        <div className="bg-base/70 absolute inset-0 z-20 grid place-items-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={26} />
            <span className="micro-label">
              {loading ? 'Lendo o arquivo' : 'Desenhando a partitura'}
            </span>
            {rendering && (
              <span className="text-txt-micro max-w-[16rem] text-center text-[11px]">
                Arranjos longos levam alguns segundos. Mostre menos trilhas para acelerar.
              </span>
            )}
          </div>
        </div>
      )}
      {!loading && !soundFontReady && (
        <div className="text-warn absolute top-2 right-3 z-10 text-[11px]">
          sintetizador sem soundfont — notação sem áudio
        </div>
      )}
      {/*
        Two elements on purpose: the outer one scrolls, the inner one is
        alphaTab's canvas. alphaTab computes the score's offset *relative to*
        the scroll element, so if the two are the same node that offset comes
        back as the current scrollTop and every auto-scroll adds it again —
        the view then runs away to the end of the score instead of following
        the cursor.
      */}
      <div
        ref={scrollRef}
        className="scroll-area h-full w-full"
        style={{ background: 'transparent', minWidth: 0 }}
      >
        <div ref={containerRef} style={{ background: 'transparent', minWidth: 0 }} />
      </div>
    </div>
  )
})
