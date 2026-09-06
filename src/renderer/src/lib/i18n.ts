import { create } from 'zustand'
import { catalogFor, type Catalog } from '@shared/i18n/catalogs'
import { DEFAULT_LOCALE, isLocale, pickLocale, type Locale } from '@shared/i18n'
import * as fmt from '@shared/format'

/**
 * The language the interface is drawn in.
 *
 * Initialised *synchronously* from localStorage, which matters: the boot gate
 * in App.tsx only sets `opacity-0`, so the tree renders before the main process
 * has answered. Waiting for that answer would paint the whole app in the wrong
 * language — or in no language — for a frame. The settings file stays the
 * source of truth and overwrites this as soon as it arrives; localStorage is
 * only a mirror kept for the next launch.
 */

const MIRROR_KEY = 'guitarlab.locale'

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(MIRROR_KEY)
    if (saved && isLocale(saved)) return saved
  } catch {
    // Private windows and cleared site data both land here.
  }
  return pickLocale(navigator.languages ?? [navigator.language ?? DEFAULT_LOCALE])
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: string) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (raw: string) => {
    const locale = isLocale(raw) ? raw : pickLocale([raw])
    try {
      localStorage.setItem(MIRROR_KEY, locale)
    } catch {
      // Not remembering is survivable: the main process tells us again next launch.
    }
    // Screen readers and the browser's own hyphenation both read this.
    document.documentElement.lang = locale
    set({ locale })
  }
}))

/** The current language. */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale)
}

/** The strings for the current language: `const s = useStrings()`. */
export function useStrings(): Catalog {
  return catalogFor(useLocaleStore((s) => s.locale))
}

/**
 * Formatters already bound to the current language, so screens do not have to
 * thread the locale through every call.
 */
export function useFormat(): {
  duration: (ms: number | null | undefined) => string
  seconds: (s: number) => string
  totalDuration: (ms: number) => string
  relative: (ts: number | null) => string
  date: (ts: number) => string
  dateTime: (ts: number) => string
  number: (value: number, digits?: number) => string
  percent: (value: number, digits?: number) => string
  bytes: (value: number) => string
} {
  const locale = useLocaleStore((s) => s.locale)
  const strings = catalogFor(locale)
  return {
    duration: (ms) => fmt.formatDuration(ms, strings.common.empty),
    seconds: (s) => fmt.formatSeconds(s),
    totalDuration: (ms) => fmt.formatTotalDuration(ms, strings.units),
    relative: (ts) => fmt.formatRelative(ts, locale, strings.common.never, strings.common.now),
    date: (ts) => fmt.formatDate(ts, locale),
    dateTime: (ts) => fmt.formatDateTime(ts, locale),
    number: (value, digits) => fmt.formatNumber(value, locale, digits),
    percent: (value, digits) => fmt.formatPercent(value, locale, digits),
    bytes: (value) => fmt.formatBytes(value, locale)
  }
}
