import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, normalize } from 'node:path'
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { config } from './config'
import { setSystemLocale } from './settings'
import { registerSettingsEffects } from './settings-effects'
import { pickLocale } from '@shared/i18n'
import { initDb, closeDb } from './db/client'
import { registerIpc } from './ipc'
import { refreshAllRunning } from './services/lab'
import { autoStartSidecar, stopSidecar } from './services/labsetup'
import { registerUpdater } from './services/updater'
import { startPlayerServer, stopPlayerServer } from './services/ytplayer'

let mainWindow: BrowserWindow | null = null
let jobTimer: NodeJS.Timeout | null = null

/**
 * Local audio and stems live outside the app bundle, so the renderer cannot
 * reach them with file:// under a sane CSP. A custom `media://` scheme exposes
 * exactly the directories the user configured and nothing else.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      /*
       * The multitrack player fetches each stem to decode it into an
       * AudioBuffer. Without CORS the request is rejected before it ever
       * reaches the protocol handler — <audio src> works either way, but
       * fetch() does not.
       */
      corsEnabled: true
    }
  },
  /*
   * The renderer is served over app:// rather than file://. Under file:// the
   * browser blocks Web Workers, module workers and blob: workers, which alphaTab
   * needs for both score layout and the audio synth — a 425-bar score laid out
   * on the main thread freezes the window. A custom standard scheme is a proper
   * secure origin, so workers, blobs and fetch all behave normally.
   */
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

function allowedRoot(path: string): boolean {
  const roots = [config.paths.songs, config.paths.stems, config.paths.gptabs, config.paths.waveforms]
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return roots.some((r) => normalized.startsWith(r.replace(/\\/g, '/').toLowerCase()))
}

/**
 * Windows path components that Chromium's file loader will not reach.
 *
 * A trailing dot or space is legal on NTFS — Demucs happily wrote the stems for
 * "System Of A Down - B.Y.O.B." into a folder whose name ends in a period — but
 * Chromium normalises those characters away before it opens the file, so
 * `net.fetch` answers ERR_FILE_NOT_FOUND for a file Node reads without
 * complaint. Those paths are served straight from disk instead.
 */
function needsManualRead(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => /[. ]$/.test(segment))
}

const AUDIO_TYPES: Record<string, string> = {
  flac: 'audio/flac',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg'
}

/**
 * Serve one file with byte-range support.
 *
 * `<audio>` seeks by asking for a range, so answering the whole file for every
 * request would make dragging the playhead re-download hundreds of megabytes —
 * and the element gives up on a server that ignores Range. The stem player's
 * own `fetch()` asks for everything, which is the 200 branch.
 */
function readFromDisk(path: string, request: Request): Response {
  const size = statSync(path).size
  const type = AUDIO_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')

  let start = 0
  let end = size - 1
  let status = 200
  if (range) {
    const [, from, to] = range
    if (from) {
      start = Number(from)
      if (to) end = Math.min(Number(to), end)
    } else if (to) {
      // "bytes=-500" means the last 500 bytes
      start = Math.max(0, size - Number(to))
    }
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }
    status = 206
  }

  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

  const stream = Readable.toWeb(
    createReadStream(path, { start, end })
  ) as unknown as ReadableStream<Uint8Array>
  return new Response(stream, { status, headers })
}

function registerMediaProtocol(): void {
  protocol.handle('media', (request) => {
    // media://local/F%3A/path/to/file.flac — see `mediaUrl` in the preload for
    // why the host is there and why each segment is encoded separately
    const url = new URL(request.url)
    const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!allowedRoot(decoded)) {
      return new Response('Fora das pastas permitidas', { status: 403 })
    }
    if (!existsSync(decoded)) {
      return new Response(`Arquivo não encontrado: ${decoded}`, { status: 404 })
    }
    if (needsManualRead(decoded)) return readFromDisk(decoded, request)
    return net.fetch(pathToFileURL(decoded).toString())
  })
}

/** Serves the built renderer bundle as a real origin: app://bundle/… */
function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const target = normalize(join(rendererRoot, relative))
    // never let a crafted path escape the bundle directory
    if (!target.startsWith(normalize(rendererRoot))) {
      return new Response('Fora do bundle', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

/**
 * The window icon.
 *
 * On Windows and macOS the icon a user sees comes from the executable, which
 * electron-builder stamps from resources/icon.png. This one covers the two
 * cases that does not reach: `npm run dev`, where there is no executable, and
 * Linux, where the window manager reads it from the window itself. Missing is
 * not an error — it only means the default Electron icon shows in dev.
 */
function windowIcon(): string | undefined {
  const candidate = join(config.projectRoot, 'resources', 'icon.png')
  return existsSync(candidate) ? candidate : undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    icon: windowIcon(),
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#1c1c22',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1c1c22', symbolColor: '#8b8b98', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // the tuner needs the microphone; alphaTab needs worklets
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // external links always go to the real browser, never an in-app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL('app://bundle/index.html')
  }
}

app.whenReady().then(() => {
  /*
   * Locale and settings effects are wired here, not at import time, because
   * neither can work earlier: getPreferredSystemLanguages only answers after
   * ready, and so does safeStorage, which the settings store needs to read a
   * secret. getPreferredSystemLanguages is the right question ("what does this
   * person read?") where getLocale answers a regional-formatting one, so it
   * leads and getLocale is the fallback.
   */
  setSystemLocale(pickLocale([...app.getPreferredSystemLanguages(), app.getLocale()]))
  registerSettingsEffects()

  /*
   * Songs and tabs are created too, not only the app's own folders. On an
   * installed build these default under Music/GuitarLab, and a folder that does
   * not exist yet is a folder the user cannot be told to drop files into.
   */
  for (const dir of [
    config.paths.songs,
    config.paths.gptabs,
    config.paths.stems,
    config.paths.waveforms,
    config.paths.screenshots
  ]) {
    mkdirSync(dir, { recursive: true })
  }

  initDb()
  registerMediaProtocol()
  registerAppProtocol()
  registerIpc(() => mainWindow)
  createWindow()

  // the local origin the YouTube embed needs; a failure here only costs
  // in-app video, so it must never keep the app from opening
  void startPlayerServer().catch((err) =>
    console.error('[youtube] player local não subiu:', err)
  )

  /*
   * Bring the lab up if it is installed. It is a child process now rather than
   * a container someone starts in a terminal, so nothing else would ever start
   * it — and a failure is only a lab that stays off, which the whole app is
   * already designed to survive.
   */
  void autoStartSidecar()

  registerUpdater(() => mainWindow)

  // mirror lab job progress into the local DB while the lab works
  jobTimer = setInterval(() => {
    void refreshAllRunning().then((jobs) => {
      if (jobs.length && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lab:jobsUpdated', jobs)
      }
    })
  }, 4000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (jobTimer) clearInterval(jobTimer)
  stopPlayerServer()
  // Kills the whole tree: the sidecar spawns Demucs, and a stranded python
  // holds on to several gigabytes of VRAM long after the window is gone.
  void stopSidecar()
  closeDb()
})
