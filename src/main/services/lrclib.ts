import { config } from '../config'

/**
 * LRCLIB is free, needs no API key and exists specifically to serve synced
 * lyrics to open-source players. It is the primary lyrics source; the Guitar
 * Pro file's embedded lyrics are the offline fallback.
 */

const BASE = 'https://lrclib.net/api'

export interface LrcResult {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  duration: number | null
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

function headers(): Record<string, string> {
  return { 'User-Agent': config.musicbrainz.userAgent, Accept: 'application/json' }
}

/** Exact lookup — best hit rate when duration is known (matches the right edit). */
export async function getLyrics(
  artist: string,
  title: string,
  album?: string | null,
  durationSec?: number | null
): Promise<LrcResult | null> {
  const url = new URL(`${BASE}/get`)
  url.searchParams.set('artist_name', artist)
  url.searchParams.set('track_name', title)
  if (album) url.searchParams.set('album_name', album)
  if (durationSec) url.searchParams.set('duration', String(Math.round(durationSec)))

  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (res.status === 404) return null
    if (!res.ok) return null
    return (await res.json()) as LrcResult
  } catch {
    return null
  }
}

export async function searchLyrics(query: string): Promise<LrcResult[]> {
  const url = new URL(`${BASE}/search`)
  url.searchParams.set('q', query)
  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    return (await res.json()) as LrcResult[]
  } catch {
    return []
  }
}

/** Exact match first, then a looser search — LRCLIB's /get is strict about titles. */
export async function findBest(
  artist: string | null,
  title: string,
  album?: string | null,
  durationMs?: number | null
): Promise<LrcResult | null> {
  const durationSec = durationMs ? Math.round(durationMs / 1000) : null

  if (artist) {
    const exact = await getLyrics(artist, title, album, durationSec)
    if (exact?.syncedLyrics || exact?.plainLyrics) return exact
    // retry without duration: our tag duration may differ from their reference
    const loose = await getLyrics(artist, title, album, null)
    if (loose?.syncedLyrics || loose?.plainLyrics) return loose
  }

  const results = await searchLyrics([artist, title].filter(Boolean).join(' '))
  if (!results.length) return null

  // prefer synced lyrics, then the closest duration
  const scored = results
    .filter((r) => r.syncedLyrics || r.plainLyrics)
    .map((r) => {
      let score = r.syncedLyrics ? 100 : 0
      if (durationSec && r.duration) score -= Math.min(50, Math.abs(r.duration - durationSec))
      return { r, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.r ?? null
}

export interface LrcLine {
  timeMs: number
  text: string
}

/** Parse an LRC body into sorted, timestamped lines. */
export function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) {
      const min = Number.parseInt(s[1], 10)
      const sec = Number.parseInt(s[2], 10)
      const frac = s[3] ? Number.parseInt(s[3].padEnd(3, '0'), 10) : 0
      lines.push({ timeMs: min * 60000 + sec * 1000 + frac, text })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}
