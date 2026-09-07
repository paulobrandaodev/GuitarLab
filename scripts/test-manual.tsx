/**
 * The two "add it by hand" dialogs, as the screen renders them.
 *
 * Run with: npm run test:manual
 *
 * Rendered with react-dom/server, so this checks the real components rather
 * than a description of them. What it guards is the promise the feature makes:
 * a setlist needs a name and a song needs a title and an artist, and *nothing
 * else is in the way* — every other field can be left empty, and the ones that
 * are not the two required ones are folded out of sight until asked for.
 *
 * The database side of the same promise — optional columns staying null,
 * required ones being refused — is in `npm run test:setlist`.
 */
// tsx transpiles JSX in classic mode here, so React has to be in scope
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/*
 * `lib/api` reads `window.api` at import time and the locale store reads
 * `navigator` — both are the renderer's world, so they are stubbed before the
 * components are pulled in. Nothing here is called: `useEffect` does not run
 * under server rendering.
 */
const globals = globalThis as Record<string, unknown>
globals.window = { api: { songs: { tunings: async () => [] } } }
// Node ships a read-only `navigator` of its own, so this one has to be defined over it
Object.defineProperty(globalThis, 'navigator', {
  value: { languages: ['pt-BR'], language: 'pt-BR' },
  configurable: true
})

const { NewSetlistDialog, NewSongDialog } = await import(
  '../src/renderer/src/features/setlist/SetlistDialogs'
)
const { ptBR } = await import('../src/shared/i18n/pt-BR')

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const str = ptBR.manual
/** How a required field is marked: the label ends in "· obrigatório". */
const MARK = new RegExp(`· ${str.required}`, 'g')

/** The visible text, the way a reader sees it. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The create button, which is the last disabled-able one in either dialog. */
function createButtonDisabled(html: string): boolean {
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []
  const create = buttons.filter((b) => text(b) === str.create)
  if (create.length !== 1) throw new Error(`found ${create.length} create buttons`)
  return / disabled(=""|[ >])/.test(create[0])
}

console.log('=== 1. novo setlist ===')
const setlist = renderToStaticMarkup(
  <NewSetlistDialog bands={['Cover Metallica']} onCreate={async () => {}} onClose={() => {}} />
)
const setlistText = text(setlist)

check('o botão de criar nasce travado', createButtonDisabled(setlist))
check(
  'o nome é o único campo marcado como obrigatório',
  (setlistText.match(MARK) ?? []).length === 1,
  setlistText.match(new RegExp(`\\S+ · ${str.required}`, 'g'))?.join(', ')
)
check(
  'e o campo marcado é mesmo o nome',
  setlistText.includes(`${str.setlistName} · ${str.required}`)
)
for (const [label, field] of [
  ['banda', str.band],
  ['data', str.eventDate],
  ['local', str.venue],
  ['anotações', str.notes]
] as const) {
  check(`${label} aparece sem exigir preenchimento`, setlistText.includes(field))
}
check('as bandas que já existem viram atalho', setlistText.includes('Cover Metallica'))
check('o texto explica o que é obrigatório', setlistText.includes(str.setlistHint))
check(
  'nenhum input do navegador exige valor',
  !/ required(=""|[ >])/.test(setlist),
  'o HTML não deve trazer required='
)

console.log('\n=== 2. nova música ===')
const song = renderToStaticMarkup(
  <NewSongDialog
    setlists={[
      {
        id: 7,
        name: 'Show do Sesc',
        band: 'Cover Metallica',
        spotifyPlaylistId: null,
        eventDate: null,
        venue: null,
        notes: null,
        targetReadyDate: null,
        isActive: true,
        songCount: 3,
        totalDurationMs: 0,
        readiness: 0
      }
    ]}
    defaultSetlistId={7}
    onCreated={() => {}}
    onOpenSong={() => {}}
    onClose={() => {}}
  />
)
const songText = text(song)

check('o botão de criar nasce travado', createButtonDisabled(song))
check(
  'só dois campos são obrigatórios',
  (songText.match(MARK) ?? []).length === 2,
  songText.match(new RegExp(`\\S+ · ${str.required}`, 'g'))?.join(', ')
)
check(
  'e são o título e o artista',
  songText.includes(`${str.songTitle} · ${str.required}`) &&
    songText.includes(`${str.artist} · ${str.required}`)
)
check(
  'o resto começa escondido, atrás de "mais campos"',
  songText.includes(str.moreFields) &&
    !songText.includes(str.album) &&
    !songText.includes(str.bpm) &&
    !songText.includes(str.capo),
  songText.slice(0, 120)
)
check('dá para já mandar a música para um setlist', songText.includes(str.addTo))
check('e dá para deixá-la só na biblioteca', songText.includes(str.onlyLibrary))
check('o setlist ativo já vem escolhido', song.includes('value="7"'))
check('o texto explica o que é obrigatório', songText.includes(str.songHint))
check(
  'nenhum input do navegador exige valor',
  !/ required(=""|[ >])/.test(song),
  'o HTML não deve trazer required='
)
check(
  'nada de aviso de repetida antes de haver o que repetir',
  !songText.includes(str.duplicateAnyway)
)

console.log(`\n${failures === 0 ? 'CRIACAO MANUAL OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
