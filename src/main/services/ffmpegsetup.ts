import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config'
import { saveSettings, settingValue } from '../settings'
import { downloadToFile, extractArchive } from './download'
import type { ToolProgress } from '@shared/types'

/**
 * FFmpeg, installed by the app.
 *
 * FFmpeg is the one hard dependency GuitarLab has ever had, and "install it and
 * put it on your PATH" is where a person who does not use a terminal stops. The
 * app already supports pointing `ffmpegPath` at any binary; this just fetches
 * one and fills that setting in.
 *
 * The binaries are the standard GPL builds, downloaded by the user at their own
 * request rather than shipped inside the installer — which is the same reason
 * the NOTICE gives for not embedding FFmpeg in the first place.
 */

const SOURCES: Record<string, { url: string; binary: string }> = {
  win32: {
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    binary: 'ffmpeg.exe'
  },
  linux: {
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    binary: 'ffmpeg'
  }
}

export function ffmpegToolDir(): string {
  return join(config.userData, 'tools', 'ffmpeg')
}

/** The binary this installer put there, if it is still present. */
export function managedFfmpeg(): string | null {
  const current = settingValue('ffmpegPath')
  if (current && current.startsWith(ffmpegToolDir()) && existsSync(current)) return current
  return null
}

/** Depth-first search for the binary, since each build nests it differently. */
async function findBinary(root: string, name: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name) return full
    if (entry.isDirectory()) {
      const found = await findBinary(full, name)
      if (found) return found
    }
  }
  return null
}

/**
 * Download FFmpeg and point the app at it.
 *
 * Returns the path. Writing it through `saveSettings` rather than straight to
 * the file matters: that is what fires the effect clearing the memoised
 * `ffmpegVersion`, without which Settings would go on reporting "not found"
 * next to a binary that is right there.
 */
export async function installFfmpeg(
  onProgress: (progress: ToolProgress) => void
): Promise<string> {
  const source = SOURCES[process.platform]
  if (!source) throw new Error(`sem build de FFmpeg para ${process.platform}`)

  const dir = ffmpegToolDir()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const archive = join(dir, source.url.split('/').pop() ?? 'ffmpeg-archive')
  onProgress({ tool: 'ffmpeg', status: 'downloading', receivedBytes: 0, totalBytes: null })

  await downloadToFile(source.url, archive, {
    onProgress: (p) =>
      onProgress({
        tool: 'ffmpeg',
        status: 'downloading',
        receivedBytes: p.bytes,
        totalBytes: p.total
      })
  })

  onProgress({ tool: 'ffmpeg', status: 'extracting', receivedBytes: 0, totalBytes: null })
  await extractArchive(archive, dir)
  await rm(archive, { force: true })

  const binary = await findBinary(dir, source.binary)
  if (!binary) throw new Error('o FFmpeg foi baixado mas o executável não foi encontrado')
  if (process.platform !== 'win32') await chmod(binary, 0o755)

  const saved = saveSettings({ ffmpegPath: binary })
  if (!saved.ok) throw new Error(saved.error ?? 'não foi possível salvar o caminho do FFmpeg')

  onProgress({ tool: 'ffmpeg', status: 'done', receivedBytes: 0, totalBytes: null })
  return binary
}

/** Undo the install and let the app go back to whatever is on PATH. */
export async function removeFfmpeg(): Promise<void> {
  if (managedFfmpeg()) saveSettings({ ffmpegPath: '' })
  await rm(ffmpegToolDir(), { recursive: true, force: true })
}
