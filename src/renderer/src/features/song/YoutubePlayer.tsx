import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NeuButton, NeuSlider, Badge, Spinner, cx } from '../../components/ui'
import { IconPlay, IconPause, IconLoop, IconYoutube } from '../../components/ui/icons'
import { api, formatDuration } from '../../lib/api'

/**
 * A YouTube video, playing inside the app, with practice controls.
 *
 * The video itself lives two frames down: this component embeds a page served
 * from a local http origin (see `main/services/ytplayer`), and that page embeds
 * YouTube's own iframe. The indirection exists because the IFrame player refuses
 * to start on the `app://` origin the renderer is served from. Everything here
 * talks to that page over `postMessage`.
 *
 * The controls are the ones you actually want on a lesson video: slow it down,
 * and loop the four bars you keep missing. YouTube's API only accepts the
 * playback rates it advertises, so the speed control is a set of steps rather
 * than a free slider.
 */

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5]

/** What YT.PlayerState.PLAYING is, without pulling in the YouTube typings. */
const PLAYING = 1

interface Outgoing {
  source: 'guitarlab-app'
  type: 'load' | 'play' | 'pause' | 'seek' | 'rate' | 'volume' | 'loop'
  [key: string]: unknown
}

export function YoutubePlayer({
  videoId,
  title,
  className
}: {
  videoId: string
  title?: string | null
  className?: string
}): ReactNode {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [playerUrl, setPlayerUrl] = useState<string | null | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState<string | null>(null)
  /** A/B loop in seconds; null when off. */
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null)
  const [markA, setMarkA] = useState<number | null>(null)

  useEffect(() => {
    void api.youtube.playerUrl().then(setPlayerUrl)
  }, [])

  const post = useCallback((message: Omit<Outgoing, 'source'>) => {
    frameRef.current?.contentWindow?.postMessage(
      { source: 'guitarlab-app', ...message },
      '*'
    )
  }, [])

  /* Everything the embedded page has to say arrives here. */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as Record<string, unknown> | null
      if (!data || data.source !== 'guitarlab-yt') return
      switch (data.type) {
        case 'ready':
          setReady(true)
          break
        case 'state':
          setPlaying(data.state === PLAYING)
          break
        case 'time':
          setSeconds(Number(data.seconds) || 0)
          setDuration(Number(data.duration) || 0)
          if (typeof data.rate === 'number') setRate(data.rate)
          break
        case 'error':
          setError(
            data.code === 101 || data.code === 150
              ? 'Esse vídeo não permite reprodução fora do YouTube.'
              : `O player devolveu o erro ${String(data.code)}.`
          )
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /* Load whenever the chosen video changes — including before the page is ready,
     which the page itself queues up. */
  useEffect(() => {
    if (!playerUrl) return
    setError(null)
    setLoop(null)
    setMarkA(null)
    post({ type: 'load', videoId })
  }, [videoId, playerUrl, ready, post])

  useEffect(() => {
    post({ type: 'loop', range: loop })
  }, [loop, post])

  if (playerUrl === undefined) {
    return (
      <div className={cx('neu-inset grid place-items-center rounded-[18px] p-8', className)}>
        <Spinner size={22} />
      </div>
    )
  }

  if (playerUrl === null) {
    return (
      <div className={cx('neu-inset rounded-[18px] p-6 text-center', className)}>
        <IconYoutube width={26} height={26} className="text-txt-micro mx-auto mb-2" />
        <p className="text-txt-dim text-xs">
          O player interno não subiu nesta sessão. O vídeo ainda abre no navegador.
        </p>
        <NeuButton
          className="mt-3"
          onClick={() => void api.shell.openExternal(`https://www.youtube.com/watch?v=${videoId}`)}
        >
          Abrir no YouTube
        </NeuButton>
      </div>
    )
  }

  const setMark = (): void => {
    if (markA === null) {
      setMarkA(seconds)
      return
    }
    const start = Math.min(markA, seconds)
    const end = Math.max(markA, seconds)
    // a loop shorter than a second is a mis-click, not a practice loop
    if (end - start < 1) {
      setMarkA(seconds)
      return
    }
    setLoop({ start, end })
    setMarkA(null)
    post({ type: 'seek', seconds: start })
  }

  return (
    <div className={cx('space-y-2.5', className)}>
      <div className="neu-inset relative aspect-video overflow-hidden rounded-[18px]">
        <iframe
          ref={frameRef}
          src={playerUrl}
          title={title ?? 'YouTube'}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        />
      </div>

      {error && (
        <div className="text-danger flex items-center gap-2 text-[11px]">
          <span>{error}</span>
          <button
            className="gradient-text font-semibold"
            onClick={() =>
              void api.shell.openExternal(`https://www.youtube.com/watch?v=${videoId}`)
            }
          >
            abrir no YouTube
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => post({ type: playing ? 'pause' : 'play' })}
          disabled={!ready}
          className="neu-press text-accent-2 grid h-11 w-11 shrink-0 place-items-center rounded-[14px] disabled:opacity-40"
          title={playing ? 'Pausar' : 'Tocar'}
        >
          {playing ? <IconPause width={17} height={17} /> : <IconPlay width={17} height={17} />}
        </button>

        <div className="text-txt-dim w-24 shrink-0 text-xs tabular-nums">
          {formatDuration(seconds * 1000)} / {formatDuration(duration * 1000)}
        </div>

        <div className="min-w-[180px] flex-1">
          <NeuSlider
            value={duration > 0 ? seconds : 0}
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            onChange={(v) => post({ type: 'seek', seconds: v })}
            disabled={!ready}
          />
        </div>

        <button
          onClick={setMark}
          disabled={!ready}
          className={cx(
            'rounded-[11px] px-3 py-1.5 text-[11px] font-bold disabled:opacity-40',
            markA !== null ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
          )}
          title="Marque o início e depois o fim do trecho para repetir em loop"
        >
          {markA !== null ? `A ${formatDuration(markA * 1000)} → B` : 'Marcar A → B'}
        </button>

        {loop && (
          <button
            onClick={() => setLoop(null)}
            className="neu-glow gradient-text flex items-center gap-1.5 rounded-[11px] px-3 py-1.5 text-[11px] font-bold"
            title="Desligar o loop"
          >
            <IconLoop width={13} height={13} />
            {formatDuration(loop.start * 1000)}–{formatDuration(loop.end * 1000)}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="micro-label">velocidade</span>
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => post({ type: 'rate', rate: r })}
            disabled={!ready}
            className={cx(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40',
              Math.abs(rate - r) < 0.01 ? 'neu-glow gradient-text' : 'neu-press text-txt-micro'
            )}
          >
            {r === 1 ? 'normal' : `${r}×`}
          </button>
        ))}
        <Badge title="O YouTube só aceita esses passos de velocidade">passos do YouTube</Badge>
        <button
          onClick={() => void api.shell.openExternal(`https://www.youtube.com/watch?v=${videoId}`)}
          className="text-txt-micro hover:text-txt ml-auto text-[11px]"
        >
          abrir no YouTube
        </button>
      </div>
    </div>
  )
}
