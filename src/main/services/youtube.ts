import { eq, and } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { config } from '../config'
import type { YoutubeRole, YoutubeRefView } from '@shared/types'

/**
 * The free YouTube quota is 10,000 units/day and search.list costs 100, so the
 * app gets ~100 searches per day.
 *
 * One broad search per song used to fill only whichever slot the algorithm
 * happened to surface — backing tracks and isolated guitar almost never made it
 * into the top 25 of a generic query. So we now run one short, explicit query
 * per practice slot (see ROLE_QUERY) and let the query itself decide the role,
 * spending 3 searches on a song instead of 1. Results are cached forever, and a
 * song that already has all three slots filled is not searched again.
 */

const SEARCH_COST = 100
const QUOTA_KEY_PREFIX = 'youtube_quota_'

function todayKey(): string {
  // YouTube quota resets at midnight Pacific
  const pacific = new Date(Date.now() - 8 * 3600 * 1000)
  return `${QUOTA_KEY_PREFIX}${pacific.toISOString().slice(0, 10)}`
}

export function quotaUsedToday(): number {
  const row = getDb()
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, todayKey()))
    .get()
  return row ? Number.parseInt(row.value, 10) || 0 : 0
}

function addQuota(units: number): void {
  const db = getDb()
  const key = todayKey()
  const current = quotaUsedToday()
  const next = String(current + units)
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()
  if (existing) {
    db.update(schema.appSettings).set({ value: next }).where(eq(schema.appSettings.key, key)).run()
  } else {
    db.insert(schema.appSettings).values({ key, value: next }).run()
  }
}

export function quotaRemaining(): number {
  return Math.max(0, config.youtube.quotaLimit - quotaUsedToday())
}

export function canSearch(): boolean {
  return config.youtube.configured && quotaRemaining() >= SEARCH_COST
}

/* --------------------------------------------------------- classification */

interface RolePattern {
  role: YoutubeRole
  patterns: RegExp[]
  negative?: RegExp[]
  weight: number
}

// Ordered so the most specific practice roles win over generic ones.
const ROLE_PATTERNS: RolePattern[] = [
  {
    role: 'guitar_only',
    patterns: [
      /\bguitar[s]?\s*(?:track|only|solo\s*track)\b/i,
      /\bisolated\s+guitar/i,
      /\bguitar\s+isolated/i,
      /\bonly\s+guitar\b/i,
      /\bs[oó]\s+(?:a\s+)?guitarra\b/i,
      /\bguitarra\s+isolada\b/i
    ],
    negative: [/\bno\s+guitar\b/i, /\bwithout\s+guitar\b/i, /\bsem\s+guitarra\b/i],
    weight: 1
  },
  {
    role: 'backing_track',
    patterns: [
      /\bbacking\s*track\b/i,
      /\bplay[\s-]?along\b/i,
      /\bno\s+guitar\b/i,
      /\bwithout\s+guitar\b/i,
      /\bsem\s+guitarra\b/i,
      /\bminus\s+one\b/i,
      /\bplayback\b/i,
      /\bkaraoke\b/i
    ],
    weight: 1
  },
  {
    role: 'lesson_tabs',
    patterns: [
      /\bwith\s+tabs?\b/i,
      /\btabs?\b.*\blesson\b/i,
      /\blesson\b/i,
      /\btutorial\b/i,
      /\bhow\s+to\s+play\b/i,
      /\bguitar\s+cover\s+with\s+tab/i,
      /\baula\b/i,
      /\bcomo\s+tocar\b/i,
      /\bcifra\b/i
    ],
    weight: 1
  },
  {
    role: 'bass_only',
    patterns: [/\bbass\s*(?:track|only|cover)\b/i, /\bisolated\s+bass\b/i, /\bbaixo\s+isolado\b/i],
    weight: 0.9
  },
  {
    role: 'drums_only',
    patterns: [/\bdrum[s]?\s*(?:track|only|cover)\b/i, /\bisolated\s+drums\b/i, /\bbateria\s+isolada\b/i],
    weight: 0.9
  },
  { role: 'live', patterns: [/\blive\b/i, /\bao\s+vivo\b/i, /\bconcert\b/i], weight: 0.5 },
  {
    role: 'official',
    patterns: [/\bofficial\s+(?:music\s+)?video\b/i, /\bofficial\s+audio\b/i],
    weight: 0.7
  },
  { role: 'cover', patterns: [/\bcover\b/i], weight: 0.4 }
]

/** Channels that reliably publish one kind of material. */
const CHANNEL_HINTS: Array<{ pattern: RegExp; role: YoutubeRole; boost: number }> = [
  { pattern: /backing\s*track/i, role: 'backing_track', boost: 0.25 },
  { pattern: /karaoke/i, role: 'backing_track', boost: 0.2 },
  { pattern: /guitar\s*lesson/i, role: 'lesson_tabs', boost: 0.2 },
  { pattern: /songsterr|ultimate\s*guitar/i, role: 'lesson_tabs', boost: 0.25 }
]

export interface ClassifiedVideo {
  videoId: string
  title: string
  channel: string
  durationS: number | null
  role: YoutubeRole
  confidence: number
  /** Set when rules were inconclusive and an LLM re-rank would help. */
  ambiguous: boolean
}

export function classifyVideo(title: string, channel: string): {
  role: YoutubeRole
  confidence: number
  ambiguous: boolean
} {
  const haystack = `${title} ${channel}`
  const scores = new Map<YoutubeRole, number>()

  for (const rp of ROLE_PATTERNS) {
    if (rp.negative?.some((n) => n.test(haystack))) continue
    const hits = rp.patterns.filter((p) => p.test(haystack)).length
    if (hits > 0) {
      const score = Math.min(1, 0.55 + hits * 0.2) * rp.weight
      scores.set(rp.role, Math.max(scores.get(rp.role) ?? 0, score))
    }
  }

  for (const hint of CHANNEL_HINTS) {
    if (hint.pattern.test(channel)) {
      scores.set(hint.role, Math.min(1, (scores.get(hint.role) ?? 0.4) + hint.boost))
    }
  }

  if (scores.size === 0) return { role: 'unknown', confidence: 0, ambiguous: true }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [role, confidence] = sorted[0]
  const runnerUp = sorted[1]?.[1] ?? 0
  // two roles scoring within 0.15 of each other is a genuine coin flip
  const ambiguous = confidence < 0.6 || confidence - runnerUp < 0.15
  return { role, confidence: Math.round(confidence * 100) / 100, ambiguous }
}

/* -------------------------------------------------------------- API calls */

function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return null
  return (
    Number.parseInt(m[1] ?? '0', 10) * 3600 +
    Number.parseInt(m[2] ?? '0', 10) * 60 +
    Number.parseInt(m[3] ?? '0', 10)
  )
}

interface SearchItem {
  id: { videoId?: string }
  snippet: { title: string; channelTitle: string }
}

/**
 * The search phrase for each practice slot. Deliberately short: long queries
 * with the album, "full song", "HD" and so on push YouTube towards the official
 * upload instead of the practice material we are actually after.
 */
const ROLE_QUERY: Record<string, string> = {
  lesson_tabs: 'Guitar Lesson Tab',
  backing_track: 'Guitar Backing Track',
  guitar_only: 'Guitar Only'
}

const SLOT_ROLES: YoutubeRole[] = ['lesson_tabs', 'backing_track', 'guitar_only']

export function roleQuery(artist: string | null, title: string, role: YoutubeRole): string {
  return [artist, title, ROLE_QUERY[role] ?? ''].filter(Boolean).join(' ')
}

async function searchRole(
  artist: string | null,
  title: string,
  role: YoutubeRole
): Promise<{ items: SearchItem[]; error?: string }> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', roleQuery(artist, title, role))
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '10')
  url.searchParams.set('key', config.youtube.apiKey)

  const res = await fetch(url)
  addQuota(SEARCH_COST)
  if (!res.ok) {
    const body = await res.text()
    return { items: [], error: `YouTube ${res.status}: ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { items?: SearchItem[] }
  return { items: data.items ?? [] }
}

/**
 * Decide the final role for a hit found by the query for `queried`.
 *
 * The query is the strongest signal — a video returned for "Guitar Backing
 * Track" almost always is one — but the title still gets a vote, so a lesson
 * that surfaces in the backing-track results lands in the right slot instead of
 * the wrong one.
 */
function resolveRole(
  title: string,
  channel: string,
  queried: YoutubeRole
): { role: YoutubeRole; confidence: number; ambiguous: boolean } {
  const rules = classifyVideo(title, channel)
  if (rules.role === queried) {
    // query and title agree — as certain as this gets without watching it
    return { role: queried, confidence: Math.max(rules.confidence, 0.85), ambiguous: false }
  }
  // a confident title that names a different practice slot overrules the query
  if (SLOT_ROLES.includes(rules.role) && !rules.ambiguous && rules.confidence >= 0.7) {
    return rules
  }
  return { role: queried, confidence: 0.6, ambiguous: rules.ambiguous }
}

/**
 * Fill the three practice slots with one query each. Runs only the searches the
 * remaining quota affords, in slot order, so a nearly-exhausted quota still
 * fills the most useful slot rather than failing outright.
 */
export async function searchAndClassify(
  artist: string | null,
  title: string,
  roles: YoutubeRole[] = SLOT_ROLES
): Promise<{ videos: ClassifiedVideo[]; quotaSpent: number; error?: string }> {
  if (!config.youtube.configured) {
    return { videos: [], quotaSpent: 0, error: 'YOUTUBE_API_KEY não configurada' }
  }
  if (!canSearch()) {
    return {
      videos: [],
      quotaSpent: 0,
      error: `Cota diária esgotada (${quotaUsedToday()}/${config.youtube.quotaLimit} unidades)`
    }
  }

  const affordable = Math.min(roles.length, Math.floor(quotaRemaining() / SEARCH_COST))
  const planned = roles.slice(0, affordable)

  const found = new Map<string, ClassifiedVideo>()
  const errors: string[] = []
  let quotaSpent = 0

  for (const role of planned) {
    const { items, error } = await searchRole(artist, title, role)
    quotaSpent += SEARCH_COST
    if (error) {
      errors.push(error)
      continue
    }
    for (const item of items) {
      const videoId = item.id.videoId
      if (!videoId) continue
      const resolved = resolveRole(item.snippet.title, item.snippet.channelTitle, role)
      const existing = found.get(videoId)
      // the same video can come back from two queries; keep the surer reading
      if (existing && existing.confidence >= resolved.confidence) continue
      found.set(videoId, {
        videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        durationS: null,
        ...resolved
      })
    }
  }

  const videos = [...found.values()]

  // videos.list for durations costs 1 unit for the whole batch — cheap and worth it
  const ids = videos.map((v) => v.videoId)
  if (ids.length) {
    const dUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
    dUrl.searchParams.set('part', 'contentDetails')
    dUrl.searchParams.set('id', ids.join(','))
    dUrl.searchParams.set('key', config.youtube.apiKey)
    const dRes = await fetch(dUrl)
    addQuota(1)
    quotaSpent += 1
    if (dRes.ok) {
      const dData = (await dRes.json()) as {
        items?: Array<{ id: string; contentDetails: { duration: string } }>
      }
      const durations = new Map<string, number | null>()
      for (const v of dData.items ?? []) {
        durations.set(v.id, parseIsoDuration(v.contentDetails.duration))
      }
      for (const v of videos) v.durationS = durations.get(v.videoId) ?? null
    }
  }

  if (!videos.length && errors.length) {
    return { videos: [], quotaSpent, error: errors[0] }
  }
  if (planned.length < roles.length) {
    return {
      videos,
      quotaSpent,
      error: `Cota só deu para ${planned.length} de ${roles.length} buscas — tente o resto amanhã.`
    }
  }
  return { videos, quotaSpent }
}

/**
 * Persist the hits for each practice slot.
 *
 * A video already cached under a different role gets re-filed: the row is
 * unique per (song, video), and rows left over from an earlier, broader search
 * are exactly the ones sitting in the wrong slot. Rows the user pinned or
 * confirmed by hand are never touched — their choice outranks the classifier.
 */
export function saveClassified(songId: number, videos: ClassifiedVideo[]): YoutubeRefView[] {
  const db = getDb()
  for (const v of videos) {
    if (v.role === 'unknown') continue
    db.insert(schema.youtubeRefs)
      .values({
        songId,
        videoId: v.videoId,
        role: v.role,
        title: v.title,
        channel: v.channel,
        durationS: v.durationS,
        confidence: v.confidence
      })
      .onConflictDoUpdate({
        target: [schema.youtubeRefs.songId, schema.youtubeRefs.videoId],
        set: {
          role: v.role,
          title: v.title,
          channel: v.channel,
          durationS: v.durationS,
          confidence: v.confidence
        },
        setWhere: and(
          eq(schema.youtubeRefs.verified, false),
          eq(schema.youtubeRefs.pinned, false)
        )
      })
      .run()
  }
  return db
    .select()
    .from(schema.youtubeRefs)
    .where(eq(schema.youtubeRefs.songId, songId))
    .all() as YoutubeRefView[]
}

/** Manual fallback for when quota runs out: user pastes any YouTube URL. */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  ]
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m) return m[1]
  }
  return null
}

export function addManualRef(
  songId: number,
  urlOrId: string,
  role: YoutubeRole,
  title?: string
): YoutubeRefView | { error: string } {
  const videoId = extractVideoId(urlOrId)
  if (!videoId) return { error: 'Não consegui extrair o ID do vídeo dessa URL' }
  const db = getDb()
  const existing = db
    .select()
    .from(schema.youtubeRefs)
    .where(and(eq(schema.youtubeRefs.songId, songId), eq(schema.youtubeRefs.videoId, videoId)))
    .get()
  if (existing) {
    db.update(schema.youtubeRefs)
      .set({ role, verified: true, pinned: true, confidence: 1 })
      .where(eq(schema.youtubeRefs.id, existing.id))
      .run()
    return { ...existing, role, verified: true, pinned: true, confidence: 1 } as YoutubeRefView
  }
  const row = db
    .insert(schema.youtubeRefs)
    .values({
      songId,
      videoId,
      role,
      title: title ?? null,
      confidence: 1,
      verified: true,
      pinned: true
    })
    .returning()
    .get()
  return row as YoutubeRefView
}

export function setRefRole(refId: number, role: YoutubeRole): void {
  getDb()
    .update(schema.youtubeRefs)
    .set({ role, verified: true })
    .where(eq(schema.youtubeRefs.id, refId))
    .run()
}

export function deleteRef(refId: number): void {
  getDb().delete(schema.youtubeRefs).where(eq(schema.youtubeRefs.id, refId)).run()
}

/**
 * Zero-quota path: the URL the user can open in a browser and copy a link back
 * from. Uses the same phrasing as the in-app search so the browser results look
 * like what the app would have found.
 */
export function manualSearchUrl(artist: string | null, title: string, role: YoutubeRole): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    roleQuery(artist, title, role)
  )}`
}
