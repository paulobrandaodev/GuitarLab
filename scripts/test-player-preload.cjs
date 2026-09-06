/**
 * The `window.api` the player test runs against.
 *
 * The point of the test is the renderer, not the database, so this stands in for
 * the real bridge: the same shape, answering from a payload the test process
 * built (real file paths, a real chord track, a real LRC) and handed over in a
 * file — it is far too big for a command-line argument. Anything the flow does not touch answers empty rather than throwing,
 * so one unrelated screen mounting in the background cannot fail the run.
 */
const { contextBridge } = require('electron')

const arg = process.argv.find((a) => a.startsWith('--stub-file='))
const stub = arg ? JSON.parse(require('node:fs').readFileSync(arg.slice('--stub-file='.length), 'utf8')) : {}

const none = async () => null
const empty = async () => []
const unsubscribe = () => () => {}

/** Same parser as `lrclib.parseLrc`; the cifra button goes through it. */
function parseLrc(lrc) {
  const lines = []
  for (const raw of String(lrc).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number.parseInt(m[3].padEnd(3, '0'), 10) : 0
      lines.push({
        timeMs: Number.parseInt(m[1], 10) * 60000 + Number.parseInt(m[2], 10) * 1000 + frac,
        text
      })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: async () => ({
      settings: [],
      encryption: { available: true, hint: '' },
      locale: 'pt-BR'
    }),
    set: async () => ({ ok: true, changed: [] }),
    testProvider: async () => ({ ok: false, detail: 'stub' })
  },
  library: {
    importAll: none,
    importGuitarPro: none,
    importAudio: none,
    paths: none,
    setPaths: none
  },
  songs: {
    list: async () => stub.songs ?? [],
    get: async () => stub.song ?? null,
    update: none,
    remove: none,
    media: async () => stub.media ?? [],
    tunings: empty
  },
  sections: { list: empty, create: none, update: none, remove: none },
  setlists: {
    list: async () => stub.setlists ?? [],
    items: async () => stub.items ?? [],
    create: none,
    bands: empty,
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
  charts: {
    list: async () => stub.charts ?? [],
    save: async (songId, kind, format, content) => {
      stub.charts = [
        ...(stub.charts ?? []).filter((c) => c.kind !== kind),
        { id: 99, kind, format, content, sourceUrl: null }
      ]
      return 99
    }
  },
  lyrics: { fetch: none, parseLrc: async (lrc) => parseLrc(lrc) },
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
    // no local player origin under test: the video tab falls back to the browser
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
  chords: { get: async () => stub.chordMap ?? null, detect: none, clear: none },
  lab: {
    health: async () => ({ reachable: false, gpu: null, cuda: false, models: [], detail: '' }),
    jobs: empty,
    submit: none,
    refresh: none,
    refreshAll: empty,
    onJobsUpdated: unsubscribe
  },
  gear: { rig: none, setRig: none, patch: none },
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
  mediaUrl: (path) =>
    `media://local/${String(path)
      .replace(/\\/g, '/')
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
})
