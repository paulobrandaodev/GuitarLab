import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { config } from '../config'
import { saveToken, loadToken, clearToken, type StoredToken } from '../auth/vault'

/**
 * Spotify integration, shaped by two hard constraints verified against the
 * current API:
 *
 *  - audio-features / audio-analysis are dead for apps created after Nov 2024,
 *    so tempo and key come from local analysis, never from Spotify.
 *  - The February 2026 changes cut `search` to 10 results, removed the batch
 *    fetch endpoints (one request per track now) and renamed playlist
 *    `/tracks` to `/items`. Everything below assumes the new shapes and keeps a
 *    conservative request pace because development-mode rate limits are low.
 *
 * Playback uses Spotify Connect to drive the user's already-running desktop
 * client. The in-app Web Playback SDK would need Widevine, which stock Electron
 * does not ship — not worth a forked runtime for a practice tool.
 */

const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'
const PROVIDER = 'spotify'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeVerifier(): string {
  return base64url(randomBytes(64))
}

function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

let pendingServer: Server | null = null

function redirectPort(): number {
  try {
    return Number.parseInt(new URL(config.spotify.redirectUri).port, 10) || 8888
  } catch {
    return 8888
  }
}

const PAGE = (title: string, body: string): string => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
<style>
 body{background:#1c1c22;color:#f2f2f5;font:16px/1.6 system-ui,sans-serif;
      display:grid;place-items:center;height:100vh;margin:0}
 .card{background:#212128;padding:44px 52px;border-radius:28px;text-align:center;
       box-shadow:-6px -6px 14px rgba(255,255,255,.045),8px 8px 18px rgba(0,0,0,.55)}
 h1{margin:0 0 8px;font-size:20px;
    background:linear-gradient(135deg,#FFD15C,#FF8A5C 45%,#FF4E8A);
    -webkit-background-clip:text;background-clip:text;color:transparent}
 p{margin:0;color:#8b8b98;font-size:14px}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`

/**
 * Opens the consent screen in the user's real browser (where they are already
 * signed in) and catches the redirect on a short-lived loopback server.
 */
export async function connect(): Promise<{ ok: boolean; error?: string }> {
  if (!config.spotify.configured) {
    return { ok: false, error: 'SPOTIFY_CLIENT_ID não configurado no .env' }
  }

  const verifier = makeVerifier()
  const state = base64url(randomBytes(16))
  const port = redirectPort()

  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', config.spotify.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.spotify.redirectUri)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', challengeFor(verifier))
  url.searchParams.set('state', state)
  url.searchParams.set('scope', config.spotify.scopes.join(' '))

  return new Promise((resolve) => {
    pendingServer?.close()

    const timeout = setTimeout(() => {
      pendingServer?.close()
      pendingServer = null
      resolve({ ok: false, error: 'Tempo esgotado esperando a autorização (2 min)' })
    }, 120_000)

    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (!reqUrl.pathname.startsWith('/callback')) {
        res.writeHead(404).end()
        return
      }

      const error = reqUrl.searchParams.get('error')
      const code = reqUrl.searchParams.get('code')
      const returnedState = reqUrl.searchParams.get('state')

      const finish = (ok: boolean, message: string, detail: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGE(message, detail))
        clearTimeout(timeout)
        server.close()
        pendingServer = null
        resolve(ok ? { ok: true } : { ok: false, error: detail })
      }

      if (error) return finish(false, 'Autorização negada', error)
      if (returnedState !== state) return finish(false, 'Falha de segurança', 'state não confere')
      if (!code) return finish(false, 'Falha', 'nenhum código recebido')

      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.spotify.redirectUri,
          client_id: config.spotify.clientId,
          code_verifier: verifier
        })
        const tokenRes = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        })
        if (!tokenRes.ok) {
          return finish(false, 'Falha no token', (await tokenRes.text()).slice(0, 200))
        }
        const data = (await tokenRes.json()) as {
          access_token: string
          refresh_token?: string
          expires_in: number
          scope?: string
        }
        saveToken(PROVIDER, {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
          scopes: data.scope ?? null
        })
        finish(true, 'Spotify conectado', 'Pode fechar esta aba e voltar pro GuitarLab.')
      } catch (err) {
        finish(false, 'Erro', err instanceof Error ? err.message : String(err))
      }
    })

    server.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: `Não consegui abrir a porta ${port}: ${err.message}` })
    })

    server.listen(port, '127.0.0.1', () => {
      pendingServer = server
      void shell.openExternal(url.toString())
    })
  })
}

export function disconnect(): void {
  clearToken(PROVIDER)
}

export function isConnected(): boolean {
  return loadToken(PROVIDER) !== null
}

async function refresh(token: StoredToken): Promise<StoredToken | null> {
  if (!token.refreshToken) return null
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: config.spotify.clientId
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  const next: StoredToken = {
    accessToken: data.access_token,
    // Spotify only sometimes rotates the refresh token
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    scopes: data.scope ?? token.scopes
  }
  saveToken(PROVIDER, next)
  return next
}

async function accessToken(): Promise<string | null> {
  let token = loadToken(PROVIDER)
  if (!token) return null
  const now = Math.floor(Date.now() / 1000)
  if (token.expiresAt && token.expiresAt - 60 < now) {
    token = await refresh(token)
    if (!token) return null
  }
  return token.accessToken
}

/* ----------------------------------------------------------- rate limiting */

let lastCall = 0
const MIN_GAP_MS = 120 // development-mode limits are low; stay well under them

async function pace(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  retries = 1
): Promise<T | { error: string }> {
  const token = await accessToken()
  if (!token) return { error: 'Spotify não conectado' }

  await pace()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })

  if (res.status === 429 && retries > 0) {
    const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '2', 10)
    await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000))
    return api<T>(path, init, retries - 1)
  }
  if (res.status === 204) return {} as T
  if (!res.ok) {
    return { error: `Spotify ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  return (await res.json()) as T
}

/* -------------------------------------------------------------- endpoints */

export interface SpotifyTrack {
  id: string
  name: string
  artists: string[]
  album: string
  durationMs: number
  uri: string
}

/** February 2026 capped `limit` at 10; asking for more is a 400. */
export async function searchTracks(query: string): Promise<SpotifyTrack[] | { error: string }> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '10' })
  const data = await api<{
    tracks?: {
      items: Array<{
        id: string
        name: string
        artists: Array<{ name: string }>
        album: { name: string }
        duration_ms: number
        uri: string
      }>
    }
  }>(`/search?${params}`)
  if ('error' in data) return data
  return (data.tracks?.items ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    durationMs: t.duration_ms,
    uri: t.uri
  }))
}

export async function me(): Promise<{ id: string; displayName: string } | { error: string }> {
  const data = await api<{ id: string; display_name?: string }>('/me')
  if ('error' in data) return data
  return { id: data.id, displayName: data.display_name ?? data.id }
}

/* ------------------------------------------------------------- playlists */

export interface SpotifyPlaylist {
  id: string
  name: string
  owner: string
  trackCount: number
  imageUrl: string | null
}

/** The user's own playlists, newest API page first. Paged to cover big libraries. */
export async function listPlaylists(): Promise<SpotifyPlaylist[] | { error: string }> {
  const out: SpotifyPlaylist[] = []
  let url = '/me/playlists?limit=50'

  // 50 per page is the API maximum; loop until Spotify stops handing out a next
  for (let page = 0; page < 10; page++) {
    const data = await api<{
      items?: Array<{
        id: string
        name: string
        owner?: { display_name?: string; id?: string }
        // February 2026 renamed the playlist's `tracks` collection to `items`.
        // The old key stays as a fallback in case anything still serves it.
        items?: { total?: number }
        tracks?: { total?: number }
        images?: Array<{ url: string }>
      }>
      next?: string | null
    }>(url)
    if ('error' in data) return data

    for (const p of data.items ?? []) {
      out.push({
        id: p.id,
        name: p.name,
        owner: p.owner?.display_name ?? p.owner?.id ?? '',
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
        imageUrl: p.images?.[0]?.url ?? null
      })
    }
    if (!data.next) break
    // `next` is absolute; the api() helper wants a path relative to the base
    url = data.next.replace(API, '')
  }
  return out
}

export interface PlaylistTrack {
  name: string
  artists: string[]
  album: string | null
  durationMs: number | null
  spotifyId: string | null
  year: number | null
}

/** Every track of a playlist, flattened to what the importer needs. */
export async function playlistTracks(
  playlistId: string
): Promise<PlaylistTrack[] | { error: string }> {
  const out: PlaylistTrack[] = []
  // February 2026: the endpoint is `/items` (the old `/tracks` answers 403), the
  // page size is capped at 50 and each entry wraps the track under `item`.
  let url =
    `/playlists/${playlistId}/items?limit=50` +
    '&fields=next,items(item(id,name,duration_ms,album(name,release_date),artists(name)))'

  // 50 per page now, so twice the pages to keep the same reach
  for (let page = 0; page < 40; page++) {
    const data = await api<{
      items?: Array<{
        item?: {
          id?: string
          name?: string
          duration_ms?: number
          album?: { name?: string; release_date?: string }
          artists?: Array<{ name: string }>
        } | null
      }>
      next?: string | null
    }>(url)
    if ('error' in data) {
      // Playlists the Spotify client builds for you (Descobertas da Semana,
      // Radar de Novidades, Daily Mix) and private ones owned by someone else
      // answer 403 here even though they show up in /me/playlists.
      if (data.error.startsWith('Spotify 403')) {
        return {
          error:
            'O Spotify não libera o conteúdo desta playlist. Isso acontece com as ' +
            'playlists geradas pelo próprio Spotify (Descobertas da Semana, Radar de ' +
            'Novidades, Daily Mix) e com playlists privadas de outra pessoa.'
        }
      }
      return data
    }

    for (const item of data.items ?? []) {
      const t = item.item
      // local files and removed tracks come back as null or without a name
      if (!t?.name) continue
      const year = t.album?.release_date
        ? Number.parseInt(t.album.release_date.slice(0, 4), 10)
        : null
      out.push({
        name: t.name,
        artists: (t.artists ?? []).map((a) => a.name),
        album: t.album?.name ?? null,
        durationMs: t.duration_ms ?? null,
        spotifyId: t.id ?? null,
        year: Number.isFinite(year) ? year : null
      })
    }
    if (!data.next) break
    url = data.next.replace(API, '')
  }
  return out
}

/* --------------------------------------------------------- Connect control */

export interface PlaybackState {
  isPlaying: boolean
  progressMs: number
  trackName: string | null
  trackUri: string | null
  deviceName: string | null
  deviceId: string | null
}

export async function playbackState(): Promise<PlaybackState | { error: string }> {
  const data = await api<{
    is_playing?: boolean
    progress_ms?: number
    item?: { name: string; uri: string }
    device?: { name: string; id: string }
  }>('/me/player')
  if ('error' in data) return data
  return {
    isPlaying: Boolean(data.is_playing),
    progressMs: data.progress_ms ?? 0,
    trackName: data.item?.name ?? null,
    trackUri: data.item?.uri ?? null,
    deviceName: data.device?.name ?? null,
    deviceId: data.device?.id ?? null
  }
}

export async function listDevices(): Promise<
  Array<{ id: string; name: string; isActive: boolean }> | { error: string }
> {
  const data = await api<{
    devices?: Array<{ id: string; name: string; is_active: boolean }>
  }>('/me/player/devices')
  if ('error' in data) return data
  return (data.devices ?? []).map((d) => ({ id: d.id, name: d.name, isActive: d.is_active }))
}

export async function play(uri?: string, positionMs?: number): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {}
  if (uri) body.uris = [uri]
  if (positionMs !== undefined) body.position_ms = positionMs
  const res = await api('/me/player/play', {
    method: 'PUT',
    body: Object.keys(body).length ? JSON.stringify(body) : undefined
  })
  return 'error' in (res as object) ? { ok: false, error: (res as { error: string }).error } : { ok: true }
}

export async function pause(): Promise<{ ok: boolean; error?: string }> {
  const res = await api('/me/player/pause', { method: 'PUT' })
  return 'error' in (res as object) ? { ok: false, error: (res as { error: string }).error } : { ok: true }
}

export async function seek(positionMs: number): Promise<{ ok: boolean; error?: string }> {
  const res = await api(`/me/player/seek?position_ms=${Math.round(positionMs)}`, { method: 'PUT' })
  return 'error' in (res as object) ? { ok: false, error: (res as { error: string }).error } : { ok: true }
}

/* ---------------------------------------------------------------- playlist */

/** Mirror a setlist to a real Spotify playlist, in setlist order. */
export async function syncSetlistPlaylist(
  name: string,
  trackUris: string[],
  existingPlaylistId?: string | null
): Promise<{ playlistId: string; added: number } | { error: string }> {
  const user = await me()
  if ('error' in user) return user

  let playlistId = existingPlaylistId ?? null

  if (!playlistId) {
    const created = await api<{ id: string }>(`/users/${user.id}/playlists`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        public: false,
        description: 'Sincronizado pelo GuitarLab'
      })
    })
    if ('error' in created) return created
    playlistId = created.id
  } else {
    // February 2026 renamed /tracks to /items
    const cleared = await api(`/playlists/${playlistId}/items`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [] })
    })
    if ('error' in (cleared as object)) return cleared as { error: string }
  }

  let added = 0
  for (let i = 0; i < trackUris.length; i += 100) {
    const chunk = trackUris.slice(i, i + 100)
    const res = await api(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk })
    })
    if ('error' in (res as object)) return res as { error: string }
    added += chunk.length
  }

  return { playlistId, added }
}

export async function status(): Promise<{ configured: boolean; connected: boolean; detail: string }> {
  if (!config.spotify.configured) {
    return { configured: false, connected: false, detail: 'SPOTIFY_CLIENT_ID ausente no .env' }
  }
  if (!isConnected()) {
    return { configured: true, connected: false, detail: 'configurado, aguardando login' }
  }
  const user = await me()
  if ('error' in user) {
    return { configured: true, connected: false, detail: user.error }
  }
  return { configured: true, connected: true, detail: `conectado como ${user.displayName}` }
}
