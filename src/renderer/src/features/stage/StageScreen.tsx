import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { Badge, Spinner, EmptyState, NeuButton, cx } from '../../components/ui'
import { IconArrowLeft, IconX } from '../../components/ui/icons'
import { api } from '../../lib/api'
import { useNav } from '../../App'
import type { SetlistItemView } from '@shared/types'

/**
 * Full-screen performance view: big type, no chrome, keyboard/pedal driven.
 * Most USB page-turner pedals emit arrow keys or PageUp/PageDown, so those are
 * the bindings.
 */
export function StageScreen({ setlistId }: { setlistId?: number }): ReactNode {
  const go = useNav((s) => s.go)
  const [items, setItems] = useState<SetlistItemView[]>([])
  const [index, setIndex] = useState(0)
  const [chart, setChart] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const lists = await api.setlists.list()
      const target = setlistId
        ? lists.find((l) => l.id === setlistId)
        : (lists.find((l) => l.isActive) ?? lists[0])
      if (target) setItems(await api.setlists.items(target.id))
      setLoading(false)
    })()
  }, [setlistId])

  const current = items[index] ?? null

  useEffect(() => {
    if (!current) return
    void api.charts.list(current.song.id).then((charts) => {
      const chords = charts.find((c) => c.kind === 'chords')
      const lyrics = charts.find((c) => c.kind === 'lyrics')
      const source = chords ?? lyrics
      if (!source) {
        setChart(null)
        return
      }
      setChart(
        source.format === 'lrc'
          ? source.content.replace(/\[\d{1,3}:\d{2}[.:]\d{1,3}\]/g, '').trim()
          : source.content
      )
    })
  }, [current])

  const next = useCallback(() => setIndex((i) => Math.min(items.length - 1, i + 1)), [items.length])
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Escape') {
        go({ name: 'setlist' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, go])

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
          title="Setlist vazio"
          description="Adicione músicas ao setlist para usar o Modo Palco."
          action={<NeuButton onClick={() => go({ name: 'setlist' })}>Voltar</NeuButton>}
        />
      </div>
    )
  }

  const upcoming = items[index + 1] ?? null

  return (
    <div className="bg-void flex h-full flex-col">
      <header className="drag-region flex items-center justify-between px-6 py-3">
        <div className="no-drag flex items-center gap-3">
          <button
            onClick={() => go({ name: 'setlist' })}
            className="text-txt-micro hover:text-txt"
            title="Sair (Esc)"
          >
            <IconX width={20} height={20} />
          </button>
          <span className="micro-label">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="no-drag flex items-center gap-2">
          {current?.song.tuning && (
            <Badge tone="accent">{current.song.tuning.name}</Badge>
          )}
          {current?.song.musicalKey && <Badge tone="info">{current.song.musicalKey}</Badge>}
          {current?.song.bpm && <Badge>{Math.round(current.song.bpm)} bpm</Badge>}
        </div>
      </header>

      <div className="min-h-0 flex-1 px-10">
        <div className="mb-4">
          <div className="text-txt-dim text-lg">{current?.song.artist}</div>
          <h1 className="text-5xl leading-tight font-bold">{current?.song.title}</h1>
        </div>

        <div className="scroll-area h-[calc(100%-7rem)]">
          {chart ? (
            <pre className="font-mono text-2xl leading-[1.9] whitespace-pre-wrap">{chart}</pre>
          ) : (
            <p className="text-txt-micro text-xl">
              Sem cifra ou letra cadastrada para esta música.
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between px-10 py-4">
        <button
          onClick={prev}
          disabled={index === 0}
          className="text-txt-dim hover:text-txt flex items-center gap-2 text-sm disabled:opacity-30"
        >
          <IconArrowLeft width={18} height={18} /> anterior
        </button>

        {upcoming && (
          <div className="text-center">
            <div className="micro-label">a seguir</div>
            <div className="text-txt-dim text-sm">
              {upcoming.song.title}
              {upcoming.song.tuning?.name !== current?.song.tuning?.name && (
                <span className="text-warn ml-2 font-semibold">
                  trocar para {upcoming.song.tuning?.name}
                </span>
              )}
            </div>
          </div>
        )}

        <button
          onClick={next}
          disabled={index >= items.length - 1}
          className="text-txt-dim hover:text-txt flex items-center gap-2 text-sm disabled:opacity-30"
        >
          próxima <IconArrowLeft width={18} height={18} className="rotate-180" />
        </button>
      </footer>
    </div>
  )
}
