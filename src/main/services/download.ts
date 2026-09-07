import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Fetching a large file to disk, with progress and a working cancel.
 *
 * Shared by the lab runtime and the FFmpeg installer. It exists as its own
 * module because both are multi-hundred-megabyte downloads that a user with no
 * terminal has to be able to watch and abort — and because getting the
 * "download to a temp name, rename on success" part wrong leaves a truncated
 * file that looks installed.
 */

export interface DownloadProgress {
  bytes: number
  /** Total from Content-Length, or null when the server does not say. */
  total: number | null
  /** Bytes per second over the whole transfer so far. */
  bytesPerSecond: number
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
}

/**
 * Download `url` to `dest`.
 *
 * The bytes land in `<dest>.part` and are renamed only after the stream closes,
 * so an aborted or failed transfer can never be mistaken for a complete file by
 * the next launch. Cancelling deletes the partial file rather than leaving it
 * to be resumed: none of these servers are guaranteed to honour Range, and a
 * silently corrupt torch wheel is a far worse failure than downloading again.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  options: DownloadOptions = {}
): Promise<number> {
  const { onProgress, signal } = options
  await mkdir(dirname(dest), { recursive: true })
  const partial = `${dest}.part`
  await rm(partial, { force: true })

  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`falha ao baixar (HTTP ${res.status}): ${url}`)
  }

  const header = res.headers.get('content-length')
  const total = header ? Number.parseInt(header, 10) : null
  const started = Date.now()
  let bytes = 0
  let lastReport = 0

  const source = Readable.fromWeb(res.body as never)
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    // Reporting every chunk would flood the IPC bridge with tens of thousands
    // of messages for one wheel; four times a second is smooth to a human.
    const now = Date.now()
    if (onProgress && now - lastReport >= 250) {
      lastReport = now
      const seconds = (now - started) / 1000
      onProgress({
        bytes,
        total: Number.isFinite(total) ? total : null,
        bytesPerSecond: seconds > 0 ? bytes / seconds : 0
      })
    }
  })

  try {
    await pipeline(source, createWriteStream(partial), { signal })
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }

  await rm(dest, { force: true })
  await rename(partial, dest)

  if (onProgress) {
    const seconds = (Date.now() - started) / 1000
    onProgress({
      bytes,
      total: Number.isFinite(total) ? total : bytes,
      bytesPerSecond: seconds > 0 ? bytes / seconds : 0
    })
  }
  return bytes
}

/**
 * Unpack an archive into `destDir`.
 *
 * `tar` does all of it. Windows 10 1803 and later ship bsdtar as `tar.exe`, and
 * bsdtar reads zip as happily as it reads tar.gz — which is what lets one code
 * path handle the Windows `.zip` assets and the Linux `.tar.gz` ones without a
 * zip library in the bundle. On Windows, PowerShell's Expand-Archive is the
 * fallback for the older builds that predate it.
 */
export async function extractArchive(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  try {
    await run('tar', ['-xf', archive, '-C', destDir], { windowsHide: true })
    return
  } catch (err) {
    if (process.platform !== 'win32' || !archive.toLowerCase().endsWith('.zip')) throw err
  }

  await run(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`
    ],
    { windowsHide: true }
  )
}

/** Total size of a directory tree, for the "using N GB" line in Settings. */
export async function directorySize(dir: string): Promise<number> {
  const { readdir } = await import('node:fs/promises')
  let total = 0
  const walk = async (current: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = `${current}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          /* raced with a delete — it is a size estimate, not an audit */
        }
      }
    }
  }
  await walk(dir)
  return total
}
