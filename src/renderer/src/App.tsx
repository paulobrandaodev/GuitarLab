import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { IconButton, Toast, useToast, cx } from './components/ui'
import { AiActivityBar } from './components/AiActivityBar'
import { SetupBanner } from './components/SetupBanner'
import { connectAiActivity } from './lib/aiActivity'
import { useLocaleStore } from './lib/i18n'
import {
  IconSetlist,
  IconPractice,
  IconLab,
  IconProgress,
  IconSettings,
  IconTuner,
  IconStage,
  IconArrowLeft,
  IconGrid
} from './components/ui/icons'
import { SetlistScreen } from './features/setlist/SetlistScreen'
import { SongScreen } from './features/song/SongScreen'
import { PracticeScreen } from './features/practice/PracticeScreen'
import { LabScreen } from './features/lab/LabScreen'
import { ProgressScreen } from './features/progress/ProgressScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { TunerScreen } from './features/tuner/TunerScreen'
import { StageScreen } from './features/stage/StageScreen'

/**
 * The rooms of one song. Everything about a song is reached through its own
 * menu now, so a route only has to say which room to open in.
 */
export type SongTab =
  | 'visao'
  | 'estudar'
  | 'stems'
  | 'video'
  | 'cifra'
  | 'timbre'
  | 'afinador'
  | 'lab'
  | 'dados'

export type Route =
  | { name: 'setlist' }
  | { name: 'song'; songId: number; tab?: SongTab; sectionId?: number | null }
  /*
   * `practice` and `lab` are kept as routes because the bottom bar opens them
   * without a song, where each shows its own picker. With a song they are rooms
   * of the song hub, so they land there instead of on a screen of their own.
   */
  | { name: 'practice'; songId?: number; sectionId?: number | null }
  | { name: 'lab'; songId?: number }
  | { name: 'progress' }
  | { name: 'settings' }
  | { name: 'tuner'; songId?: number }
  | { name: 'stage'; setlistId?: number }

interface NavState {
  route: Route
  history: Route[]
  go: (route: Route) => void
  back: () => void
}

export const useNav = create<NavState>((set, get) => ({
  route: { name: 'setlist' },
  history: [],
  go: (route) => set({ route, history: [...get().history, get().route] }),
  back: () => {
    const h = [...get().history]
    const prev = h.pop()
    if (prev) set({ route: prev, history: h })
  }
}))

const NAV_ITEMS: Array<{ name: Route['name']; icon: typeof IconSetlist; title: string }> = [
  { name: 'setlist', icon: IconSetlist, title: 'Setlist' },
  { name: 'practice', icon: IconPractice, title: 'Estudar' },
  { name: 'lab', icon: IconLab, title: 'Laboratório' },
  { name: 'progress', icon: IconProgress, title: 'Progresso' }
]

function TitleBar({ onBack, canBack }: { onBack: () => void; canBack: boolean }): ReactNode {
  const go = useNav((s) => s.go)
  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between px-4">
      <div className="no-drag flex items-center gap-2">
        {canBack && (
          <IconButton size={32} title="Voltar" onClick={onBack}>
            <IconArrowLeft width={16} height={16} />
          </IconButton>
        )}
        <img
          src="/favicon.png"
          alt=""
          width={18}
          height={18}
          className="ml-1 select-none"
          draggable={false}
        />
        <span className="micro-label">GuitarLab</span>
      </div>
      <div className="no-drag flex items-center gap-2">
        <IconButton size={32} title="Afinador" onClick={() => go({ name: 'tuner' })}>
          <IconTuner width={16} height={16} />
        </IconButton>
        <IconButton size={32} title="Modo Palco" onClick={() => go({ name: 'stage' })}>
          <IconStage width={16} height={16} />
        </IconButton>
        <IconButton size={32} title="Ajustes" onClick={() => go({ name: 'settings' })}>
          <IconGrid width={16} height={16} />
        </IconButton>
      </div>
    </header>
  )
}

function BottomNav(): ReactNode {
  const { route, go } = useNav()
  return (
    <nav className="flex shrink-0 items-center justify-center gap-3 py-3">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = route.name === item.name
        return (
          <IconButton
            key={item.name}
            active={active}
            title={item.title}
            size={52}
            // practice and lab show their own picker when no song is set
            onClick={() => go({ name: item.name } as Route)}
          >
            <Icon width={22} height={22} />
          </IconButton>
        )
      })}
      <IconButton
        active={route.name === 'settings'}
        title="Ajustes"
        size={52}
        onClick={() => go({ name: 'settings' })}
      >
        <IconSettings width={22} height={22} />
      </IconButton>
    </nav>
  )
}

function Screen({ route }: { route: Route }): ReactNode {
  switch (route.name) {
    case 'setlist':
      return <SetlistScreen />
    case 'song':
      return (
        <SongScreen
          songId={route.songId}
          tab={route.tab}
          sectionId={route.sectionId ?? null}
        />
      )
    case 'practice':
      return route.songId ? (
        <SongScreen songId={route.songId} tab="estudar" sectionId={route.sectionId ?? null} />
      ) : (
        <PracticeScreen />
      )
    case 'lab':
      return route.songId ? (
        <SongScreen songId={route.songId} tab="lab" />
      ) : (
        <LabScreen />
      )
    case 'progress':
      return <ProgressScreen />
    case 'settings':
      return <SettingsScreen />
    case 'tuner':
      return <TunerScreen songId={route.songId} />
    case 'stage':
      return <StageScreen setlistId={route.setlistId} />
    default:
      return null
  }
}

export default function App(): ReactNode {
  const { route, back, history, go } = useNav()
  const { toast, clear } = useToast()
  const [booted, setBooted] = useState(false)
  const setLocale = useLocaleStore((st) => st.setLocale)

  useEffect(() => {
    /*
     * Touch the DB once up front so a broken install surfaces immediately, and
     * pick up the language while we are here. The locale store already holds a
     * synchronous guess from localStorage, so nothing renders untranslated
     * while this is in flight; this is the authoritative answer arriving.
     */
    /*
     * Called through a lambda rather than passed directly, so a bridge that is
     * missing a channel rejects the promise instead of throwing synchronously
     * and taking the whole mount down with it. The test harness supplies a
     * partial bridge, and so would a preload that failed halfway.
     */
    void Promise.allSettled([
      (async () => window.api.songs.list())(),
      (async () => window.api.settings.get())()
    ])
      .then(([songs, settings]) => {
        if (songs.status === 'rejected') console.error('Could not read the database:', songs.reason)
        if (settings.status === 'fulfilled') setLocale(settings.value.locale)
      })
      .finally(() => setBooted(true))
  }, [setLocale])

  // one subscription for the whole app: every AI call reports through it
  useEffect(() => connectAiActivity(), [])

  // Stage mode takes over the whole window — no chrome, no nav.
  if (route.name === 'stage') {
    return <StageScreen setlistId={route.setlistId} />
  }

  return (
    <div className="bg-canvas flex h-full flex-col">
      <TitleBar onBack={back} canBack={history.length > 0} />
      <main className={cx('min-h-0 flex-1', !booted && 'opacity-0')}>
        <Screen route={route} />
      </main>
      <AiActivityBar />
      <SetupBanner onOpenSettings={() => go({ name: 'settings' })} />
      <BottomNav />
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
