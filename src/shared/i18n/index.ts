/**
 * Language selection and the primitives the catalogues are built from.
 *
 * Imported by both processes, so it stays pure: no `window`, no `document`, no
 * `node:*`, no `electron`. Everything takes the locale as an argument; the
 * ambient "current language" lives in `main/i18n.ts` and
 * `renderer/src/lib/i18n.ts`, one per side.
 */

export const LOCALES = ['en', 'pt-BR', 'es'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Human names, each written in its own language — never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  es: 'Español'
}

/** What to tell a model to write in. Kept apart from the display names. */
export const LOCALE_PROMPT_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Brazilian Portuguese',
  es: 'Spanish'
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Pick the best supported locale from a list of preferences, most-preferred
 * first — the shape both `navigator.languages` and Electron's
 * `getPreferredSystemLanguages` come in.
 *
 * Matching is by language subtag, so `pt-PT` and `pt` both land on `pt-BR`.
 * That is a deliberate over-reach: a European Portuguese speaker is far better
 * served by Brazilian Portuguese than by English, and there is no `pt-PT`
 * catalogue to fall back to.
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    if (!raw) continue
    const tag = raw.replace('_', '-')
    if (isLocale(tag)) return tag

    const base = tag.split('-')[0]?.toLowerCase()
    if (!base) continue
    const match = LOCALES.find((l) => l.split('-')[0].toLowerCase() === base)
    if (match) return match
  }
  return DEFAULT_LOCALE
}

/**
 * Choose between a singular and a plural form.
 *
 * All three languages here use the same one/other split for whole numbers, so
 * this is the whole of the plural problem — `Intl.PluralRules` reads the same
 * CLDR data a translation library would embed, without the library.
 */
export function plural(n: number, one: string, other: string): string {
  return new Intl.PluralRules('en').select(n) === 'one' ? one : other
}
