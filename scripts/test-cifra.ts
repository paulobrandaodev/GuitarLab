/**
 * Turning the two analyses into a chart: chords + synced lyrics = cifra.
 *
 * Run with: npm run test:cifra
 *
 * The chord detector answers one block per beat and the LRC answers one line per
 * phrase; everything interesting happens where the two clocks meet. What is
 * checked here is that a chord never lands in the middle of a word, that a bar of
 * the same chord is written once and not four times, and that a song with no
 * timestamps still produces something honest instead of a lie.
 */
import { buildChordPro, placeChordsOnLine, wordStarts, cifraReadiness } from '../src/shared/cifra'
import { mergeChordSpans, NO_CHORD } from '../src/shared/chords'
import type { ChordSpan } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const span = (startMs: number, endMs: number, label: string, confidence = 0.9): ChordSpan => ({
  startMs,
  endMs,
  label,
  confidence
})

console.log('=== 1. juntar repeticoes ===')
const perBeat = [
  span(0, 500, 'Em'),
  span(500, 1000, 'Em'),
  span(1000, 1500, 'Em'),
  span(1500, 2000, 'C'),
  span(2000, 2500, 'C')
]
const merged = mergeChordSpans(perBeat)
check('um compasso de Em vira um bloco', merged.length === 2, `${merged.length}`)
check('o bloco cobre o tempo todo', merged[0].startMs === 0 && merged[0].endMs === 1500)
check('o proximo acorde continua separado', merged[1].label === 'C')
check('nao mexe no original', perBeat.length === 5)

const withSilence = [span(0, 500, 'Em'), span(500, 1000, NO_CHORD, 0), span(1000, 1500, 'Em')]
check('por padrao o silencio separa', mergeChordSpans(withSilence).length === 3)
check(
  'com dropSilence o Em volta a ser um so',
  mergeChordSpans(withSilence, { dropSilence: true }).length === 1
)
check(
  'a confianca e ponderada pela duracao',
  Math.abs(
    mergeChordSpans([span(0, 1000, 'A', 1), span(1000, 2000, 'A', 0)])[0].confidence - 0.5
  ) < 1e-9
)

console.log('\n=== 2. onde o acorde pode cair ===')
check('inicio de cada palavra', wordStarts('one two three').join(',') === '0,4,8')
check('espacos no comeco nao contam', wordStarts('  hi there').join(',') === '2,5')
check('linha vazia ainda tem a coluna zero', wordStarts('').join(',') === '0')

const line = placeChordsOnLine('walking down the street', [
  { label: 'Em', ratio: 0 },
  { label: 'C', ratio: 0.55 }
])
check('o primeiro acorde abre a linha', line.startsWith('[Em]walking'), line)
check('o segundo cai num comeco de palavra', /\s\[C\]\w/.test(line), line)
check('a letra sobrevive inteira', line.replace(/\[[^\]]+\]/g, '') === 'walking down the street')
check(
  'dois acordes nunca dividem a mesma coluna',
  (() => {
    const out = placeChordsOnLine('a b', [
      { label: 'C', ratio: 0 },
      { label: 'D', ratio: 0 },
      { label: 'E', ratio: 0 }
    ])
    // three chords, two words: the leftover rides at the end instead of stacking
    return out.replace(/\[[^\]]+\]/g, '') === 'a b' && /\[C\]a\s\[D\]b\[E\]|\[C\]a \[D\]b\[E\]/.test(out)
  })(),
  placeChordsOnLine('a b', [
    { label: 'C', ratio: 0 },
    { label: 'D', ratio: 0 },
    { label: 'E', ratio: 0 }
  ])
)

console.log('\n=== 3. cifra com letra sincronizada ===')
const spans = [
  span(0, 2000, 'Em'),
  span(2000, 4000, 'Em'),
  span(4000, 6000, 'C'),
  span(6000, 8000, 'G'),
  span(8000, 10_000, 'D'),
  span(30_000, 32_000, 'B')
]
const chart = buildChordPro({
  title: 'Seek and Destroy',
  artist: 'Metallica',
  musicalKey: 'Em',
  bpm: 172,
  spans,
  lines: [
    { timeMs: 4000, text: 'we are scanning the scene' },
    { timeMs: 8000, text: 'in the city tonight' }
  ],
  sections: [{ name: 'Verso 1', startMs: 4000 }]
})!
check('sai alguma coisa', typeof chart === 'string' && chart.length > 0)
check('cabecalho com titulo', chart.includes('{title: Seek and Destroy}'))
check('cabecalho com artista', chart.includes('{artist: Metallica}'))
check('cabecalho com tom', chart.includes('{key: Em}'))
check('cabecalho com andamento', chart.includes('{tempo: 172}'))
check('a secao vira cabecalho', chart.includes('{comment: Verso 1}'))
check('o que vem antes da letra vira intro', chart.includes('{comment: intro}'))
check('o Em repetido aparece uma vez na intro', (chart.match(/\[Em\]/g) ?? []).length === 1, chart)
check('a primeira linha comeca com o acorde dela', chart.includes('[C]we are'), chart)
check('o acorde que troca no meio da linha entra nela', chart.includes('[G]the scene'), chart)
check('a segunda linha comeca com o acorde dela', chart.includes('[D]in the'), chart)
check(
  'o acorde que sobra depois da letra vira final',
  chart.includes('{comment: final}') && chart.includes('[B]'),
  chart
)
check(
  'todas as palavras da letra sobrevivem',
  chart.includes('we are scanning the scene') || chart.replace(/\[[^\]]+\]/g, '').includes('we are scanning the scene'),
  chart
)

console.log('\n=== 4. trecho instrumental no meio ===')
const withBreak = buildChordPro({
  title: 'x',
  spans: [span(0, 1000, 'A'), span(20_000, 21_000, 'B'), span(30_000, 31_000, 'C')],
  lines: [
    { timeMs: 0, text: 'primeira' },
    { timeMs: 30_000, text: 'segunda' }
  ]
})!
check('o buraco longo vira instrumental', withBreak.includes('{comment: instrumental}'), withBreak)
check('o acorde do buraco fica no bloco', withBreak.includes('[B]'))

console.log('\n=== 5. sem letra sincronizada ===')
const grid = buildChordPro({
  title: 'x',
  // nine chords, so the grid breaks into a second line carrying its own clock mark
  spans: [
    ...Array.from({ length: 8 }, (_, i) => span(i * 1000, i * 1000 + 1000, i % 2 ? 'A' : 'D')),
    span(65_000, 66_000, 'B')
  ],
  plainLyrics: 'linha um\nlinha dois'
})!
check('explica que a letra nao tem tempo', grid.includes('marcação de tempo'), grid)
check('grade com o relogio na margem', grid.includes('{comment: 0:00}'))
check('o relogio acompanha os minutos', grid.includes('{comment: 1:05}'), grid)
check('a letra vai junto', grid.includes('linha um') && grid.includes('{comment: letra}'))
check(
  'sem letra nenhuma ainda sai a grade',
  buildChordPro({ title: 'x', spans: [span(0, 1000, 'A')] })!.includes('[A]')
)
check('sem acorde nenhum nao sai nada', buildChordPro({ title: 'x', spans: [] }) === null)
check(
  'so silencio tambem nao sai nada',
  buildChordPro({ title: 'x', spans: [span(0, 1000, NO_CHORD, 0)] }) === null
)

console.log('\n=== 6. transposicao da cifra inteira ===')
const dropped = buildChordPro({
  title: 'x',
  musicalKey: 'Em',
  spans: [span(0, 1000, 'Em'), span(1000, 2000, 'A7')],
  semitones: -3
})!
check('o tom do cabecalho desce junto', dropped.includes('{key: C#m}'), dropped)
check('os acordes descem', dropped.includes('[C#m]') && dropped.includes('[F#7]'), dropped)

console.log('\n=== 7. o que a tela mostra antes de gerar ===')
check(
  'sem nada, pede os dois',
  !cifraReadiness({ hasChords: false, hasLyrics: false, syncedLyrics: false }).ready
)
check(
  'so com letra, pede os acordes',
  cifraReadiness({ hasChords: false, hasLyrics: true, syncedLyrics: true }).reason.includes(
    'acordes'
  )
)
check(
  'so com acordes, pede a letra',
  cifraReadiness({ hasChords: true, hasLyrics: false, syncedLyrics: false }).reason.includes('LRCLIB')
)
check(
  'letra sem sincronia ainda deixa gerar',
  cifraReadiness({ hasChords: true, hasLyrics: true, syncedLyrics: false }).ready
)
check(
  'com tudo, deixa gerar',
  cifraReadiness({ hasChords: true, hasLyrics: true, syncedLyrics: true }).ready
)

console.log(`\n${failures === 0 ? 'CIFRA OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
