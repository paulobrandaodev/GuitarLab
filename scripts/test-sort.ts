/**
 * How the setlist and the library are ordered.
 *
 * Run with: npm run test:sort
 *
 * The rule worth a test is the tuning one: E standard is not sorted, it is
 * pinned. Every song the guitar can play without touching a peg belongs at the
 * top whichever way the arrow points, and only what is left flips between A–Z
 * and Z–A. The rest of the file guards the boring half — that an empty field
 * sorts last instead of first, and that `ordem` never touches the show order.
 */
import { compareSongs, sortSongs, type SortableSong } from '../src/shared/sort'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const song = (
  title: string,
  artist: string | null,
  tuning: string | null,
  durationMs: number | null
): SortableSong => ({
  title,
  artist,
  durationMs,
  tuning: tuning ? { name: tuning } : null
})

const library: SortableSong[] = [
  song('Seek & Destroy', 'Metallica', 'E Standard', 419_000),
  song('Nothing Else Matters', 'Metallica', 'E Standard', 388_000),
  song('Aerials', 'System of a Down', 'Drop C', 235_000),
  song('Bulls on Parade', 'Rage Against the Machine', 'Drop D', 230_000),
  song('Zombie', 'The Cranberries', null, 307_000),
  song('Ainda é Cedo', 'Legião Urbana', 'Eb Standard', null)
]

const titles = (list: SortableSong[]): string[] => list.map((s) => s.title)

console.log('=== 1. por musica ===')
const byTitle = sortSongs(library, (s) => s, 'musica', 'asc')
check('A-Z', byTitle[0].title === 'Aerials', titles(byTitle).join(' | '))
check('acento nao muda o lugar', byTitle[1].title === 'Ainda é Cedo', titles(byTitle).join(' | '))
check('Z-A inverte', sortSongs(library, (s) => s, 'musica', 'desc')[0].title === 'Zombie')

console.log('\n=== 2. por banda ===')
const byBand = sortSongs(library, (s) => s, 'banda', 'asc')
check('A-Z pela banda', byBand[0].artist === 'Legião Urbana', titles(byBand).join(' | '))
check(
  'mesma banda desempata pelo titulo',
  byBand[1].title === 'Nothing Else Matters' && byBand[2].title === 'Seek & Destroy',
  titles(byBand).join(' | ')
)
check(
  'sem banda vai para o fim mesmo invertendo',
  sortSongs([song('a', null, null, 1), song('b', 'Zz', null, 1)], (s) => s, 'banda', 'desc')[1]
    .artist === null
)

console.log('\n=== 3. por afinacao ===')
const byTuning = sortSongs(library, (s) => s, 'afinacao', 'asc')
check('E Standard no topo', byTuning[0].tuning?.name === 'E Standard', titles(byTuning).join(' | '))
check(
  'as duas em E Standard ficam juntas',
  byTuning[1].tuning?.name === 'E Standard',
  titles(byTuning).join(' | ')
)
check('depois vem o resto em A-Z', byTuning[2].tuning?.name === 'Drop C', titles(byTuning).join(' | '))
check('sem afinacao por ultimo', byTuning[byTuning.length - 1].tuning === null)

const byTuningDesc = sortSongs(library, (s) => s, 'afinacao', 'desc')
check(
  'E Standard continua no topo invertido',
  byTuningDesc[0].tuning?.name === 'E Standard' && byTuningDesc[1].tuning?.name === 'E Standard',
  byTuningDesc.map((s) => s.tuning?.name ?? '—').join(' | ')
)
check(
  'o resto inverte para Z-A',
  byTuningDesc[2].tuning?.name === 'Eb Standard',
  byTuningDesc.map((s) => s.tuning?.name ?? '—').join(' | ')
)
check(
  'sem afinacao segue por ultimo invertido',
  byTuningDesc[byTuningDesc.length - 1].tuning === null
)
check(
  'as variantes de E Standard tambem sobem',
  sortSongs(
    [song('a', null, 'Drop D', 1), song('b', null, 'E Standard (7)', 1)],
    (s) => s,
    'afinacao',
    'asc'
  )[0].tuning?.name === 'E Standard (7)'
)
check(
  'E Standard puro vem antes das variantes',
  sortSongs(
    [song('a', null, 'E Standard (baixo 4)', 1), song('b', null, 'E Standard', 1)],
    (s) => s,
    'afinacao',
    'desc'
  )[0].tuning?.name === 'E Standard'
)

console.log('\n=== 4. por duracao ===')
const short = sortSongs(library, (s) => s, 'duracao', 'asc')
check('menor primeiro', short[0].durationMs === 230_000, `${short[0].durationMs}`)
check('sem duracao por ultimo', short[short.length - 1].durationMs === null)
const long = sortSongs(library, (s) => s, 'duracao', 'desc')
check('maior primeiro', long[0].durationMs === 419_000, `${long[0].durationMs}`)
check('sem duracao segue por ultimo', long[long.length - 1].durationMs === null)

console.log('\n=== 5. ordem do show ===')
const untouched = sortSongs(library, (s) => s, 'ordem', 'desc')
check('devolve a mesma lista', untouched === library)
check('nao compara nada', compareSongs(library[0], library[1], 'ordem', 'asc') === 0)

console.log('\n=== 6. desempate e estabilidade ===')
const sameLength = [song('c', 'X', 'Drop D', 1), song('a', 'X', 'Drop D', 1), song('b', 'X', 'Drop D', 1)]
check(
  'duracao igual desempata pelo titulo',
  titles(sortSongs(sameLength, (s) => s, 'duracao', 'asc')).join('') === 'abc',
  titles(sortSongs(sameLength, (s) => s, 'duracao', 'asc')).join('')
)
check('nao muda a lista original', titles(sameLength).join('') === 'cab')

// nothing left to compare: the entry order is all that decides
const identical = [song('x', 'C', 'Drop D', 1), song('x', 'A', 'Drop D', 1), song('x', 'B', 'Drop D', 1)]
check(
  'empate total mantem a ordem de entrada',
  sortSongs(identical, (s) => s, 'duracao', 'asc')
    .map((s) => s.artist)
    .join('') === 'CAB',
  sortSongs(identical, (s) => s, 'duracao', 'asc')
    .map((s) => s.artist)
    .join('')
)

console.log('\n=== 7. sobre os itens do setlist ===')
const items = library.map((s, i) => ({ itemId: i + 1, song: s }))
const sortedItems = sortSongs(items, (i) => i.song, 'duracao', 'asc')
check('funciona sobre o item, lendo a musica de dentro', sortedItems[0].song.durationMs === 230_000)
check(
  'o itemId original vem junto',
  sortedItems[0].itemId === items.find((i) => i.song.durationMs === 230_000)!.itemId
)

console.log(`\n${failures === 0 ? 'ORDENACAO OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
