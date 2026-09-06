/**
 * The tone plan: tuning maths, the shape of what the model returns, and the
 * instructions the prompt is required to carry.
 *
 * Run with: npm run test:tone
 *
 * The tuning side is arithmetic and must never depend on a model getting it
 * right — the player's rule is that the guitar stays in E standard (a physical
 * Drop D at most) and the pitch shifter covers the rest, so this is where that
 * rule is actually enforced.
 */
import {
  planPitchShifter,
  normalizePlan,
  normalizePatch,
  noteToMidi,
  buildToneContext
} from '../src/main/services/tone'
import { tonePatchPrompt } from '../src/main/services/prompts'
import { RIG_DEFAULT, RIG_OUTPUT_EN } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const tuning = (name: string, strings: string[]): { name: string; strings: string[] } => ({
  name,
  strings
})

console.log('=== 1. notas -> MIDI ===')
check('E2 e 40', noteToMidi('E2') === 40, String(noteToMidi('E2')))
check('sustenido', noteToMidi('D#2') === 39, String(noteToMidi('D#2')))
check('bemol equivale ao sustenido', noteToMidi('Eb2') === noteToMidi('D#2'))
check('lixo devolve null', noteToMidi('xyz') === null)

console.log('\n=== 2. afinação -> pitch shifter ===')
const eStandard = planPitchShifter(tuning('E Standard', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']))
check('E padrão não usa PS', !eStandard.enabled && eStandard.playedTuning === 'E padrão')

const ebStandard = planPitchShifter(
  tuning('Eb Standard', ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'])
)
check('Eb desce 1 semitom no PS', ebStandard.enabled && ebStandard.semitones === -1, `${ebStandard.semitones}`)
check('e a guitarra fica em E padrão', ebStandard.playedTuning === 'E padrão', ebStandard.playedTuning)
check('a nota explica o ajuste', /PITCH SHIFTER/.test(ebStandard.note), ebStandard.note)

const dStandard = planPitchShifter(tuning('D Standard', ['D2', 'G2', 'C3', 'F3', 'A3', 'D4']))
check('D padrão desce 2 semitons', dStandard.enabled && dStandard.semitones === -2, `${dStandard.semitones}`)

const dropD = planPitchShifter(tuning('Drop D', ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']))
check('Drop D é feito na mão, sem PS', !dropD.enabled && dropD.playedTuning === 'Drop D')

// the case the player asked about: Drop D on the guitar plus half a step down
const dropCsharp = planPitchShifter(
  tuning('Drop C#', ['C#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'])
)
check(
  'Drop C# = Drop D na mão + PS -1',
  dropCsharp.enabled && dropCsharp.semitones === -1 && dropCsharp.playedTuning === 'Drop D',
  `${dropCsharp.playedTuning} ${dropCsharp.semitones}`
)

const dropC = planPitchShifter(tuning('Drop C', ['C2', 'G2', 'C3', 'F3', 'A3', 'D4']))
check(
  'Drop C = Drop D na mão + PS -2',
  dropC.enabled && dropC.semitones === -2 && dropC.playedTuning === 'Drop D',
  `${dropC.playedTuning} ${dropC.semitones}`
)

const sevenString = planPitchShifter(
  tuning('E Standard (7)', ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'])
)
check('7 cordas não vira PS', !sevenString.enabled && /7 cordas/.test(sevenString.note))

const dadgad = planPitchShifter(tuning('DADGAD', ['D2', 'A2', 'D3', 'G3', 'A3', 'D4']))
check('afinação aberta não vira PS', !dadgad.enabled && /não é um deslocamento/.test(dadgad.note))

check('sem afinação assume E padrão', !planPitchShifter(null).enabled)

console.log('\n=== 3. resposta da IA -> plano ===')
const raw = {
  patches: [
    {
      patchName: 'Puppets Clean',
      appliesTo: 'Trecho limpo do meio',
      summary: 'limpo com chorus',
      chain: ['Guitarra', 'COMP', 'PREAMP', 'PA'],
      blocks: [
        {
          slot: 'PREAMP',
          model: 'JC-120',
          enabled: true,
          params: [
            { label: 'Gain', value: 20 },
            { label: 'Tipo', value: null, text: 'CLEAN TWIN' },
            { label: 'Bass', value: '55' },
            { label: 'Fora', value: 900 }
          ]
        }
      ],
      ctrl: { target: 'CHORUS', action: 'liga o chorus', when: 'no arpejo' },
      listenFor: 'as cordas soltas',
      notes: ''
    },
    {
      patchName: 'Puppets Rhythm',
      appliesTo: 'Riff principal',
      blocks: [{ slot: 'PREAMP', model: 'RECTO', params: [{ label: 'Gain', value: 78 }] }],
      ctrl: { target: '', action: 'nada' }
    },
    { patchName: 'Vazio', blocks: [] }
  ]
}

const plan = normalizePlan(raw, RIG_DEFAULT, ebStandard, 'gemini', 'flash')
check('um patch por timbre', plan.patches.length === 2, `${plan.patches.length}`)
check('em ordem', plan.patches[0].patchName === 'Puppets Clean')
check('patch sem bloco é descartado', !plan.patches.some((p) => p.patchName === 'Vazio'))
check('o trecho de cada patch é preservado', plan.patches[0].appliesTo === 'Trecho limpo do meio')
check(
  'knob fora da faixa é preso em 0..100',
  plan.patches[0].blocks[0].params[3].value === 100,
  `${plan.patches[0].blocks[0].params[3].value}`
)
check(
  'knob em texto vira número',
  plan.patches[0].blocks[0].params[2].value === 55,
  `${plan.patches[0].blocks[0].params[2].value}`
)
check('seletor mantém o texto', plan.patches[0].blocks[0].params[1].text === 'CLEAN TWIN')
check('CTRL válido é mantido', plan.patches[0].ctrl?.target === 'CHORUS')
check('CTRL sem alvo vira null', plan.patches[1].ctrl === null)
check('o pitch shifter vem do cálculo, não do modelo', plan.pitchShifter?.semitones === -1)
check('o patch sem cadeia ganha uma pela lista de blocos', plan.patches[1].chain.length >= 3)

const legacy = normalizePlan(
  { patchName: 'Antigo', blocks: [{ slot: 'OD', model: 'TS', params: [] }] },
  RIG_DEFAULT,
  eStandard,
  'ollama',
  'qwen'
)
check('resposta antiga (um patch só) ainda vira plano', legacy.patches.length === 1)
check('e ganha um trecho padrão', legacy.patches[0].appliesTo === 'Música inteira')

check('lixo vira plano vazio', normalizePlan('nada', RIG_DEFAULT, eStandard, 'x', 'y').patches.length === 0)
check(
  'patch sem nada usável não inventa blocos',
  normalizePatch({}, RIG_DEFAULT, 'x', 'y').blocks.length === 0
)

console.log('\n=== 4. o prompt carrega as regras ===')
const context = buildToneContext(
  {
    title: 'Master of Puppets',
    artist: 'Metallica',
    genre: 'Thrash Metal',
    musicalKey: 'Em',
    bpm: 212,
    tuning: tuning('Eb Standard', ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'])
  },
  RIG_DEFAULT,
  ['Intro', 'Riff', 'Clean', 'Solo']
)
check('o contexto leva os trechos da música', /Intro, Riff, Clean, Solo/.test(context))
check('e a afinação do disco', /Eb Standard/.test(context))

/*
 * The prompt scaffolding is fixed English — see services/prompts.ts for why.
 * Only the output directive follows the interface language, and that is
 * covered in test-llm.ts, which has all three catalogues to compare.
 */
const output = RIG_OUTPUT_EN[RIG_DEFAULT.output].toLowerCase()
const prompt = tonePatchPrompt(context, output, ebStandard)
check('manda usar o CTRL', /CTRL/.test(prompt))
check('explica o pitch shifter', /PITCH SHIFTER/.test(prompt) && /-1/.test(prompt))
check(
  'pede patches separados por trecho',
  /appliesTo/.test(prompt) && /at most 4/.test(prompt)
)
check('pede JSON com lista de patches', /"patches":\[/.test(prompt))
check('diz para onde a saida vai', prompt.includes(output))

const promptNoPitch = tonePatchPrompt(context, output, eStandard)
check('sem PS o prompt diz que não precisa', /NO pitch shifter/.test(promptNoPitch))

console.log(`\n${failures === 0 ? 'TIMBRE OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
