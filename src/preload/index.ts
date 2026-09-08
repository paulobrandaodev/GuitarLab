import { contextBridge, ipcRenderer } from 'electron'
import type { NewSetlistInput, NewSongInput, SettingsSnapshot } from '@shared/types'

/**
 * Every call funnels through `invoke`, which unwraps the `{ __error }` envelope
 * the main process uses so renderer code can `try/catch` normally.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result && typeof result === 'object' && '__error' in result) {
    throw new Error((result as { __error: string }).__error)
  }
  return result as T
}

const api = {
  library: {
    importAll: () => invoke('library:importAll'),
    importGuitarPro: () => invoke('library:importGuitarPro'),
    importAudio: () => invoke('library:importAudio'),
    paths: () => invoke('library:paths'),
    setPaths: (next: Record<string, string>) => invoke('library:setPaths', next)
  },
  songs: {
    list: () => invoke('songs:list'),
    get: (id: number) => invoke('songs:get', id),
    create: (input: NewSongInput) => invoke('songs:create', input),
    findDuplicate: (title: string, artist: string) =>
      invoke('songs:findDuplicate', title, artist),
    update: (id: number, patch: unknown) => invoke('songs:update', id, patch),
    remove: (id: number) => invoke('songs:delete', id),
    media: (id: number) => invoke('songs:media', id),
    tunings: () => invoke('songs:tunings')
  },
  sections: {
    list: (songId: number) => invoke('sections:list', songId),
    create: (values: unknown) => invoke('sections:create', values),
    update: (id: number, patch: unknown) => invoke('sections:update', id, patch),
    remove: (id: number) => invoke('sections:delete', id)
  },
  setlists: {
    list: () => invoke('setlists:list'),
    items: (id: number) => invoke('setlists:items', id),
    create: (name: string, band?: string | null, extra?: Omit<NewSetlistInput, 'name' | 'band'>) =>
      invoke('setlists:create', name, band, extra),
    bands: () => invoke('setlists:bands'),
    removeSong: (setlistId: number, songId: number) =>
      invoke('setlists:removeSong', setlistId, songId),
    addSong: (setlistId: number, songId: number) =>
      invoke('setlists:addSong', setlistId, songId),
    removeItem: (itemId: number) => invoke('setlists:removeItem', itemId),
    reorder: (setlistId: number, ids: number[]) => invoke('setlists:reorder', setlistId, ids),
    setActive: (id: number) => invoke('setlists:setActive', id),
    remove: (id: number) => invoke('setlists:delete', id),
    update: (id: number, patch: unknown) => invoke('setlists:update', id, patch)
  },
  progress: {
    list: (songId: number) => invoke('progress:list', songId),
    setStatus: (songId: number, instrument: string, sectionId: number | null, status: string) =>
      invoke('progress:setStatus', songId, instrument, sectionId, status),
    setTargetBpm: (songId: number, instrument: string, sectionId: number | null, bpm: number) =>
      invoke('progress:setTargetBpm', songId, instrument, sectionId, bpm),
    recordSession: (input: unknown) => invoke('progress:recordSession', input),
    dailyQueue: (budget: number) => invoke('progress:dailyQueue', budget),
    queuePins: () => invoke('progress:queuePins'),
    queued: (songId: number, sectionId: number | null) =>
      invoke('progress:queued', songId, sectionId),
    enqueue: (songId: number, sectionId: number | null) =>
      invoke('progress:enqueue', songId, sectionId),
    dequeue: (songId: number, sectionId: number | null) =>
      invoke('progress:dequeue', songId, sectionId),
    clearQueue: () => invoke('progress:clearQueue'),
    stats: () => invoke('progress:stats'),
    nextBpm: (current: number, target: number, step: number) =>
      invoke('progress:nextBpm', current, target, step)
  },
  charts: {
    list: (songId: number) => invoke('charts:list', songId),
    save: (
      songId: number,
      kind: string,
      format: string,
      content: string,
      sourceUrl?: string
    ) => invoke('charts:save', songId, kind, format, content, sourceUrl)
  },
  lyrics: {
    fetch: (songId: number) => invoke('lyrics:fetch', songId),
    parseLrc: (lrc: string) => invoke('lyrics:parseLrc', lrc)
  },
  gp: {
    parse: (path: string) => invoke('gp:parse', path),
    readFile: (path: string) => invoke<ArrayBuffer>('gp:readFile', path)
  },
  waveform: {
    read: (songId: number) => invoke('waveform:read', songId)
  },
  youtube: {
    refs: (songId: number) => invoke('youtube:refs', songId),
    search: (songId: number, roles?: string[]) => invoke('youtube:search', songId, roles),
    addManual: (songId: number, url: string, role: string, title?: string) =>
      invoke('youtube:addManual', songId, url, role, title),
    setRole: (refId: number, role: string) => invoke('youtube:setRole', refId, role),
    remove: (refId: number) => invoke('youtube:delete', refId),
    quota: () => invoke('youtube:quota'),
    playerUrl: () => invoke<string | null>('youtube:playerUrl'),
    manualUrl: (songId: number, role: string) => invoke('youtube:manualUrl', songId, role)
  },
  spotify: {
    status: () => invoke('spotify:status'),
    connect: () => invoke('spotify:connect'),
    disconnect: () => invoke('spotify:disconnect'),
    search: (q: string) => invoke('spotify:search', q),
    playback: () => invoke('spotify:playback'),
    devices: () => invoke('spotify:devices'),
    play: (uri?: string, positionMs?: number) => invoke('spotify:play', uri, positionMs),
    pause: () => invoke('spotify:pause'),
    seek: (ms: number) => invoke('spotify:seek', ms),
    syncPlaylist: (setlistId: number) => invoke('spotify:syncPlaylist', setlistId),
    playlists: () => invoke('spotify:playlists'),
    importPlaylist: (playlistId: string, setlistName: string, band: string | null) =>
      invoke('spotify:importPlaylist', playlistId, setlistName, band)
  },
  /**
   * Where the files come from: the tab sites (link + intercepted download) and
   * archive.org (search and download done by the app itself).
   */
  sources: {
    tabLinks: (songId: number) => invoke('sources:tabLinks', songId),
    openTabBrowser: (songId: number, site: 'ultimate' | 'cifraclub') =>
      invoke('sources:openTabBrowser', songId, site),
    pickTabFile: (songId: number) => invoke('sources:pickTabFile', songId),
    archiveSearch: (songId: number) => invoke('sources:archiveSearch', songId),
    archiveDownload: (songId: number, candidate: unknown) =>
      invoke('sources:archiveDownload', songId, candidate),
    /** Progress of every download, wherever it was started from. */
    onProgress: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('sources:progress', listener)
      return () => ipcRenderer.removeListener('sources:progress', listener)
    }
  },
  chords: {
    get: (songId: number) => invoke('chords:get', songId),
    detect: (songId: number) => invoke('chords:detect', songId),
    clear: (songId: number) => invoke('chords:clear', songId)
  },
  lab: {
    health: () => invoke('lab:health'),
    jobs: (songId?: number) => invoke('lab:jobs', songId),
    submit: (songId: number, type: string, params?: unknown) =>
      invoke('lab:submit', songId, type, params),
    refresh: (jobId: number) => invoke('lab:refresh', jobId),
    refreshAll: () => invoke('lab:refreshAll'),
    onJobsUpdated: (cb: (jobs: unknown[]) => void) => {
      const listener = (_e: unknown, jobs: unknown[]): void => cb(jobs)
      ipcRenderer.on('lab:jobsUpdated', listener)
      return () => ipcRenderer.removeListener('lab:jobsUpdated', listener)
    },
    setup: {
      status: () => invoke('lab:setup:status'),
      install: (pack: string) => invoke('lab:setup:install', pack),
      cancel: () => invoke('lab:setup:cancel'),
      remove: () => invoke('lab:setup:remove'),
      removeModels: () => invoke('lab:setup:removeModels'),
      start: () => invoke('lab:process:start'),
      stop: () => invoke('lab:process:stop'),
      fetchModel: (family: string, id: string) => invoke('lab:models:fetch', family, id),
      modelJob: (jobId: string) => invoke('lab:models:job', jobId),
      onProgress: (cb: (progress: unknown) => void) => {
        const listener = (_e: unknown, progress: unknown): void => cb(progress)
        ipcRenderer.on('lab:setup:progress', listener)
        return () => ipcRenderer.removeListener('lab:setup:progress', listener)
      }
    }
  },
  tools: {
    installFfmpeg: () => invoke('media:ffmpeg:install'),
    removeFfmpeg: () => invoke('media:ffmpeg:remove'),
    managedFfmpeg: () => invoke('media:ffmpeg:managed'),
    onProgress: (cb: (progress: unknown) => void) => {
      const listener = (_e: unknown, progress: unknown): void => cb(progress)
      ipcRenderer.on('media:tool:progress', listener)
      return () => ipcRenderer.removeListener('media:tool:progress', listener)
    }
  },
  update: {
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    onAvailable: (cb: (info: unknown) => void) => {
      const listener = (_e: unknown, info: unknown): void => cb(info)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.removeListener('update:available', listener)
    },
    onProgress: (cb: (info: unknown) => void) => {
      const listener = (_e: unknown, info: unknown): void => cb(info)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    },
    onReady: (cb: (info: unknown) => void) => {
      const listener = (_e: unknown, info: unknown): void => cb(info)
      ipcRenderer.on('update:ready', listener)
      return () => ipcRenderer.removeListener('update:ready', listener)
    }
  },
  gear: {
    rig: () => invoke('gear:rig'),
    setRig: (rig: unknown) => invoke('gear:setRig', rig),
    patch: (songId: number) => invoke('gear:patch', songId)
  },
  /** The AI answers already stored for a song, read without asking the model. */
  insights: {
    get: (songId: number, kind: string, sectionId?: number | null) =>
      invoke('insights:get', songId, kind, sectionId ?? null)
  },
  llm: {
    status: () => invoke('llm:status'),
    /**
     * Live progress for every LLM call: which provider is being tried, the
     * model's reasoning as it streams, quota waits and failures.
     */
    onProgress: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('llm:progress', listener)
      return () => ipcRenderer.removeListener('llm:progress', listener)
    },
    practicePlan: (budgetMinutes: number) => invoke('llm:practiceePlan', budgetMinutes),
    techniqueBreakdown: (songId: number, sectionId: number | null) =>
      invoke('llm:techniqueBreakdown', songId, sectionId),
    toneAdvice: (songId: number) => invoke('llm:toneAdvice', songId),
    sections: (songId: number) => invoke('llm:sections', songId),
    tonePatch: (songId: number) => invoke('llm:tonePatch', songId),
    classifyVideos: (videos: unknown[]) => invoke('llm:classifyVideos', videos),
    toChordPro: (songId: number, rawText: string) => invoke('llm:toChordPro', songId, rawText)
  },
  settings: {
    get: () => invoke<SettingsSnapshot>('settings:get'),
    set: (patch: Record<string, string>) =>
      invoke<{ ok: boolean; changed?: string[]; error?: string }>('settings:set', patch),
    testProvider: (name: string) =>
      invoke<{ ok: boolean; detail: string }>('settings:testProvider', name)
  },
  status: {
    integrations: () => invoke('status:integrations')
  },
  shell: {
    openExternal: (url: string) => invoke('shell:openExternal', url),
    showItem: (path: string) => invoke('shell:showItem', path),
    pickFolder: () => invoke<string | null>('shell:pickFolder')
  },
  /**
   * Turn an absolute local path into a URL the renderer is allowed to load.
   *
   * The `local/` host is load-bearing on Windows. `media` is a *standard*
   * scheme, so Chromium parses the first component after `//` as the authority:
   * `media:///F:/song.flac` gets normalised to `media://f/song.flac`, silently
   * eating the drive letter and leaving the handler a relative path that
   * resolves nowhere — which is why local audio never played. A literal host
   * keeps the whole path inside `pathname`.
   *
   * Segments are encoded one by one so `#`, `?` and the drive's `:` survive
   * while the separators stay real slashes.
   */
  mediaUrl: (path: string) =>
    `media://local/${path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
