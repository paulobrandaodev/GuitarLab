import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cleanTitle, normalizeTitle, normalizeArtist, similarity } from '../importers/matcher'
import type { ArchiveCandidate, TabSourceLinks } from '@shared/types'

/**
 * Where the files come from.
 *
 * Two very different contracts, and the difference drives the whole design:
 *
 *  - **Tablature.** Ultimate Guitar and CifraClub have no public API and their
 *    terms forbid scraping, so the app never reads a tab off those pages. What
 *    it does is build the exact search URL — Guitar Pro files only, rated 4–5
 *    stars — and open it. The download itself is the user clicking the site's
 *    own button; the app only decides *where the file lands* (gptabs/) and
 *    imports it from there.
 *  - **Audio.** archive.org publishes a real search and metadata API and serves
 *    its files over plain HTTP, so that side is fully automatic: search, rank,
 *    download into songs/, import.
 */

/* --------------------------------------------------------------- tablature */

/** The site's own filter code for "Guitar Pro Tab". */
const UG_GUITAR_PRO_TYPE = 500

/**
 * Ultimate Guitar, Guitar Pro tabs only, best-rated first.
 *
 * `type=500` is the Guitar Pro filter and `rating[0]=4&rating[1]=5` is the
 * site's own "High rated" toggle — both lifted from the filter links the search
 * page itself renders, so this follows the site instead of guessing at it.
 */
export function ultimateGuitarUrl(artist: string | null, title: string): string {
  // "The Four Horsemen - Remastered" finds nothing on either site; the store's
  // packaging is not part of the name anybody files a tab under
  const value = [artist, cleanTitle(title)].filter(Boolean).join(' ').trim()
  const params = new URLSearchParams({
    title: value,
    page: '1',
    type: String(UG_GUITAR_PRO_TYPE),
    order: 'myweight'
  })
  params.append('rating[0]', '4')
  params.append('rating[1]', '5')
  return `https://www.ultimate-guitar.com/search.php?${params.toString()}`
}

export function cifraClubSearchUrl(artist: string | null, title: string): string {
  const value = [artist, cleanTitle(title)].filter(Boolean).join(' ').trim()
  return `https://www.cifraclub.com.br/?q=${encodeURIComponent(value)}`
}

interface CifraDoc {
  /** "2" is a song; artists and other entities carry different codes. */
  t?: string
  /** song name */
  m?: string
  /** artist name */
  a?: string
  /** artist slug */
  d?: string
  /** song slug */
  u?: string
}

/**
 * Resolve the CifraClub page for a song through the same autocomplete endpoint
 * the site's own search box calls. Only the slug is used — to build a link the
 * user clicks — never the page content.
 */
async function resolveCifraClub(artist: string | null, title: string): Promise<string | null> {
  const query = [artist, cleanTitle(title)].filter(Boolean).join(' ').trim()
  if (!query) return null
  try {
    const res = await fetch(`https://solr.sscdn.co/cc/h2/?ck=1&q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) return null
    // the endpoint answers with a JSONP-style `( ... )` wrapper
    const text = (await res.text()).trim().replace(/^\(+/, '').replace(/\)+;?$/, '')
    const data = JSON.parse(text) as { response?: { docs?: CifraDoc[] } }
    const docs = (data.response?.docs ?? []).filter((d) => d.t === '2' && d.d && d.u)
    if (!docs.length) return null

    const wantTitle = normalizeTitle(title)
    const wantArtist = artist ? normalizeArtist(artist) : ''
    const best = docs
      .map((d) => {
        const titleScore = similarity(wantTitle, normalizeTitle(d.m ?? ''))
        const artistScore = wantArtist ? similarity(wantArtist, normalizeArtist(d.a ?? '')) : 0.5
        return { doc: d, score: titleScore * 0.7 + artistScore * 0.3 }
      })
      .sort((a, b) => b.score - a.score)[0]

    if (!best || best.score < 0.5) return null
    return `https://www.cifraclub.com.br/${best.doc.d}/${best.doc.u}/`
  } catch {
    return null
  }
}

export async function tabLinks(artist: string | null, title: string): Promise<TabSourceLinks> {
  const resolved = await resolveCifraClub(artist, title)
  return {
    query: [artist, cleanTitle(title)].filter(Boolean).join(' ').trim(),
    ultimateGuitar: ultimateGuitarUrl(artist, title),
    cifraClub: resolved ?? cifraClubSearchUrl(artist, title),
    cifraClubResolved: resolved !== null
  }
}

/* ------------------------------------------------------------- archive.org */

const ARCHIVE = 'https://archive.org'

/** Lossless first: the point of going to archive.org is a better master. */
const FORMAT_RANK: Array<{ test: RegExp; ext: string; bonus: number }> = [
  { test: /^wave?$/i, ext: '.wav', bonus: 1 },
  { test: /flac/i, ext: '.flac', bonus: 0.9 },
  { test: /aiff/i, ext: '.aiff', bonus: 0.7 },
  { test: /mp3/i, ext: '.mp3', bonus: 0.6 },
  { test: /ogg|vorbis/i, ext: '.ogg', bonus: 0.4 }
]

const DOWNLOADABLE_EXT = new Set(['.wav', '.flac', '.mp3', '.ogg', '.aiff', '.m4a'])

interface ArchiveFile {
  name?: string
  format?: string
  size?: string
  length?: string
  title?: string
  artist?: string
  creator?: string
  album?: string
  source?: string
}

interface ArchiveDoc {
  identifier?: string
  title?: string
  creator?: string | string[]
  year?: number
  downloads?: number
}

/** "255.9" and "4:15" both show up in archive.org metadata. */
export function parseArchiveLength(raw: string | undefined): number | null {
  if (!raw) return null
  if (raw.includes(':')) {
    const parts = raw.split(':').map((p) => Number.parseFloat(p))
    if (parts.some((n) => !Number.isFinite(n))) return null
    return parts.reduce((acc, n) => acc * 60 + n, 0)
  }
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

function formatInfo(format: string | undefined): { ext: string; bonus: number } | null {
  if (!format) return null
  for (const entry of FORMAT_RANK) {
    if (entry.test.test(format)) return { ext: entry.ext, bonus: entry.bonus }
  }
  return null
}

function firstCreator(creator: string | string[] | undefined): string | null {
  if (!creator) return null
  return Array.isArray(creator) ? (creator[0] ?? null) : creator
}

async function archiveJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Score one file inside an archive.org item against the song being looked for.
 * Exported so the test script can exercise the ranking without the network.
 */
export function scoreArchiveFile(
  file: ArchiveFile,
  doc: ArchiveDoc,
  wantTitle: string,
  wantArtist: string
): ArchiveCandidate | null {
  if (!file.name || file.source === 'derivative') return null
  const info = formatInfo(file.format)
  const ext = info?.ext ?? extname(file.name).toLowerCase()
  if (!info && !DOWNLOADABLE_EXT.has(ext)) return null

  const fileTitle = normalizeTitle(file.title ?? file.name)
  const titleScore = similarity(wantTitle, fileTitle)
  // an exact-ish track title is the whole point; below this it is another song
  if (titleScore < 0.55) return null

  const fileArtist = normalizeArtist(
    file.artist ?? file.creator ?? firstCreator(doc.creator) ?? ''
  )
  const artistScore = wantArtist ? similarity(wantArtist, fileArtist) : 0.5
  const score = titleScore * 0.65 + artistScore * 0.25 + (info?.bonus ?? 0.3) * 0.1

  return {
    identifier: doc.identifier as string,
    itemTitle: doc.title ?? (doc.identifier as string),
    creator: firstCreator(doc.creator),
    year: typeof doc.year === 'number' ? doc.year : null,
    fileName: file.name,
    format: file.format ?? ext.replace('.', '').toUpperCase(),
    ext,
    sizeBytes: file.size ? Number.parseInt(file.size, 10) : null,
    durationS: parseArchiveLength(file.length),
    url: `${ARCHIVE}/download/${doc.identifier}/${file.name
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    score: Number(score.toFixed(3)),
    reason:
      `título ${(titleScore * 100).toFixed(0)}%` +
      (wantArtist ? ` · artista ${(artistScore * 100).toFixed(0)}%` : '')
  }
}

/**
 * Find downloadable audio for one song on archive.org.
 *
 * Two steps, because the search index is item-level (an album, a concert) while
 * what the user wants is one track inside it: the first query narrows to a
 * handful of items, then each item's file list is scored track by track against
 * the song's own title.
 */
export async function searchArchiveAudio(
  artist: string | null,
  title: string,
  limit = 12
): Promise<{ candidates: ArchiveCandidate[]; error?: string }> {
  const clean = cleanTitle(title)
  const terms = [`"${clean.replace(/"/g, '')}"`]
  if (artist) terms.push(`"${artist.replace(/"/g, '')}"`)
  const q = `(${terms.join(' AND ')}) AND mediatype:audio`

  const params = new URLSearchParams({ q, rows: '8', page: '1', output: 'json' })
  for (const field of ['identifier', 'title', 'creator', 'year', 'downloads']) {
    params.append('fl[]', field)
  }
  params.append('sort[]', 'downloads desc')

  const search = await archiveJson<{ response?: { docs?: ArchiveDoc[] } }>(
    `${ARCHIVE}/advancedsearch.php?${params.toString()}`
  )
  if (!search) return { candidates: [], error: 'archive.org não respondeu à busca' }

  const docs = (search.response?.docs ?? []).filter((d) => d.identifier)
  if (!docs.length) return { candidates: [], error: 'Nenhum item encontrado no archive.org' }

  const wantTitle = normalizeTitle(clean)
  const wantArtist = artist ? normalizeArtist(artist) : ''
  const out: ArchiveCandidate[] = []

  for (const doc of docs) {
    const meta = await archiveJson<{ files?: ArchiveFile[] }>(
      `${ARCHIVE}/metadata/${doc.identifier}`
    )
    if (!meta?.files?.length) continue
    for (const file of meta.files) {
      const candidate = scoreArchiveFile(file, doc, wantTitle, wantArtist)
      if (candidate) out.push(candidate)
    }
  }

  out.sort((a, b) => b.score - a.score)
  if (!out.length) {
    return {
      candidates: [],
      error: 'Os itens encontrados não têm nenhuma faixa com esse título'
    }
  }
  return { candidates: out.slice(0, limit) }
}

/* --------------------------------------------------------------- download */

/** Windows-safe file name, using the app's own naming so the importer matches it. */
export function safeFileName(artist: string | null, title: string, ext: string): string {
  const base = [artist, cleanTitle(title)].filter(Boolean).join(' - ')
  const cleaned = base
    // characters Windows refuses in a file name
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${cleaned || 'faixa'}${ext}`
}

/** Never overwrite a file the user already has: park the new one beside it. */
export function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  let candidate = join(dir, fileName)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${n})${ext}`)
    n++
  }
  return candidate
}

export interface DownloadResult {
  path: string
  bytes: number
}

/**
 * Stream a URL to disk, reporting progress.
 *
 * A partial file is deleted on failure — a truncated wav sitting in songs/
 * would be picked up by the next scan and look like a corrupt track forever.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number | null) => void
): Promise<DownloadResult> {
  mkdirSync(dirname(destPath), { recursive: true })

  const res = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) })
  if (!res.ok || !res.body) {
    throw new Error(`Download falhou: HTTP ${res.status}`)
  }

  const header = res.headers.get('content-length')
  const parsed = header ? Number.parseInt(header, 10) : NaN
  const total = Number.isFinite(parsed) ? parsed : null
  let received = 0

  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress?.(received, total)
  })

  try {
    await pipeline(source, createWriteStream(destPath))
  } catch (err) {
    try {
      unlinkSync(destPath)
    } catch {
      /* the partial file may not exist at all */
    }
    throw err
  }

  return { path: destPath, bytes: statSync(destPath).size }
}
