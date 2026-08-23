/**
 * Tuning maths, shared by the main process (which writes it into the tone
 * prompt) and the renderer (which shows the player what to tune to).
 *
 * The rule it encodes is the player's own: the guitar lives in E standard, at
 * most a physical Drop D, and the pitch shifter covers everything below that —
 * one guitar for a set that jumps between Eb, D and drop tunings. Free of Node
 * and DOM imports so both sides can use it.
 */

import type { PitchShifterPlan } from './types'

const SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11
}

/** "D#2" → 39. Returns null for anything that is not a note name. */
export function noteToMidi(name: string): number | null {
  const match = /^([A-G][#b]?)(-?\d+)$/.exec(name.trim())
  if (!match) return null
  const semitone = SEMITONE[match[1]]
  if (semitone === undefined) return null
  return (Number.parseInt(match[2], 10) + 1) * 12 + semitone
}

/** Low string first, the tuning the player is allowed to leave the guitar in. */
const E_STANDARD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
const E_STANDARD_MIDI = E_STANDARD.map((n) => noteToMidi(n) as number)

function semitoneLabel(n: number): string {
  const abs = Math.abs(n)
  const unit = abs === 1 ? 'semitom' : 'semitons'
  return `${n > 0 ? '+' : '−'}${abs} ${unit}`
}

/**
 * Work out how to play a song without retuning the guitar.
 *
 * The player's rule: the guitar lives in E standard and, at most, gets a
 * physical Drop D. Everything below that is the pitch shifter's job — one
 * instrument covers a set that jumps between Eb, D and drop tunings, and no
 * string gets slack enough to rattle.
 *
 * Deterministic on purpose: the shift is arithmetic on the tuning the Guitar Pro
 * file declares, not something a language model should be guessing at.
 */
export function planPitchShifter(
  tuning: { name: string; strings: string[] } | null
): PitchShifterPlan {
  const none = (note: string, recordTuning = 'E padrão'): PitchShifterPlan => ({
    enabled: false,
    semitones: 0,
    playedTuning: 'E padrão',
    recordTuning,
    note
  })

  if (!tuning || tuning.strings.length === 0) {
    return none('Sem afinação declarada no arquivo — assumindo E padrão.')
  }

  const midi = tuning.strings.map(noteToMidi)
  if (midi.some((m) => m === null)) {
    return none(`Afinação "${tuning.name}" não reconhecida; confira de ouvido.`, tuning.name)
  }
  const notes = midi as number[]

  if (notes.length !== 6) {
    return none(
      `${tuning.name} tem ${notes.length} cordas — o pitch shifter não resolve isso, ` +
        'toque na guitarra de 6 adaptando as vozes.',
      tuning.name
    )
  }

  const diffs = notes.map((n, i) => n - E_STANDARD_MIDI[i])
  const [low, ...rest] = diffs
  const restEqual = rest.every((d) => d === rest[0])

  // whole tuning moved by the same amount: pure pitch-shifter territory
  if (restEqual && low === rest[0]) {
    const shift = low
    if (shift === 0) {
      return none('Já é E padrão — nada a compensar.', tuning.name)
    }
    return {
      enabled: true,
      semitones: shift,
      playedTuning: 'E padrão',
      recordTuning: tuning.name,
      note:
        `${tuning.name} é E padrão ${semitoneLabel(shift)}. Deixe a guitarra afinada e ponha o ` +
        `PITCH SHIFTER em ${semitoneLabel(shift)} com Mix 100% (só o sinal deslocado, sem o seco).`
    }
  }

  // drop tuning: the sixth string is two semitones under the rest
  if (restEqual && low === rest[0] - 2) {
    const shift = rest[0]
    if (shift === 0) {
      return {
        enabled: false,
        semitones: 0,
        playedTuning: 'Drop D',
        recordTuning: tuning.name,
        note: 'Drop D é o único destuning que vale fazer na mão — solte a 6ª corda de E para D.'
      }
    }
    return {
      enabled: true,
      semitones: shift,
      playedTuning: 'Drop D',
      recordTuning: tuning.name,
      note:
        `${tuning.name} é Drop D ${semitoneLabel(shift)}. Solte só a 6ª corda para Drop D e deixe ` +
        `o PITCH SHIFTER descer o resto (${semitoneLabel(shift)}, Mix 100%).`
    }
  }

  return none(
    `${tuning.name} não é um deslocamento simples de E padrão — o pitch shifter não cobre ` +
      'esse caso, afine a guitarra para essa música.',
    tuning.name
  )
}
