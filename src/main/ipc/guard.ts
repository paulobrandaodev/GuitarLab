import { resolve, sep } from 'node:path'

/**
 * Argument validation for IPC handlers.
 *
 * Written by hand rather than with a schema library, deliberately.
 *
 * The threat model here is narrow. The renderer is served from `app://bundle`
 * with context isolation on, node integration off, a strict CSP, and a
 * window-open handler that refuses everything — there is no remote content in
 * the window and no third party on the other end of this bridge. So validation
 * is not a boundary against an attacker; it is a guard against crashes, and a
 * *policy* boundary for the handful of channels that take a filesystem path or
 * start a process. That is a much smaller job than validating eighty channels.
 *
 * Against that, a schema library is a fifth runtime dependency and ~60 KB in a
 * project that keeps three on purpose. And the codebase already does this by
 * hand where it matters: see `normalizePatch` in services/tone.ts, which
 * reshapes whatever the model returned.
 *
 * These throw plain Errors. The `handle()` wrapper already turns a thrown error
 * into `{ __error }` for the renderer, so nothing else is needed.
 *
 * If you are here to "improve" this by adding Zod: please read the paragraph
 * above first. The absence is the decision.
 */

export function asString(value: unknown, field: string, maxLength = 4096): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (value.length > maxLength) throw new Error(`${field} is too long`)
  return value
}

export function asOptionalString(value: unknown, field: string, maxLength = 4096): string | null {
  if (value === null || value === undefined || value === '') return null
  return asString(value, field, maxLength)
}

export function asInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
  return value
}

/** A database row id: an integer, and a positive one. */
export function asId(value: unknown, field = 'id'): number {
  const n = asInt(value, field)
  if (n < 1) throw new Error(`${field} must be positive`)
  return n
}

export function asBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

export function asEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  const s = asString(value, field, 200)
  if (!allowed.includes(s as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return s as T
}

/**
 * A URL the app is willing to open in the user's browser.
 *
 * `shell:openExternal` hands its argument to the operating system, which will
 * happily act on `file:` and on registered custom schemes. Restricting it to
 * http(s) is the one change in the IPC layer that closes a real hole rather
 * than a theoretical one.
 */
export function asHttpUrl(value: unknown, field = 'url'): string {
  const raw = asString(value, field, 2048)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${field} is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} must be http or https`)
  }
  return parsed.toString()
}

/**
 * A path that must live under one of the given roots.
 *
 * Resolved before comparing, so `..` cannot walk out, and compared with a
 * trailing separator so that `/data/songs-backup` does not pass as being inside
 * `/data/songs`.
 */
export function asPathUnder(value: unknown, roots: string[], field = 'path'): string {
  const raw = asString(value, field, 4096)
  const target = resolve(raw)
  const ok = roots.some((root) => {
    const base = resolve(root)
    return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
  })
  if (!ok) throw new Error(`${field} is outside the allowed folders`)
  return target
}

/** A plain object of string values, for settings patches. */
export function asStringRecord(
  value: unknown,
  field: string,
  maxKeys = 64
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > maxKeys) throw new Error(`${field} has too many keys`)
  const out: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') throw new Error(`${field}.${key} must be a string`)
    if (raw.length > 4096) throw new Error(`${field}.${key} is too long`)
    out[key] = raw
  }
  return out
}
