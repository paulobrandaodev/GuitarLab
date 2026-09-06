import type { Locale } from './i18n'

/**
 * Locale-aware formatting, in one place.
 *
 * There were four separate copies of "milliseconds to m:ss" in this codebase
 * and three hard-coded 'pt-BR' locales. Everything here takes the locale as an
 * argument and reads no ambient state, so both processes can use it.
 *
 * `Intl` objects are expensive to construct and cheap to reuse, so they are
 * memoised per locale.
 */

const numberCache = new Map<string, Intl.NumberFormat>()
const relativeCache = new Map<Locale, Intl.RelativeTimeFormat>()
const dateCache = new Map<Locale, Intl.DateTimeFormat>()
const collatorCache = new Map<Locale, Intl.Collator>()

function numberFormat(locale: Locale, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`
  let f = numberCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    })
    numberCache.set(key, f)
  }
  return f
}

/**
 * Sorting order for the current language.
 *
 * Used by the setlist sort. Accents must not change a word's place — "Água"
 * belongs with "Agua" — which is what `sensitivity: 'base'` buys, and `numeric`
 * makes "Track 2" come before "Track 10".
 */
export function collatorFor(locale: Locale): Intl.Collator {
  let c = collatorCache.get(locale)
  if (!c) {
    c = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
    collatorCache.set(locale, c)
  }
  return c
}

/**
 * A track length, as `m:ss`.
 *
 * Deliberately not localised: `m:ss` reads the same in every language this app
 * speaks, and a colon is what every other music player shows.
 */
export function formatDuration(ms: number | null | undefined, empty = '—'): string {
  if (!ms || ms <= 0) return empty
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Seconds to `m:ss`, for playheads and loop markers. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A total running time, in words: "1h 12min".
 *
 * This one does need the language — "min" happens to work in Portuguese and
 * Spanish and reads wrong in English — so the unit words come from the caller's
 * catalogue rather than being baked in here.
 */
export function formatTotalDuration(
  ms: number,
  units: { hour: string; minute: string }
): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? `${h}${units.hour} ${m}${units.minute}` : `${m}${units.minute}`
}

export function formatNumber(value: number, locale: Locale, digits = 1): string {
  return numberFormat(locale, digits).format(value)
}

export function formatPercent(value: number, locale: Locale, digits = 0): string {
  return `${formatNumber(value, locale, digits)}%`
}

/** File sizes. Binary-ish units, because that is what every OS shows. */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes >= 1e9) return `${formatNumber(bytes / 1e9, locale, 1)} GB`
  if (bytes >= 1e6) return `${formatNumber(bytes / 1e6, locale, 1)} MB`
  if (bytes >= 1e3) return `${formatNumber(bytes / 1e3, locale, 0)} kB`
  return `${bytes} B`
}

export function formatDate(ts: number, locale: Locale): string {
  let f = dateCache.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: 'short' })
    dateCache.set(locale, f)
  }
  return f.format(new Date(ts * 1000))
}

export function formatDateTime(ts: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(ts * 1000)
  )
}

/**
 * "3 days ago", in the user's language.
 *
 * `Intl.RelativeTimeFormat` handles the wording, including the cases that are
 * irregular in Portuguese and Spanish. Past a month it falls back to a date,
 * because "seven weeks ago" is harder to read than the day itself.
 */
export function formatRelative(
  ts: number | null,
  locale: Locale,
  never: string,
  now: string
): string {
  if (!ts) return never

  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return now

  let f = relativeCache.get(locale)
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeCache.set(locale, f)
  }

  // 'auto' is what turns -1 day into "yesterday" instead of "1 day ago".
  if (diff < 3600) return f.format(-Math.floor(diff / 60), 'minute')
  if (diff < 86400) return f.format(-Math.floor(diff / 3600), 'hour')

  const days = Math.floor(diff / 86400)
  if (days < 30) return f.format(-days, 'day')
  return formatDate(ts, locale)
}
