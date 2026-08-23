/**
 * The chord track: what the lab sends, what gets stored, what the screen draws.
 *
 * Run with: npm run test:chords
 *
 * The detection itself lives in the container (librosa + template matching +
 * Viterbi) and is exercised by running it. What is checked here is everything
 * around it: foreign JSON never reaches the database unvalidated, the reader
 * lands on the right chord at a given millisecond, and transposing moves the
 * root without touching the quality.
 */
import {
  transposeChord,
  spanAt,
  normalizeChordSpans,
  distinctChords,
  NO_CHORD
} from '../src/shared/chords'
import type { ChordSpan } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('=== 1. transposicao ===')
check('sobe meio tom', transposeChord('E', 1) === 'F', transposeChord('E', 1))
check('mantem a qualidade', transposeChord('Em7', 2) === 'F#m7', transposeChord('Em7', 2))
check('desce meio tom', transposeChord('C', -1) === 'B', transposeChord('C', -1))
check('da a volta na oitava', transposeChord('A', 12) === 'A', transposeChord('A', 12))
check('volta pra baixo dando a volta', transposeChord('C', -13) === 'B', transposeChord('C', -13))
check('bemol vira sustenido', transposeChord('Bb', 0) === 'Bb' && transposeChord('Bb', 1) === 'B')
check('silencio nao transpoe', transposeChord(NO_CHORD, 5) === NO_CHORD)
check('zero semitons nao mexe', transposeChord('F#m7', 0) === 'F#m7')
check('rotulo estranho volta inteiro', transposeChord('???', 3) === '???')
// Drop C# is a whole step and a half below standard — the case the user lives in
check('Drop C#: Em vira C#m', transposeChord('Em', -3) === 'C#m', transposeChord('Em', -3))

console.log('\n=== 2. qual acorde esta tocando ===')
const spans: ChordSpan[] = [
  { startMs: 0, endMs: 2000, label: 'Em', confidence: 0.9 },
  { startMs: 2000, endMs: 4000, label: 'C', confidence: 0.8 },
  { startMs: 4000, endMs: 6000, label: NO_CHORD, confidence: 0 }
]
check('no comeco do bloco', spanAt(spans, 0) === 0)
check('no meio do bloco', spanAt(spans, 1999) === 0)
check('a fronteira pertence ao proximo', spanAt(spans, 2000) === 1)
check('depois do fim nao acha nada', spanAt(spans, 99_999) === -1)
check('antes do inicio nao acha nada', spanAt([{ ...spans[0], startMs: 500 }], 0) === -1)

console.log('\n=== 3. o que vem do container e validado ===')
const raw = [
  { label: 'Em', startMs: 2000, endMs: 4000, confidence: 0.91 },
  { label: 'A', startMs: 0, endMs: 2000, confidence: 1.7 },
  { label: 'C', startMs: 5000, endMs: 5000, confidence: 0.5 },
  { label: '', startMs: 6000, endMs: 7000, confidence: 0.5 },
  { startMs: 8000, endMs: 9000, confidence: 0.5 },
  { label: 'G', startMs: 'x', endMs: 9000, confidence: 0.5 },
  null,
  'nada disso'
]
const clean = normalizeChordSpans(raw)
check('so os blocos validos passam', clean.length === 2, `${clean.length}`)
check('ficam ordenados no tempo', clean[0].startMs === 0 && clean[1].startMs === 2000)
check('confianca fica entre 0 e 1', clean[0].confidence === 1, `${clean[0].confidence}`)
check('bloco de duracao zero cai fora', !clean.some((s) => s.label === 'C'))
check('bloco sem rotulo cai fora', !clean.some((s) => !s.label))
check('tempo nao numerico cai fora', !clean.some((s) => s.label === 'G'))
check('entrada que nao e lista vira vazio', normalizeChordSpans('nada').length === 0)

console.log('\n=== 4. vocabulario da musica ===')
const vocab = distinctChords(
  [
    { startMs: 0, endMs: 1, label: 'Em', confidence: 1 },
    { startMs: 1, endMs: 2, label: 'C', confidence: 1 },
    { startMs: 2, endMs: 3, label: 'Em', confidence: 1 },
    { startMs: 3, endMs: 4, label: NO_CHORD, confidence: 0 }
  ],
  0
)
check('sem repetir', vocab.length === 2, vocab.join(' '))
check('na ordem em que aparecem', vocab[0] === 'Em' && vocab[1] === 'C', vocab.join(' '))
check('silencio nao entra no vocabulario', !vocab.includes(NO_CHORD))
check(
  'transpoe o vocabulario junto',
  distinctChords([{ startMs: 0, endMs: 1, label: 'Em', confidence: 1 }], 2)[0] === 'F#m'
)

console.log('\n=== 5. ida e volta pelo banco (JSON) ===')
const stored = {
  key: 'Em',
  bpm: 172.3,
  confidence: 0.82,
  source: 'analysis' as const,
  beatsMs: [0, 348, 697],
  spans: clean
}
const roundTrip = JSON.parse(JSON.stringify(stored)) as typeof stored
check('sobrevive ao JSON', roundTrip.spans.length === clean.length && roundTrip.key === 'Em')
check('as batidas sobrevivem', roundTrip.beatsMs.length === 3)
check(
  'os blocos continuam validos depois da volta',
  normalizeChordSpans(roundTrip.spans).length === clean.length
)

console.log(`\n${failures === 0 ? 'ACORDES OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
