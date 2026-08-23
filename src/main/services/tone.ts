import type {
  RigView,
  TonePatchView,
  TonePlanView,
  PatchBlock,
  PatchParam,
  CtrlAssignment,
  PitchShifterPlan
} from '@shared/types'
import { OUTPUT_LABEL } from '@shared/types'

/**
 * Tone-patch plumbing, kept out of the IPC layer so it can be exercised without
 * booting Electron: prompt construction and the repair pass that turns whatever
 * the model returned into something the renderer can draw.
 */

/*
 * The tuning maths lives in shared/ because the tuner screen needs the same
 * answer this prompt does — what the player actually tunes to, and how much of
 * the drop the pitch shifter carries. Re-exported so callers of this module do
 * not have to know where it moved to.
 */
export { planPitchShifter, noteToMidi } from '@shared/tuning'

export const RIG_SETTING_KEY = 'gear_rig'

/* ---------------------------------------------------------- normalização */

function clampKnob(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeParams(raw: unknown): PatchParam[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 4)
    .map((p): PatchParam | null => {
      const o = (p ?? {}) as Record<string, unknown>
      const label = String(o.label ?? '').trim()
      if (!label) return null
      const text = o.text == null ? null : String(o.text).trim() || null
      return { label, value: clampKnob(o.value), text }
    })
    .filter((p): p is PatchParam => p !== null)
}

function normalizeCtrl(raw: unknown): CtrlAssignment | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const target = String(o.target ?? '').trim()
  const action = String(o.action ?? '').trim()
  if (!target || !action) return null
  return { target, action, when: String(o.when ?? '').trim() }
}

/**
 * Models drop fields, return strings where numbers belong, and occasionally
 * invent extra blocks. Reshape whatever came back into something the renderer
 * can draw without defensive checks at every level.
 */
export function normalizePatch(
  raw: Partial<TonePatchView>,
  rig: RigView,
  provider: string,
  model: string
): TonePatchView {
  const blocks: PatchBlock[] = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .slice(0, 6)
    .map((b) => {
      const o = (b ?? {}) as unknown as Record<string, unknown>
      return {
        slot: String(o.slot ?? '').trim() || 'BLOCO',
        model: String(o.model ?? '').trim(),
        enabled: o.enabled !== false,
        params: normalizeParams(o.params),
        note: o.note == null ? null : String(o.note).trim() || null
      }
    })
    .filter((b) => b.model || b.params.length)

  const chain = (Array.isArray(raw.chain) ? raw.chain : [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return {
    patchName: String(raw.patchName ?? '').trim() || 'Patch sugerido',
    appliesTo: String(raw.appliesTo ?? '').trim() || 'Música inteira',
    summary: String(raw.summary ?? '').trim(),
    // a model that skipped the chain still gets a usable diagram from the blocks
    chain: chain.length
      ? chain
      : [rig.guitar, ...blocks.map((b) => b.slot), OUTPUT_LABEL[rig.output]],
    blocks,
    ctrl: normalizeCtrl((raw as { ctrl?: unknown }).ctrl),
    listenFor: String(raw.listenFor ?? '').trim(),
    notes: String(raw.notes ?? '').trim(),
    rig,
    provider,
    model
  }
}

/**
 * Reshape the whole answer.
 *
 * `pitchShifter` is passed in rather than read from the model: the tuning maths
 * is arithmetic and must not depend on the model getting it right. A model that
 * answered with a single patch (the old shape) still produces a valid plan.
 */
export function normalizePlan(
  raw: unknown,
  rig: RigView,
  pitchShifter: PitchShifterPlan,
  provider: string,
  model: string
): TonePlanView {
  const o = (raw ?? {}) as Record<string, unknown>
  const list = Array.isArray(o.patches) ? o.patches : [o]
  const patches = list
    .slice(0, 4)
    .map((p) => normalizePatch((p ?? {}) as Partial<TonePatchView>, rig, provider, model))
    .filter((p) => p.blocks.length > 0)

  // an empty list is a real answer: the caller reports "the model returned
  // nothing usable" rather than drawing a card full of blanks
  return { patches, pitchShifter, rig, provider, model }
}

/* -------------------------------------------------------------- prompts */

/** Everything the model needs to know about the song and the rig. */
export function buildToneContext(
  song: {
    title: string
    artist: string | null
    genre: string | null
    musicalKey: string | null
    bpm: number | null
    tuning: { name: string; strings: string[] } | null
  },
  rig: RigView,
  sections: string[] = []
): string {
  return [
    `Música: ${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
    song.genre ? `Gênero: ${song.genre}` : null,
    song.musicalKey ? `Tom: ${song.musicalKey}` : null,
    song.bpm ? `Andamento: ${Math.round(song.bpm)} BPM` : null,
    song.tuning ? `Afinação do disco: ${song.tuning.name} (${song.tuning.strings.join(' ')})` : null,
    sections.length ? `Trechos do arquivo Guitar Pro: ${sections.join(', ')}` : null,
    `Guitarra: ${rig.guitar}`,
    `Pedaleira/processador: ${rig.processor}`,
    `Saída: ${OUTPUT_LABEL[rig.output]} (som direto, sem amplificador na sala)`
  ]
    .filter(Boolean)
    .join('\n')
}

export const TONE_SYSTEM_PROMPT =
  'Você é um técnico de guitarra especialista em pedaleiras multiefeito. Conhece a ' +
  'ordem de blocos e a nomenclatura real de cada aparelho. Responda SOMENTE JSON ' +
  'válido, sem comentários e sem cercas de código. Textos em português do Brasil.'

export function buildTonePrompt(
  context: string,
  rig: RigView,
  pitch: PitchShifterPlan
): string {
  const pitchLine = pitch.enabled
    ? `A guitarra fica em ${pitch.playedTuning} e o bloco PITCH SHIFTER (PS) desloca ` +
      `${pitch.semitones} semitom(ns) para bater com o disco (${pitch.recordTuning}). ` +
      'Inclua esse bloco em TODOS os patches, com Mix/Balance em 100% (só o som deslocado), ' +
      'e conte esse ajuste no "notes" do primeiro patch.'
    : `A guitarra fica em ${pitch.playedTuning} e NÃO precisa de pitch shifter nessa música.`

  return (
    `${context}\n\n` +
    `Monte os patches para tocar essa música nessa pedaleira, saindo direto para ` +
    `${OUTPUT_LABEL[rig.output].toLowerCase()} — inclua simulação de gabinete/cabinet e ` +
    `ajuste o brilho pensando em som direto, que costuma sair mais áspero que num amp.\n\n` +
    `AFINAÇÃO. ${pitchLine}\n\n` +
    'DIVISÃO EM PATCHES. Se a música muda de timbre de forma marcante — limpo no verso e ' +
    'distorcido no refrão, um solo que pede mais ganho e delay — devolva um patch para cada ' +
    'timbre, no máximo 4, em ordem cronológica. Em "appliesTo" diga em que parte da música ' +
    'cada um entra, usando os nomes dos trechos quando eles existirem. Se o timbre é um só do ' +
    'começo ao fim, devolva um único patch e não invente divisões.\n\n' +
    'BOTÃO CTRL. A pedaleira tem UM footswitch atribuível (CTRL) além do banco de patches. ' +
    'Em "ctrl" diga o que vale colocar nele NESSE patch — wah, whammy, boost de solo, ' +
    'delay, ligar/desligar um bloco — com o que um toque faz e em que momento da música se ' +
    'usa. Se naquele patch não houver nada que justifique, devolva "ctrl": null.\n\n' +
    'Use no máximo 6 blocos por patch, na ordem real da cadeia do aparelho. Em "params" use no ' +
    'máximo 4 controles por bloco: "value" é a posição do knob de 0 a 100, ou null ' +
    'quando o controle é uma escolha e não um knob (nesse caso preencha "text"). ' +
    'Em "chain" liste os rótulos curtos do caminho do sinal, começando pela guitarra e ' +
    'terminando na saída.\n\n' +
    'Formato exato:\n' +
    '{"patches":[{"patchName":"","appliesTo":"","summary":"",' +
    '"chain":["Guitarra","COMP","OD","PREAMP","PA"],' +
    '"blocks":[{"slot":"PREAMP","model":"","enabled":true,' +
    '"params":[{"label":"Gain","value":70,"text":null}],"note":""}],' +
    '"ctrl":{"target":"WAH","action":"","when":""},' +
    '"listenFor":"","notes":""}]}'
  )
}
