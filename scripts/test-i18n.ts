/**
 * What the type system cannot check about the string catalogues.
 *
 * Run with: npm run test:i18n
 *
 * `npm run typecheck` already guarantees the three catalogues have the same
 * shape — `en.ts` and `es.ts` are declared `: Catalog`, so a missing key, a
 * spare one, or a function whose arguments drifted is a compile error. That
 * covers most of what a translation library's tooling would.
 *
 * What it cannot see is whether the words are right, and two failures matter:
 *
 * 1. A translator drops the `${n}` out of an interpolated string. It still
 *    compiles, still returns a string, and silently shows "songs" where it
 *    should say "12 songs". This is the most common i18n bug there is and the
 *    only one no type can catch, so it is checked with sentinel arguments.
 * 2. Someone adds Portuguese straight into a .tsx file. Nothing breaks, and the
 *    interface slowly stops being translatable. A baseline count that may only
 *    go down turns that into a failing test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGS } from '../src/shared/i18n/catalogs'
import { LOCALES, pickLocale, plural, isLocale } from '../src/shared/i18n'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

type Node = Record<string, unknown>

/** Walk a catalogue, yielding every leaf with its dotted path. */
function* leaves(node: Node, path = ''): Generator<[string, unknown]> {
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key
    if (value && typeof value === 'object') yield* leaves(value as Node, here)
    else yield [here, value]
  }
}

console.log('\n=== 1. seleção de idioma ===')
check('exato', pickLocale(['pt-BR']) === 'pt-BR')
check('por subtag: pt-PT cai em pt-BR', pickLocale(['pt-PT']) === 'pt-BR')
check('por subtag: es-MX cai em es', pickLocale(['es-MX']) === 'es')
check('underscore também', pickLocale(['pt_BR']) === 'pt-BR')
check('respeita a ordem de preferência', pickLocale(['de', 'es', 'en']) === 'es')
check('desconhecido cai em inglês', pickLocale(['de', 'fr']) === 'en')
check('lista vazia cai em inglês', pickLocale([]) === 'en')
check('isLocale rejeita lixo', !isLocale('klingon') && isLocale('es'))

console.log('\n=== 2. plural ===')
check('singular', plural(1, 'música', 'músicas') === 'música')
check('zero é plural', plural(0, 'música', 'músicas') === 'músicas')
check('plural', plural(7, 'música', 'músicas') === 'músicas')

console.log('\n=== 3. Intl está presente nesta build ===')
// A small-icu build silently falls back to English and produces confusing
// downstream failures, so it is worth catching here.
for (const locale of LOCALES) {
  const ok =
    new Intl.NumberFormat(locale).resolvedOptions().locale.startsWith(locale.split('-')[0]) &&
    typeof Intl.RelativeTimeFormat === 'function' &&
    typeof Intl.PluralRules === 'function'
  check(`Intl completo para ${locale}`, ok)
}

console.log('\n=== 4. nenhum valor vazio ===')
for (const locale of LOCALES) {
  const empty: string[] = []
  for (const [path, value] of leaves(CATALOGS[locale] as unknown as Node)) {
    if (typeof value === 'string' && !value.trim()) empty.push(path)
  }
  check(`${locale} sem string vazia`, empty.length === 0, empty.join(', '))
}

console.log('\n=== 5. traduções que ficaram idênticas ao português ===')
/*
 * Same word in two languages is usually a forgotten translation. These are the
 * cases where it is correct: proper nouns, YouTube jargon, units and symbols.
 */
const SAME_ON_PURPOSE = new Set([
  'common.empty',
  'common.no',
  'units.hour',
  'units.minute',
  'units.bpm',
  'nav.setlist',
  'nav.settings',
  'nav.tuner',
  'labels.role.lesson_tabs',
  'labels.role.backing_track',
  'labels.role.guitar_only',
  'labels.role.bass_only',
  'labels.role.drums_only',
  'labels.role.cover',
  'labels.role.official',
  'labels.sort.banda',
  'labels.sortDir.banda.asc',
  'labels.sortDir.banda.desc',
  'labels.sortDir.musica.asc',
  'labels.sortDir.musica.desc',
  'settings.title',
  'settings.groupSpotify',
  'settings.groupYoutube',
  'settings.groupFfmpeg',
  'settings.connect',
  'settings.folderGuitarPro',
  'settings.folderStems',
  'settings.fields.spotifyClientId',
  'settings.fields.spotifyRedirectUri',
  'settings.fields.geminiModel',
  'settings.fields.openaiModel',
  'settings.fields.groqModel',
  'settings.fields.ollamaModel',
  'settings.fields.demucsSegment',
  'setup.openSettings',
  'setlist.import',
  'common.cancel',
  'common.confirm',
  'common.edit',
  'common.search',
  'common.open',
  'nav.progress',
  'labels.instrument.guitar',
  'settings.groupLab',
  'settings.disconnect',

  /*
   * Field labels in the "add by hand" form. Checked one by one: these are the
   * words Portuguese and Spanish spell the same, and "BPM" is a unit in every
   * language including English. Everything else in that form is translated.
   */
  'manual.band',
  'manual.artist',
  'manual.songTitle',
  'manual.album',
  'manual.bpm',
  'manual.fewerFields',

  /*
   * Portuguese and Spanish genuinely share these words. Checked one by one —
   * add to this list only after confirming the word really is identical in
   * both, not after assuming it.
   */
  'common.never',
  'common.show',
  'common.hide',
  'labels.instrument.vocals',
  'labels.output.amp',
  'settings.fallback',
  'settings.language',
  'settings.disconnected',
  'settings.connected',
  'setlist.library',

  /* Platform names. Nobody translates "Ko-fi". */
  'support.sponsor',
  'support.kofi'
])

const pt = Object.fromEntries(leaves(CATALOGS['pt-BR'] as unknown as Node))
for (const locale of LOCALES.filter((l) => l !== 'pt-BR')) {
  const same: string[] = []
  for (const [path, value] of leaves(CATALOGS[locale] as unknown as Node)) {
    if (typeof value !== 'string' || SAME_ON_PURPOSE.has(path)) continue
    if (value === pt[path]) same.push(path)
  }
  check(
    `${locale}: nada esquecido em português`,
    same.length === 0,
    same.join(', ')
  )
}

console.log('\n=== 6. interpolação não se perde na tradução ===')
/*
 * The check that earns this file's existence. Every function entry is called
 * with sentinel arguments in every language; if a sentinel is missing from the
 * output, that language dropped a placeholder.
 */
const SENTINELS: unknown[] = ['__P0__', -987654, '__P2__', -987655]

for (const locale of LOCALES) {
  const lost: string[] = []
  for (const [path, value] of leaves(CATALOGS[locale] as unknown as Node)) {
    if (typeof value !== 'function') continue
    const fn = value as (...args: unknown[]) => string
    const args = SENTINELS.slice(0, fn.length)
    let out: string
    try {
      out = fn(...args)
    } catch (err) {
      lost.push(`${path} (lançou: ${err instanceof Error ? err.message : err})`)
      continue
    }
    for (const arg of args) {
      if (!out.includes(String(arg))) {
        lost.push(`${path} perdeu ${String(arg)}`)
      }
    }
  }
  check(`${locale}: toda interpolação chega na saída`, lost.length === 0, lost.join('; '))
}

console.log('\n=== 7. shared/ continua puro ===')
/*
 * shared/ is imported by both processes. Reaching for `window` breaks the main
 * process and reaching for `node:` breaks the renderer, in both cases only at
 * runtime and only on the path that touches it.
 */
/** Comments may name these APIs while explaining why they are absent. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const FORBIDDEN = /\bdocument\.|\bwindow\.|\bnavigator\.|from 'electron'|from "electron"|from 'node:|from "node:/
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const impure = walk('src/shared')
  .filter((f) => f.endsWith('.ts'))
  .filter((f) => FORBIDDEN.test(stripComments(readFileSync(f, 'utf8'))))
check('sem electron, node: nem DOM em shared/', impure.length === 0, impure.join(', '))

console.log('\n=== 8. português cru na interface ===')
/*
 * A baseline, not a clean bill of health. Most screens have not been migrated
 * to the catalogue yet, so this counts what is left and refuses to let the
 * number grow — which is what stops the interface from quietly drifting back
 * out of being translatable. Lower it as screens are migrated; when it reaches
 * zero, turn this into a hard failure.
 */
/*
 * This is a ratchet, not a census. The detector below is deliberately
 * conservative — plain JSX text nodes and double-quoted attributes, and only
 * where an accent or a common Portuguese word gives it away — so the real
 * number of untranslated strings is several times higher. What it is good for
 * is refusing to grow: a screen migrated to the catalogue lowers it, and
 * Portuguese typed straight into a .tsx raises it and fails the build.
 * Lower this number as screens are migrated. When it reaches zero, replace the
 * detector with a proper AST pass and make it a hard failure.
 */
const BASELINE = 70

const PT_HINT =
  /[áàâãéêíóôõúüç]|\b(não|você|música|pasta|nenhum|nenhuma|arquivo|trecho|ainda|agora|salvo|falha|erro)\b/i

let raw = 0
const worst: Array<[string, number]> = []
for (const file of walk('src/renderer/src').filter((f) => f.endsWith('.tsx'))) {
  const text = readFileSync(file, 'utf8')
  let hits = 0
  // JSX text nodes, plus the attributes that hold user-facing text
  for (const m of text.matchAll(/>([^<>{}\n]{3,})</g)) {
    if (PT_HINT.test(m[1])) hits++
  }
  for (const m of text.matchAll(/(?:title|placeholder|aria-label|label|description)="([^"]{3,})"/g)) {
    if (PT_HINT.test(m[1])) hits++
  }
  if (hits) {
    raw += hits
    worst.push([file.replace(/\\/g, '/').replace('src/renderer/src/', ''), hits])
  }
}

worst.sort((a, b) => b[1] - a[1])
console.log(`  português cru restante: ${raw} (limite: ${BASELINE})`)
for (const [file, n] of worst.slice(0, 8)) console.log(`    ${n.toString().padStart(3)}  ${file}`)
check(
  'o total não cresceu',
  raw <= BASELINE,
  raw > BASELINE ? `subiu para ${raw}; migre as strings novas para o catálogo` : ''
)
if (raw < BASELINE - 40) {
  console.log(`  (dá para baixar o BASELINE para ${raw} neste arquivo)`)
}

console.log(`\n${failures === 0 ? 'I18N OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
