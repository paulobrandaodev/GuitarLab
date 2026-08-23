/**
 * Resolving a file to a song. Metadata is authoritative when present: both the
 * user's audio files carry artist+title (ID3 / RIFF INFO) and the binary Guitar
 * Pro files carry them in the header, so filename parsing is only the fallback
 * for untagged files.
 */

/**
 * Release qualifiers: the words that mark a chunk of a title as packaging
 * rather than as the name of the song.
 */
const TITLE_NOISE =
  /\b(?:re-?master(?:ed|s|ing)?|remasterizad[oa]|album version|original(?: album)?(?: version| mix)?|single version|radio (?:edit|version)|mono|stereo|deluxe|bonus track|anniversary|live|explicit|feat\.?|featuring|edit)\b/i

/**
 * The song's name without the store's packaging.
 *
 * "The Four Horsemen - Remastered" and "The Trooper (Original Album Version)"
 * are what Spotify hands over, and they are wrong twice: they look bad in the
 * setlist, and no tab site or archive.org item is filed under them, so every
 * search came back empty. Only a tail that is *only* qualifiers is dropped —
 * "Sgt. Pepper's Lonely Hearts Club Band - Reprise" keeps its reprise.
 *
 * Case and punctuation survive: this is the title people read, not the
 * comparison key (that is `normalizeTitle`).
 */
export function cleanTitle(raw: string): string {
  let s = raw.trim()

  // "(Remastered 2004)", "[2011 Remaster]", "(feat. Someone)"
  s = s.replace(/\s*[([]([^)\]]*)[)\]]/g, (full, inner: string) =>
    TITLE_NOISE.test(inner) ? '' : full
  )

  // " - Remastered", " – 2015 Remaster", " - Live at Wembley"
  const parts = s.split(/\s+[-–—]\s+/)
  const kept = [parts[0]]
  for (const part of parts.slice(1)) {
    if (TITLE_NOISE.test(part)) break
    kept.push(part)
  }

  const cleaned = kept.join(' - ').replace(/\s{2,}/g, ' ').trim()
  return cleaned || raw.trim()
}

/** Strip track numbers, release qualifiers and tool suffixes down to a comparable core. */
export function normalizeTitle(raw: string): string {
  // the display cleaner first, so " - Remastered" never reaches the comparison
  let s = cleanTitle(raw).toLowerCase()
  s = s.replace(/\.[a-z0-9]{1,5}$/, '') // extension
  s = s.replace(/^\s*\d{1,3}\s*[.\-_)]+\s*/, '') // leading track number
  s = s.replace(/\((?:original\s+)?album\s+version\)/g, '')
  s = s.replace(/\((?:\d{4}\s+)?remaster(?:ed)?[^)]*\)/g, '')
  s = s.replace(/\[(?:\d{4}\s+)?remaster(?:ed)?[^\]]*\]/g, '')
  s = s.replace(/\((?:single|ep|live|demo|explicit|clean|radio edit)[^)]*\)/g, '')
  s = s.replace(/\bofficial\s+(?:audio|video|music\s+video)\b/g, '')
  s = s.replace(/[_\-]+/g, ' ')
  s = s.replace(/\b(?:gp|guitar[\s]?pro)\s?v?\d*\b/g, '') // gp_v2, guitarpro5
  s = s.replace(/\bver(?:sion)?\s?\d+\b/g, '')
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function normalizeArtist(raw: string): string {
  let s = raw.toLowerCase().trim()
  s = s.replace(/^the\s+/, '')
  s = s.replace(/\s*(?:feat|ft|featuring)\.?\s+.*$/, '')
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Dice coefficient over word bigrams — forgiving about word order and small typos. */
function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

/** True when every word of the shorter string appears in the longer one. */
function tokenSubset(a: string, b: string): boolean {
  const A = a.split(' ').filter(Boolean)
  const B = b.split(' ').filter(Boolean)
  if (!A.length || !B.length) return false
  const [short, long] = A.length <= B.length ? [A, B] : [B, A]
  const set = new Set(long)
  return short.every((w) => set.has(w))
}

export interface MatchCandidate {
  id: number
  title: string
  artist: string | null
}

export interface MatchResult {
  songId: number | null
  score: number
  reason: string
}

const ACCEPT = 0.82
const REVIEW = 0.6

/**
 * Score a parsed (title, artist) against existing songs.
 * Artist agreement is a strong signal but is not required — the same song may
 * have been created from a Guitar Pro file whose artist field was blank.
 */
export function matchSong(
  title: string,
  artist: string | null,
  candidates: MatchCandidate[]
): MatchResult {
  const t = normalizeTitle(title)
  const a = artist ? normalizeArtist(artist) : ''
  if (!t) return { songId: null, score: 0, reason: 'sem título utilizável' }

  let best: MatchResult = { songId: null, score: 0, reason: 'nenhum candidato' }

  for (const c of candidates) {
    const ct = normalizeTitle(c.title)
    const ca = c.artist ? normalizeArtist(c.artist) : ''

    let titleScore = similarity(t, ct)
    if (tokenSubset(t, ct)) titleScore = Math.max(titleScore, 0.92)

    let score: number
    let reason: string
    if (a && ca) {
      let artistScore = similarity(a, ca)
      if (tokenSubset(a, ca)) artistScore = Math.max(artistScore, 0.9)
      score = titleScore * 0.7 + artistScore * 0.3
      reason = `título ${(titleScore * 100) | 0}% + artista ${(artistScore * 100) | 0}%`
    } else {
      // no artist on one side: title has to carry it alone, so discount slightly
      score = titleScore * 0.95
      reason = `só título ${(titleScore * 100) | 0}%`
    }

    if (score > best.score) best = { songId: c.id, score, reason }
  }

  if (best.score >= ACCEPT) return best
  if (best.score >= REVIEW) {
    return { songId: null, score: best.score, reason: `${best.reason} (abaixo do limiar)` }
  }
  return { songId: null, score: best.score, reason: 'sem correspondência' }
}

export const MATCH_THRESHOLDS = { ACCEPT, REVIEW }
