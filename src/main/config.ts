import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

/**
 * Minimal .env reader. We do not use `dotenv` directly because the user's file
 * may carry inline `# comments` after values, which older parsers keep as part
 * of the value. Everything here is trimmed and comment-stripped defensively.
 */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    // strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    } else {
      // strip an inline comment only when preceded by whitespace, so that
      // values legitimately containing '#' (rare, but possible) survive
      const hash = value.search(/\s+#/)
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    if (key) out[key] = value
  }
  return out
}

/**
 * Project root: the directory holding .env and the media folders. Walk up from
 * the app path looking for a marker, because the starting directory differs
 * between `electron-vite dev`, a packaged build and one-off scripts.
 */
function findProjectRoot(): string {
  const candidates = [
    process.env.SETLIST_LAB_ROOT,
    app.isPackaged ? join(process.resourcesPath, '..') : app.getAppPath(),
    process.cwd()
  ].filter(Boolean) as string[]

  for (const start of candidates) {
    let dir = resolve(start)
    for (let depth = 0; depth < 6; depth++) {
      if (existsSync(join(dir, '.env')) || existsSync(join(dir, 'gptabs'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  // nothing matched: fall back to the app path and let the folders be configured
  return resolve(app.isPackaged ? join(process.resourcesPath, '..') : app.getAppPath())
}

const projectRoot = findProjectRoot()
const fileEnv = parseEnvFile(join(projectRoot, '.env'))

function env(key: string, fallback = ''): string {
  const v = process.env[key] ?? fileEnv[key] ?? ''
  return v === '' ? fallback : v
}

function envInt(key: string, fallback: number): number {
  const n = Number.parseInt(env(key), 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Pin the app name before the first path is read from it.
 *
 * Electron derives the name from the nearest package.json, which resolves to
 * "Electron" when the built bundle is launched directly instead of through
 * electron-vite. That silently moves `userData` — and with it the database — to
 * a different folder, so the app comes up with an empty library. This module is
 * the first thing to read a path, so the name has to be set right here: doing it
 * in main/index.ts is too late, because its imports run first.
 */
app.setName('setlist-lab')

const userData = app.getPath('userData')

export const config = {
  projectRoot,
  userData,

  paths: {
    db: join(userData, 'setlist-lab.db'),
    gptabs: env('GPTABS_DIR', join(projectRoot, 'gptabs')),
    songs: env('SONGS_DIR', join(projectRoot, 'songs')),
    stems: env('STEMS_DIR', join(projectRoot, '.stems')),
    waveforms: join(userData, 'waveforms'),
    screenshots: join(userData, 'screenshots'),
    soundfont: join(projectRoot, 'resources', 'soundfont.sf2')
  },

  ffmpeg: {
    /** Empty means "use whatever is on PATH" — the user has 7.1.1 installed. */
    path: env('FFMPEG_PATH') || 'ffmpeg',
    probePath: env('FFMPEG_PATH') ? env('FFMPEG_PATH').replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe'
  },

  spotify: {
    clientId: env('SPOTIFY_CLIENT_ID'),
    redirectUri: env('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8888/callback'),
    get configured(): boolean {
      return Boolean(env('SPOTIFY_CLIENT_ID'))
    },
    scopes: [
      'user-read-private',
      'user-read-email',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-modify-private',
      'playlist-modify-public'
    ]
  },

  youtube: {
    apiKey: env('YOUTUBE_API_KEY'),
    get configured(): boolean {
      return Boolean(env('YOUTUBE_API_KEY'))
    },
    /** Daily unit budget. search.list costs 100, so this is ~100 searches. */
    quotaLimit: envInt('YOUTUBE_QUOTA_LIMIT', 10000),
    searchCost: 100
  },

  llm: {
    provider: env('LLM_PROVIDER', 'openai'),
    /**
     * Comma-separated, tried in order after the primary provider. Keeping it a
     * list means a cloud fallback (OpenAI) can sit in front of the local one
     * (Ollama) without the local model being skipped when both are down.
     */
    get fallbackProviders(): string[] {
      return env('LLM_FALLBACK_PROVIDER', 'gemini,ollama')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    },
    gemini: {
      apiKey: env('GEMINI_API_KEY'),
      model: env('GEMINI_MODEL', 'gemini-3.5-flash')
    },
    openai: {
      // the user's .env spells it OPEN_AI_API_KEY; accept the conventional
      // spelling too so either name works
      apiKey: env('OPEN_AI_API_KEY') || env('OPENAI_API_KEY'),
      model: env('OPENAI_MODEL', 'gpt-5.4-nano'),
      baseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1')
    },
    groq: {
      apiKey: env('GROQ_API_KEY'),
      model: env('GROQ_MODEL', 'llama-3.3-70b-versatile')
    },
    ollama: {
      baseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
      model: env('OLLAMA_MODEL', 'huihui_ai/Qwen3.8-abliterated:27b-q4_K_M')
    }
  },

  musicbrainz: {
    userAgent: env('MUSICBRAINZ_USER_AGENT', 'SetlistLab/0.1 ( setlist-lab )')
  },

  genius: {
    accessToken: env('GENIUS_ACCESS_TOKEN')
  },

  lab: {
    url: env('FORGE_LAB_URL', 'http://127.0.0.1:8756'),
    demucsModel: env('DEMUCS_MODEL', 'htdemucs_6s'),
    demucsSegment: envInt('DEMUCS_SEGMENT', 7)
  }
}

export type AppConfig = typeof config
