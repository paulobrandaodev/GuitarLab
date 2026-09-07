import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NeuButton, NeuCard, Badge, Spinner, cx } from '../../components/ui'
import { IconLab, IconDownload, IconTrash, IconCheck } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import { useStrings, useFormat } from '../../lib/i18n'
import type { LabPack, LabSetupProgress, LabSetupStatus } from '@shared/types'

/**
 * Installing the audio lab.
 *
 * This is the screen that replaced "run `npm run lab:up` in a terminal". It is
 * the only place in the app that asks someone to spend a multi-gigabyte
 * download, so it has to answer three questions before they commit: what will
 * be downloaded, how big it is, and whether their machine can use the fast one.
 * Everything else here is progress and a working cancel.
 */

function Bar({ value }: { value: number }): ReactNode {
  return (
    <div className="neu-inset-sm h-1.5 overflow-hidden rounded-full">
      <div
        className="gradient-bg h-full rounded-full transition-all"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  )
}

export function LabSetup({ onChanged }: { onChanged?: () => void }): ReactNode {
  const s = useStrings()
  const fmt = useFormat()
  const [status, setStatus] = useState<LabSetupStatus | null>(null)
  const [progress, setProgress] = useState<LabSetupProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await api.lab.setup.status()
    if (!isError(next)) setStatus(next)
    onChanged?.()
  }, [onChanged])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Progress arrives as an event rather than being polled: the install runs for
  // minutes and asking once a second for all of them is worse in every way.
  useEffect(() => {
    return api.lab.setup.onProgress((next) => {
      setProgress(next)
      if (next.phase === 'done' || next.phase === 'error') {
        setBusy(false)
        if (next.error) setError(next.error)
        void refresh()
      }
    })
  }, [refresh])

  const install = async (pack: LabPack): Promise<void> => {
    setError(null)
    setBusy(true)
    setProgress({ phase: 'uv', progress: 0, detail: '' })
    const res = await api.lab.setup.install(pack)
    if (isError(res)) {
      setError(res.error)
      setBusy(false)
    }
    await refresh()
  }

  /*
   * Downloading a model is a job on the sidecar, like a separation, so it is
   * polled the same way rather than given its own event channel. There are at
   * most a handful of these and each is over in a minute or two.
   */
  const pollRef = useRef<number | null>(null)
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  const fetchModel = async (family: 'demucs' | 'whisper', id: string): Promise<void> => {
    setError(null)
    setFetching(`${family}-${id}`)
    const res = await api.lab.setup.fetchModel(family, id)
    if (isError(res)) {
      setError(res.error)
      setFetching(null)
      return
    }
    pollRef.current = window.setInterval(() => {
      void api.lab.setup.modelJob(res.jobId).then((job) => {
        if (!job || (job.status !== 'done' && job.status !== 'error')) return
        if (pollRef.current) window.clearInterval(pollRef.current)
        if (job.status === 'error' && job.error) setError(job.error)
        setFetching(null)
        void refresh()
      })
    }, 1500)
  }

  if (!status) {
    return (
      <NeuCard className="mb-5 flex items-center gap-3 p-4">
        <Spinner /> <span className="text-txt-dim text-sm">{s.common.loading}</span>
      </NeuCard>
    )
  }

  // ── installing ──────────────────────────────────────────────────────────────
  if (busy || status.busy) {
    const phase = progress?.phase ?? 'uv'
    const label = s.lab.setup.phase[phase as keyof typeof s.lab.setup.phase] ?? phase
    return (
      <NeuCard className="mb-5 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">
            {s.lab.setup.installing} — {label}
          </span>
          <NeuButton
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => void api.lab.setup.cancel()}
          >
            {s.lab.setup.cancel}
          </NeuButton>
        </div>
        <Bar value={progress?.progress ?? 0} />
        <p className="text-txt-micro mt-2 text-[11px] break-words">
          {progress?.detail || s.lab.setup.timeWarning}
        </p>
      </NeuCard>
    )
  }

  // ── not installed ───────────────────────────────────────────────────────────
  if (!status.installed) {
    const cards: Array<{ pack: LabPack; title: string; desc: string; size: number }> = [
      {
        pack: 'cpu',
        title: s.lab.setup.packCpu,
        desc: s.lab.setup.packCpuDesc,
        size: 400_000_000
      },
      {
        pack: 'cuda',
        title: s.lab.setup.packCuda,
        desc: s.lab.setup.packCudaDesc,
        size: 2_700_000_000
      }
    ]
    return (
      <NeuCard className="mb-5 p-4">
        <div className="mb-3 flex items-start gap-3">
          <IconLab width={22} height={22} className="text-accent mt-0.5 shrink-0" />
          <div>
            <div className="mb-1 text-sm font-semibold">{s.lab.setup.title}</div>
            <p className="text-txt-dim text-xs leading-relaxed">{s.lab.setup.intro}</p>
            <p className="text-txt-micro mt-1.5 text-[11px]">
              {status.gpu
                ? s.lab.setup.gpuFound(status.gpu.name, status.gpu.driver)
                : s.lab.setup.gpuNone}
            </p>
          </div>
        </div>

        {error && <p className="text-danger mb-3 text-[11px] break-words">{error}</p>}

        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => {
            const best = status.recommendedPack === card.pack
            return (
              <NeuCard key={card.pack} className="flex flex-col p-3.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{card.title}</span>
                  {best && <Badge tone="accent">{s.lab.setup.recommended}</Badge>}
                </div>
                <p className="text-txt-micro mb-3 text-[11px] leading-snug">{card.desc}</p>
                <NeuButton
                  className="mt-auto"
                  variant={best ? 'accent' : 'default'}
                  onClick={() => void install(card.pack)}
                >
                  {s.lab.setup.install(fmt.bytes(card.size))}
                </NeuButton>
              </NeuCard>
            )
          })}
        </div>
      </NeuCard>
    )
  }

  // ── installed ───────────────────────────────────────────────────────────────
  return (
    <NeuCard className="mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconCheck width={18} height={18} className="text-ok shrink-0" />
          <div>
            <div className="text-sm font-semibold">{s.lab.setup.ready}</div>
            <div className="text-txt-micro text-[11px]">
              {status.pack && s.lab.setup.packInUse(status.pack.toUpperCase())} ·{' '}
              {s.lab.setup.diskRuntime} {fmt.bytes(status.runtimeBytes)} · {s.lab.setup.diskModels}{' '}
              {fmt.bytes(status.modelBytes)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NeuButton
            className="px-3 py-1.5 text-xs"
            onClick={() =>
              void (status.running ? api.lab.setup.stop() : api.lab.setup.start()).then(refresh)
            }
          >
            {status.running ? s.lab.setup.stop : s.lab.setup.start}
          </NeuButton>
          <NeuButton
            variant="danger"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              if (!window.confirm(s.lab.setup.removeConfirm)) return
              void api.lab.setup.remove().then(refresh)
            }}
          >
            <IconTrash width={14} height={14} />
          </NeuButton>
        </div>
      </div>

      {status.stale && (
        <div className="neu-inset-sm mb-3 rounded-xl p-3">
          <div className="text-warn text-xs font-semibold">{s.lab.setup.stale}</div>
          <p className="text-txt-micro text-[11px]">{s.lab.setup.staleDesc}</p>
        </div>
      )}

      {error && <p className="text-danger mb-3 text-[11px] break-words">{error}</p>}

      <div className="micro-label mb-1.5">{s.lab.setup.models}</div>
      <p className="text-txt-micro mb-2.5 text-[11px]">{s.lab.setup.modelsDesc}</p>
      <div className="space-y-1.5">
        {status.models.map((model) => {
          const key = `${model.family}-${model.id}`
          const have = status.installedModels.includes(key)
          const running = fetching === key
          return (
            <div key={key} className="flex items-center gap-3 text-xs">
              <span className="w-32 font-semibold">{model.id}</span>
              <span className="text-txt-micro w-16">{model.family}</span>
              <span className="text-txt-micro flex-1">{fmt.bytes(model.approxBytes)}</span>
              {have ? (
                <Badge tone="ok">{s.lab.setup.downloaded}</Badge>
              ) : (
                <button
                  disabled={running || !status.running}
                  onClick={() => void fetchModel(model.family, model.id)}
                  className={cx(
                    'text-txt-micro hover:text-txt flex items-center gap-1 text-[11px]',
                    (running || !status.running) && 'opacity-40'
                  )}
                >
                  {running ? (
                    <Spinner />
                  ) : (
                    <IconDownload width={13} height={13} />
                  )}
                  {running ? s.lab.setup.downloading : s.lab.setup.download}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </NeuCard>
  )
}
