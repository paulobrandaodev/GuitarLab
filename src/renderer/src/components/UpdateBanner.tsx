import { useEffect, useState, type ReactNode } from 'react'
import { useStrings } from '../lib/i18n'
import { NeuButton, cx } from './ui'
import { api } from '../lib/api'

/**
 * The one place the app mentions a new version.
 *
 * Nothing here happens on its own. The check runs in the background, but the
 * download waits for a click and the restart waits for a second one, because
 * the app is routinely twenty minutes into separating a track and quitting
 * under someone to apply a patch is worse than the patch is good.
 *
 * Dismissible, and it stays dismissed for that version only: a banner people
 * learn to ignore is worth less than no banner.
 */

const DISMISSED_KEY = 'guitarlab.update.dismissed'

type Phase = 'available' | 'downloading' | 'ready'

export function UpdateBanner(): ReactNode {
  const s = useStrings()
  const [version, setVersion] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('available')
  const [percent, setPercent] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    /*
     * The bridge can arrive without this namespace: the test harnesses expose a
     * partial `window.api` on purpose, and so would a preload that failed
     * halfway. Subscribing blind took the whole mount down with it — App.tsx
     * already guards its boot calls for the same reason.
     */
    if (!(api as Partial<typeof api>).update) return
    const offAvailable = api.update.onAvailable((info) => {
      setVersion(info.version)
      setPhase('available')
    })
    const offProgress = api.update.onProgress((info) => {
      setPhase('downloading')
      setPercent(info.percent)
    })
    const offReady = api.update.onReady((info) => {
      setVersion(info.version)
      setPhase('ready')
    })
    return () => {
      offAvailable()
      offProgress()
      offReady()
    }
  }, [])

  if (!version || dismissed === version) return null

  const dismiss = (): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, version)
    } catch {
      // Not remembering only costs one more banner next launch.
    }
    setDismissed(version)
  }

  return (
    <div className="px-6 pb-2">
      <div className="neu-inset-sm flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <span className="flex-1 text-xs">
          {phase === 'ready' ? s.update.ready(version) : s.update.available(version)}
        </span>

        {phase === 'downloading' && (
          <span className="text-txt-micro text-[11px]">
            {s.update.downloading} {Math.round(percent)}%
          </span>
        )}

        {phase === 'available' && (
          <NeuButton
            variant="accent"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              setPhase('downloading')
              void api.update.download()
            }}
          >
            {s.update.download}
          </NeuButton>
        )}

        {phase === 'ready' && (
          <NeuButton
            variant="accent"
            className="px-3 py-1.5 text-xs"
            onClick={() => void api.update.install()}
          >
            {s.update.restart}
          </NeuButton>
        )}

        <button
          onClick={dismiss}
          className={cx('text-txt-micro hover:text-txt text-[11px]')}
        >
          {s.update.later}
        </button>
      </div>
    </div>
  )
}
