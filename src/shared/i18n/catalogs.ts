import type { Catalog } from './catalog'
import { ptBR } from './pt-BR'
import { en } from './en'
import { es } from './es'
import type { Locale } from './index'

/**
 * Every catalogue, by locale.
 *
 * All three are bundled rather than loaded on demand: three languages of
 * strings is well under a hundred kilobytes, which does not pay for the
 * complexity of an async loader or for the flash of untranslated interface
 * while one arrives.
 */
export const CATALOGS: Record<Locale, Catalog> = {
  en,
  'pt-BR': ptBR,
  es
}

export function catalogFor(locale: Locale): Catalog {
  return CATALOGS[locale] ?? en
}

export type { Catalog }
