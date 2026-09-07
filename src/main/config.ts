import { join } from 'node:path'
import {
  APP_NAME,
  APP_SLUG,
  LEGACY_SLUG,
  fileEnv,
  legacyUserData,
  mediaRoot,
  projectRoot,
  userData
} from './config-env'
import { settingInt, settingValue, storedPaths } from './settings'

/**
 * The app's configuration, resolved on every read.
 *
 * Almost everything here is a getter rather than a value, so that a key pasted
 * into Settings takes effect without restarting. That is worth the indirection:
 * asking someone to restart after every field during first-run setup is a bad
 * enough experience to lose them. Nearly every call site already reads
 * `config.x.y` inside a function, so making these getters changed no callers.
 *
 * `paths` is the deliberate exception and stays frozen. Moving the library
 * genuinely needs a restart — the `media://` protocol roots, the directories
 * created at startup and the database handle are all bound at boot — so the
 * Settings screen writes the choice and relaunches. The asymmetry is the
 * design, and the UI says so: folders restart, keys and URLs do not.
 *
 * Do not "tidy" `paths` into getters for consistency. It would look correct and
 * break media loading in ways that only show up at runtime.
 */

export { APP_NAME, APP_SLUG, legacyUserData }

/** A folder the user chose in Settings wins over .env, but never over the environment. */
function dir(key: 'gptabs' | 'songs' | 'stems', envKey: string, fallback: string): string {
  const overrides = storedPaths()
  const fromFile = fileEnv[envKey]
  return process.env[envKey] || overrides[key] || fromFile || fallback
}

export const config = {
  projectRoot,
  userData,

  paths: {
    db: join(userData, `${APP_SLUG}.db`),
    legacyDb: join(legacyUserData, `${LEGACY_SLUG}.db`),
    gptabs: dir('gptabs', 'GPTABS_DIR', join(mediaRoot, 'gptabs')),
    songs: dir('songs', 'SONGS_DIR', join(mediaRoot, 'songs')),
    stems: dir('stems', 'STEMS_DIR', join(mediaRoot, '.stems')),
    waveforms: join(userData, 'waveforms'),
    screenshots: join(userData, 'screenshots')
  },

  ffmpeg: {
    /** Empty means "use whatever is on PATH". */
    get path(): string {
      return settingValue('ffmpegPath') || 'ffmpeg'
    },
    get probePath(): string {
      const custom = settingValue('ffmpegPath')
      return custom ? custom.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe'
    }
  },

  spotify: {
    get clientId(): string {
      return settingValue('spotifyClientId')
    },
    get redirectUri(): string {
      return settingValue('spotifyRedirectUri')
    },
    get configured(): boolean {
      return Boolean(settingValue('spotifyClientId'))
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
    get apiKey(): string {
      return settingValue('youtubeApiKey')
    },
    get configured(): boolean {
      return Boolean(settingValue('youtubeApiKey'))
    },
    /** Daily unit budget. search.list costs 100, so this is ~100 searches. */
    get quotaLimit(): number {
      return settingInt('youtubeQuotaLimit', 10000)
    },
    searchCost: 100
  },

  llm: {
    get provider(): string {
      return settingValue('llmProvider')
    },
    /**
     * Comma-separated, tried in order after the primary provider. Keeping it a
     * list means a cloud fallback (OpenAI) can sit in front of the local one
     * (Ollama) without the local model being skipped when both are down.
     */
    get fallbackProviders(): string[] {
      return settingValue('llmFallbackProvider')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    },
    gemini: {
      get apiKey(): string {
        return settingValue('geminiApiKey')
      },
      get model(): string {
        return settingValue('geminiModel')
      }
    },
    openai: {
      get apiKey(): string {
        return settingValue('openaiApiKey')
      },
      get model(): string {
        return settingValue('openaiModel')
      },
      get baseUrl(): string {
        return settingValue('openaiBaseUrl')
      }
    },
    groq: {
      get apiKey(): string {
        return settingValue('groqApiKey')
      },
      get model(): string {
        return settingValue('groqModel')
      }
    },
    ollama: {
      get baseUrl(): string {
        return settingValue('ollamaBaseUrl')
      },
      get model(): string {
        return settingValue('ollamaModel')
      }
    }
  },

  musicbrainz: {
    get userAgent(): string {
      return settingValue('musicbrainzUserAgent')
    }
  },

  lab: {
    get url(): string {
      return settingValue('labUrl')
    },
    get demucsModel(): string {
      return settingValue('demucsModel')
    },
    get demucsSegment(): number {
      return settingInt('demucsSegment', 7)
    }
  }
}

export { saveLibraryPaths } from './settings'

export type AppConfig = typeof config
