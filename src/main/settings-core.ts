/**
 * The settings catalogue and the precedence rule, with no I/O and no Electron.
 *
 * Split from `settings.ts` so the rules can be tested with plain `tsx`. Nothing
 * in this file may import `electron`, `node:fs`, or anything with a side effect.
 */

export type SettingGroup = 'spotify' | 'youtube' | 'llm' | 'lab' | 'media' | 'app'

/**
 * Where a resolved value came from. The UI shows this, because "I pasted the
 * key and nothing happened" is otherwise an unanswerable bug report.
 */
export type SettingSource = 'env' | 'user' | 'dotenv' | 'default'

export interface SettingSpec {
  /** Stable identifier used by the IPC layer and by the settings file. */
  key: string
  /**
   * Environment variable names, in order. More than one where the app has
   * historically accepted an alternative spelling.
   */
  envKeys: string[]
  /** Encrypted at rest, and never sent to the renderer in full. */
  secret: boolean
  /** Used when nothing else supplies a value. */
  fallback: string
  group: SettingGroup
}

/**
 * Every user-configurable value, in one place.
 *
 * Media folders are deliberately absent: they are read before this store is
 * available and changing one requires a restart, so they keep their own path
 * through `settings.ts`. See the note on `config.paths` for why that asymmetry
 * is the design rather than an oversight.
 */
export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: 'spotifyClientId',
    envKeys: ['SPOTIFY_CLIENT_ID'],
    secret: true,
    fallback: '',
    group: 'spotify'
  },
  {
    key: 'spotifyRedirectUri',
    envKeys: ['SPOTIFY_REDIRECT_URI'],
    secret: false,
    fallback: 'http://127.0.0.1:8888/callback',
    group: 'spotify'
  },

  {
    key: 'youtubeApiKey',
    envKeys: ['YOUTUBE_API_KEY'],
    secret: true,
    fallback: '',
    group: 'youtube'
  },
  {
    key: 'youtubeQuotaLimit',
    envKeys: ['YOUTUBE_QUOTA_LIMIT'],
    secret: false,
    fallback: '10000',
    group: 'youtube'
  },

  {
    key: 'llmProvider',
    envKeys: ['LLM_PROVIDER'],
    secret: false,
    fallback: 'openai',
    group: 'llm'
  },
  {
    key: 'llmFallbackProvider',
    envKeys: ['LLM_FALLBACK_PROVIDER'],
    secret: false,
    fallback: 'gemini,ollama',
    group: 'llm'
  },

  { key: 'geminiApiKey', envKeys: ['GEMINI_API_KEY'], secret: true, fallback: '', group: 'llm' },
  {
    key: 'geminiModel',
    envKeys: ['GEMINI_MODEL'],
    secret: false,
    fallback: 'gemini-3.5-flash',
    group: 'llm'
  },

  // The .env this app shipped with spells it OPEN_AI_API_KEY; the conventional
  // spelling is accepted too, so either name works.
  {
    key: 'openaiApiKey',
    envKeys: ['OPEN_AI_API_KEY', 'OPENAI_API_KEY'],
    secret: true,
    fallback: '',
    group: 'llm'
  },
  {
    key: 'openaiModel',
    envKeys: ['OPENAI_MODEL'],
    secret: false,
    fallback: 'gpt-5.4-nano',
    group: 'llm'
  },
  {
    key: 'openaiBaseUrl',
    envKeys: ['OPENAI_BASE_URL'],
    secret: false,
    fallback: 'https://api.openai.com/v1',
    group: 'llm'
  },

  { key: 'groqApiKey', envKeys: ['GROQ_API_KEY'], secret: true, fallback: '', group: 'llm' },
  {
    key: 'groqModel',
    envKeys: ['GROQ_MODEL'],
    secret: false,
    fallback: 'llama-3.3-70b-versatile',
    group: 'llm'
  },

  {
    key: 'ollamaBaseUrl',
    envKeys: ['OLLAMA_BASE_URL'],
    secret: false,
    fallback: 'http://127.0.0.1:11434',
    group: 'llm'
  },
  {
    key: 'ollamaModel',
    envKeys: ['OLLAMA_MODEL'],
    secret: false,
    fallback: 'huihui_ai/Qwen3.8-abliterated:27b-q4_K_M',
    group: 'llm'
  },

  {
    key: 'labUrl',
    envKeys: ['FORGE_LAB_URL'],
    secret: false,
    fallback: 'http://127.0.0.1:8756',
    group: 'lab'
  },
  {
    key: 'demucsModel',
    envKeys: ['DEMUCS_MODEL'],
    secret: false,
    fallback: 'htdemucs_6s',
    group: 'lab'
  },
  { key: 'demucsSegment', envKeys: ['DEMUCS_SEGMENT'], secret: false, fallback: '7', group: 'lab' },

  { key: 'ffmpegPath', envKeys: ['FFMPEG_PATH'], secret: false, fallback: '', group: 'media' },
  {
    key: 'musicbrainzUserAgent',
    envKeys: ['MUSICBRAINZ_USER_AGENT'],
    secret: false,
    fallback: 'GuitarLab/0.1 ( guitarlab )',
    group: 'app'
  },

  // 'auto' means "follow the operating system". It is stored as 'auto' and
  // resolved on every read, so that choosing it keeps following the OS instead
  // of freezing today's language forever.
  { key: 'locale', envKeys: ['GUITARLAB_LOCALE'], secret: false, fallback: 'auto', group: 'app' }
] as const

const BY_KEY = new Map(SETTING_SPECS.map((s) => [s.key, s]))

export function specFor(key: string): SettingSpec | undefined {
  return BY_KEY.get(key)
}

export function isSettingKey(key: string): boolean {
  return BY_KEY.has(key)
}

/** Keys whose values are encrypted at rest. */
export const SECRET_KEYS: readonly string[] = SETTING_SPECS.filter((s) => s.secret).map((s) => s.key)

export interface Resolved {
  value: string
  source: SettingSource
}

export interface ResolveInputs {
  /** The real process environment. */
  processEnv: Record<string, string | undefined>
  /** What the user saved, already decrypted. */
  stored: Record<string, string>
  /** The parsed .env at the project root. */
  fileEnv: Record<string, string>
}

/**
 * Resolve one setting.
 *
 * Precedence is `process.env` > what the user saved > `.env` > default, and
 * each step earns its place:
 *
 * - The environment wins because it is the explicit, temporary override:
 *   a one-off `GEMINI_API_KEY=... npm run dev`, CI, and the test scripts, which
 *   run outside the app and must not disturb what the user saved.
 * - The user's choice beats `.env` because it is the most recent deliberate act
 *   and the only layer an installed build has at all. If `.env` won, a stale
 *   file at the project root would silently override a key the user had just
 *   typed and watched turn green — an unexplainable failure. A developer who
 *   wants the file to win can export it instead.
 *
 * An empty string means "not set" at every layer, so clearing a field in the UI
 * lets `.env` or the default reappear. That is why callers delete a stored key
 * rather than storing an empty one.
 */
export function resolveSetting(key: string, inputs: ResolveInputs): Resolved {
  const spec = BY_KEY.get(key)
  if (!spec) return { value: '', source: 'default' }

  for (const envKey of spec.envKeys) {
    const fromEnv = inputs.processEnv[envKey]
    if (fromEnv) return { value: fromEnv, source: 'env' }
  }

  const fromUser = inputs.stored[key]
  if (fromUser) return { value: fromUser, source: 'user' }

  for (const envKey of spec.envKeys) {
    const fromFile = inputs.fileEnv[envKey]
    if (fromFile) return { value: fromFile, source: 'dotenv' }
  }

  return { value: spec.fallback, source: 'default' }
}

/**
 * Replace known secret values inside a string with a mask.
 *
 * IPC errors travel to the renderer verbatim, and an exception can quote a URL
 * or a header carrying a key. Best effort by construction: it can only hide the
 * values it is handed, and a key mangled by whatever threw will slip past. It
 * is a seatbelt, not a guarantee.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    // Very short values would match everywhere and turn the message into noise.
    if (!secret || secret.length < 8) continue
    out = out.split(secret).join('••••')
  }
  return out
}

/** What the renderer is allowed to know about one setting. */
export interface SettingView {
  key: string
  group: SettingGroup
  secret: boolean
  source: SettingSource
  /** For a secret: whether something is set. Never the value itself. */
  present: boolean
  /** The value, for non-secrets only. Always empty for a secret. */
  value: string
}

export function viewFor(key: string, inputs: ResolveInputs): SettingView {
  const spec = BY_KEY.get(key)
  if (!spec) throw new Error(`unknown setting: ${key}`)
  const { value, source } = resolveSetting(key, inputs)
  return {
    key,
    group: spec.group,
    secret: spec.secret,
    source,
    present: Boolean(value),
    // A secret never crosses the bridge. Modelling it as an empty string here
    // means a leak would have to be written on purpose.
    value: spec.secret ? '' : value
  }
}

export function allViews(inputs: ResolveInputs): SettingView[] {
  return SETTING_SPECS.map((s) => viewFor(s.key, inputs))
}
