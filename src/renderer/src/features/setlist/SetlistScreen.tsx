import { useEffect, useState, useCallback, type ReactNode, type DragEvent } from 'react'
import {
  ProgressRing,
  NeuCard,
  NeuButton,
  ListRow,
  Badge,
  Stat,
  Spinner,
  EmptyState,
  Segmented,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import {
  IconImport,
  IconSetlist,
  IconPractice,
  IconClock,
  IconSpotify,
  IconGrip,
  IconTrash,
  IconDownload,
  IconWave,
  INSTRUMENT_ICON
} from '../../components/ui/icons'
import { AddToSetlistDialog, ImportPlaylistDialog, ConfirmDialog } from './SetlistDialogs'
import { SourcesDialog } from './SourcesDialog'
import { api, formatDuration, formatTotalDuration, formatRelative } from '../../lib/api'
import { useNav } from '../../App'
import type { SetlistView, SetlistItemView, SongView, ImportReport } from '@shared/types'
import { STATUS_LABEL } from '@shared/types'
import {
  sortSongs,
  SORT_KEYS,
  SORT_LABEL,
  SORT_DIR_LABEL,
  type SongSortKey,
  type SortDir
} from '@shared/sort'

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'gig_ready') return 'ok'
  if (status === 'solid') return 'ok'
  if (status === 'shaky') return 'warn'
  if (status === 'learning') return 'warn'
  return 'danger'
}

/**
 * The two download shortcuts that sit on every row, before the running time.
 *
 * Green means the song already has that file; the gradient means it is missing
 * and this is where you go get it.
 */
function SourceChip({
  label,
  title,
  has,
  icon,
  onClick
}: {
  label: string
  title: string
  has: boolean
  icon: ReactNode
  onClick: () => void
}): ReactNode {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cx(
        'neu-press flex h-8 items-center gap-1 rounded-[10px] px-2 text-[10px] font-bold',
        has ? 'text-ok' : 'gradient-text'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Expanded row detail, mirroring the Departure/Return card in the reference. */
function SongDetail({ song }: { song: SongView }): ReactNode {
  const go = useNav((s) => s.go)
  const [queued, setQueued] = useState<boolean | null>(null)

  useEffect(() => {
    void api.progress.queued(song.id, null).then(setQueued)
  }, [song.id])

  const toggleQueue = async (): Promise<void> => {
    if (queued) await api.progress.dequeue(song.id, null)
    else await api.progress.enqueue(song.id, null)
    setQueued(!queued)
  }

  return (
    <div className="neu-inset mx-3.5 mb-3.5 rounded-[18px] p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="micro-label mb-1">Último treino</div>
          <div className="text-sm font-semibold">{formatRelative(song.lastPracticedAt)}</div>
        </div>
        <div>
          <div className="micro-label mb-1">Afinação</div>
          <div className="text-sm font-semibold">{song.tuning?.name ?? '—'}</div>
        </div>
        <div>
          <div className="micro-label mb-1">Tom</div>
          <div className="text-sm font-semibold">
            {song.musicalKey ?? '—'}
            {song.keySource && (
              <span className="text-txt-micro ml-1 text-[10px]">({song.keySource})</span>
            )}
          </div>
        </div>
        <div>
          <div className="micro-label mb-1">Andamento</div>
          <div className="text-sm font-semibold">
            {song.bpm ? `${Math.round(song.bpm)} BPM` : '—'}
            {song.bpmSource && (
              <span className="text-txt-micro ml-1 text-[10px]">({song.bpmSource})</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <NeuButton onClick={() => go({ name: 'song', songId: song.id })}>Abrir música</NeuButton>
        <NeuButton
          variant="accent"
          onClick={() => go({ name: 'song', songId: song.id, tab: 'estudar' })}
        >
          Estudar
        </NeuButton>
        <NeuButton onClick={() => go({ name: 'song', songId: song.id, tab: 'cifra' })}>
          Cifra & letra
        </NeuButton>
        {song.hasAudio && (
          <NeuButton onClick={() => go({ name: 'song', songId: song.id, tab: 'lab' })}>
            Laboratório
          </NeuButton>
        )}
        <NeuButton
          variant={queued ? 'accent' : 'default'}
          onClick={toggleQueue}
          title="Entra no topo da fila de hoje, na tela de Progresso"
        >
          <span className="flex items-center gap-2">
            <IconClock width={14} height={14} />
            {queued ? 'Na fila de estudos' : 'Add à fila de estudos'}
          </span>
        </NeuButton>
      </div>
    </div>
  )
}

/**
 * How the list is ordered.
 *
 * Clicking the key that is already active flips it, which is the only way to
 * reach Z–A and maior→menor. `ordem` is not a sort at all — it is the show
 * order, the one the drag handle writes, and the only one you can drag in.
 */
function SortBar({
  value,
  dir,
  onChange
}: {
  value: SongSortKey
  dir: SortDir
  onChange: (key: SongSortKey, dir: SortDir) => void
}): ReactNode {
  return (
    <div className="neu-inset flex flex-wrap items-center gap-1 rounded-[16px] p-1">
      <span className="micro-label px-1.5">ordenar</span>
      {SORT_KEYS.map((key) => {
        const active = key === value
        return (
          <button
            key={key}
            onClick={() => onChange(key, active && key !== 'ordem' ? flip(dir) : 'asc')}
            title={
              key === 'ordem'
                ? 'A ordem do show, do jeito que você arrastou'
                : `${SORT_LABEL[key]}: ${SORT_DIR_LABEL[key][active ? dir : 'asc']}`
            }
            className={cx(
              'rounded-[11px] px-2.5 py-1 text-[11px] font-semibold transition-all',
              active ? 'neu-raised-sm gradient-text' : 'text-txt-micro hover:text-txt-dim'
            )}
          >
            {SORT_LABEL[key]}
            {active && key !== 'ordem' && (
              <span className="ml-1 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function flip(dir: SortDir): SortDir {
  return dir === 'asc' ? 'desc' : 'asc'
}

function SongRow({
  item,
  position,
  expanded,
  onToggle,
  onRemove,
  onSources,
  previousTuning,
  drag
}: {
  item: SetlistItemView
  /** Place in the show, which stays put however the list is being sorted. */
  position: number
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
  onSources: () => void
  previousTuning: string | null
  drag: {
    enabled: boolean
    dragging: boolean
    over: 'above' | 'below' | null
    onDragStart: (e: DragEvent<HTMLDivElement>) => void
    onDragOver: (e: DragEvent<HTMLDivElement>) => void
    onDrop: () => void
    onDragEnd: () => void
  }
}): ReactNode {
  const song = item.song
  // A tuning change between consecutive songs means a guitar swap mid-set.
  const tuningChange =
    previousTuning !== null && song.tuning?.name && previousTuning !== song.tuning.name

  return (
    <div
      draggable={drag.enabled}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={(e) => {
        e.preventDefault()
        drag.onDrop()
      }}
      onDragEnd={drag.onDragEnd}
      className={cx(
        'transition-opacity',
        drag.dragging && 'opacity-40',
        // the insertion line shows which gap the row would land in
        drag.over === 'above' && 'border-accent-2 rounded-t-[22px] border-t-2',
        drag.over === 'below' && 'border-accent-2 rounded-b-[22px] border-b-2'
      )}
    >
      {tuningChange && (
        <div className="text-warn mb-1.5 flex items-center gap-2 px-4 text-[11px] font-semibold">
          <span className="bg-warn/40 h-px flex-1" />
          troca de afinação: {previousTuning} → {song.tuning?.name}
          <span className="bg-warn/40 h-px flex-1" />
        </div>
      )}
      <ListRow
        icon={
          <span className="flex flex-col items-center gap-0.5">
            <IconGrip
              width={13}
              height={13}
              className="text-txt-micro cursor-grab active:cursor-grabbing"
            />
            <span className="text-txt-micro text-sm font-bold tabular-nums">
              {String(position).padStart(2, '0')}
            </span>
          </span>
        }
        label={song.artist ?? undefined}
        title={song.title}
        onClick={onToggle}
        trailing={
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 sm:flex">
              {song.tuning && <Badge>{song.tuning.name}</Badge>}
              {song.musicalKey && <Badge tone="info">{song.musicalKey}</Badge>}
              {song.bpm && <Badge>{Math.round(song.bpm)} bpm</Badge>}
            </div>
            <div className="flex items-center gap-1.5">
              <SourceChip
                label="GP"
                title={
                  song.hasGuitarPro
                    ? 'Já tem tablatura — clique para buscar outra versão'
                    : 'Buscar tablatura Guitar Pro (Ultimate Guitar / CifraClub)'
                }
                has={song.hasGuitarPro}
                icon={<IconDownload width={12} height={12} />}
                onClick={onSources}
              />
              <SourceChip
                label="WAV"
                title={
                  song.hasAudio
                    ? 'Já tem áudio — clique para baixar outra versão'
                    : 'Baixar a faixa em wav/mp3 do archive.org'
                }
                has={song.hasAudio}
                icon={<IconWave width={12} height={12} />}
                onClick={onSources}
              />
            </div>
            <div className="text-txt-dim w-12 text-right text-xs tabular-nums">
              {formatDuration(song.durationMs)}
            </div>
            <ProgressRing value={song.mastery} size={46} stroke={5}>
              <span className="text-[11px] font-bold tabular-nums">{song.mastery}</span>
            </ProgressRing>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="neu-press gradient-text hover:text-danger grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-lg font-bold leading-none"
              title="Tirar do setlist"
            >
              −
            </button>
          </div>
        }
      >
        {expanded && <SongDetail song={song} />}
      </ListRow>
    </div>
  )
}

function ImportSummary({ report, label }: { report: ImportReport; label: string }): ReactNode {
  return (
    <div className="text-xs">
      <div className="mb-1 font-semibold">
        {label}: {report.created} criadas · {report.matched} casadas · {report.skipped} já existiam
        {report.errors.length > 0 && ` · ${report.errors.length} erros`}
      </div>
      <ul className="text-txt-dim space-y-0.5">
        {report.details.slice(0, 8).map((d, i) => (
          <li key={i} className="truncate">
            <span
              className={cx(
                'mr-1.5 font-semibold',
                d.action === 'created' && 'text-ok',
                d.action === 'matched' && 'text-info',
                d.action === 'error' && 'text-danger'
              )}
            >
              {d.action}
            </span>
            {d.songTitle ?? d.file.split(/[\\/]/).pop()}
            {d.note && <span className="text-txt-micro"> — {d.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SetlistScreen(): ReactNode {
  const go = useNav((s) => s.go)
  const { toast, show, clear } = useToast()

  const [setlists, setSetlists] = useState<SetlistView[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [items, setItems] = useState<SetlistItemView[]>([])
  const [allSongs, setAllSongs] = useState<SongView[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    guitarPro: ImportReport
    audio: ImportReport
  } | null>(null)
  const [view, setView] = useState<'setlist' | 'todas'>('setlist')
  /** Display order. `ordem` is the show order and the only one that can be dragged. */
  const [sortKey, setSortKey] = useState<SongSortKey>('ordem')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  /** Index being dragged, and the index it is currently hovering over. */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [bands, setBands] = useState<string[]>([])
  const [showImport, setShowImport] = useState(false)
  /** Song waiting to be filed into a setlist from the "Todas" tab. */
  const [addingSong, setAddingSong] = useState<SongView | null>(null)
  /** Song whose Guitar Pro / audio sources are being looked up. */
  const [sourcesSong, setSourcesSong] = useState<SongView | null>(null)
  /** Setlist queued for deletion, waiting on the confirmation. */
  const [deleting, setDeleting] = useState<SetlistView | null>(null)

  const refresh = useCallback(async () => {
    const lists = await api.setlists.list()
    setSetlists(lists)
    const active = lists.find((l) => l.isActive) ?? lists[0]
    setActiveId(active?.id ?? null)
    if (active) setItems(await api.setlists.items(active.id))
    setAllSongs(await api.songs.list())
    setBands(await api.setlists.bands())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await api.library.importAll()
      setImportResult(result)
      const total =
        result.guitarPro.created +
        result.guitarPro.matched +
        result.audio.created +
        result.audio.matched
      show(`Importação concluída — ${total} arquivos processados`, 'ok')
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha na importação', 'danger')
    } finally {
      setImporting(false)
    }
  }

  const addToSetlist = async (songId: number, setlistId: number): Promise<void> => {
    await api.setlists.addSong(setlistId, songId)
    await refresh()
    const target = setlists.find((l) => l.id === setlistId)
    show(`Adicionada a ${target?.name ?? 'setlist'}`, 'ok')
  }

  const removeFromSetlist = async (songId: number, title: string): Promise<void> => {
    if (!activeId) return
    await api.setlists.removeSong(activeId, songId)
    await refresh()
    show(`${title} saiu do setlist`, 'ok')
  }

  const deleteSetlist = async (list: SetlistView): Promise<void> => {
    await api.setlists.remove(list.id)
    await refresh()
    show(`Setlist "${list.name}" excluído — as músicas continuam na biblioteca`, 'ok')
  }

  /**
   * Reorder locally first, then persist. Waiting for the round-trip before
   * repainting makes the row snap back under the cursor for a frame, which
   * reads as the drag having failed.
   */
  const commitReorder = async (from: number, to: number): Promise<void> => {
    if (!activeId || from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setItems(next)
    try {
      await api.setlists.reorder(
        activeId,
        next.map((i) => i.itemId)
      )
      // positions feed the setlist readiness and tuning-change hints
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao reordenar', 'danger')
      await refresh()
    }
  }

  const applySort = (key: SongSortKey, dir: SortDir): void => {
    setSortKey(key)
    setSortDir(dir)
  }

  /*
   * Sorting is a way of *reading* the setlist, never a way of rewriting it: the
   * order the show is played in is the one on disk. So the rows are sorted for
   * display, they keep showing their real place in the show, and the drag handle
   * is only live while the list is in that order — dropping a row into a list
   * sorted by duration would write an order nobody asked for.
   */
  const draggable = sortKey === 'ordem'
  const sortedItems = sortSongs(items, (i) => i.song, sortKey, sortDir)
  const sortedSongs = sortSongs(allSongs, (s) => s, sortKey, sortDir)

  const active = setlists.find((l) => l.id === activeId) ?? null

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} />
      </div>
    )
  }

  const totalMinutes = Math.round((active?.totalDurationMs ?? 0) / 60000)
  const gigReady = items.filter((i) => i.song.status === 'gig_ready').length
  const needsWork = items.filter(
    (i) => i.song.status === 'not_started' || i.song.status === 'learning'
  ).length

  return (
    <div className="scroll-area h-full px-6 pb-4">
      {/* hero */}
      <div className="flex flex-col items-center pt-2 pb-6">
        <ProgressRing
          value={active?.readiness ?? 0}
          size={190}
          stroke={15}
          showPip={(active?.readiness ?? 0) >= 95}
          label="prontidão do set"
        />
        <div className="mt-5 flex items-center gap-2">
          <h1 className="text-2xl font-bold">{active?.name ?? 'Sem setlist'}</h1>
          {active && (
            <button
              onClick={() => setDeleting(active)}
              title="Excluir este setlist"
              className="neu-press text-txt-dim hover:text-danger grid h-8 w-8 place-items-center rounded-[10px]"
            >
              <IconTrash width={15} height={15} />
            </button>
          )}
        </div>
        {active?.band && <Badge tone="accent">{active.band}</Badge>}
        {active && (
          <p className="text-txt-dim mt-1 text-sm">
            {active.songCount} músicas · {formatTotalDuration(active.totalDurationMs)}
          </p>
        )}

        {setlists.length > 1 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {setlists.map((l) => (
              <button
                key={l.id}
                onClick={async () => {
                  await api.setlists.setActive(l.id)
                  await refresh()
                }}
                className={cx(
                  'rounded-full px-3 py-1 text-[11px] font-semibold',
                  l.id === activeId ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                )}
                title={l.band ?? undefined}
              >
                {l.name}
                {l.band && <span className="text-txt-micro ml-1.5">· {l.band}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 flex w-full max-w-md items-start justify-around">
          <Stat value={gigReady} label="prontas" />
          <Stat value={needsWork} label="a trabalhar" />
          <Stat value={totalMinutes} unit="min" label="duração" />
        </div>
      </div>

      {/* actions */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'setlist', label: 'Do setlist' },
            { value: 'todas', label: `Todas (${allSongs.length})` }
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <NeuButton onClick={runImport} disabled={importing}>
            <span className="flex items-center gap-2">
              {importing ? <Spinner size={15} /> : <IconImport width={16} height={16} />}
              {importing ? 'Importando…' : 'Importar pastas'}
            </span>
          </NeuButton>
          <NeuButton onClick={() => setShowImport(true)}>
            <span className="flex items-center gap-2">
              <IconSpotify width={16} height={16} />
              Importar playlist
            </span>
          </NeuButton>
          <NeuButton onClick={() => go({ name: 'progress' })}>
            <span className="flex items-center gap-2">
              <IconClock width={16} height={16} />O que treinar hoje
            </span>
          </NeuButton>
        </div>
      </div>

      {importResult && (
        <NeuCard className="mb-5 space-y-3 p-4">
          <ImportSummary report={importResult.guitarPro} label="Guitar Pro" />
          <ImportSummary report={importResult.audio} label="Áudio" />
          <button
            className="text-txt-micro hover:text-txt text-xs"
            onClick={() => setImportResult(null)}
          >
            fechar
          </button>
        </NeuCard>
      )}

      {/* list */}
      {view === 'setlist' ? (
        items.length === 0 ? (
          <EmptyState
            icon={<IconSetlist width={26} height={26} />}
            title="Setlist vazio"
            description={
              allSongs.length === 0
                ? 'Importe suas pastas gptabs/ e songs/ para começar. Os arquivos Guitar Pro trazem afinação, andamento e seções automaticamente.'
                : 'Você tem músicas na biblioteca. Troque para "Todas" e adicione ao setlist.'
            }
            action={
              allSongs.length === 0 ? (
                <NeuButton variant="accent" onClick={runImport} disabled={importing}>
                  Importar agora
                </NeuButton>
              ) : (
                <NeuButton onClick={() => setView('todas')}>Ver todas as músicas</NeuButton>
              )
            }
          />
        ) : (
          <div className="space-y-2.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="micro-label">Músicas do show</div>
              <div className="flex flex-wrap items-center gap-2">
                <SortBar value={sortKey} dir={sortDir} onChange={applySort} />
                <span className="text-txt-micro text-[10px]">
                  {draggable
                    ? 'arraste para reordenar'
                    : 'ordenado — volte para "ordem" para arrastar'}
                </span>
              </div>
            </div>
            {sortedItems.map((item, i) => (
              <SongRow
                key={item.itemId}
                item={item}
                position={items.indexOf(item) + 1}
                expanded={expanded === item.song.id}
                onToggle={() => setExpanded(expanded === item.song.id ? null : item.song.id)}
                onRemove={() => void removeFromSetlist(item.song.id, item.song.title)}
                onSources={() => setSourcesSong(item.song)}
                previousTuning={i > 0 ? (sortedItems[i - 1].song.tuning?.name ?? null) : null}
                drag={{
                  enabled: draggable,
                  dragging: dragIndex === i,
                  over:
                    overIndex === i && dragIndex !== null && dragIndex !== i
                      ? dragIndex > i
                        ? 'above'
                        : 'below'
                      : null,
                  onDragStart: (e) => {
                    // Chromium starts a drag without it, but a drag carrying no
                    // data is a no-op in other engines and in some DnD polyfills
                    e.dataTransfer.setData('text/plain', String(item.itemId))
                    e.dataTransfer.effectAllowed = 'move'
                    setDragIndex(i)
                    // a row expanded mid-drag makes the drop targets jump around
                    setExpanded(null)
                  },
                  onDragOver: (e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (overIndex !== i) setOverIndex(i)
                  },
                  onDrop: () => {
                    if (dragIndex !== null) void commitReorder(dragIndex, i)
                    setDragIndex(null)
                    setOverIndex(null)
                  },
                  onDragEnd: () => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }
                }}
              />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="micro-label">Biblioteca</div>
            <SortBar value={sortKey} dir={sortDir} onChange={applySort} />
          </div>
          {allSongs.length === 0 && (
            <EmptyState
              icon={<IconImport width={26} height={26} />}
              title="Nenhuma música ainda"
              description="Importe as pastas gptabs/ e songs/."
              action={
                <NeuButton variant="accent" onClick={runImport} disabled={importing}>
                  Importar
                </NeuButton>
              }
            />
          )}
          {sortedSongs.map((song) => (
            <ListRow
              key={song.id}
              icon={<INSTRUMENT_ICON.guitar width={20} height={20} className="text-txt-micro" />}
              label={song.artist ?? undefined}
              title={song.title}
              onClick={() => go({ name: 'song', songId: song.id })}
              trailing={
                <div className="flex items-center gap-2">
                  {song.hasStems && <Badge tone="ok">stems</Badge>}
                  <SourceChip
                    label="GP"
                    title={
                      song.hasGuitarPro
                        ? 'Já tem tablatura — clique para buscar outra versão'
                        : 'Buscar tablatura Guitar Pro (Ultimate Guitar / CifraClub)'
                    }
                    has={song.hasGuitarPro}
                    icon={<IconDownload width={12} height={12} />}
                    onClick={() => setSourcesSong(song)}
                  />
                  <SourceChip
                    label="WAV"
                    title={
                      song.hasAudio
                        ? 'Já tem áudio — clique para baixar outra versão'
                        : 'Baixar a faixa em wav/mp3 do archive.org'
                    }
                    has={song.hasAudio}
                    icon={<IconWave width={12} height={12} />}
                    onClick={() => setSourcesSong(song)}
                  />
                  <Badge tone={statusTone(song.status)}>{STATUS_LABEL[song.status]}</Badge>
                  <NeuButton
                    className="gradient-text !h-8 !w-8 !px-0 !py-0 !text-lg !font-bold"
                    title="Adicionar a um setlist"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddingSong(song)
                    }}
                  >
                    +
                  </NeuButton>
                </div>
              }
            />
          ))}
        </div>
      )}

      {addingSong && (
        <AddToSetlistDialog
          song={addingSong}
          setlists={setlists}
          onAdd={(setlistId) => addToSetlist(addingSong.id, setlistId)}
          onCreate={async (name, band) => {
            const created = await api.setlists.create(name, band)
            await refresh()
            return created
          }}
          onClose={() => setAddingSong(null)}
        />
      )}

      {showImport && (
        <ImportPlaylistDialog
          bands={bands}
          onDone={async (report) => {
            await api.setlists.setActive(report.setlist.id)
            await refresh()
            setView('setlist')
            show(
              `${report.setlist.name} ${report.mode === 'updated' ? 'atualizado' : 'criado'}: ` +
                `${report.created} novas, ${report.matched} já existiam` +
                (report.removed ? `, ${report.removed} saíram da playlist` : '') +
                (report.skipped ? `, ${report.skipped} repetidas` : ''),
              'ok'
            )
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {sourcesSong && (
        <SourcesDialog
          song={sourcesSong}
          onChanged={() => {
            // re-read the song itself: the dialog's badges are driven by
            // hasGuitarPro/hasAudio, which an import just changed
            void (async () => {
              await refresh()
              const fresh = await api.songs.get(sourcesSong.id)
              if (fresh) setSourcesSong(fresh)
            })()
          }}
          onClose={() => setSourcesSong(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir setlist"
          message={
            <>
              <b>{deleting.name}</b>
              {deleting.band ? ` (${deleting.band})` : ''} some com as {deleting.songCount} músicas
              que estão nele. As músicas <b>continuam na biblioteca</b> — some só o setlist e a
              ordem do show.
            </>
          }
          onConfirm={() => deleteSetlist(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
