import { currentLocale } from './settings'
import { catalogFor, type Catalog } from '@shared/i18n/catalogs'
import { isLocale, type Locale } from '@shared/i18n'

/**
 * The main process's view of the current language.
 *
 * Only strings that reach the interface are translated here. Console logs stay
 * in English permanently and on purpose: they are read by whoever is debugging,
 * and a stack trace in Portuguese pasted into an issue on an international
 * repository helps nobody. That distinction removes more than half of the
 * strings in this process from the translation surface.
 */

export function mainLocale(): Locale {
  const raw = currentLocale()
  return isLocale(raw) ? raw : 'en'
}

/** The catalogue for the language in force right now. */
export function mt(): Catalog {
  return catalogFor(mainLocale())
}
