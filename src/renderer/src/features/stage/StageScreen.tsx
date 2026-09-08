import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Badge, Spinner, EmptyState, NeuButton, NeuSelect, cx } from '../../components/ui'
import { ChordProView } from '../../components/ui/chordpro'
import { IconArrowLeft, IconX, IconSetlist, IconTuner } from '../../components/ui/icons'
import { api } from '../../lib/api'
import { useNav } from '../../App'
import { useStrings } from '../../lib/i18n'
import type { SetlistItemView, SetlistView } from '@shared/types'

/** Lyric size in stage mode, in px. Persisted: it depends on the room, not the song. */
const SIZE_KEY = 'guitarlab.stage.fontSize'
const MIN_SIZE = 16
const MAX_SIZE = 46

function readStoredSize(): number {
  try {
    const raw = Number(localStorage.getItem(SIZE_KEY))
    if (Number.isFinite(raw) && raw >= MIN_SIZE && raw <= MAX_SIZE) return raw
  } catch {
    // a locked-down profile refuses storage; the default is fine
  }
  return 26
}

/** Strip the LRC timestamps so a synced lyric reads as a plain one. */
function plainFromLrc(content: string): string {
  return content.replace(/\[\d{1,3}:\d{2}[.:]\d{1,3}\]/g, '').trim()
}

/** The wall clock, which is what tells you whether the set is running long. */
function Clock(): ReactNode {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="text-txt-dim text-sm tabular-nums">
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
    </span>
  )
}

/**
 * Full-screen performance view: big type, no chrome, keyboard and pedal driven.
 *
 * The job on stage is different from the job at a desk. Nothing here is a
 * control you hunt for with a mouse — most USB page-turner pedals send arrow
 * keys or PageUp/PageDown, so those move between songs, and the rest of the
 * bindings are single keys within reach of one hand. What is on screen is the
 * three things you actually look down for: what the song is, what to play, and
 * whether the next one needs the guitar retuned.
 */
export function StageScreen({ setlistId }: { setlistId?: number }): ReactNode {
  const str = useStrings().stage
  const go = useNav((s) => s.go)
  const [setlists, setSetlists] = useState<SetlistView[]>([])
  const [activeList, setActiveList] = useState<number | null>(null)
  const [items, setItems] = useState<SetlistItemView[]>([])
  const [index, setIndex] = useState(0)
  const [chart, setChart] = useState<{ content: string; chordPro: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [fontSize, setFontSize] = useState(readStoredSize)
  const [showList, setShowList] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const lists = await api.setlists.list()
      setSetlists(lists)
      const target = setlistId
        ? lists.find((l) => l.id === setlistId)
        : (lists.find((l) => l.isActive) ?? lists[0])
      setActiveList(target?.id ?? null)
      setLoading(false)
    })()
  }, [setlistId])

  useEffect(() => {
    if (activeList === null) return
    let alive = true
    void api.setlists.items(activeList).then((rows) => {
      if (!alive) return
      setItems(rows)
      setIndex(0)
    })
    return () => {
      alive = false
    }
  }, [activeList])

  const current = items[index] ?? null
  const upcoming = items[index + 1] ?? null

  useEffect(() => {
    if (!current) {
      setChart(null)
      return
    }
    let alive = true
    void api.charts.list(current.song.id).then((charts) => {
      if (!alive) return
      /*
       * An empty row counts as no chart at all.
       *
       * A chart the user opened, cleared and saved leaves a row with an empty
       * string behind, and taking that as "there is a chart" is how stage mode
       * ends up showing a blank page with no explanation of why — which on
       * stage reads as the app having broken.
       */
      const usable = charts.filter((c) => c.content.trim().length > 0)
      const chords = usable.find((c) => c.kind === 'chords')
      const lyrics = usable.find((c) => c.kind === 'lyrics')
      const source = chords ?? lyrics
      if (!source) {
        setChart(null)
        return
      }
      const content =
        source.format === 'lrc' ? plainFromLrc(source.content) : source.content
      setChart(content.trim() ? { content, chordPro: source.format === 'chordpro' } : null)
      // a new song starts at its top, whatever the last one was scrolled to
      scrollRef.current?.scrollTo({ top: 0 })
    })
    return () => {
      alive = false
    }
  }, [current])

  const next = useCallback(
    () => setIndex((i) => Math.min(items.length - 1, i + 1)),
    [items.length]
  )
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  const resize = useCallback((delta: number) => {
    setFontSize((size) => {
      const nextSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size + delta))
      try {
        localStorage.setItem(SIZE_KEY, String(nextSize))
      } catch {
        // not being able to remember the size is not worth failing over
      }
      return nextSize
    })
  }, [])

  /** Half a screen at a time, which is how a long chart is actually read. */
  const scrollChart = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: direction * el.clientHeight * 0.6, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      /*
       * Space and the arrows do double duty: down/up scroll the chart of the
       * song you are on, right/left change songs. A pedal that sends PageDown
       * gets the next song, which is what a pedal is for.
       */
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        prev()
      } else if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        scrollChart(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        scrollChart(-1)
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        resize(2)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        resize(-2)
      } else if (e.key.toLowerCase() === 'l') {
        setShowList((v) => !v)
      } else if (e.key === 'Escape') {
        if (showList) setShowList(false)
        else go({ name: 'setlist' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, go, resize, scrollChart, showList])

  /** The remaining songs that need a different tuning from the one in hand. */
  const retunes = useMemo(() => {
    const out: Array<{ position: number; title: string; tuning: string }> = []
    for (let i = index + 1; i < items.length; i++) {
      const name = items[i].song.tuning?.name
      const before = items[i - 1].song.tuning?.name
      if (name && name !== before) {
        out.push({ position: i, title: items[i].song.title, tuning: name })
      }
    }
    return out
  }, [items, index])

  const tuningChange =
    upcoming?.song.tuning?.name && upcoming.song.tuning.name !== current?.song.tuning?.name
      ? upcoming.song.tuning.name
      : null

  if (loading) {
    return (
      <div className="bg-void grid h-full place-items-center">
        <Spinner size={30} />
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="bg-void grid h-full place-items-center">
        <EmptyState
          icon={<IconSetlist width={26} height={26} />}
          title={str.emptyTitle}
          description={str.emptyBody}
          action={
            <NeuButton onClick={() => go({ name: 'setlist' })}>{str.backToSetlist}</NeuButton>
          }
        />
      </div>
    )
  }

  return (
    <div className="bg-void flex h-full flex-col">
      <header className="drag-region flex shrink-0 items-center justify-between gap-4 px-6 py-3">
        <div className="no-drag flex min-w-0 items-center gap-3">
          <button
            onClick={() => go({ name: 'setlist' })}
            className="text-txt-micro hover:text-txt"
            title={str.exit}
            aria-label={str.exitLabel}
          >
            <IconX width={20} height={20} />
          </button>
          <span className="gradient-text text-sm font-bold tabular-nums">
            {index + 1} / {items.length}
          </span>
          {setlists.length > 1 ? (
            <div className="w-52">
              <NeuSelect
                value={activeList === null ? '' : String(activeList)}
                onChange={(v) => setActiveList(Number(v))}
                options={setlists.map((l) => ({
                  value: String(l.id),
                  label: l.band ? `${l.name} · ${l.band}` : l.name
                }))}
              />
            </div>
          ) : (
            <span className="text-txt-micro truncate text-xs">
              {setlists.find((l) => l.id === activeList)?.name}
            </span>
          )}
        </div>

        <div className="no-drag flex items-center gap-2">
          {current?.song.tuning && <Badge tone="accent">{current.song.tuning.name}</Badge>}
          {current?.song.musicalKey && <Badge tone="info">{current.song.musicalKey}</Badge>}
          {current?.song.bpm && <Badge>{Math.round(current.song.bpm)} bpm</Badge>}
          {current?.song.capo ? <Badge>capo {current.song.capo}</Badge> : null}
          <div className="text-txt-micro ml-2 flex items-center gap-1">
            <button
              onClick={() => resize(-2)}
              className="neu-press grid h-7 w-7 place-items-center rounded-[9px] text-sm font-bold"
              title={str.smaller}
            >
              −
            </button>
            <button
              onClick={() => resize(2)}
              className="neu-press grid h-7 w-7 place-items-center rounded-[9px] text-sm font-bold"
              title={str.bigger}
            >
              +
            </button>
          </div>
          <button
            onClick={() => setShowList((v) => !v)}
            className={cx(
              'neu-press grid h-7 w-7 place-items-center rounded-[9px]',
              showList && 'text-accent-2'
            )}
            title={str.repertoireKey}
            aria-label={str.repertoire}
          >
            <IconSetlist width={15} height={15} />
          </button>
          <Clock />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-10">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-4 shrink-0">
            <div className="text-txt-dim text-lg">{current?.song.artist ?? '—'}</div>
            <h1 className="truncate text-5xl leading-tight font-bold" title={current?.song.title}>
              {current?.song.title}
            </h1>
          </div>

          <div ref={scrollRef} className="scroll-area min-h-0 flex-1 pr-2">
            {chart ? (
              chart.chordPro ? (
                <ChordProView
                  content={chart.content}
                  fontSize={fontSize}
                  hideMeta
                  className="font-mono"
                />
              ) : (
                <pre
                  className="font-mono whitespace-pre-wrap"
                  style={{ fontSize, lineHeight: 1.9 }}
                >
                  {chart.content}
                </pre>
              )
            ) : (
              <div className="text-txt-micro space-y-2 text-xl">
                <p>{str.noChart}</p>
                <p className="text-base">{str.noChartHint}</p>
              </div>
            )}
          </div>
        </div>

        {/*
          The rest of the set, on demand.

          Kept closed by default and behind one key, because on stage the chart
          is the whole screen — but "which song is fourth" is the question that
          otherwise makes someone walk back to a laptop.
        */}
        {showList && (
          <aside className="scroll-area hidden w-72 shrink-0 pb-4 lg:block">
            <div className="micro-label mb-2">{str.repertoire}</div>
            <div className="space-y-1">
              {items.map((item, i) => (
                <button
                  key={item.itemId}
                  onClick={() => setIndex(i)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm',
                    i === index
                      ? 'neu-raised-sm gradient-text font-bold'
                      : i < index
                        ? 'text-txt-micro line-through'
                        : 'text-txt-dim hover:text-txt'
                  )}
                >
                  <span className="w-5 shrink-0 text-[11px] tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{item.song.title}</span>
                  {item.song.tuning && (
                    <span className="text-txt-micro shrink-0 text-[10px]">
                      {item.song.tuning.name}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {retunes.length > 0 && (
              <>
                <div className="micro-label mt-5 mb-2">{str.retunes}</div>
                <div className="space-y-1">
                  {retunes.map((r) => (
                    <div key={r.position} className="text-txt-dim flex items-center gap-2 text-xs">
                      <IconTuner width={13} height={13} className="text-warn shrink-0" />
                      <span className="w-5 shrink-0 tabular-nums">{r.position + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <span className="text-warn shrink-0 font-semibold">{r.tuning}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 px-10 py-4">
        <button
          onClick={prev}
          disabled={index === 0}
          className="text-txt-dim hover:text-txt flex items-center gap-2 text-sm disabled:opacity-30"
        >
          <IconArrowLeft width={18} height={18} /> {str.previous}
        </button>

        <div className="min-w-0 text-center">
          {upcoming ? (
            <>
              <div className="micro-label">{str.upNext}</div>
              <div className="text-txt-dim truncate text-sm">
                {upcoming.song.title}
                {tuningChange && (
                  <span className="text-warn ml-2 font-semibold">
                    {str.switchTo(tuningChange)}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="micro-label">{str.lastOfSet}</div>
          )}
        </div>

        <button
          onClick={next}
          disabled={index >= items.length - 1}
          className="text-txt-dim hover:text-txt flex items-center gap-2 text-sm disabled:opacity-30"
        >
          {str.next} <IconArrowLeft width={18} height={18} className="rotate-180" />
        </button>
      </footer>

      <div className="text-txt-micro pb-2 text-center text-[10px]">{str.help}</div>
    </div>
  )
}
