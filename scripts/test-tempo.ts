/**
 * The clock behind the stem player: beat grid, snapping and the looping playhead.
 *
 * Run with: npm run test:tempo
 *
 * What is guarded here is the arithmetic nobody can eyeball. A metronome that is
 * two frames late every lap sounds fine for thirty seconds and a beat off after
 * five minutes, and an A/B loop that recomputes its position from "now" instead
 * of from the instant it actually wrapped drifts exactly like that. Playback
 * itself lives in the browser and is covered by test:media.
 */
import {
  parseBeatsPerBar,
  buildBeatGrid,
  nextBeatIndex,
  snapToBeat,
  resolvePosition,
  ctxTimeAt
} from '../src/shared/tempo'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance

console.log('=== 1. formula de compasso ===')
check('4/4 da quatro', parseBeatsPerBar('4/4') === 4)
check('3/4 da tres', parseBeatsPerBar('3/4') === 3)
check('7/8 da sete', parseBeatsPerBar('7/8') === 7)
check('espacos nao atrapalham', parseBeatsPerBar(' 6 / 8 ') === 6)
check('nulo cai em 4/4', parseBeatsPerBar(null) === 4)
check('lixo cai em 4/4', parseBeatsPerBar('quatro por quatro') === 4)
check('absurdo cai em 4/4', parseBeatsPerBar('99/4') === 4)

console.log('\n=== 2. grade a partir do bpm ===')
const flat = buildBeatGrid({ bpm: 120, durationS: 10, timeSignature: '4/4' })
check('a grade existe', flat !== null)
check('120 bpm da meio segundo por batida', near(flat!.times[1] - flat!.times[0], 0.5))
check('comeca no zero', flat!.times[0] === 0)
check('cobre a duracao inteira', flat!.times[flat!.times.length - 1] < 10)
check('vinte batidas em dez segundos', flat!.times.length === 20, `${flat!.times.length}`)
check('marcada como grade de bpm', flat!.source === 'bpm')
check('sem bpm nao ha grade', buildBeatGrid({ bpm: null, durationS: 10 }) === null)
check('sem duracao nao ha grade', buildBeatGrid({ bpm: 120, durationS: 0 }) === null)
check('bpm zero nao ha grade', buildBeatGrid({ bpm: 0, durationS: 10 }) === null)

console.log('\n=== 3. grade a partir das batidas do laboratorio ===')
// beats that drift on purpose: a real recording is not a metronome
const detected = buildBeatGrid({
  bpm: 120,
  durationS: 12,
  beatsMs: [0, 480, 1000, 1500, 2020, 2500],
  timeSignature: '4/4'
})
check('usa as batidas detectadas', detected!.source === 'analysis')
check('mantem as batidas originais', near(detected!.times[1], 0.48))
check('estende ate o fim da musica', detected!.times[detected!.times.length - 1] > 11)
check(
  'a extensao usa o espacamento mediano',
  near(detected!.times[6] - detected!.times[5], 0.5, 1e-6),
  `${detected!.times[6] - detected!.times[5]}`
)
check(
  'bpm sai do espacamento medido',
  Math.round(detected!.bpm) === 120,
  `${detected!.bpm.toFixed(2)}`
)
check(
  'poucas batidas caem na grade do bpm',
  buildBeatGrid({ bpm: 100, durationS: 10, beatsMs: [0, 600] })!.source === 'bpm'
)
check(
  'batidas fora de ordem sao ordenadas',
  buildBeatGrid({ bpm: 120, durationS: 4, beatsMs: [1000, 0, 500, 1500] })!.times[0] === 0
)

console.log('\n=== 4. encaixe na batida ===')
const grid = buildBeatGrid({ bpm: 120, durationS: 10 })!
check('primeira batida a partir do meio', nextBeatIndex(grid, 0.7) === 2, `${nextBeatIndex(grid, 0.7)}`)
check('em cima da batida devolve ela mesma', nextBeatIndex(grid, 1.0) === 2)
check('depois do fim devolve o tamanho', nextBeatIndex(grid, 999) === grid.times.length)
check('encaixa para tras', near(snapToBeat(grid, 1.1), 1))
check('encaixa para frente', near(snapToBeat(grid, 1.4), 1.5))
check('sem grade nao mexe no valor', snapToBeat(null, 1.234) === 1.234)

console.log('\n=== 5. cabecote sem loop ===')
const anchor = { ctxTime: 100, offset: 0, rate: 1 }
check('parado no proprio ancora', resolvePosition(anchor, 100, null).position === 0)
check('anda um por um', resolvePosition(anchor, 105, null).position === 5)
check('nao reancora a toa', resolvePosition(anchor, 105, null).anchor === anchor)
check(
  'a 70% o tempo da musica anda mais devagar',
  near(resolvePosition({ ...anchor, rate: 0.7 }, 110, null).position, 7)
)
check('ida e volta pelo tempo do contexto', near(ctxTimeAt(anchor, 5), 105))
check(
  'ida e volta a 70%',
  near(ctxTimeAt({ ...anchor, rate: 0.7 }, 7), 110),
  `${ctxTimeAt({ ...anchor, rate: 0.7 }, 7)}`
)

console.log('\n=== 6. cabecote dentro do loop A-B ===')
const loop = { start: 10, end: 14 }
const inside = { ctxTime: 100, offset: 10, rate: 1 }
check('antes de bater no fim nao volta', resolvePosition(inside, 102, loop).position === 12)
check('sem volta o ancora e o mesmo', resolvePosition(inside, 102, loop).anchor === inside)

const first = resolvePosition(inside, 105, loop)
check('deu a volta uma vez', near(first.position, 11), `${first.position}`)
check('reancorou', first.anchor !== inside)
check('reancorou no inicio do trecho', first.anchor.offset === 10)
check(
  'reancorou no instante exato da virada',
  near(first.anchor.ctxTime, 104),
  `${first.anchor.ctxTime}`
)
check(
  'o ancora novo devolve a mesma posicao',
  near(resolvePosition(first.anchor, 105, loop).position, first.position)
)

const many = resolvePosition(inside, 123, loop)
check('varias voltas de uma vez', near(many.position, 13), `${many.position}`)
check(
  'a 60% a volta demora mais tempo real',
  near(resolvePosition({ ctxTime: 0, offset: 10, rate: 0.6 }, 10, loop).position, 12),
  `${resolvePosition({ ctxTime: 0, offset: 10, rate: 0.6 }, 10, loop).position}`
)

// the regression this file exists for: laps must not accumulate error
let running = { ctxTime: 0, offset: 10, rate: 1 }
for (let lap = 1; lap <= 200; lap++) {
  running = resolvePosition(running, lap * 4, loop).anchor
}
check(
  'duzentas voltas sem acumular erro',
  near(running.ctxTime, 800, 1e-9) && running.offset === 10,
  `ctxTime=${running.ctxTime}`
)

console.log('\n=== 7. loop degenerado ===')
check(
  'trecho de tamanho zero nao trava',
  resolvePosition(inside, 105, { start: 10, end: 10 }).position === 15
)
check(
  'entrar antes do trecho toca ate o fim dele',
  resolvePosition({ ctxTime: 0, offset: 8, rate: 1 }, 3, loop).position === 11
)

console.log(`\n${failures === 0 ? 'TEMPO OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
