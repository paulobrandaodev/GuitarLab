import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileEnv, userData } from './config-env'
import { ENCRYPTION_UNAVAILABLE, secretBox, type SecretBox } from './secretbox'
import {
  SECRET_KEYS,
  allViews,
  isSettingKey,
  resolveSetting,
  specFor,
  type ResolveInputs,
  type SettingView
} from './settings-core'

/**
 * Where the app remembers what the user configured.
 *
 * A JSON file next to the database, not rows in `app_settings`, and the reason
 * is backup. The database *is* the user's library — the file they copy between
 * machines, and which `adoptLegacyDatabase` already treats that way. Ciphertext
 * from `safeStorage` is bound to the OS user, so keys living inside the .db
 * would decrypt to garbage on the other machine with no way to tell that apart
 * from "wrong key". Keeping them outside makes copying the library clean by
 * construction.
 *
 * Two smaller reasons: a file has no import graph, so `config` never has to
 * reach through `repo` into `db/client` and back; and "delete settings.json and
 * reopen" is a one-line support answer that needs no sqlite client and works
 * even when the database will not open.
 *
 * (`oauth_tokens` stays in the database on purpose. A token is derivable — one
 * click on Connect makes a new one. An API key the user pasted is not.)
 *
 * Secrets are separated from plain preferences inside the same file. A base URL
 * or a model name is not a secret, encrypting it buys nothing and costs
 * debuggability, and on a Linux box with no keyring the plain half keeps
 * working while only the keys are refused.
 */

const SETTINGS_VERSION = 1

export const settingsPath = join(userData, 'settings.json')

/** The pre-settings.json file that held only the media folders. */
const legacyPathsFile = join(userData, 'paths.json')

export type LibraryFolder = 'gptabs' | 'songs' | 'stems'

interface SettingsFile {
  version: number
  paths: Partial<Record<LibraryFolder, string>>
  /** Plain values: models, base URLs, provider order, language. */
  prefs: Record<string, string>
  /** Encrypted values, keyed the same way as `prefs`. */
  secrets: Record<string, string>
}

function emptyFile(): SettingsFile {
  return { version: SETTINGS_VERSION, paths: {}, prefs: {}, secrets: {} }
}

function readStrings(source: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!source || typeof source !== 'object') return out
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out
}

function load(): SettingsFile {
  try {
    if (existsSync(settingsPath)) {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        const raw = parsed as Record<string, unknown>
        return {
          version: typeof raw.version === 'number' ? raw.version : SETTINGS_VERSION,
          paths: readStrings(raw.paths) as Partial<Record<LibraryFolder, string>>,
          prefs: readStrings(raw.prefs),
          secrets: readStrings(raw.secrets)
        }
      }
    }
  } catch {
    // A corrupt file must not stop the app from opening. Falling through to an
    // empty one loses configuration, which is recoverable; refusing to boot is
    // not.
  }

  // Migrate the folders written by the version that only had paths.json. Left
  // in place rather than deleted, so downgrading still finds it.
  try {
    if (existsSync(legacyPathsFile)) {
      const parsed: unknown = JSON.parse(readFileSync(legacyPathsFile, 'utf8'))
      const paths = readStrings(parsed) as Partial<Record<LibraryFolder, string>>
      if (Object.keys(paths).length) return { ...emptyFile(), paths }
    }
  } catch {
    /* same reasoning */
  }

  return emptyFile()
}

let file = load()

/**
 * Decrypted secrets, cached.
 *
 * `safeStorage` does real work per call, and these are read on every config
 * access. Invalidated wholesale on write, which is rare.
 */
let decrypted: Record<string, string> | null = null

let box: SecretBox = secretBox

/** Swap the crypto backend. Tests only. */
export function __setSecretBox(next: SecretBox): void {
  box = next
  decrypted = null
}

function secrets(): Record<string, string> {
  if (decrypted) return decrypted
  const out: Record<string, string> = {}
  for (const [key, stored] of Object.entries(file.secrets)) {
    const value = box.open(stored)
    // A value that will not decrypt was written by another OS user, or the
    // keyring changed underneath us. Treat it as absent — the UI will show the
    // field as unset and the user can paste it again.
    if (value) out[key] = value
  }
  decrypted = out
  return out
}

function inputs(): ResolveInputs {
  return { processEnv: process.env, stored: { ...file.prefs, ...secrets() }, fileEnv }
}

/** Write the file atomically: a crash mid-write must not lose the user's keys. */
function persist(): void {
  mkdirSync(userData, { recursive: true })
  const tmp = `${settingsPath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  renameSync(tmp, settingsPath)
}

// ─── reading ──────────────────────────────────────────────────────────────────

/** The resolved value of one setting. */
export function settingValue(key: string): string {
  return resolveSetting(key, inputs()).value
}

export function settingInt(key: string, fallback: number): number {
  const n = Number.parseInt(settingValue(key), 10)
  return Number.isFinite(n) ? n : fallback
}

/** Everything the renderer may see. Secret values are stripped. */
export function settingViews(): SettingView[] {
  return allViews(inputs())
}

/** Every secret currently in play, for redacting error messages. */
export function activeSecrets(): string[] {
  const out: string[] = []
  for (const key of SECRET_KEYS) {
    const value = settingValue(key)
    if (value) out.push(value)
  }
  return out
}

export function encryptionAvailable(): boolean {
  return box.available()
}

// ─── writing ──────────────────────────────────────────────────────────────────

export type SettingsPatch = Record<string, string>

export interface SaveResult {
  ok: boolean
  /** Keys that actually changed, for the effects layer. */
  changed: string[]
  /** Present when something was refused. */
  error?: string
}

/**
 * Save settings.
 *
 * An empty value deletes the key rather than storing an empty string, so the
 * `.env` value or the built-in default becomes visible again — see the
 * precedence note in settings-core.
 */
export function saveSettings(patch: SettingsPatch): SaveResult {
  const changed: string[] = []
  const before = inputs()

  for (const [key, raw] of Object.entries(patch)) {
    const spec = specFor(key)
    if (!spec) continue
    const value = typeof raw === 'string' ? raw.trim() : ''

    if (spec.secret) {
      if (!value) {
        if (key in file.secrets) {
          delete file.secrets[key]
          changed.push(key)
        }
        continue
      }
      if (!box.available()) {
        return {
          ok: false,
          changed,
          error: ENCRYPTION_UNAVAILABLE
        }
      }
      file.secrets[key] = box.seal(value)
      changed.push(key)
    } else {
      if (!value) {
        if (key in file.prefs) {
          delete file.prefs[key]
          changed.push(key)
        }
        continue
      }
      if (file.prefs[key] === value) continue
      file.prefs[key] = value
      changed.push(key)
    }
  }

  if (!changed.length) return { ok: true, changed: [] }

  decrypted = null
  persist()

  // Report only what changed in the *resolved* value. A key shadowed by
  // process.env changes the file but nothing the app reads, and firing effects
  // for it would clear caches for no reason.
  const after = inputs()
  const effective = changed.filter(
    (key) => resolveSetting(key, before).value !== resolveSetting(key, after).value
  )
  notify(effective)
  return { ok: true, changed: effective }
}

// ─── media folders ────────────────────────────────────────────────────────────

export function storedPaths(): Partial<Record<LibraryFolder, string>> {
  return { ...file.paths }
}

/**
 * Persist the folders picked in Settings.
 *
 * `config.paths` is frozen at import time, so the caller restarts the app
 * afterwards — which is what the Settings screen does. Writing straight through
 * means a failed restart still leaves the choice recorded.
 */
export function saveLibraryPaths(next: Partial<Record<LibraryFolder, string>>): void {
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string' && value.trim()) {
      file.paths[key as LibraryFolder] = value.trim()
    } else {
      delete file.paths[key as LibraryFolder]
    }
  }
  persist()
}

// ─── locale ───────────────────────────────────────────────────────────────────

let systemLocale = 'en'

/**
 * Record what the OS reports. Called once, after `ready` — `getLocale` and
 * `getPreferredSystemLanguages` are not answerable before that.
 */
export function setSystemLocale(locale: string): void {
  systemLocale = locale
}

/** The language to use: the user's explicit choice, or the OS when set to auto. */
export function currentLocale(): string {
  const chosen = settingValue('locale')
  return !chosen || chosen === 'auto' ? systemLocale : chosen
}

// ─── change notification ──────────────────────────────────────────────────────

type Listener = (changed: string[]) => void
const listeners: Listener[] = []

/** Register a side effect to run when settings change. See settings-effects.ts. */
export function onSettingsChange(listener: Listener): void {
  listeners.push(listener)
}

function notify(changed: string[]): void {
  if (!changed.length) return
  for (const listener of listeners) {
    try {
      listener(changed)
    } catch (err) {
      console.error('[settings] listener failed:', err)
    }
  }
}

// ─── guards ───────────────────────────────────────────────────────────────────

/**
 * Reading a secret before `ready` cannot work: safeStorage has no key yet on
 * Windows and Linux. Nothing does this today; this makes it loud if it starts.
 */
export function assertReady(): void {
  if (!app.isReady()) {
    throw new Error('settings: secrets are not readable before the app is ready')
  }
}

export { isSettingKey }

/** Remove the settings file. Used by tests and by support instructions. */
export function resetSettings(): void {
  try {
    if (existsSync(settingsPath)) unlinkSync(settingsPath)
  } catch {
    /* nothing to do */
  }
  file = emptyFile()
  decrypted = null
}
