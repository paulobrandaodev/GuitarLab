import type {
  RigView,
  TonePatchView,
  TonePlanView,
  PatchBlock,
  PatchParam,
  CtrlAssignment,
  PitchShifterPlan
} from '@shared/types'
import { RIG_OUTPUT_EN } from '@shared/types'

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
      : [rig.guitar, ...blocks.map((b) => b.slot), RIG_OUTPUT_EN[rig.output]],
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

/**
 * Everything the model needs to know about the song and the rig.
 *
 * The labels are English on purpose. They are prompt scaffolding, read by the
 * model and never by the user, and these models follow a schema measurably
 * better in English. What the user sees comes from the string catalogue; what
 * the model reads is fixed. The values themselves — title, artist, section
 * names — are the user's own content and are passed through untouched.
 */
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
    `Song: ${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
    song.genre ? `Genre: ${song.genre}` : null,
    song.musicalKey ? `Key: ${song.musicalKey}` : null,
    song.bpm ? `Tempo: ${Math.round(song.bpm)} BPM` : null,
    song.tuning
      ? `Tuning on the record: ${song.tuning.name} (${song.tuning.strings.join(' ')})`
      : null,
    sections.length ? `Sections from the Guitar Pro file: ${sections.join(', ')}` : null,
    `Guitar: ${rig.guitar}`,
    `Multi-effects unit: ${rig.processor}`,
    `Output: ${RIG_OUTPUT_EN[rig.output]} (direct signal, no amp in the room)`
  ]
    .filter(Boolean)
    .join('\n')
}

/*
 * The prompts themselves live in services/prompts.ts, where the split between
 * fixed English scaffolding and the per-language output directive is explained.
 * Re-exported here so the existing call sites and tests keep working.
 */
export { tonePatchSystemPrompt, tonePatchPrompt } from './prompts'

