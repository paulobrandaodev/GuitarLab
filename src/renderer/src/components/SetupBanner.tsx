import { useEffect, useState, type ReactNode } from 'react'
import { NeuButton, cx } from './ui'
import { api } from '../lib/api'

/**
 * Tells the user about the one thing that is actually broken, and nothing else.
 *
 * There is no setup wizard on purpose. A wizard would claim its steps are
 * prerequisites, and they are not: the app is genuinely useful with zero keys —
 * import a Guitar Pro file, read the tab, run the metronome, tune up, track
 * progress. Gating that behind three screens about OAuth teaches people to click
 * Next without reading, and they still end up not knowing what FFmpeg is.
 *
 * The real first-run failure is narrower: the app opens on an empty setlist and
 * never says that audio import needs FFmpeg. `probeAudio` throws when it is
 * missing, so the first sign of trouble is a failed import with no explanation.
 * That is what this banner is for.
 *
 * One message at a time, most damaging first, and dismissible — a permanent
 * scold is just chrome people learn to ignore.
 */

const DISMISSED_KEY = 'guitarlab.setupBanner.dismissed'

interface Notice {
  id: string
  text: string
  action?: { label: string; run: () => void | Promise<void> }
}

export function SetupBanner({ onOpenSettings }: { onOpenSettings: () => void }): ReactNode {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY)
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      // Private windows and cleared site data both land here. An unreadable
      // store just means nothing was dismissed yet.
      return []
    }
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await api.status.integrations()
        if (cancelled) return

        const notices: Notice[] = []

        // FFmpeg first: it is the only hard requirement, and its absence is
        // silent until an import fails.
        if (!status.ffmpeg.available) {
          notices.push({
            id: 'ffmpeg',
            text: 'O FFmpeg não foi encontrado. Sem ele, importar áudio não funciona — é o único requisito obrigatório do app.',
            action: {
              label: 'como instalar',
              run: () => api.shell.openExternal('https://ffmpeg.org/download.html')
            }
          })
        }

        setNotice(notices.find((n) => !dismissed.includes(n.id)) ?? null)
      } catch {
        // The status call failing is its own, louder problem; the banner stays
        // out of the way rather than reporting it twice.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dismissed])

  if (!notice) return null

  const dismiss = (): void => {
    const next = [...dismissed, notice.id]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      // Not being able to remember the dismissal is survivable; the banner
      // comes back next launch.
    }
  }

  return (
    <div
      className={cx(
        'border-edge bg-raised flex flex-wrap items-center gap-3 border-t px-6 py-2.5 text-xs'
      )}
    >
      <span className="text-warn shrink-0">!</span>
      <span className="text-txt-dim min-w-0 flex-1">{notice.text}</span>
      {notice.action && (
        <NeuButton className="!px-3 !py-1 !text-[10px]" onClick={() => void notice.action?.run()}>
          {notice.action.label}
        </NeuButton>
      )}
      <NeuButton className="!px-3 !py-1 !text-[10px]" onClick={onOpenSettings}>
        ajustes
      </NeuButton>
      <NeuButton variant="ghost" className="!px-2 !py-1 !text-[10px]" onClick={dismiss}>
        dispensar
      </NeuButton>
    </div>
  )
}
