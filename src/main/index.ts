import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, normalize } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { config } from './config'
import { initDb, closeDb } from './db/client'
import { registerIpc } from './ipc'
import { refreshAllRunning } from './services/lab'

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
  for (const dir of [config.paths.stems, config.paths.waveforms, config.paths.screenshots]) {
    mkdirSync(dir, { recursive: true })
  }

  initDb()
  registerMediaProtocol()
  registerAppProtocol()
  registerIpc(() => mainWindow)
  createWindow()

  // mirror lab job progress into the local DB while the container works
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
  closeDb()
})
