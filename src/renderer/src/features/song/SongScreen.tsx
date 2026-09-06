import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  NeuInput,
  NeuSelect,
  Badge,
  Spinner,
  EmptyState,
  ProgressRing,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import {
  IconYoutube,
  IconChart,
  IconSparkle,
  IconLab,
  IconPractice,
  IconProgress,
  IconSearch,
  IconChords,
  IconClock,
  IconGrid,
  IconTone,
  IconTuner,
  IconWave,
  IconX,
  INSTRUMENT_ICON
} from '../../components/ui/icons'
import { ToneTab } from './ToneTab'
import { ChordMap } from './ChordMap'
import { YoutubePlayer } from './YoutubePlayer'
import { PracticeScreen } from '../practice/PracticeScreen'
import { LabScreen } from '../lab/LabScreen'
import { TunerScreen } from '../tuner/TunerScreen'
import { api, isError, formatDuration, formatRelative } from '../../lib/api'
import { useNav, type SongTab } from '../../App'
import { buildChordPro, cifraReadiness } from '@shared/cifra'
import type {
  SongView,
  SectionView,
  ChordMapView,
  MediaAssetView,
  YoutubeRefView,
  ProgressView,
  TuningView,
  Instrument,
  ProgressStatus,
  YoutubeRole
} from '@shared/types'
import { useStrings } from '../../lib/i18n'

/** Object.entries, but keeping the value typed as the string it is. */
function roleEntries(map: Record<string, string>): Array<[string, string]> {
  return Object.entries(map)
}
import {
  STATUS_ORDER,
  PRACTICE_INSTRUMENT,
  PRIMARY_ROLES
} from '@shared/types'

/* ------------------------------------------------------------------ video */

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/**
 * The three study videos, playing in the app.
 *
 * One player, and the slots above choose what goes in it — a lesson, a backing
 * track, the isolated guitar. Three players side by side would each have their
 * own loop and speed and would all be fighting for the same speakers, which is
 * not how anybody practises. The video still opens in the browser on demand,
 * both as an escape hatch and because some uploaders forbid embedding.
 */
function VideoTab({ song }: { song: SongView }): ReactNode {
  const str = useStrings()
  const { toast, show, clear } = useToast()
  const [refs, setRefs] = useState<YoutubeRefView[]>([])
  const [quota, setQuota] = useState<{ searchesLeft: number; used: number; limit: number } | null>(
    null
  )
  /** null = no search running, otherwise the role being searched or 'all'. */
  const [searching, setSearching] = useState<YoutubeRole | 'all' | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [manualRole, setManualRole] = useState<YoutubeRole>('lesson_tabs')
  /** Which reference is loaded in the player. */
  const [playingId, setPlayingId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    setRefs(await api.youtube.refs(song.id))
    setQuota(await api.youtube.quota())
  }, [song.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Best match per role: pinned first, then whatever the classifier trusted most. */
  const bestFor = (role: YoutubeRole): YoutubeRefView | undefined =>
    refs
      .filter((r) => r.role === role)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence)[0]

  const current = refs.find((r) => r.id === playingId) ?? bestFor(PRIMARY_ROLES[0]) ?? refs[0]

  /** `roles` empty means all three slots. Each slot costs one search of quota. */
  const runSearch = async (roles?: YoutubeRole[]): Promise<void> => {
    setSearching(roles?.length === 1 ? roles[0] : 'all')
    try {
      const res = await api.youtube.search(song.id, roles)
      if ('error' in res && res.error) show(res.error, res.videos.length ? 'warn' : 'danger')
      else show(`Encontrados ${res.videos.length} vídeos`, 'ok')
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha na busca', 'danger')
    } finally {
      setSearching(null)
    }
  }

  const addManual = async (): Promise<void> => {
    if (!manualUrl.trim()) return
    const res = await api.youtube.addManual(song.id, manualUrl, manualRole)
    if (isError(res)) show(res.error, 'danger')
    else {
      show('Vídeo adicionado', 'ok')
      setManualUrl('')
      await refresh()
    }
  }

  const openManualSearch = async (role: YoutubeRole): Promise<void> => {
    const url = await api.youtube.manualUrl(song.id, role)
    if (url) void api.shell.openExternal(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-txt-dim text-xs">
          {quota && (
            <>
              Cota do YouTube: <span className="text-txt font-semibold">{quota.searchesLeft}</span>{' '}
              buscas restantes hoje ({quota.used}/{quota.limit} unidades)
            </>
          )}
        </div>
        <NeuButton
          onClick={() => void runSearch()}
          disabled={searching !== null || (quota?.searchesLeft ?? 0) < 3}
          title="Uma busca por tipo — gasta 3 buscas da cota"
        >
          <span className="flex items-center gap-2">
            {searching === 'all' ? <Spinner size={15} /> : <IconSearch width={15} height={15} />}
            Buscar as 3 versões
          </span>
        </NeuButton>
      </div>

      {/* the three practice slots pick what plays below */}
      <div className="grid gap-2.5 lg:grid-cols-3">
        {PRIMARY_ROLES.map((role) => {
          const matches = refs
            .filter((r) => r.role === role)
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence)
          const best = matches[0]
          const active = best && current?.id === best.id
          return (
            <NeuCard key={role} className={cx('p-3', active && 'neu-glow')}>
              <div className="micro-label mb-2">{str.labels.role[role]}</div>
              {best ? (
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setPlayingId(best.id)}
                    className="neu-inset relative h-12 w-20 shrink-0 overflow-hidden rounded-[10px]"
                    title="Tocar aqui dentro"
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${best.videoId}/mqdefault.jpg`}
                      alt=""
                      className="h-full w-full object-cover opacity-80"
                    />
                    <span className="absolute inset-0 grid place-items-center">
                      <span
                        className={cx(
                          'grid h-6 w-6 place-items-center rounded-full text-[10px]',
                          active ? 'gradient-bg text-void' : 'bg-void/70 text-txt'
                        )}
                      >
                        ▶
                      </span>
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => setPlayingId(best.id)}
                      className={cx(
                        'line-clamp-2 text-left text-[11px] font-semibold',
                        active ? 'gradient-text' : 'hover:text-accent-2'
                      )}
                    >
                      {best.title ?? best.videoId}
                    </button>
                    <div className="mt-1 flex items-center gap-1.5">
                      {best.verified ? (
                        <Badge tone="ok">confirmado</Badge>
                      ) : (
                        <Badge tone={best.confidence > 0.75 ? 'info' : 'warn'}>
                          {Math.round(best.confidence * 100)}%
                        </Badge>
                      )}
                      {matches.length > 1 && <Badge>+{matches.length - 1}</Badge>}
                      <button
                        onClick={async () => {
                          await api.youtube.remove(best.id)
                          if (playingId === best.id) setPlayingId(null)
                          await refresh()
                        }}
                        className="text-txt-micro hover:text-danger ml-auto"
                        title="Remover"
                      >
                        <IconX width={12} height={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 py-1.5 text-center">
                  <IconYoutube width={20} height={20} className="text-txt-micro" />
                  <NeuButton
                    className="!px-3 !py-1 !text-[10px]"
                    onClick={() => void runSearch([role])}
                    disabled={searching !== null || (quota?.searchesLeft ?? 0) < 1}
                  >
                    <span className="flex items-center gap-1.5">
                      {searching === role ? <Spinner size={11} /> : null}
                      buscar só este
                    </span>
                  </NeuButton>
                  <button
                    onClick={() => openManualSearch(role)}
                    className="gradient-text text-[10px] font-semibold"
                  >
                    buscar no navegador
                  </button>
                </div>
              )}
            </NeuCard>
          )
        })}
      </div>

      {current ? (
        <NeuCard className="p-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <Badge tone="accent">{str.labels.role[current.role]}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {current.title ?? current.videoId}
            </span>
            <span className="text-txt-micro text-[11px]">{current.channel}</span>
          </div>
          <YoutubePlayer videoId={current.videoId} title={current.title} />
        </NeuCard>
      ) : (
        <NeuCard className="p-4">
          <EmptyState
            icon={<IconYoutube width={24} height={24} />}
            title="Nenhum vídeo ainda"
            description="Busque as três versões acima, ou cole a URL de um vídeo que você já conhece — colar não gasta cota."
          />
        </NeuCard>
      )}

      {/* manual add — the zero-quota path */}
      <NeuCard className="p-4">
        <div className="micro-label mb-3">Adicionar manualmente (não gasta cota)</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <NeuInput
              placeholder="Cole a URL do YouTube aqui"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
          </div>
          <div className="w-52">
            <NeuSelect
              value={manualRole}
              onChange={(v) => setManualRole(v as YoutubeRole)}
              options={roleEntries(str.labels.role)
                .filter(([k]) => k !== 'unknown')
                .map(([value, label]) => ({ value, label }))}
            />
          </div>
          <NeuButton variant="accent" onClick={addManual}>
            Adicionar
          </NeuButton>
        </div>
      </NeuCard>

      {refs.length > 0 && (
        <NeuCard className="p-4">
          <div className="micro-label mb-3">Todos os vídeos ({refs.length})</div>
          <div className="space-y-1.5">
            {refs.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 text-xs">
                <Badge>{str.labels.role[r.role]}</Badge>
                <button
                  onClick={() => setPlayingId(r.id)}
                  className={cx(
                    'min-w-0 flex-1 truncate text-left',
                    current?.id === r.id ? 'gradient-text font-semibold' : 'hover:text-accent-2'
                  )}
                  title="Tocar aqui dentro"
                >
                  {r.title ?? r.videoId}
                </button>
                <span className="text-txt-micro shrink-0">{r.channel}</span>
                <button
                  onClick={() => void api.shell.openExternal(watchUrl(r.videoId))}
                  className="text-txt-micro hover:text-txt shrink-0 text-[10px]"
                  title="Abrir no YouTube"
                >
                  ↗
                </button>
                <select
                  value={r.role}
                  onChange={async (e) => {
                    await api.youtube.setRole(r.id, e.target.value as YoutubeRole)
                    await refresh()
                  }}
                  className="neu-inset-sm shrink-0 rounded-md px-1.5 py-1 text-[10px]"
                >
                  {roleEntries(str.labels.role).map(([value, label]) => (
                    <option key={value} value={value} style={{ background: '#212128' }}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </NeuCard>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}

/* ------------------------------------------------------------------ chart */

/** Minimal ChordPro renderer: chords in brackets float above the lyric syllable. */
function ChordProView({ content }: { content: string }): ReactNode {
  const lines = content.split(/\r?\n/)
  return (
    <div className="font-mono text-[13px] leading-[2.1]">
      {lines.map((line, i) => {
        const directive = line.match(/^\{(\w+)\s*:?\s*(.*)\}$/)
        if (directive) {
          const [, key, value] = directive
          if (key === 'comment' || key === 'c') {
            return (
              <div key={i} className="text-txt-micro my-1 text-[11px] italic">
                {value}
              </div>
            )
          }
          if (key.startsWith('start_of')) {
            return (
              <div key={i} className="micro-label mt-3">
                {key.replace('start_of_', '')}
              </div>
            )
          }
          if (key.startsWith('end_of')) return <div key={i} className="h-2" />
          return (
            <div key={i} className="text-txt-dim text-xs">
              <span className="micro-label mr-2">{key}</span>
              {value}
            </div>
          )
        }
        if (!line.trim()) return <div key={i} className="h-3" />

        const parts = line.split(/(\[[^\]]+\])/g).filter(Boolean)
        return (
          <div key={i} className="flex flex-wrap">
            {parts.map((part, j) => {
              if (part.startsWith('[') && part.endsWith(']')) {
                return (
                  <span key={j} className="relative inline-block">
                    <span className="gradient-text absolute -top-[1.35em] text-[11px] font-bold whitespace-nowrap">
                      {part.slice(1, -1)}
                    </span>
                  </span>
                )
              }
              return (
                <span key={j} className="whitespace-pre-wrap">
                  {part}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function ChartTab({
  song,
  media,
  sections,
  onChanged
}: {
  song: SongView
  media: MediaAssetView[]
  sections: SectionView[]
  onChanged: () => void
}): ReactNode {
  const { toast, show, clear } = useToast()
  const [charts, setCharts] = useState<
    Array<{ id: number; kind: string; format: string; content: string; sourceUrl: string | null }>
  >([])
  const [chordMap, setChordMap] = useState<ChordMapView | null>(null)
  const [editing, setEditing] = useState<'chords' | 'lyrics' | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [list, map] = await Promise.all([api.charts.list(song.id), api.chords.get(song.id)])
    setCharts(list)
    setChordMap(map)
  }, [song.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const chords = charts.find((c) => c.kind === 'chords')
  const lyrics = charts.find((c) => c.kind === 'lyrics')
  const readiness = cifraReadiness({
    hasChords: Boolean(chordMap?.spans.length),
    hasLyrics: Boolean(lyrics),
    syncedLyrics: lyrics?.format === 'lrc'
  })

  const fetchLyrics = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.lyrics.fetch(song.id)
      if (isError(res)) show(res.error, 'danger')
      else {
        show(res.synced ? 'Letra sincronizada encontrada no LRCLIB' : 'Letra simples encontrada', 'ok')
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const convertToChordPro = async (): Promise<void> => {
    if (!draft.trim()) return
    setBusy(true)
    try {
      const res = await api.llm.toChordPro(song.id, draft)
      setDraft(res.content)
      show(`Convertido para ChordPro via ${res.provider}`, 'ok')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha na conversão', 'danger')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Write the cifra out of the two analyses that are already on disk.
   *
   * The chord track has the harmony on a clock and the LRC has the words on the
   * same clock, so the chart is arithmetic rather than an LLM job — see
   * `@shared/cifra`. An existing cifra is never overwritten silently: it lands
   * in the editor instead, so anything typed by hand survives.
   */
  const generateCifra = async (): Promise<void> => {
    if (!chordMap?.spans.length) return
    setBusy(true)
    try {
      const timed = lyrics?.format === 'lrc' ? await api.lyrics.parseLrc(lyrics.content) : []
      const content = buildChordPro({
        title: song.title,
        artist: song.artist,
        musicalKey: chordMap.key ?? song.musicalKey,
        bpm: chordMap.bpm ?? song.bpm,
        spans: chordMap.spans,
        lines: timed,
        plainLyrics: lyrics && lyrics.format !== 'lrc' ? lyrics.content : null,
        sections: sections.map((s) => ({ name: s.name, startMs: s.startMs }))
      })
      if (!content) {
        show('Não deu para montar a cifra com esses dados', 'danger')
        return
      }
      if (chords) {
        setDraft(content)
        setEditing('chords')
        show('Cifra montada — confira antes de salvar por cima da atual', 'warn')
        return
      }
      await api.charts.save(song.id, 'chords', 'chordpro', content)
      await refresh()
      show(
        timed.length
          ? `Cifra montada com ${timed.length} linhas da letra sincronizada`
          : 'Grade de acordes montada — a letra não tinha marcação de tempo',
        'ok'
      )
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao montar a cifra', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    await api.charts.save(
      song.id,
      editing,
      editing === 'chords' ? 'chordpro' : 'plain',
      draft
    )
    setEditing(null)
    await refresh()
    show('Salvo', 'ok')
  }

  if (editing) {
    return (
      <NeuCard className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="micro-label">Editando {editing === 'chords' ? 'cifra' : 'letra'}</div>
          <div className="flex gap-2">
            {editing === 'chords' && (
              <NeuButton onClick={convertToChordPro} disabled={busy}>
                <span className="flex items-center gap-1.5">
                  {busy ? <Spinner size={13} /> : <IconSparkle width={14} height={14} />}
                  Limpar com IA
                </span>
              </NeuButton>
            )}
            <NeuButton onClick={() => setEditing(null)}>Cancelar</NeuButton>
            <NeuButton variant="accent" onClick={save}>
              Salvar
            </NeuButton>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="neu-inset text-txt h-[420px] w-full resize-none rounded-[16px] p-4 font-mono text-[13px] outline-none"
          placeholder={
            editing === 'chords'
              ? 'Cole a cifra aqui (de qualquer site) e clique em "Limpar com IA" para virar ChordPro'
              : 'Cole a letra aqui'
          }
        />
      </NeuCard>
    )
  }

  return (
    <div className="space-y-4">
      <ChordMap song={song} media={media} onKeyDetected={onChanged} />

      <div className="grid gap-4 lg:grid-cols-2">
        <NeuCard className="p-4">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="micro-label">Cifra</div>
            <div className="flex gap-2">
              <NeuButton
                className="!px-3 !py-1.5 !text-xs"
                onClick={generateCifra}
                disabled={busy || !readiness.ready}
                title={readiness.reason}
              >
                <span className="flex items-center gap-1.5">
                  {busy ? <Spinner size={13} /> : <IconChords width={14} height={14} />}
                  Gerar dos acordes
                </span>
              </NeuButton>
              <NeuButton
                className="!px-3 !py-1.5 !text-xs"
                onClick={() => {
                  setDraft(
                    chords?.content ?? `{title: ${song.title}}\n{artist: ${song.artist ?? ''}}\n\n`
                  )
                  setEditing('chords')
                }}
              >
                {chords ? 'Editar' : 'Adicionar'}
              </NeuButton>
            </div>
          </div>
          <p className="text-txt-micro mb-3 text-[10px] leading-snug">{readiness.reason}</p>
          {chords ? (
            <div className="scroll-area max-h-[460px]">
              <ChordProView content={chords.content} />
            </div>
          ) : (
            <EmptyState
              icon={<IconChart width={24} height={24} />}
              title="Sem cifra"
              description="Cole de qualquer site de cifras e a IA converte para ChordPro."
            />
          )}
        </NeuCard>

        <NeuCard className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="micro-label">
              Letra {lyrics?.format === 'lrc' && <span className="text-ok ml-1">sincronizada</span>}
            </div>
            <div className="flex gap-2">
              <NeuButton className="!px-3 !py-1.5 !text-xs" onClick={fetchLyrics} disabled={busy}>
                {busy ? <Spinner size={13} /> : 'Buscar no LRCLIB'}
              </NeuButton>
              <NeuButton
                className="!px-3 !py-1.5 !text-xs"
                onClick={() => {
                  setDraft(lyrics?.content ?? '')
                  setEditing('lyrics')
                }}
              >
                {lyrics ? 'Editar' : 'Adicionar'}
              </NeuButton>
            </div>
          </div>
          {lyrics ? (
            <div className="scroll-area max-h-[460px] text-[13px] leading-relaxed whitespace-pre-wrap">
              {lyrics.format === 'lrc'
                ? lyrics.content.replace(/\[\d{1,3}:\d{2}[.:]\d{1,3}\]/g, '')
                : lyrics.content}
            </div>
          ) : (
            <EmptyState
              icon={<IconChart width={24} height={24} />}
              title="Sem letra"
              description="O LRCLIB é gratuito e não precisa de chave."
            />
          )}
        </NeuCard>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}

/* ------------------------------------------------------------------ tone */

/* ------------------------------------------------------------------ dados */

function DataTab({
  song,
  sections,
  media,
  tunings,
  onSaved
}: {
  song: SongView
  sections: SectionView[]
  media: MediaAssetView[]
  tunings: TuningView[]
  onSaved: () => void
}): ReactNode {
  const { toast, show, clear } = useToast()
  const [form, setForm] = useState({
    title: song.title,
    musicalKey: song.musicalKey ?? '',
    bpm: song.bpm ? String(Math.round(song.bpm)) : '',
    timeSignature: song.timeSignature ?? '',
    capo: String(song.capo),
    tuningId: song.tuning ? String(song.tuning.id) : '',
    notes: song.notes ?? ''
  })

  const save = async (): Promise<void> => {
    await api.songs.update(song.id, {
      title: form.title,
      musicalKey: form.musicalKey || null,
      keySource: form.musicalKey !== (song.musicalKey ?? '') ? 'manual' : song.keySource,
      bpm: form.bpm ? Number(form.bpm) : null,
      bpmSource: form.bpm !== String(song.bpm ?? '') ? 'manual' : song.bpmSource,
      timeSignature: form.timeSignature || null,
      capo: Number(form.capo) || 0,
      tuningId: form.tuningId ? Number(form.tuningId) : null,
      notes: form.notes || null
    })
    show('Salvo', 'ok')
    onSaved()
  }

  return (
    <div className="space-y-4">
      <NeuCard className="p-4">
        <div className="micro-label mb-3">Dados da música</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NeuInput
            label="título"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <NeuInput
            label="tom"
            placeholder="Em, A, F#m…"
            value={form.musicalKey}
            onChange={(e) => setForm({ ...form, musicalKey: e.target.value })}
          />
          <NeuInput
            label="bpm"
            type="number"
            value={form.bpm}
            onChange={(e) => setForm({ ...form, bpm: e.target.value })}
          />
          <NeuInput
            label="compasso"
            placeholder="4/4"
            value={form.timeSignature}
            onChange={(e) => setForm({ ...form, timeSignature: e.target.value })}
          />
          <NeuSelect
            label="afinação"
            value={form.tuningId}
            onChange={(v) => setForm({ ...form, tuningId: v })}
            options={[
              { value: '', label: '— nenhuma —' },
              ...tunings.map((t) => ({
                value: String(t.id),
                label: `${t.name} (${t.strings.join(' ')})`
              }))
            ]}
          />
          <NeuInput
            label="capotraste"
            type="number"
            value={form.capo}
            onChange={(e) => setForm({ ...form, capo: e.target.value })}
          />
        </div>
        <div className="mt-3">
          <label className="micro-label mb-2 block">anotações</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="neu-inset text-txt h-24 w-full resize-none rounded-[16px] p-3 text-sm outline-none"
          />
        </div>
        <div className="mt-3">
          <NeuButton variant="accent" onClick={save}>
            Salvar
          </NeuButton>
        </div>
      </NeuCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <NeuCard className="p-4">
          <div className="micro-label mb-3">Seções ({sections.length})</div>
          {sections.length ? (
            <div className="space-y-1">
              {sections.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <Badge>{s.kind}</Badge>
                  <span className="flex-1 font-semibold">{s.name}</span>
                  <span className="text-txt-micro tabular-nums">
                    c. {(s.startBar ?? 0) + 1}–{(s.endBar ?? 0) + 1}
                  </span>
                  <span className="text-txt-micro">{s.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-txt-micro text-xs">
              Nenhuma seção. Arquivos Guitar Pro com marcadores criam as seções automaticamente.
            </p>
          )}
        </NeuCard>

        <NeuCard className="p-4">
          <div className="micro-label mb-3">Arquivos ({media.length})</div>
          <div className="space-y-1">
            {media.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-xs">
                <Badge tone={m.kind.startsWith('stem_') ? 'ok' : 'neutral'}>{m.kind}</Badge>
                <button
                  onClick={() => void api.shell.showItem(m.path)}
                  className="hover:text-accent-2 min-w-0 flex-1 truncate text-left"
                  title={m.path}
                >
                  {m.path.split(/[\\/]/).pop()}
                </button>
                {m.bytes && (
                  <span className="text-txt-micro shrink-0 tabular-nums">
                    {(m.bytes / 1e6).toFixed(1)} MB
                  </span>
                )}
              </div>
            ))}
          </div>
        </NeuCard>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}

/* --------------------------------------------------------------- progress */

function ProgressPanel({
  song,
  sections,
  progress,
  queued,
  onChange,
  onToggleQueue
}: {
  song: SongView
  sections: SectionView[]
  progress: ProgressView[]
  /** Section ids currently pinned; `null` stands for the whole song. */
  queued: Set<number | null>
  onChange: () => void
  onToggleQueue: (sectionId: number | null) => void
}): ReactNode {
  const str = useStrings()
  // Guitar only: bass and drums were noise on a screen the user opens to
  // practise guitar. The data model still keeps one row per instrument.
  const instrument: Instrument = PRACTICE_INSTRUMENT

  const rowFor = (sectionId: number | null): ProgressView | undefined =>
    progress.find((p) => p.instrument === instrument && (p.sectionId ?? null) === sectionId)

  const setStatus = async (sectionId: number | null, status: ProgressStatus): Promise<void> => {
    await api.progress.setStatus(song.id, instrument, sectionId, status)
    onChange()
  }

  const rows: Array<{ id: number | null; name: string }> = [
    { id: null, name: 'Música inteira' },
    ...sections.map((s) => ({ id: s.id, name: s.name }))
  ]

  return (
    <NeuCard className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="micro-label">Progresso por trecho</div>
        <Badge tone="accent">
          <INSTRUMENT_ICON.guitar width={12} height={12} /> {str.labels.instrument.guitar}
        </Badge>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const p = rowFor(row.id)
          const pinned = queued.has(row.id)
          return (
            <div key={row.id ?? 'all'} className="flex flex-wrap items-center gap-2">
              {/* one click puts this exact trecho at the top of today's list */}
              <button
                onClick={() => onToggleQueue(row.id)}
                title={pinned ? 'Tirar da fila de estudos' : 'Adicionar à fila de estudos'}
                className={cx(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-[8px] text-sm leading-none font-bold',
                  pinned ? 'neu-glow gradient-text' : 'neu-press text-txt-micro'
                )}
              >
                {pinned ? '★' : '+'}
              </button>
              <span
                className={cx('w-32 shrink-0 truncate text-xs', row.id === null && 'font-bold')}
              >
                {row.name}
              </span>
              <div className="flex flex-wrap gap-1">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(row.id, s)}
                    className={cx(
                      'rounded-full px-2 py-1 text-[10px] font-semibold transition-all',
                      p?.status === s
                        ? s === 'gig_ready'
                          ? 'bg-ok/20 text-ok'
                          : 'neu-glow gradient-text'
                        : 'neu-press text-txt-micro'
                    )}
                  >
                    {str.labels.status[s]}
                  </button>
                ))}
              </div>
              {p?.bestBpm && (
                <Badge tone="ok" title="Melhor tempo tocado limpo">
                  {Math.round(p.bestBpm)} bpm
                </Badge>
              )}
              <div className="ml-auto w-20">
                <div className="neu-inset-sm h-1.5 overflow-hidden rounded-full">
                  <div
                    className="gradient-bg h-full rounded-full transition-all"
                    style={{ width: `${p?.mastery ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-txt-micro mt-3 text-[11px] leading-snug">
        O <b>+</b> na frente de cada linha manda aquele trecho para a fila de estudos de hoje, em
        Progresso. As porcentagens contam só a guitarra.
      </p>
    </NeuCard>
  )
}

/* -------------------------------------------------------------- song hub */

/**
 * Everything about one song lives behind one menu.
 *
 * Before this, the pieces of a song were scattered across three routes: the
 * tablature and the stem player were in Estudar, the analysis jobs were in
 * Laboratório, and only the videos, chart, tone and metadata were here. Getting
 * from the chart to the stems meant going back out to the setlist. Now the song
 * is the place and these are its rooms — the shell keeps the title, the mastery
 * ring and the actions on screen while the room changes underneath.
 */
const HUB_TABS: Array<{
  id: SongTab
  label: string
  icon: typeof IconPractice
  hint: string
}> = [
  { id: 'visao', label: 'Visão geral', icon: IconProgress, hint: 'Status por trecho' },
  { id: 'estudar', label: 'Tablatura', icon: IconPractice, hint: 'Guitar Pro com player' },
  { id: 'stems', label: 'Stems', icon: IconWave, hint: 'Faixas separadas' },
  { id: 'video', label: 'Vídeos', icon: IconYoutube, hint: 'Aulas e backing tracks' },
  { id: 'cifra', label: 'Cifra & Letra', icon: IconChords, hint: 'Acordes e letra' },
  { id: 'timbre', label: 'Timbre', icon: IconTone, hint: 'Ajuste do seu rig' },
  { id: 'afinador', label: 'Afinador', icon: IconTuner, hint: 'Afinação desta música' },
  { id: 'lab', label: 'Laboratório', icon: IconLab, hint: 'Separar e analisar' },
  { id: 'dados', label: 'Dados', icon: IconGrid, hint: 'Tom, andamento, arquivos' }
]

/** The rooms that manage their own scrolling and want the full height. */
const FULL_HEIGHT: SongTab[] = ['estudar', 'stems', 'afinador']

function HubNav({
  tab,
  onPick,
  song,
  stemCount
}: {
  tab: SongTab
  onPick: (tab: SongTab) => void
  song: SongView
  stemCount: number
}): ReactNode {
  /** A short note on the right of a row when the room has nothing to show yet. */
  const missing = (id: SongTab): string | null => {
    if (id === 'estudar' && !song.hasGuitarPro) return 'sem GP'
    if (id === 'stems' && stemCount === 0) return 'sem stems'
    if (id === 'lab' && !song.hasAudio) return 'sem áudio'
    return null
  }

  return (
    <nav className="flex flex-col gap-1">
      {HUB_TABS.map((item) => {
        const Icon = item.icon
        const active = tab === item.id
        const note = missing(item.id)
        return (
          <button
            key={item.id}
            onClick={() => onPick(item.id)}
            title={item.hint}
            className={cx(
              'flex items-center gap-2.5 rounded-[13px] px-3 py-2 text-left transition-all',
              active ? 'neu-raised-sm gradient-text' : 'text-txt-dim hover:text-txt'
            )}
          >
            <Icon width={16} height={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.label}</span>
            {note && <span className="text-txt-micro shrink-0 text-[9px]">{note}</span>}
            {item.id === 'stems' && stemCount > 0 && (
              <span className="text-txt-micro shrink-0 text-[9px] tabular-nums">{stemCount}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

export function SongScreen({
  songId,
  tab: routeTab,
  sectionId
}: {
  songId: number
  /** Which room to open in; the menu takes over from here. */
  tab?: SongTab
  sectionId?: number | null
}): ReactNode {
  const go = useNav((s) => s.go)
  const { toast, show, clear } = useToast()
  const [song, setSong] = useState<SongView | null>(null)
  const [sections, setSections] = useState<SectionView[]>([])
  const [media, setMedia] = useState<MediaAssetView[]>([])
  const [progress, setProgress] = useState<ProgressView[]>([])
  const [tunings, setTunings] = useState<TuningView[]>([])
  const [queued, setQueued] = useState<Set<number | null>>(new Set())
  const [tab, setTab] = useState<SongTab>(routeTab ?? 'visao')
  const [loading, setLoading] = useState(true)

  // arriving from another screen with a room in mind (the daily queue, the
  // setlist's "Estudar") re-points the menu without remounting the whole song
  useEffect(() => {
    if (routeTab) setTab(routeTab)
  }, [routeTab])

  /*
   * "Estudar" means "put me in front of this song", not "open the tablature".
   * A song with no Guitar Pro file but with separated stems has a perfectly good
   * practice room; sending the user to an empty score with a note about copying
   * files into gptabs/ is a dead end. Only redirects once per arrival, so
   * clicking Tablatura afterwards sticks.
   */
  const redirected = useRef<string | null>(null)
  useEffect(() => {
    if (!song || routeTab !== 'estudar') return
    const key = `${song.id}:estudar`
    if (redirected.current === key) return
    redirected.current = key
    if (!song.hasGuitarPro && media.some((m) => m.kind.startsWith('stem_'))) setTab('stems')
  }, [routeTab, song, media])

  const refreshQueue = useCallback(async () => {
    const pins = await api.progress.queuePins()
    setQueued(
      new Set(pins.filter((p) => p.songId === songId).map((p) => p.sectionId))
    )
  }, [songId])

  const refresh = useCallback(async () => {
    const [s, secs, m, p, t] = await Promise.all([
      api.songs.get(songId),
      api.sections.list(songId),
      api.songs.media(songId),
      api.progress.list(songId),
      api.songs.tunings()
    ])
    setSong(s)
    setSections(secs)
    setMedia(m)
    setProgress(p)
    setTunings(t)
    await refreshQueue()
    setLoading(false)
  }, [songId, refreshQueue])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleQueue = async (secId: number | null): Promise<void> => {
    const on = queued.has(secId)
    if (on) await api.progress.dequeue(songId, secId)
    else await api.progress.enqueue(songId, secId)
    await refreshQueue()
    show(on ? 'Saiu da fila de estudos' : 'Na fila de estudos', on ? 'neutral' : 'ok')
  }

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
        action={<NeuButton onClick={() => go({ name: 'setlist' })}>Voltar ao setlist</NeuButton>}
      />
    )
  }

  const stems = media.filter((m) => m.kind.startsWith('stem_'))
  const songQueued = queued.has(null)
  const fullHeight = FULL_HEIGHT.includes(tab)

  return (
    <div className="flex h-full min-h-0 gap-4 px-5 pb-3">
      {/* the menu: one place to reach every room of this song */}
      <aside className="hidden w-52 shrink-0 flex-col gap-3 md:flex">
        <NeuCard className="flex items-center gap-3 p-3">
          <ProgressRing
            value={song.mastery}
            size={54}
            stroke={6}
            showPip={song.status === 'gig_ready'}
          >
            <span className="text-[12px] font-bold tabular-nums">{song.mastery}</span>
          </ProgressRing>
          <div className="min-w-0">
            <div className="micro-label truncate">{song.artist ?? 'sem artista'}</div>
            <div className="truncate text-sm font-bold" title={song.title}>
              {song.title}
            </div>
          </div>
        </NeuCard>

        <NeuCard className="p-2">
          <HubNav tab={tab} onPick={setTab} song={song} stemCount={stems.length} />
        </NeuCard>

        <NeuButton
          variant={songQueued ? 'accent' : 'default'}
          onClick={() => void toggleQueue(null)}
          title="A fila de hoje fica na tela de Progresso"
        >
          <span className="flex items-center justify-center gap-2 text-[11px]">
            <IconClock width={14} height={14} />
            {songQueued ? 'Na fila de estudos' : 'Add à fila de estudos'}
          </span>
        </NeuButton>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* compact identity bar: the facts you keep glancing at while playing */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-1 truncate text-lg font-bold md:hidden">{song.title}</h1>
          {song.tuning && <Badge tone="accent">{song.tuning.name}</Badge>}
          {song.musicalKey && <Badge tone="info">{song.musicalKey}</Badge>}
          {song.bpm && <Badge>{Math.round(song.bpm)} bpm</Badge>}
          {song.timeSignature && <Badge>{song.timeSignature}</Badge>}
          {song.capo > 0 && <Badge>capo {song.capo}</Badge>}
          <span className="text-txt-micro ml-auto text-[11px]">
            {formatDuration(song.durationMs)} · {sections.length} trechos · último treino{' '}
            {formatRelative(song.lastPracticedAt)}
          </span>
        </div>

        {/* the menu again, horizontally, on narrow windows */}
        <div className="scroll-area mb-3 md:hidden">
          <div className="flex gap-1.5">
            {HUB_TABS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cx(
                  'shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold',
                  tab === item.id ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className={cx('min-h-0 flex-1', !fullHeight && 'scroll-area pr-1')}>
          {tab === 'visao' && (
            <div className="space-y-4">
              <ProgressPanel
                song={song}
                sections={sections}
                progress={progress}
                queued={queued}
                onChange={() => void refresh()}
                onToggleQueue={(secId) => void toggleQueue(secId)}
              />
              <div className="flex flex-wrap gap-2">
                <NeuButton variant="accent" onClick={() => setTab('estudar')}>
                  <span className="flex items-center gap-2">
                    <IconPractice width={15} height={15} /> Abrir a tablatura
                  </span>
                </NeuButton>
                {stems.length > 0 && (
                  <NeuButton onClick={() => setTab('stems')}>
                    <span className="flex items-center gap-2">
                      <IconWave width={15} height={15} /> Tocar com os stems
                    </span>
                  </NeuButton>
                )}
                <NeuButton onClick={() => setTab('cifra')}>
                  <span className="flex items-center gap-2">
                    <IconChords width={15} height={15} /> Cifra & letra
                  </span>
                </NeuButton>
              </div>
            </div>
          )}

          {/* the tablature and the stem player are the practice screen, pinned
              to one source each — the menu on the left is the switcher now */}
          {tab === 'estudar' && (
            <PracticeScreen
              songId={song.id}
              sectionId={sectionId ?? null}
              fixedSource="gp_synth"
              embedded
            />
          )}
          {tab === 'stems' && (
            <PracticeScreen
              songId={song.id}
              sectionId={sectionId ?? null}
              fixedSource="stems"
              embedded
            />
          )}

          {tab === 'video' && <VideoTab song={song} />}
          {/* `refresh` is stable, so the chord map's job subscription is not
              rebuilt on every render of this screen */}
          {tab === 'cifra' && (
            <ChartTab song={song} media={media} sections={sections} onChanged={refresh} />
          )}
          {tab === 'timbre' && <ToneTab song={song} />}
          {tab === 'afinador' && <TunerScreen songId={song.id} />}
          {tab === 'lab' && <LabScreen songId={song.id} embedded />}
          {tab === 'dados' && (
            <DataTab
              song={song}
              sections={sections}
              media={media}
              tunings={tunings}
              onSaved={() => void refresh()}
            />
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
