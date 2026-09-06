/**
 * Checks that every stem the database points at can reach — and play in — the
 * renderer, through both paths the app uses.
 *
 * Run with: npm run test:media
 *
 * Paths come from the real database, not from a disk walk, because the bug that
 * silenced the stems lived in what was *stored* (`/data/stems/...`, the Docker
 * container's own view) rather than in the files. Two transports are exercised:
 * <audio src> for simple playback and fetch + decodeAudioData for the
 * multitrack player, which fail independently — fetch needs CORS on the scheme,
 * <audio> does not.
 */
import { app, protocol, net, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import Database from 'better-sqlite3'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      // must mirror src/main/index.ts, or fetch() fails here but not in the app
      corsEnabled: true
    }
  }
])

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * Trailing dots and spaces in a Windows path component — Chromium normalises
 * them away and then cannot open the file, so those are read straight from
 * disk. Mirrors `needsManualRead` / `readFromDisk` in src/main/index.ts.
 */
function needsManualRead(path) {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => /[. ]$/.test(segment))
}

const AUDIO_TYPES = {
  flac: 'audio/flac',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg'
}

function readFromDisk(path, request) {
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
      start = Math.max(0, size - Number(to))
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    status = 206
  }

  const headers = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  return new Response(Readable.toWeb(createReadStream(path, { start, end })), { status, headers })
}

/** Same construction as `mediaUrl` in src/preload/index.ts. */
function mediaUrl(path) {
  return `media://local/${path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`
}

app.whenReady().then(async () => {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!existsSync(decoded)) {
      console.log(`    [handler] NAO ENCONTRADO: ${decoded}`)
      return new Response('nao encontrado', { status: 404 })
    }
    if (needsManualRead(decoded)) return readFromDisk(decoded, request)
    return net.fetch(pathToFileURL(decoded).toString())
  })

  const appData = app.getPath('appData')
  // the app was called setlist-lab before the rename; an install that has not
  // been opened since still keeps its library under the old name
  const dbPath = [
    join(appData, 'guitarlab', 'guitarlab.db'),
    join(appData, 'setlist-lab', 'setlist-lab.db')
  ].find((candidate) => existsSync(candidate))
  if (!dbPath) {
    console.log(`FALHA: banco nao encontrado em ${join(appData, 'guitarlab', 'guitarlab.db')}`)
    app.exit(1)
    return
  }
  console.log(`banco: ${dbPath}`)
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .prepare(
      "SELECT song_id AS songId, kind, path FROM media_assets " +
        "WHERE kind LIKE 'stem_%' OR kind = 'audio_master' ORDER BY song_id, kind"
    )
    .all()
  db.close()

  console.log(`faixas registradas no banco: ${rows.length}`)
  check('ha faixas para tocar', rows.length > 0)
  if (!rows.length) {
    app.exit(1)
    return
  }

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const decoded = []
  for (const row of rows) {
    const url = mediaUrl(row.path)
    const name = `${row.kind} (${row.path.split(/[\\/]/).pop()})`

    check(`${row.kind}: caminho existe no disco`, existsSync(row.path), row.path)

    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const out = {}

        // path 1: <audio src>, used by simple players
        out.audio = await new Promise((resolve) => {
          const el = new Audio()
          el.muted = true
          const timer = setTimeout(() => resolve('TIMEOUT'), 15000)
          el.addEventListener('canplay', () => {
            clearTimeout(timer)
            resolve('canplay dur=' + el.duration.toFixed(1) + 's')
          })
          el.addEventListener('error', () => {
            clearTimeout(timer)
            const codes = {1:'ABORTED',2:'NETWORK',3:'DECODE',4:'SRC_NOT_SUPPORTED'}
            resolve('ERRO ' + (codes[el.error?.code] ?? el.error?.code))
          })
          el.src = ${JSON.stringify(url)}
          el.load()
        })

        // path 2: fetch + decodeAudioData, used by the multitrack player
        try {
          const res = await fetch(${JSON.stringify(url)})
          out.status = res.status
          out.contentType = res.headers.get('content-type')
          const bytes = await res.arrayBuffer()
          out.bytes = bytes.byteLength
          const ctx = new AudioContext()
          const buf = await ctx.decodeAudioData(bytes)
          out.decoded = { duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels }
          await ctx.close()
        } catch (e) {
          out.fetchError = String(e && e.message ? e.message : e)
        }
        return out
      })()
    `)

    const audioOk = typeof result.audio === 'string' && result.audio.startsWith('canplay')
    check(`${name}: toca via <audio>`, audioOk, result.audio)
    check(
      `${name}: fetch + decodeAudioData`,
      Boolean(result.decoded),
      result.decoded
        ? `${result.decoded.duration.toFixed(1)}s ${result.decoded.rate}Hz ${result.decoded.channels}ch, ${(result.bytes / 1048576).toFixed(1)}MB`
        : (result.fetchError ?? `HTTP ${result.status}`)
    )
    if (result.decoded) decoded.push({ songId: row.songId, kind: row.kind, ...result.decoded })
  }

  /*
   * The multitrack player lines every track up on one clock, so the stems have
   * to agree on length and sample rate or they drift apart as they play.
   *
   * Per song: two different songs have no reason to be the same length, and
   * comparing them pooled together reported a fake desync the moment a second
   * song got separated.
   */
  const bySong = new Map()
  for (const track of decoded.filter((d) => d.kind.startsWith('stem_'))) {
    if (!bySong.has(track.songId)) bySong.set(track.songId, [])
    bySong.get(track.songId).push(track)
  }
  for (const [songId, stems] of bySong) {
    if (stems.length < 2) continue
    const spread =
      Math.max(...stems.map((s) => s.duration)) - Math.min(...stems.map((s) => s.duration))
    check(
      `musica ${songId}: stems tem a mesma duracao (sincronia)`,
      spread < 0.05,
      `${stems.length} stems, diferenca de ${spread.toFixed(3)}s`
    )
    const rates = new Set(stems.map((s) => s.rate))
    check(
      `musica ${songId}: stems tem a mesma taxa de amostragem`,
      rates.size === 1,
      [...rates].join(', ')
    )
  }

  console.log(`\n${failures === 0 ? 'TODAS AS FAIXAS TOCAM' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
})
