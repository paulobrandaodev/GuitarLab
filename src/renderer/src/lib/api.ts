import type {
  ArchiveCandidate,
  ChordMapView,
  DownloadProgress,
  TabSourceLinks,
  SongView,
  SectionView,
  SetlistView,
  SetlistItemView,
  ProgressView,
  MediaAssetView,
  YoutubeRefView,
  AnalysisJobView,
  DailyQueueItem,
  QueuePinView,
  ImportReport,
  IntegrationStatus,
  TuningView,
  Instrument,
  ProgressStatus,
  YoutubeRole,
  RigView,
  TonePlanView,
  LlmProgressEvent,
  SpotifyPlaylistView,
  PlaylistImportView,
  SettingsSnapshot,
  NewSongInput,
  NewSetlistInput
} from '@shared/types'

/** Mirrors the shape exposed by the preload bridge. */
export interface Api {
  library: {
    importAll: () => Promise<{ guitarPro: ImportReport; audio: ImportReport }>
    importGuitarPro: () => Promise<ImportReport>
    importAudio: () => Promise<ImportReport>
    paths: () => Promise<{ gptabs: string; songs: string; stems: string; db: string }>
    /** Remembers the folders and restarts the app — they are read at startup. */
    setPaths: (
      next: Partial<Record<'gptabs' | 'songs' | 'stems', string>>
    ) => Promise<{ ok: boolean }>
  }
  songs: {
    list: () => Promise<SongView[]>
    get: (id: number) => Promise<SongView | null>
    /** A song typed in by hand — only the title and the artist are required. */
    create: (input: NewSongInput) => Promise<SongView>
    /** The library song this title and artist would duplicate, if there is one. */
    findDuplicate: (
      title: string,
      artist: string
    ) => Promise<{ id: number; title: string; artist: string | null } | null>
    update: (id: number, patch: Record<string, unknown>) => Promise<SongView | null>
    remove: (id: number) => Promise<void>
    media: (id: number) => Promise<MediaAssetView[]>
    tunings: () => Promise<TuningView[]>
  }
  sections: {
    list: (songId: number) => Promise<SectionView[]>
    create: (values: Record<string, unknown>) => Promise<SectionView>
    update: (id: number, patch: Record<string, unknown>) => Promise<void>
    remove: (id: number) => Promise<void>
  }
  setlists: {
    list: () => Promise<SetlistView[]>
    items: (id: number) => Promise<SetlistItemView[]>
    create: (
      name: string,
      band?: string | null,
      extra?: Omit<NewSetlistInput, 'name' | 'band'>
    ) => Promise<SetlistView>
    bands: () => Promise<string[]>
    removeSong: (setlistId: number, songId: number) => Promise<void>
    addSong: (setlistId: number, songId: number) => Promise<void>
    removeItem: (itemId: number) => Promise<void>
    reorder: (setlistId: number, ids: number[]) => Promise<void>
    setActive: (id: number) => Promise<void>
    remove: (id: number) => Promise<void>
    update: (id: number, patch: Record<string, unknown>) => Promise<void>
  }
  progress: {
    list: (songId: number) => Promise<ProgressView[]>
    setStatus: (
      songId: number,
      instrument: Instrument,
      sectionId: number | null,
      status: ProgressStatus
    ) => Promise<void>
    setTargetBpm: (
      songId: number,
      instrument: Instrument,
      sectionId: number | null,
      bpm: number
    ) => Promise<void>
    recordSession: (input: Record<string, unknown>) => Promise<void>
    dailyQueue: (budget: number) => Promise<DailyQueueItem[]>
    /** Items the user pinned by hand, in the order they will be practised. */
    queuePins: () => Promise<QueuePinView[]>
    queued: (songId: number, sectionId: number | null) => Promise<boolean>
    enqueue: (songId: number, sectionId: number | null) => Promise<void>
    dequeue: (songId: number, sectionId: number | null) => Promise<void>
    clearQueue: () => Promise<void>
    stats: () => Promise<{
      totals: Record<string, number>
      heatmap: Array<{ day: string; seconds: number; sessions: number }>
      bpmProgress: Array<{ song: string; instrument: string; day: string; bpm: number }>
    }>
    nextBpm: (current: number, target: number, step: number) => Promise<number>
  }
  charts: {
    list: (songId: number) => Promise<
      Array<{ id: number; kind: string; format: string; content: string; sourceUrl: string | null }>
    >
    save: (
      songId: number,
      kind: string,
      format: string,
      content: string,
      sourceUrl?: string
    ) => Promise<number>
  }
  lyrics: {
    fetch: (
      songId: number
    ) => Promise<{ format: string; synced: boolean; content: string } | { error: string }>
    parseLrc: (lrc: string) => Promise<Array<{ timeMs: number; text: string }>>
  }
  gp: {
    parse: (path: string) => Promise<Record<string, unknown>>
    readFile: (path: string) => Promise<ArrayBuffer>
  }
  waveform: {
    read: (songId: number) => Promise<{ songId: number; peaks: number[] } | null>
  }
  youtube: {
    refs: (songId: number) => Promise<YoutubeRefView[]>
    search: (
      songId: number,
      roles?: YoutubeRole[]
    ) => Promise<
      | { videos: Array<Record<string, unknown>>; quotaSpent: number }
      | { error: string; videos: Array<Record<string, unknown>> }
    >
    addManual: (
      songId: number,
      url: string,
      role: YoutubeRole,
      title?: string
    ) => Promise<YoutubeRefView | { error: string }>
    setRole: (refId: number, role: YoutubeRole) => Promise<void>
    remove: (refId: number) => Promise<void>
    quota: () => Promise<{
      used: number
      limit: number
      remaining: number
      searchesLeft: number
    }>
    manualUrl: (songId: number, role: YoutubeRole) => Promise<string | null>
    /**
     * Local http origin that hosts the embeddable player, or null when it could
     * not be started — see `services/ytplayer` for why app:// cannot embed
     * YouTube directly.
     */
    playerUrl: () => Promise<string | null>
  }
  spotify: {
    status: () => Promise<{ configured: boolean; connected: boolean; detail: string }>
    connect: () => Promise<{ ok: boolean; error?: string }>
    disconnect: () => Promise<void>
    search: (q: string) => Promise<unknown>
    playback: () => Promise<unknown>
    devices: () => Promise<unknown>
    play: (uri?: string, positionMs?: number) => Promise<{ ok: boolean; error?: string }>
    pause: () => Promise<{ ok: boolean; error?: string }>
    seek: (ms: number) => Promise<{ ok: boolean; error?: string }>
    syncPlaylist: (setlistId: number) => Promise<unknown>
    playlists: () => Promise<SpotifyPlaylistView[] | { error: string }>
    importPlaylist: (
      playlistId: string,
      setlistName: string,
      band: string | null
    ) => Promise<PlaylistImportView | { error: string }>
  }
  sources: {
    tabLinks: (songId: number) => Promise<TabSourceLinks | { error: string }>
    openTabBrowser: (
      songId: number,
      site: 'ultimate' | 'cifraclub'
    ) => Promise<{ ok: boolean; url: string } | { error: string }>
    pickTabFile: (
      songId: number
    ) => Promise<
      { path: string; report: ImportReport } | { canceled: true } | { error: string }
    >
    archiveSearch: (
      songId: number
    ) => Promise<{ candidates: ArchiveCandidate[] } | { error: string; candidates: [] }>
    archiveDownload: (
      songId: number,
      candidate: ArchiveCandidate
    ) => Promise<{ path: string; bytes: number; report: ImportReport } | { error: string }>
    onProgress: (cb: (event: DownloadProgress) => void) => () => void
  }
  chords: {
    get: (songId: number) => Promise<ChordMapView | null>
    detect: (songId: number) => Promise<AnalysisJobView | { error: string }>
    clear: (songId: number) => Promise<void>
  }
  lab: {
    health: () => Promise<{
      reachable: boolean
      gpu: string | null
      cuda: boolean
      models: string[]
      detail: string
    }>
    jobs: (songId?: number) => Promise<AnalysisJobView[]>
    submit: (
      songId: number,
      type: string,
      params?: Record<string, unknown>
    ) => Promise<AnalysisJobView | { error: string }>
    refresh: (jobId: number) => Promise<AnalysisJobView | null>
    refreshAll: () => Promise<AnalysisJobView[]>
    onJobsUpdated: (cb: (jobs: AnalysisJobView[]) => void) => () => void
  }
  gear: {
    rig: () => Promise<RigView>
    setRig: (rig: RigView) => Promise<RigView>
    patch: (songId: number) => Promise<TonePlanView | null>
  }
  llm: {
    onProgress: (cb: (event: LlmProgressEvent) => void) => () => void
    status: () => Promise<{
      provider: string
      fallback: string
      configured: boolean
      detail: string
    }>
    practicePlan: (
      budgetMinutes: number
    ) => Promise<{ content: string; provider: string; model: string } | { error: string }>
    techniqueBreakdown: (
      songId: number,
      sectionId: number | null
    ) => Promise<{ content: string; provider: string; model: string } | { error: string }>
    toneAdvice: (
      songId: number
    ) => Promise<{ content: string; provider: string; model: string } | { error: string }>
    tonePatch: (songId: number) => Promise<TonePlanView | { error: string }>
    classifyVideos: (videos: unknown[]) => Promise<{
      assignments: Array<{ index: number; role: string; confidence: number }>
    }>
    toChordPro: (
      songId: number,
      rawText: string
    ) => Promise<{ content: string; provider: string; model: string }>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    set: (patch: Record<string, string>) => Promise<{
      ok: boolean
      changed?: string[]
      error?: string
    }>
    testProvider: (name: string) => Promise<{ ok: boolean; detail: string }>
  }
  status: {
    integrations: () => Promise<IntegrationStatus>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    showItem: (path: string) => Promise<void>
    pickFolder: () => Promise<string | null>
  }
  mediaUrl: (path: string) => string
}

declare global {
  interface Window {
    api: Api
  }
}

export const api: Api = window.api

/**
 * Narrow the `{ error }` unions the IPC layer returns.
 *
 * The test is on the *value*, not on the key. Several views carry an `error`
 * field that is null when nothing went wrong — `AnalysisJobView` is one — and a
 * key-presence check read every healthy job as a failure. That is what made
 * "Detectar acordes" look dead: the job was submitted fine, the renderer threw
 * the result away as an error, and there was no message to show for it.
 */
export function isError<T>(value: T | { error: string }): value is { error: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTotalDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

export function formatRelative(ts: number | null): string {
  if (!ts) return 'nunca'
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'ontem'
  if (days < 30) return `${days} dias atrás`
  return new Date(ts * 1000).toLocaleDateString('pt-BR')
}
