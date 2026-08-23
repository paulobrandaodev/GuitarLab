import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  NeuInput,
  NeuSelect,
  Badge,
  Segmented,
  Spinner,
  EmptyState,
  ProgressRing,
  Stat,
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
  IconSearch,
  IconChords,
  IconX,
  INSTRUMENT_ICON
} from '../../components/ui/icons'
import { ToneTab } from './ToneTab'
import { ChordMap } from './ChordMap'
import { api, isError, formatDuration, formatRelative } from '../../lib/api'
import { useNav } from '../../App'
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
import {
  STATUS_LABEL,
  STATUS_ORDER,
  INSTRUMENT_LABEL,
  ROLE_LABEL,
  PRIMARY_ROLES
} from '@shared/types'

type Tab = 'estudar' | 'cifra' | 'video' | 'timbre' | 'dados'

/* ------------------------------------------------------------------ video */

/**
 * Videos open in the real browser rather than in an embedded player.
 *
 * The renderer is served from `app://bundle`, and the YouTube IFrame player
 * refuses to start on any origin that is not http(s) — it answers with "erro de
 * configuração do player". Rewriting Origin/Referer from the main process was
 * not enough, because the player also validates the embedding page through
 * postMessage against its real origin, which stays `app://bundle`. Embedding
 * would need the page to be served from a local HTTP origin; until then the
 * thumbnail links out, which always works.
 */
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

function VideoTab({ song }: { song: SongView }): ReactNode {
  const { toast, show, clear } = useToast()
  const [refs, setRefs] = useState<YoutubeRefView[]>([])
  const [quota, setQuota] = useState<{ searchesLeft: number; used: number; limit: number } | null>(
    null
  )
  /** null = no search running, otherwise the role being searched or 'all'. */
  const [searching, setSearching] = useState<YoutubeRole | 'all' | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [manualRole, setManualRole] = useState<YoutubeRole>('lesson_tabs')

  const refresh = useCallback(async () => {
    setRefs(await api.youtube.refs(song.id))
    setQuota(await api.youtube.quota())
  }, [song.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

      {/* the three practice slots */}
      <div className="grid gap-3 lg:grid-cols-3">
        {PRIMARY_ROLES.map((role) => {
          const matches = refs
            .filter((r) => r.role === role)
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence)
          const best = matches[0]
          return (
            <NeuCard key={role} className="flex min-h-[210px] flex-col p-4">
              <div className="micro-label mb-2">{ROLE_LABEL[role]}</div>
              {best ? (
                <>
                  <button
                    onClick={() => void api.shell.openExternal(watchUrl(best.videoId))}
                    className="neu-inset group relative mb-2 aspect-video overflow-hidden rounded-[14px]"
                    title="Abrir no YouTube"
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${best.videoId}/mqdefault.jpg`}
                      alt=""
                      className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                    />
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="gradient-bg text-void grid h-11 w-11 place-items-center rounded-full">
                        ▶
                      </span>
                    </span>
                    <span className="text-txt bg-void/75 absolute right-1.5 bottom-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold">
                      abrir no YouTube
                    </span>
                  </button>
                  <button
                    onClick={() => void api.shell.openExternal(watchUrl(best.videoId))}
                    className="hover:text-accent-2 line-clamp-2 text-left text-xs font-semibold"
                    title="Abrir no YouTube"
                  >
                    {best.title}
                  </button>
                  <div className="text-txt-micro mt-0.5 text-[11px]">{best.channel}</div>
                  <div className="mt-auto flex items-center gap-1.5 pt-2">
                    {best.verified ? (
                      <Badge tone="ok">confirmado</Badge>
                    ) : (
                      <Badge tone={best.confidence > 0.75 ? 'info' : 'warn'}>
                        {Math.round(best.confidence * 100)}% certeza
                      </Badge>
                    )}
                    {matches.length > 1 && <Badge>+{matches.length - 1}</Badge>}
                    <button
                      onClick={async () => {
                        await api.youtube.remove(best.id)
                        await refresh()
                      }}
                      className="text-txt-micro hover:text-danger ml-auto"
                      title="Remover"
                    >
                      <IconX width={13} height={13} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <IconYoutube width={26} height={26} className="text-txt-micro" />
                  <p className="text-txt-micro text-[11px]">Nenhum vídeo desse tipo ainda</p>
                  <NeuButton
                    className="!px-3 !py-1.5 !text-[11px]"
                    onClick={() => void runSearch([role])}
                    disabled={searching !== null || (quota?.searchesLeft ?? 0) < 1}
                  >
                    <span className="flex items-center gap-1.5">
                      {searching === role ? <Spinner size={12} /> : null}
                      buscar só este
                    </span>
                  </NeuButton>
                  <button
                    onClick={() => openManualSearch(role)}
                    className="gradient-text text-[11px] font-semibold"
                  >
                    buscar no navegador
                  </button>
                </div>
              )}
            </NeuCard>
          )
        })}
      </div>

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
              options={Object.entries(ROLE_LABEL)
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
                <Badge>{ROLE_LABEL[r.role]}</Badge>
                <button
                  onClick={() => void api.shell.openExternal(watchUrl(r.videoId))}
                  className="hover:text-accent-2 min-w-0 flex-1 truncate text-left"
                >
                  {r.title ?? r.videoId}
                </button>
                <span className="text-txt-micro shrink-0">{r.channel}</span>
                <select
                  value={r.role}
                  onChange={async (e) => {
                    await api.youtube.setRole(r.id, e.target.value as YoutubeRole)
                    await refresh()
                  }}
                  className="neu-inset-sm shrink-0 rounded-md px-1.5 py-1 text-[10px]"
                >
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
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
  onChange
}: {
  song: SongView
  sections: SectionView[]
  progress: ProgressView[]
  onChange: () => void
}): ReactNode {
  // Guitar only: bass and drums were noise on a screen the user opens to
  // practise guitar. The data model still keeps one row per instrument.
  const instrument: Instrument = 'guitar'

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
          <INSTRUMENT_ICON.guitar width={12} height={12} /> {INSTRUMENT_LABEL.guitar}
        </Badge>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const p = rowFor(row.id)
          return (
            <div key={row.id ?? 'all'} className="flex flex-wrap items-center gap-2">
              <span
                className={cx(
                  'w-36 shrink-0 truncate text-xs',
                  row.id === null && 'font-bold'
                )}
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
                    {STATUS_LABEL[s]}
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
    </NeuCard>
  )
}

/* ------------------------------------------------------------------ main */

export function SongScreen({ songId }: { songId: number }): ReactNode {
  const go = useNav((s) => s.go)
  const [song, setSong] = useState<SongView | null>(null)
  const [sections, setSections] = useState<SectionView[]>([])
  const [media, setMedia] = useState<MediaAssetView[]>([])
  const [progress, setProgress] = useState<ProgressView[]>([])
  const [tunings, setTunings] = useState<TuningView[]>([])
  const [tab, setTab] = useState<Tab>('estudar')
  const [loading, setLoading] = useState(true)

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
    setLoading(false)
  }, [songId])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  return (
    <div className="scroll-area h-full px-6 pb-4">
      {/* hero */}
      <div className="mb-5 flex flex-wrap items-center gap-6">
        <ProgressRing
          value={song.mastery}
          size={130}
          stroke={11}
          showPip={song.status === 'gig_ready'}
        />
        <div className="min-w-0 flex-1">
          <div className="micro-label">{song.artist ?? 'sem artista'}</div>
          <h1 className="truncate text-2xl font-bold">{song.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {song.tuning && <Badge tone="accent">{song.tuning.name}</Badge>}
            {song.musicalKey && <Badge tone="info">{song.musicalKey}</Badge>}
            {song.bpm && <Badge>{Math.round(song.bpm)} bpm</Badge>}
            {song.timeSignature && <Badge>{song.timeSignature}</Badge>}
            {song.capo > 0 && <Badge>capo {song.capo}</Badge>}
            {song.hasGuitarPro && <Badge tone="accent">Guitar Pro</Badge>}
            {song.hasAudio && <Badge tone="info">áudio</Badge>}
            {song.hasStems && <Badge tone="ok">stems</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <NeuButton variant="accent" onClick={() => go({ name: 'practice', songId: song.id })}>
              <span className="flex items-center gap-2">
                <IconPractice width={15} height={15} /> Estudar
              </span>
            </NeuButton>
            {song.hasAudio && (
              <NeuButton onClick={() => go({ name: 'lab', songId: song.id })}>
                <span className="flex items-center gap-2">
                  <IconLab width={15} height={15} /> Laboratório
                </span>
              </NeuButton>
            )}
          </div>
        </div>
        <div className="flex gap-6">
          <Stat value={formatDuration(song.durationMs)} label="duração" />
          <Stat value={sections.length} label="trechos" />
          <Stat value={formatRelative(song.lastPracticedAt)} label="último treino" />
        </div>
      </div>

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'estudar', label: 'Progresso' },
            { value: 'video', label: 'Vídeos' },
            { value: 'cifra', label: 'Cifra & Letra' },
            { value: 'timbre', label: 'Timbre' },
            { value: 'dados', label: 'Dados' }
          ]}
        />
      </div>

      {tab === 'estudar' && (
        <ProgressPanel
          song={song}
          sections={sections}
          progress={progress}
          onChange={() => void refresh()}
        />
      )}
      {tab === 'video' && <VideoTab song={song} />}
      {/* `refresh` is stable, so the chord map's job subscription is not rebuilt
          on every render of this screen */}
      {tab === 'cifra' && (
        <ChartTab song={song} media={media} sections={sections} onChanged={refresh} />
      )}
      {tab === 'timbre' && <ToneTab song={song} />}
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
  )
}
