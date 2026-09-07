import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NeuCard, NeuButton, Badge, Spinner, EmptyState, cx } from '../../components/ui'
import { IconChords, IconPlay, IconPause, IconLab } from '../../components/ui/icons'
import { api, isError, formatDuration } from '../../lib/api'
import type { ChordMapView, ChordSpan, MediaAssetView, SongView } from '@shared/types'
import { transposeChord, spanAt, distinctChords, mergeChordSpans, NO_CHORD } from '@shared/chords'
import { ChordHud } from '../practice/ChordHud'

/**
 * The chord track over the recording, the way Chordify shows it.
 *
 * Detection happens in the lab container: beat tracking gives the grid, a
 * chroma-per-beat is matched against chord templates and a Viterbi pass picks
 * the path — which is what turns "a different chord every beat" into the blocks
 * a player actually reads. This screen is the reader: the chords in order, the
 * one being played lit up, click to jump there, and a transpose for when the
 * guitar is tuned somewhere else.
 */

function ChordCell({
  span,
  active,
  semitones,
  onSeek
}: {
  span: ChordSpan
  active: boolean
  semitones: number
  onSeek: () => void
}): ReactNode {
  const silent = span.label === NO_CHORD
  const seconds = (span.endMs - span.startMs) / 1000
  return (
    <button
      onClick={onSeek}
      title={`${formatDuration(span.startMs)} · ${seconds.toFixed(1)}s · confiança ${(
        span.confidence * 100
      ).toFixed(0)}%`}
      style={{ flexGrow: Math.max(1, Math.round(seconds * 2)), flexBasis: 62 }}
      className={cx(
        'h-14 rounded-[12px] px-2 text-sm font-bold transition-all',
        active ? 'neu-glow gradient-text scale-[1.04]' : silent ? 'neu-inset-sm' : 'neu-press',
        silent && 'text-txt-micro font-normal'
      )}
    >
      {silent ? '·' : transposeChord(span.label, semitones)}
      <span
        className={cx(
          'mt-1 block h-0.5 rounded-full',
          // a low-confidence guess should look like a guess
          span.confidence >= 0.75 ? 'bg-ok/60' : span.confidence >= 0.5 ? 'bg-warn/60' : 'bg-danger/50'
        )}
        style={{ opacity: silent ? 0 : 1 }}
      />
    </button>
  )
}

export function ChordMap({
  song,
  media,
  onKeyDetected
}: {
  song: SongView
  media: MediaAssetView[]
  onKeyDetected?: () => void
}): ReactNode {
  const [map, setMap] = useState<ChordMapView | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [semitones, setSemitones] = useState(0)
  const [positionMs, setPositionMs] = useState(0)
  const [playing, setPlaying] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number | null>(null)

  const audio = media.find((m) => m.kind === 'audio_master')

  /*
   * The teleprompter wants chord *changes*, not beats. The detector emits one
   * span per beat, so a bar of Em arrives as four identical blocks and "próximo
   * acorde: Em" while Em is ringing helps nobody. The grid below keeps the raw
   * spans — that is what makes the blocks proportional to their duration.
   */
  const hudSpans = useMemo(
    () => (map ? mergeChordSpans(map.spans, { dropSilence: true }) : []),
    [map]
  )

  const load = useCallback(async () => {
    setMap(await api.chords.get(song.id))
    setLoading(false)
  }, [song.id])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * The main process polls the container every few seconds and pushes the jobs
   * it saw move. A finished harmony job is exactly when the chord map appears,
   * so reload on it instead of polling from here as well.
   */
  useEffect(() => {
    return api.lab.onJobsUpdated((jobs) => {
      const mine = jobs.find((j) => j.songId === song.id && j.type === 'harmony')
      if (!mine) return
      if (mine.status === 'done') {
        setDetecting(false)
        void load()
        onKeyDetected?.()
      }
      if (mine.status === 'error') {
        setDetecting(false)
        setError(mine.error ?? 'A análise falhou')
      }
    })
  }, [song.id, load, onKeyDetected])

  /** Follow playback with rAF — `timeupdate` only fires ~4x a second. */
  useEffect(() => {
    const tick = (): void => {
      const el = audioRef.current
      if (el) setPositionMs(el.currentTime * 1000)
      frame.current = requestAnimationFrame(tick)
    }
    if (playing) frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [playing])

  const detect = async (): Promise<void> => {
    setDetecting(true)
    setError(null)
    try {
      const res = await api.chords.detect(song.id)
      if (isError(res)) {
        setError(res.error)
        setDetecting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao pedir a análise')
      setDetecting(false)
    }
  }

  const clear = async (): Promise<void> => {
    await api.chords.clear(song.id)
    setMap(null)
  }

  const seek = (ms: number): void => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = ms / 1000
    setPositionMs(ms)
  }

  if (loading) {
    return (
      <NeuCard className="grid place-items-center p-8">
        <Spinner size={22} />
      </NeuCard>
    )
  }

  if (!map) {
    return (
      <NeuCard className="p-4">
        <EmptyState
          icon={<IconChords width={24} height={24} />}
          title="Cifra automática"
          description={
            error ??
            (audio
              ? 'O laboratório escuta o áudio e escreve os acordes na linha do tempo — batida ' +
                'por batida, como o Chordify. Precisa do laboratório ligado.'
              : 'Essa música ainda não tem áudio local. Baixe a faixa pelo botão WAV no setlist ' +
                'ou coloque o arquivo em songs/ e importe — a detecção escuta a gravação.')
          }
          action={
            <NeuButton variant="accent" onClick={detect} disabled={detecting || !audio}>
              <span className="flex items-center gap-2">
                {detecting ? <Spinner size={14} /> : <IconLab width={15} height={15} />}
                {detecting ? 'Analisando…' : 'Detectar acordes'}
              </span>
            </NeuButton>
          }
        />
      </NeuCard>
    )
  }

  const active = spanAt(map.spans, positionMs)
  const distinct = distinctChords(map.spans, semitones)

  return (
    <NeuCard className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="micro-label">Cifra automática</div>
          {map.key && <Badge tone="info">{transposeChord(map.key, semitones)}</Badge>}
          {map.bpm && <Badge>{Math.round(map.bpm)} bpm</Badge>}
          <Badge title="Quanta certeza o detector tem do tom">
            {(map.confidence * 100).toFixed(0)}%
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="neu-inset flex items-center gap-1 rounded-[12px] px-1.5 py-1">
            <button
              onClick={() => setSemitones((v) => v - 1)}
              className="gradient-text grid h-6 w-6 place-items-center rounded-[8px] text-base font-bold"
              title="Descer meio tom"
            >
              −
            </button>
            <span className="w-14 text-center text-[11px] font-semibold tabular-nums">
              {semitones > 0 ? `+${semitones}` : semitones} semi
            </span>
            <button
              onClick={() => setSemitones((v) => v + 1)}
              className="gradient-text grid h-6 w-6 place-items-center rounded-[8px] text-base font-bold"
              title="Subir meio tom"
            >
              +
            </button>
          </div>
          <NeuButton className="!px-3 !py-1.5 !text-[11px]" onClick={detect} disabled={detecting}>
            {detecting ? <Spinner size={12} /> : 'refazer'}
          </NeuButton>
          <NeuButton className="!px-3 !py-1.5 !text-[11px]" onClick={clear}>
            apagar
          </NeuButton>
        </div>
      </div>

      {audio && (
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={() => {
              const el = audioRef.current
              if (!el) return
              if (el.paused) void el.play()
              else el.pause()
            }}
            className="neu-press text-accent-2 grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
            title={playing ? 'Pausar' : 'Tocar'}
          >
            {playing ? <IconPause width={17} height={17} /> : <IconPlay width={17} height={17} />}
          </button>
          <div className="text-txt-dim text-xs tabular-nums">
            {formatDuration(positionMs)} / {formatDuration(song.durationMs)}
          </div>
          <div className="neu-inset-sm h-1.5 flex-1 overflow-hidden rounded-full">
            <div
              className="gradient-bg h-full rounded-full"
              style={{
                width: `${
                  song.durationMs ? Math.min(100, (positionMs / song.durationMs) * 100) : 0
                }%`
              }}
            />
          </div>
          <audio
            ref={audioRef}
            src={api.mediaUrl(audio.path)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
            preload="metadata"
          />
        </div>
      )}

      {/*
        The same head-up display the stems screen uses: the chord under your
        fingers big, the one before it faded, the next two shrinking to the
        right, and a bar showing how much of the current chord is left so the
        change never arrives as a surprise.
      */}
      {hudSpans.length > 0 && (
        <div className="mb-3">
          <ChordHud spans={hudSpans} positionMs={positionMs} semitones={semitones} />
        </div>
      )}

      {distinct.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="micro-label mr-1">Acordes da música</span>
          {distinct.map((c) => (
            <Badge key={c} tone="accent">
              {c}
            </Badge>
          ))}
        </div>
      )}

      <div className="scroll-area max-h-[420px]">
        <div className="flex flex-wrap gap-1.5">
          {map.spans.map((span, i) => (
            <ChordCell
              key={`${span.startMs}-${i}`}
              span={span}
              active={i === active}
              semitones={semitones}
              onSeek={() => seek(span.startMs)}
            />
          ))}
        </div>
      </div>

      <p className="text-txt-micro mt-3 text-[11px] leading-snug">
        {map.spans.length} blocos detectados no áudio. A barrinha embaixo de cada acorde é a
        confiança — vermelha quer dizer que o trecho é ambíguo (distorção pesada, palm mute) e vale
        conferir de ouvido. Clique num acorde para pular pra ele.
      </p>

      {error && <div className="text-danger mt-2 text-[11px]">{error}</div>}
    </NeuCard>
  )
}
