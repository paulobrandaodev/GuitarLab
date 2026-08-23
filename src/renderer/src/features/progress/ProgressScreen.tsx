import { useEffect, useState, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  Badge,
  Stat,
  Spinner,
  EmptyState,
  Segmented,
  ProgressRing,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import { IconClock, IconSparkle, IconFlame, INSTRUMENT_ICON } from '../../components/ui/icons'
import { Markdown } from '../../components/ui/markdown'
import { api, isError } from '../../lib/api'
import { useNav } from '../../App'
import type { DailyQueueItem } from '@shared/types'
import { STATUS_LABEL, INSTRUMENT_LABEL } from '@shared/types'

/** GitHub-style year heatmap of practice minutes. */
function Heatmap({ data }: { data: Array<{ day: string; seconds: number }> }): ReactNode {
  const byDay = new Map(data.map((d) => [d.day, d.seconds]))
  const max = Math.max(600, ...data.map((d) => d.seconds))

  const days: Array<{ date: Date; key: string; seconds: number }> = []
  const today = new Date()
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ date: d, key, seconds: byDay.get(key) ?? 0 })
  }

  // pad so the grid starts on a Sunday column
  const lead = days[0].date.getDay()
  const cells: Array<{ key: string; seconds: number } | null> = [
    ...Array<null>(lead).fill(null),
    ...days
  ]

  const weeks: Array<Array<{ key: string; seconds: number } | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell, di) => {
              if (!cell) return <div key={di} className="h-[11px] w-[11px]" />
              const intensity = cell.seconds > 0 ? Math.min(1, cell.seconds / max) : 0
              return (
                <div
                  key={di}
                  title={`${cell.key}: ${Math.round(cell.seconds / 60)} min`}
                  className="h-[11px] w-[11px] rounded-[3px]"
                  style={{
                    background:
                      intensity === 0
                        ? 'rgba(255,255,255,0.035)'
                        : `linear-gradient(135deg,
                            rgba(255,209,92,${0.25 + intensity * 0.75}),
                            rgba(255,78,138,${0.25 + intensity * 0.75}))`
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function QueueCard({ item }: { item: DailyQueueItem }): ReactNode {
  const go = useNav((s) => s.go)
  const Icon = INSTRUMENT_ICON[item.instrument]
  return (
    <NeuCard className="p-3.5">
      <div className="flex items-center gap-3">
        <div className="neu-inset grid h-11 w-11 shrink-0 place-items-center rounded-[14px]">
          <Icon width={18} height={18} className="text-txt-micro" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {item.songTitle}
            {item.sectionName && (
              <span className="text-txt-dim font-normal"> · {item.sectionName}</span>
            )}
          </div>
          <div className="text-txt-dim mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span>{item.reason}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={item.status === 'shaky' ? 'warn' : 'neutral'}>
            {STATUS_LABEL[item.status]}
          </Badge>
          <Badge>
            <IconClock width={11} height={11} /> {item.estimatedMinutes}min
          </Badge>
          <NeuButton
            className="!px-3 !py-1.5 !text-xs"
            onClick={() =>
              go({ name: 'practice', songId: item.songId, sectionId: item.sectionId })
            }
          >
            treinar
          </NeuButton>
        </div>
      </div>
    </NeuCard>
  )
}

export function ProgressScreen(): ReactNode {
  const { toast, show, clear } = useToast()
  const [budget, setBudget] = useState(30)
  const [queue, setQueue] = useState<DailyQueueItem[]>([])
  const [stats, setStats] = useState<{
    totals: Record<string, number>
    heatmap: Array<{ day: string; seconds: number; sessions: number }>
    bpmProgress: Array<{ song: string; instrument: string; day: string; bpm: number }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<string | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  useEffect(() => {
    void Promise.all([api.progress.dailyQueue(budget), api.progress.stats()]).then(([q, s]) => {
      setQueue(q)
      setStats(s)
      setLoading(false)
    })
  }, [budget])

  const askPlan = async (): Promise<void> => {
    setPlanLoading(true)
    setPlan(null)
    try {
      const res = await api.llm.practicePlan(budget)
      if (isError(res)) show(res.error, 'danger')
      else setPlan(res.content)
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao gerar o plano', 'danger')
    } finally {
      setPlanLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} />
      </div>
    )
  }

  const totalHours = Math.round(((stats?.totals.totalSeconds ?? 0) / 3600) * 10) / 10
  const queueMinutes = queue.reduce((a, q) => a + q.estimatedMinutes, 0)

  // current streak of consecutive days with any practice
  const practiced = new Set((stats?.heatmap ?? []).filter((h) => h.seconds > 0).map((h) => h.day))
  let streak = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    if (practiced.has(d.toISOString().slice(0, 10))) streak++
    else if (i > 0) break
  }

  return (
    <div className="scroll-area h-full px-6 pb-4">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Progresso</h1>
          <p className="text-txt-dim text-sm">O que treinar hoje e como você está evoluindo</p>
        </div>
        <div className="flex gap-6">
          <Stat value={stats?.totals.songs ?? 0} label="músicas" />
          <Stat value={stats?.totals.sessions ?? 0} label="sessões" />
          <Stat value={totalHours} unit="h" label="praticadas" />
          <Stat value={streak} label="dias seguidos" />
        </div>
      </div>

      {/* daily queue */}
      <NeuCard className="mb-5 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="micro-label mb-1">Fila de hoje</div>
            <div className="text-txt-dim text-xs">
              {queue.length} itens · {queueMinutes} min planejados
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={String(budget)}
              onChange={(v) => setBudget(Number(v))}
              options={[
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '60', label: '1 hora' },
                { value: '120', label: '2 horas' }
              ]}
            />
            <NeuButton onClick={askPlan} disabled={planLoading || queue.length === 0}>
              <span className="flex items-center gap-2">
                {planLoading ? <Spinner size={14} /> : <IconSparkle width={15} height={15} />}
                Plano com IA
              </span>
            </NeuButton>
          </div>
        </div>

        {queue.length === 0 ? (
          <EmptyState
            icon={<IconClock width={24} height={24} />}
            title="Fila vazia"
            description="Importe músicas e marque o status dos trechos para o app montar sua rotina."
          />
        ) : (
          <div className="space-y-2">
            {queue.map((item, i) => (
              <QueueCard key={`${item.songId}-${item.sectionId}-${item.instrument}-${i}`} item={item} />
            ))}
          </div>
        )}

        {plan && (
          <div className="neu-inset mt-4 rounded-[18px] p-4">
            <div className="micro-label mb-2">Plano sugerido</div>
            <Markdown content={plan} />
          </div>
        )}
      </NeuCard>

      {/* heatmap */}
      <NeuCard className="mb-5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="micro-label">Constância (12 meses)</div>
          {streak > 2 && (
            <Badge tone="ok">
              <IconFlame width={11} height={11} /> {streak} dias
            </Badge>
          )}
        </div>
        <Heatmap data={stats?.heatmap ?? []} />
      </NeuCard>

      {/* bpm growth */}
      {stats && stats.bpmProgress.length > 0 && (
        <NeuCard className="p-4">
          <div className="micro-label mb-3">Evolução de andamento</div>
          <div className="space-y-2">
            {Object.entries(
              stats.bpmProgress.reduce<Record<string, Array<{ day: string; bpm: number }>>>(
                (acc, row) => {
                  const key = `${row.song} · ${INSTRUMENT_LABEL[row.instrument as 'guitar']}`
                  ;(acc[key] ??= []).push({ day: row.day, bpm: row.bpm })
                  return acc
                },
                {}
              )
            ).map(([key, points]) => {
              const max = Math.max(...points.map((p) => p.bpm))
              const first = points[0]?.bpm ?? 0
              const last = points[points.length - 1]?.bpm ?? 0
              const gain = last - first
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-52 shrink-0 truncate text-xs font-semibold">{key}</span>
                  <div className="flex h-8 flex-1 items-end gap-[2px]">
                    {points.slice(-40).map((p, i) => (
                      <div
                        key={i}
                        title={`${p.day}: ${Math.round(p.bpm)} bpm`}
                        className="gradient-bg min-w-[3px] flex-1 rounded-t-[2px]"
                        style={{ height: `${(p.bpm / max) * 100}%` }}
                      />
                    ))}
                  </div>
                  <span
                    className={cx(
                      'w-20 shrink-0 text-right text-xs font-bold tabular-nums',
                      gain > 0 ? 'text-ok' : 'text-txt-dim'
                    )}
                  >
                    {gain > 0 ? '+' : ''}
                    {Math.round(gain)} bpm
                  </span>
                </div>
              )
            })}
          </div>
        </NeuCard>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
