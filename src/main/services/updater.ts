import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { settingValue } from '../settings'

/**
 * Update checking.
 *
 * The publish target and `latest.yml` were already in place — electron-builder
 * produces the manifest as a side effect of the NSIS target — so this is only
 * the client half.
 *
 * Two rules shape all of it. Nothing installs without the user saying so: the
 * app can be twenty minutes into a stem separation, and quitting under someone
 * to apply a patch is worse than the patch is good. And a failure here is never
 * surfaced as an error — an unreachable GitHub means "no update today", not a
 * dialog on top of what the person was doing.
 */

const { autoUpdater } = electronUpdater

let wired = false

export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  autoUpdater.on('update-available', (info) => {
    send('update:available', { version: info.version, notes: info.releaseNotes ?? null })
  })
  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: p.percent, bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send('update:ready', { version: info.version })
  })
  autoUpdater.on('error', (err) => {
    // Logged, never shown. See the note above.
    console.error('[update]', err instanceof Error ? err.message : String(err))
  })

  if (settingValue('autoUpdate') === 'false') return

  // Six hours rather than on every launch: the app is one people leave open
  // through a rehearsal, and there is nothing here worth a request per hour.
  void checkForUpdate()
  setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000)
}

/**
 * Ask GitHub whether there is something newer.
 *
 * A dev run has no `latest.yml` to compare against and would only ever log a
 * confusing error, so it does not run there.
 */
export async function checkForUpdate(): Promise<{ version: string } | null> {
  if (!app.isPackaged) return null
  try {
    const result = await autoUpdater.checkForUpdates()
    return result?.updateInfo ? { version: result.updateInfo.version } : null
  } catch {
    return null
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/** Quit and install. Only ever called from an explicit click. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
