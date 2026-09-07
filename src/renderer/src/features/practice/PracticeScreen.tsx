import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  IconButton,
  NeuSlider,
  Badge,
  Segmented,
  Spinner,
  EmptyState,
  Toast,
  useToast,
  ProgressRing,
  cx
} from '../../components/ui'
import {
  IconPlay,
  IconPause,
  IconStop,
  IconLoop,
  IconMetronome,
  IconPractice,
  IconSparkle,
  IconYoutube,
  IconWave,
  INSTRUMENT_ICON
} from '../../components/ui/icons'
import { Markdown } from '../../components/ui/markdown'
import { AlphaTabView, type AlphaTabHandle, type AlphaTabTrack } from './AlphaTabView'
import { SpeedTrainer } from './SpeedTrainer'
import { MultitrackPlayer } from './MultitrackPlayer'
import { api, isError, formatDuration } from '../../lib/api'
import { useNav } from '../../App'
import type { SongView, SectionView, Instrument, MediaAssetView } from '@shared/types'
import { useStrings } from '../../lib/i18n'
import { PRACTICE_INSTRUMENT } from '@shared/types'

type Source = 'gp_synth' | 'stems' | 'youtube'

const SPEEDS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25]

function SongPicker(): ReactNode {
  const go = useNav((s) => s.go)
  const [songs, setSongs] = useState<SongView[]>([])
  useEffect(() => {
    void api.songs.list().then(setSongs)
  }, [])

  return (
    <div className="scroll-area h-full px-6 py-4">
      <h2 className="mb-4 text-lg font-bold">Escolha o que estudar</h2>
      {songs.length === 0 ? (
        <EmptyState
          icon={<IconPractice width={26} height={26} />}
          title="Nenhuma música importada"
          description="Volte ao Setlist e importe as pastas gptabs/ e songs/."
          action={<NeuButton onClick={() => go({ name: 'setlist' })}>Ir para o Setlist</NeuButton>}
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {songs.map((s) => (
            <NeuCard
              key={s.id}
              className="hover:neu-glow cursor-pointer p-4 transition-shadow"
              onClick={() => go({ name: 'practice', songId: s.id })}
            >
              <div className="flex items-center gap-3">
                <ProgressRing value={s.mastery} size={44} stroke={5}>
                  <span className="text-[11px] font-bold">{s.mastery}</span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.title}</div>
                  <div className="text-txt-dim truncate text-xs">{s.artist ?? '—'}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {s.hasGuitarPro && <Badge tone="accent">GP</Badge>}
                  {s.hasAudio && <Badge tone="info">áudio</Badge>}
                </div>
              </div>
            </NeuCard>
          ))}
        </div>
      )}
    </div>
  )
}

export function PracticeScreen({
  songId,
  sectionId,
  fixedSource,
  embedded = false
}: {
  songId?: number
  sectionId?: number | null
  /**
   * Pins the player to one source. The song hub owns that choice in its own
   * menu, so the in-screen switcher would be a second control for the same
   * thing sitting two inches away from the first.
   */
  fixedSource?: Source
  /** Inside the hub the shell already draws the title, badges and chrome. */
  embedded?: boolean
}): ReactNode {
  const str = useStrings()
  const go = useNav((s) => s.go)
  const { toast, show, clear } = useToast()
  const tabRef = useRef<AlphaTabHandle>(null)

  const [song, setSong] = useState<SongView | null>(null)
  const [sections, setSections] = useState<SectionView[]>([])
  const [media, setMedia] = useState<MediaAssetView[]>([])
  const [gpData, setGpData] = useState<ArrayBuffer | null>(null)
  const [tracks, setTracks] = useState<AlphaTabTrack[]>([])
  /** Track indices currently drawn in the score. */
  const [visibleTracks, setVisibleTracks] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  const [ownSource, setSource] = useState<Source>('gp_synth')
  const source = fixedSource ?? ownSource
  /*
   * Guitar only. Bass and drums existed here because a Guitar Pro file carries
   * every track, but this app is used to practise guitar — the switcher was one
   * more control between the player and the score. Track selection below still
   * lets any track be shown on demand.
   */
  const instrument: Instrument = PRACTICE_INSTRUMENT
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [looping, setLooping] = useState(true)
  const [activeSection, setActiveSection] = useState<number | null>(sectionId ?? null)
  const [position, setPosition] = useState({ currentTime: 0, endTime: 0 })
  const [barCount, setBarCount] = useState(0)
  const [showTrainer, setShowTrainer] = useState(false)
  const [insight, setInsight] = useState<string | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)

  const sessionStart = useRef<number>(Date.now())

  const load = useCallback(async () => {
    if (!songId) return
    setLoading(true)
    const [s, secs, mediaList] = await Promise.all([
      api.songs.get(songId),
      api.sections.list(songId),
      api.songs.media(songId)
    ])
    setSong(s)
    setSections(secs)
    setMedia(mediaList)

    const gp = mediaList.find((m) => m.kind === 'guitarpro')
    if (gp) {
      try {
        setGpData(await api.gp.readFile(gp.path))
      } catch (err) {
        show(err instanceof Error ? err.message : 'Falha ao ler o arquivo Guitar Pro', 'danger')
      }
    } else {
      setGpData(null)
      // no tab available: fall back to whatever media the song does have. The
      // hub pins the source itself, so leave its choice alone.
      if (!fixedSource) {
        if (mediaList.some((m) => m.kind.startsWith('stem_'))) setSource('stems')
        else setSource('youtube')
      }
    }
    setLoading(false)
  }, [songId, show, fixedSource])

  useEffect(() => {
    void load()
  }, [load])

  // Persist the session when leaving the screen, so time practiced is never lost.
  useEffect(() => {
    return () => {
      const seconds = Math.round((Date.now() - sessionStart.current) / 1000)
      if (songId && seconds > 30) {
        void api.progress.recordSession({
          songId,
          sectionId: activeSection,
          instrument,
          durationS: seconds,
          bpmTarget: song?.bpm ?? null,
          bpmAchieved: song?.bpm ? song.bpm * speed : null,
          cleanPasses: 0,
          totalPasses: 0,
          mode: source
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  /*
   * AlphaTabView picks a sensible first track when the score loads. Switching
   * instrument re-picks; re-rendering on every `tracks` update would race with
   * that initial render and blank the score.
   */
  const renderedInstrument = useRef<Instrument | null>(null)
  useEffect(() => {
    if (!tracks.length) return
    if (renderedInstrument.current === null) {
      renderedInstrument.current = instrument
      return
    }
    if (renderedInstrument.current === instrument) return
    renderedInstrument.current = instrument
    const wanted = tracks.filter((t) => t.instrument === instrument)
    const pool = wanted.length ? wanted : tracks.filter((t) => t.instrument !== null)
    const primary =
      pool.find((t) => /(lead|main|solo)/i.test(t.name)) ??
      pool.find((t) => !/(additional|extra|backing|clean)/i.test(t.name)) ??
      pool[0]
    if (primary) {
      setVisibleTracks([primary.index])
      tabRef.current?.renderTracks([primary.index])
    }
  }, [instrument, tracks])

  /** Add or remove a staff from the rendered score. */
  const toggleVisible = (index: number): void => {
    setVisibleTracks((prev) => {
      const next = prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      // never render an empty score; keep at least the track just clicked
      const final = next.length ? next : [index]
      tabRef.current?.renderTracks(final)
      return final
    })
  }

  const applySection = (secId: number | null): void => {
    setActiveSection(secId)
    const sec = sections.find((s) => s.id === secId)
    if (sec && sec.startBar !== null && sec.endBar !== null) {
      tabRef.current?.setBarRange(sec.startBar, sec.endBar)
      tabRef.current?.setLoop(true)
      setLooping(true)
    } else {
      tabRef.current?.clearBarRange()
    }
  }

  const changeSpeed = (v: number): void => {
    setSpeed(v)
    tabRef.current?.setSpeed(v)
  }

  const toggleTrack = (index: number, key: 'muted' | 'solo'): void => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.index !== index) return t
        const next = { ...t, [key]: !t[key] }
        if (key === 'muted') tabRef.current?.setTrackMute(index, next.muted)
        else tabRef.current?.setTrackSolo(index, next.solo)
        return next
      })
    )
  }

  const askInsight = async (): Promise<void> => {
    if (!songId) return
    setInsightLoading(true)
    setInsight(null)
    try {
      const res = await api.llm.techniqueBreakdown(songId, activeSection)
      if (isError(res)) show(res.error, 'danger')
      else setInsight(res.content)
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao consultar a IA', 'danger')
    } finally {
      setInsightLoading(false)
    }
  }

  if (!songId) return <SongPicker />
  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} />
      </div>
    )
  }
  if (!song) {
    return (
      <EmptyState
        title="Música não encontrada"
        action={<NeuButton onClick={() => go({ name: 'setlist' })}>Voltar</NeuButton>}
      />
    )
  }

  const targetBpm = song.bpm ?? 120
  const currentBpm = Math.round(targetBpm * speed)
  const hasGp = gpData !== null
  /** This transport plays the tablature; the stem player brings its own. */
  const gpTransport = source === 'gp_synth' && hasGp
  const stems = media.filter((m) => m.kind.startsWith('stem_'))

  return (
    <div className={cx('flex h-full flex-col pb-2', embedded ? 'px-0' : 'px-5')}>
      {!embedded && (
        <>
          {/* header */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="micro-label">{song.artist ?? 'sem artista'}</div>
              <h1 className="truncate text-xl font-bold">{song.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {song.tuning && <Badge tone="accent">{song.tuning.name}</Badge>}
              {song.musicalKey && <Badge tone="info">{song.musicalKey}</Badge>}
              {song.timeSignature && <Badge>{song.timeSignature}</Badge>}
              <Badge>{Math.round(targetBpm)} bpm original</Badge>
            </div>
          </div>

          {/* source */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                {
                  value: 'gp_synth',
                  label: 'Guitar Pro',
                  icon: <IconPractice width={14} height={14} />
                },
                {
                  value: 'stems',
                  label: `Stems${stems.length ? ` (${stems.length})` : ''}`,
                  icon: <IconWave width={14} height={14} />
                },
                { value: 'youtube', label: 'YouTube', icon: <IconYoutube width={14} height={14} /> }
              ]}
            />
            <Badge tone="accent">
              <INSTRUMENT_ICON.guitar width={12} height={12} /> {str.labels.instrument.guitar}
            </Badge>
          </div>
        </>
      )}

      {/* main area */}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1">
          <NeuCard className="h-full overflow-hidden p-2">
            {source === 'gp_synth' &&
              (hasGp ? (
                <AlphaTabView
                  ref={tabRef}
                  fileData={gpData}
                  preferredInstrument={instrument}
                  onReady={({ tracks: t, barCount: bc, initialTrackIndex }) => {
                    setTracks(t)
                    setBarCount(bc)
                    if (initialTrackIndex !== null) setVisibleTracks([initialTrackIndex])
                    if (activeSection) applySection(activeSection)
                  }}
                  onPlayerStateChange={setPlaying}
                  onPositionChange={(p) =>
                    setPosition({ currentTime: p.currentTime, endTime: p.endTime })
                  }
                  onError={(m) => show(`alphaTab: ${m}`, 'danger')}
                />
              ) : (
                <EmptyState
                  icon={<IconPractice width={26} height={26} />}
                  title="Sem arquivo Guitar Pro"
                  description="Essa música não tem tablatura importada. Coloque um .gp/.gp3/.gp4/.gp5 na pasta gptabs/ e importe de novo."
                />
              ))}

            {source === 'stems' &&
              (stems.length ? (
                <MultitrackPlayer song={song} media={media} />
              ) : (
                <EmptyState
                  icon={<IconWave width={26} height={26} />}
                  title="Sem stems separados"
                  description={
                    song.hasAudio
                      ? 'Essa música tem áudio local. Abra o Laboratório e rode a separação de stems para gerar guitarra isolada e backing track.'
                      : 'Importe o arquivo de áudio dessa música em songs/ para poder separar os stems.'
                  }
                  action={
                    song.hasAudio ? (
                      <NeuButton
                        variant="accent"
                        onClick={() => go({ name: 'lab', songId: song.id })}
                      >
                        Abrir Laboratório
                      </NeuButton>
                    ) : undefined
                  }
                />
              ))}

            {source === 'youtube' && (
              <EmptyState
                icon={<IconYoutube width={26} height={26} />}
                title="Vídeos de estudo"
                description="Busque as três versões (Lesson w/ Tabs, Backing Track, Guitar Only) na tela da música."
                action={
                  <NeuButton onClick={() => go({ name: 'song', songId: song.id })}>
                    Abrir a música
                  </NeuButton>
                }
              />
            )}
          </NeuCard>
        </div>

        {/* right rail */}
        <aside className="scroll-area hidden w-64 shrink-0 space-y-3 lg:block">
          {sections.length > 0 && (
            <NeuCard className="p-3.5">
              <div className="micro-label mb-2.5">Trechos</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => applySection(null)}
                  className={cx(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    activeSection === null ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                  )}
                >
                  tudo
                </button>
                {sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => applySection(s.id)}
                    title={`compassos ${(s.startBar ?? 0) + 1}–${(s.endBar ?? 0) + 1}`}
                    className={cx(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      activeSection === s.id ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </NeuCard>
          )}

          {tracks.length > 0 && source === 'gp_synth' && (
            <NeuCard className="p-3.5">
              <div className="micro-label mb-2.5">Trilhas</div>
              <div className="space-y-1.5">
                {tracks
                  .filter((t) => t.instrument !== null)
                  .map((t) => (
                  <div key={t.index} className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleVisible(t.index)}
                      className={cx(
                        'min-w-0 flex-1 truncate text-left text-[11px]',
                        visibleTracks.includes(t.index)
                          ? 'gradient-text font-semibold'
                          : t.instrument === instrument
                            ? 'text-txt-dim'
                            : 'text-txt-micro'
                      )}
                      title={`${t.name} · ${t.instrument ?? 'sem instrumento'} — clique para mostrar/ocultar na partitura`}
                    >
                      {visibleTracks.includes(t.index) ? '● ' : '○ '}
                      {t.name}
                    </button>
                    <button
                      onClick={() => toggleTrack(t.index, 'muted')}
                      className={cx(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                        t.muted ? 'bg-danger/20 text-danger' : 'neu-press text-txt-micro'
                      )}
                      title="Silenciar"
                    >
                      M
                    </button>
                    <button
                      onClick={() => toggleTrack(t.index, 'solo')}
                      className={cx(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                        t.solo ? 'bg-ok/20 text-ok' : 'neu-press text-txt-micro'
                      )}
                      title="Solo"
                    >
                      S
                    </button>
                  </div>
                  ))}
              </div>
              <p className="text-txt-micro mt-2.5 text-[10px] leading-snug">
                Clique no nome para mostrar a trilha na partitura. <b>M</b> silencia e <b>S</b> deixa
                em solo no áudio — silencie a guitarra e toque por cima: é o seu backing track
                direto da tablatura.
              </p>
            </NeuCard>
          )}

          <NeuCard className="p-3.5">
            <button
              onClick={askInsight}
              disabled={insightLoading}
              className="gradient-text flex w-full items-center gap-2 text-xs font-semibold disabled:opacity-50"
            >
              {insightLoading ? <Spinner size={14} /> : <IconSparkle width={15} height={15} />}
              Dicas para esta música
            </button>
            {insight && (
              <div className="scroll-area mt-3 max-h-72">
                <Markdown content={insight} className="text-txt-dim space-y-2 text-[11px]" />
              </div>
            )}
          </NeuCard>
        </aside>
      </div>

      {/*
        Transport. Every control here drives the Guitar Pro synth, so on the
        other sources it is disabled rather than left looking live: the stem
        player carries its own speed, pitch, loop and metronome, and two speed
        controls on one screen — one of them inert — is how you lose ten minutes
        wondering why the audio will not slow down.
      */}
      <NeuCard
        className={cx('mt-3 shrink-0 p-3.5', !gpTransport && 'opacity-60')}
        hidden={embedded && !gpTransport}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <IconButton
              title={playing ? 'Pausar' : 'Tocar'}
              size={48}
              active={playing}
              onClick={() => (playing ? tabRef.current?.pause() : tabRef.current?.play())}
              disabled={!gpTransport}
            >
              {playing ? <IconPause width={20} height={20} /> : <IconPlay width={20} height={20} />}
            </IconButton>
            <IconButton
              title="Parar"
              size={40}
              onClick={() => tabRef.current?.stop()}
              disabled={!gpTransport}
            >
              <IconStop width={16} height={16} />
            </IconButton>
            <IconButton
              title="Loop"
              size={40}
              active={looping}
              disabled={!gpTransport}
              onClick={() => {
                const next = !looping
                setLooping(next)
                tabRef.current?.setLoop(next)
              }}
            >
              <IconLoop width={16} height={16} />
            </IconButton>
            <IconButton
              title="Metrônomo"
              size={40}
              active={metronome}
              disabled={!gpTransport}
              onClick={() => {
                const next = !metronome
                setMetronome(next)
                tabRef.current?.setMetronome(next)
              }}
            >
              <IconMetronome width={16} height={16} />
            </IconButton>
            <IconButton
              title="Contagem inicial"
              size={40}
              active={countIn}
              disabled={!gpTransport}
              onClick={() => {
                const next = !countIn
                setCountIn(next)
                tabRef.current?.setCountIn(next)
              }}
            >
              <span className="text-[11px] font-bold">1·2</span>
            </IconButton>
          </div>

          {/* the tempo scale from the reference */}
          <div className="min-w-[280px] flex-1">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="micro-label">
                velocidade{!gpTransport && ' da tablatura'}
              </span>
              <span className="gradient-text text-sm font-bold tabular-nums">
                {currentBpm} bpm · {Math.round(speed * 100)}%
              </span>
            </div>
            <NeuSlider
              value={speed}
              min={0.4}
              max={1.25}
              step={0.05}
              onChange={changeSpeed}
              ticks={SPEEDS}
              formatTick={(t) => `${Math.round(t * 100)}`}
              disabled={!gpTransport}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="text-txt-dim text-xs tabular-nums">
              {formatDuration(position.currentTime)} / {formatDuration(position.endTime)}
            </div>
            <NeuButton
              variant={showTrainer ? 'accent' : 'default'}
              onClick={() => setShowTrainer(!showTrainer)}
              disabled={!gpTransport}
            >
              Treinador
            </NeuButton>
          </div>
        </div>

        {showTrainer && gpTransport && (
          <SpeedTrainer
            songId={song.id}
            sectionId={activeSection}
            instrument={instrument}
            originalBpm={targetBpm}
            onSpeedChange={(bpm) => changeSpeed(Math.max(0.4, Math.min(1.25, bpm / targetBpm)))}
            onDone={(msg) => show(msg, 'ok')}
          />
        )}
      </NeuCard>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
