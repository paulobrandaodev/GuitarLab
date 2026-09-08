/**
 * The `window.api` the by-hand creation test runs against.
 *
 * Same idea as `test-player-preload.cjs`: the bridge's shape, with nothing
 * behind it. The two channels the test is about — `songs.create` and
 * `setlists.create` — record what the dialog sent them and hand the recording
 * back through `window.__probe`, so the assertions are about the payload the
 * form built rather than about pixels.
 *
 * `songs.findDuplicate` answers with a hit for one magic title, which is how
 * the "já existe" warning gets exercised without a database.
 */
const { contextBridge } = require('electron')

/** The title that makes the stub claim the library already has this song. */
const DUPLICATE_TITLE = 'Musica Repetida'

const calls = []
const record = (channel, payload) => {
  calls.push({ channel, payload })
}

const none = async () => null
const empty = async () => []
const unsubscribe = () => () => {}

const setlist = {
  id: 7,
  name: 'Show de teste',
  band: 'Banda de teste',
  spotifyPlaylistId: null,
  eventDate: null,
  venue: null,
  notes: null,
  targetReadyDate: null,
  isActive: true,
  songCount: 0,
  totalDurationMs: 0,
  readiness: 0
}

const song = (input) => ({
  id: 42,
  title: input.title,
  artist: input.artist,
  artistId: 1,
  album: input.album ?? null,
  year: input.year ?? null,
  genre: input.genre ?? null,
  durationMs: input.durationMs ?? null,
  musicalKey: input.musicalKey ?? null,
  keySource: input.musicalKey ? 'manual' : null,
  bpm: input.bpm ?? null,
  bpmSource: input.bpm != null ? 'manual' : null,
  timeSignature: input.timeSignature ?? null,
  capo: input.capo ?? 0,
  difficulty: null,
  notes: input.notes ?? null,
  loudnessLufs: null,
  tuning: null,
  mastery: 0,
  status: 'not_started',
  hasGuitarPro: false,
  hasAudio: false,
  hasStems: false,
  lastPracticedAt: null
})

contextBridge.exposeInMainWorld('__probe', {
  calls: () => JSON.parse(JSON.stringify(calls)),
  duplicateTitle: DUPLICATE_TITLE
})

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: async () => ({ settings: [], encryption: { available: true, hint: '' }, locale: 'pt-BR' }),
    set: async () => ({ ok: true, changed: [] }),
    testProvider: async () => ({ ok: false, detail: 'stub' })
  },
  library: { importAll: none, importGuitarPro: none, importAudio: none, paths: none, setPaths: none },
  songs: {
    list: empty,
    get: none,
    create: async (input) => {
      record('songs:create', input)
      return song(input)
    },
    findDuplicate: async (title, artist) => {
      record('songs:findDuplicate', { title, artist })
      return title.trim() === DUPLICATE_TITLE
        ? { id: 1, title: DUPLICATE_TITLE, artist: 'Alguem Que Ja Existe' }
        : null
    },
    update: none,
    remove: none,
    media: empty,
    tunings: empty
  },
  sections: { list: empty, create: none, update: none, remove: none },
  setlists: {
    list: async () => [setlist],
    items: empty,
    create: async (name, band, extra) => {
      record('setlists:create', { name, band, extra })
      return { ...setlist, id: 8, name, band: band ?? null }
    },
    bands: async () => ['Banda de teste'],
    removeSong: none,
    addSong: none,
    removeItem: none,
    reorder: none,
    setActive: none,
    remove: none,
    update: none
  },
  progress: {
    list: empty,
    setStatus: none,
    setTargetBpm: none,
    recordSession: none,
    dailyQueue: empty,
    queuePins: empty,
    queued: async () => false,
    enqueue: none,
    dequeue: none,
    clearQueue: none,
    stats: async () => ({ totals: {}, heatmap: [], bpmProgress: [] }),
    nextBpm: none
  },
  charts: { list: empty, save: none },
  lyrics: { fetch: none, parseLrc: empty },
  gp: { parse: none, readFile: none },
  waveform: { read: none },
  youtube: {
    refs: empty,
    search: none,
    addManual: none,
    setRole: none,
    remove: none,
    quota: async () => ({ used: 0, limit: 10000, remaining: 10000, searchesLeft: 100 }),
    manualUrl: none,
    playerUrl: none
  },
  spotify: {
    status: async () => ({ configured: false, connected: false, detail: '' }),
    connect: none,
    disconnect: none,
    search: none,
    playback: none,
    devices: none,
    play: none,
    pause: none,
    seek: none,
    syncPlaylist: none,
    playlists: empty,
    importPlaylist: none
  },
  sources: {
    tabLinks: none,
    openTabBrowser: none,
    pickTabFile: none,
    archiveSearch: async () => ({ candidates: [] }),
    archiveDownload: none,
    onProgress: unsubscribe
  },
  chords: { get: none, detect: none, clear: none },
  lab: {
    health: async () => ({ reachable: false, gpu: null, cuda: false, models: [], detail: '' }),
    jobs: empty,
    submit: none,
    refresh: none,
    refreshAll: empty,
    onJobsUpdated: unsubscribe,
    setup: {
      status: async () => ({
        installed: false,
        stale: false,
        pack: null,
        busy: false,
        running: false,
        port: null,
        gpu: null,
        recommendedPack: 'cpu',
        runtimeDir: '',
        modelsDir: '',
        runtimeBytes: 0,
        modelBytes: 0,
        models: [],
        installedModels: []
      }),
      install: none,
      cancel: none,
      remove: none,
      removeModels: none,
      start: none,
      stop: none,
      fetchModel: none,
      modelJob: none,
      onProgress: unsubscribe
    }
  },
  tools: {
    installFfmpeg: none,
    removeFfmpeg: none,
    managedFfmpeg: async () => ({ path: null }),
    onProgress: unsubscribe
  },
  update: {
    check: none,
    download: none,
    install: none,
    onAvailable: unsubscribe,
    onProgress: unsubscribe,
    onReady: unsubscribe
  },
  gear: { rig: none, setRig: none, patch: none },
  // cached AI answers: nothing stored, which is the state a fresh song is in
  insights: { get: none },
  llm: {
    onProgress: unsubscribe,
    status: async () => ({ provider: '', fallback: '', configured: false, detail: '' }),
    practicePlan: none,
    techniqueBreakdown: none,
    toneAdvice: none,
    tonePatch: none,
    classifyVideos: async () => ({ assignments: [] }),
    toChordPro: none
  },
  status: { integrations: none },
  shell: { openExternal: none, showItem: none, pickFolder: none },
  mediaUrl: (path) => `media://local/${String(path)}`
})
