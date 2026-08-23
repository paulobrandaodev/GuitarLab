import { BrowserWindow, session, type DownloadItem, type Session } from 'electron'
import { extname, basename } from 'node:path'
import { config } from '../config'
import { attachGuitarProFile, attachAudioFile } from '../importers/library'
import { uniquePath } from './sources'
import type { DownloadProgress } from '@shared/types'

/**
 * The "baixar tablatura" flow.
 *
 * Ultimate Guitar and CifraClub have no API and their terms forbid scraping, so
 * the app cannot fetch a tab on its own — but it can make the manual path
 * painless. This opens the site in a window whose downloads are intercepted:
 * whatever the user clicks lands straight in gptabs/ (or songs/ for audio) and
 * is imported onto the song they came from, instead of ending up in Downloads
 * to be moved by hand.
 *
 * The window keeps its own persistent partition, so a Pro login survives
 * between sessions without touching the app's own session.
 */

const GP_EXT = new Set(['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.gp7', '.ptb'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'])
const PARTITION = 'persist:tabsites'

export type DownloadListener = (event: DownloadProgress) => void

/** Which song the next download from this session belongs to. */
let pendingSongId: number | null = null
let listener: DownloadListener | null = null
let wired = false

function destinationFor(fileName: string): { dir: string; kind: 'guitarpro' | 'audio' } | null {
  const ext = extname(fileName).toLowerCase()
  if (GP_EXT.has(ext)) return { dir: config.paths.gptabs, kind: 'guitarpro' }
  if (AUDIO_EXT.has(ext)) return { dir: config.paths.songs, kind: 'audio' }
  return null
}

function emit(event: DownloadProgress): void {
  listener?.(event)
}

async function importDownloaded(
  songId: number,
  kind: 'guitarpro' | 'audio',
  path: string
): Promise<void> {
  const fileName = basename(path)
  emit({ songId, kind, fileName, receivedBytes: 0, totalBytes: null, status: 'importing' })
  try {
    const report =
      kind === 'guitarpro'
        ? await attachGuitarProFile(songId, path)
        : await attachAudioFile(songId, path)
    const failed = report.errors[0]
    emit({
      songId,
      kind,
      fileName,
      receivedBytes: 0,
      totalBytes: null,
      status: failed ? 'error' : 'done',
      message: failed ? failed.message : (report.details[0]?.note ?? 'importado')
    })
  } catch (err) {
    emit({
      songId,
      kind,
      fileName,
      receivedBytes: 0,
      totalBytes: null,
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

function wire(target: Session): void {
  if (wired) return
  wired = true

  target.on('will-download', (_event, item: DownloadItem) => {
    const songId = pendingSongId
    const fileName = item.getFilename()
    const dest = destinationFor(fileName)

    if (!dest || songId === null) {
      // not a file this app knows what to do with: let the user save it wherever
      return
    }

    const savePath = uniquePath(dest.dir, fileName)
    item.setSavePath(savePath)

    item.on('updated', (_e, state) => {
      if (state !== 'progressing') return
      emit({
        songId,
        kind: dest.kind,
        fileName,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes() || null,
        status: 'downloading'
      })
    })

    item.once('done', (_e, state) => {
      if (state !== 'completed') {
        emit({
          songId,
          kind: dest.kind,
          fileName,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes() || null,
          status: 'error',
          message: state === 'cancelled' ? 'download cancelado' : 'download interrompido'
        })
        return
      }
      void importDownloaded(songId, dest.kind, savePath)
    })
  })
}

export function setDownloadListener(fn: DownloadListener | null): void {
  listener = fn
}

/**
 * Open a tab site with downloads pointed at the project folders.
 *
 * Only one such window is kept around: opening another site reuses it, so the
 * user does not end up with a pile of browser windows behind the app.
 */
let browserWindow: BrowserWindow | null = null

export function openTabBrowser(url: string, songId: number, parent: BrowserWindow | null): void {
  pendingSongId = songId
  const target = session.fromPartition(PARTITION)
  wire(target)

  if (browserWindow && !browserWindow.isDestroyed()) {
    void browserWindow.loadURL(url)
    browserWindow.focus()
    return
  }

  browserWindow = new BrowserWindow({
    width: 1180,
    height: 880,
    parent: parent ?? undefined,
    backgroundColor: '#1c1c22',
    autoHideMenuBar: true,
    title: 'Baixar tablatura',
    webPreferences: {
      session: target,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  browserWindow.on('closed', () => {
    browserWindow = null
  })

  // tab sites open the download in a new tab; keep it in the same window
  browserWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (browserWindow && !browserWindow.isDestroyed()) void browserWindow.loadURL(nextUrl)
    return { action: 'deny' }
  })

  void browserWindow.loadURL(url)
}
