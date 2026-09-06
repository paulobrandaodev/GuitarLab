import { LOCALE_PROMPT_NAMES, type Locale } from '@shared/i18n'

/**
 * The prompts, and the one line in each that carries the user's language.
 *
 * Every prompt splits into three parts, and only one of them is translated:
 *
 * 1. **Scaffolding** — the role, the task, the constraints, the JSON schema and
 *    the field names. Permanently English. Three reasons: these models follow a
 *    JSON schema measurably better in English; keeping it fixed removes six
 *    prompts × three languages = eighteen variants from the maintenance
 *    surface, which is what would actually rot; and the vocabulary is English
 *    anyway — preamp, gain, backing track, drop tuning, ChordPro.
 * 2. **The output directive** — one line, generated per language. For prompts
 *    that return JSON it has to be *per field*, because a naive "answer in
 *    Spanish" translates the hardware labels too: a GT-1 prints PREAMP and
 *    OD/DS, and a patch that renames them is a patch nobody can dial in.
 * 3. **The data** — song title, artist, section names. Never translated; it is
 *    the user's own content.
 */

/** "Write your prose in Brazilian Portuguese", for a free-text answer. */
function proseDirective(locale: Locale): string {
  return `Write your answer in ${LOCALE_PROMPT_NAMES[locale]}.`
}

/**
 * The same, for a JSON answer, naming exactly which fields are prose.
 *
 * The second half matters more than the first. Without it, asking for Spanish
 * gets back `"slot": "PREAMPLIFICADOR"`, which does not exist on the device,
 * and a `chain` that no longer matches what is printed on the pedal.
 */
function jsonDirective(locale: Locale, proseFields: string[]): string {
  const fields = proseFields.map((f) => `\`${f}\``).join(', ')
  return (
    `Write the values of ${fields} in ${LOCALE_PROMPT_NAMES[locale]}. ` +
    'Everything else — field names, slot names, model names, and the labels in ' +
    '`chain` and `params` — must stay exactly as the device prints them, in ' +
    'English. Never translate a control or a block name.'
  )
}

/* ------------------------------------------------------------------ tone */

export function tonePatchSystemPrompt(locale: Locale): string {
  return (
    'You are a guitar tech who specialises in multi-effects units. You know the ' +
    'real block order and the real control names of each device. Answer with ' +
    'valid JSON only: no commentary, no code fences. ' +
    jsonDirective(locale, [
      'patchName',
      'appliesTo',
      'summary',
      'listenFor',
      'notes',
      'ctrl.action',
      'ctrl.when'
    ])
  )
}

export function tonePatchPrompt(
  context: string,
  outputLabel: string,
  pitch: {
    enabled: boolean
    playedTuning: string
    recordTuning: string
    semitones: number
  }
): string {
  const pitchLine = pitch.enabled
    ? `The guitar stays in ${pitch.playedTuning} and the PITCH SHIFTER (PS) block ` +
      `moves it ${pitch.semitones} semitone(s) to match the record ` +
      `(${pitch.recordTuning}). Include that block in EVERY patch, with Mix/Balance ` +
      'at 100% (shifted signal only), and mention the adjustment in the "notes" of ' +
      'the first patch.'
    : `The guitar stays in ${pitch.playedTuning} and this song needs NO pitch shifter.`

  return (
    `${context}\n\n` +
    'Build the patches for playing this song on this unit, going direct into ' +
    `${outputLabel} — include cabinet simulation and set the brightness for a direct ` +
    'signal, which tends to come out harsher than through an amp.\n\n' +
    `TUNING. ${pitchLine}\n\n` +
    'SPLITTING INTO PATCHES. If the song changes tone in a marked way — clean in the ' +
    'verse and distorted in the chorus, a solo that wants more gain and delay — return ' +
    'one patch per tone, at most 4, in chronological order. In "appliesTo", say which ' +
    'part of the song each one comes in at, using the section names when they exist. ' +
    'If the tone is the same from start to finish, return a single patch and do not ' +
    'invent divisions.\n\n' +
    'THE CTRL SWITCH. The unit has ONE assignable footswitch (CTRL) besides the patch ' +
    'bank. In "ctrl", say what is worth putting on it FOR THIS PATCH — wah, whammy, ' +
    'solo boost, delay, toggling a block — with what one press does and when in the ' +
    'song you would use it. If nothing in that patch justifies it, return "ctrl": null.\n\n' +
    'Use at most 6 blocks per patch, in the device\'s real chain order. In "params" use ' +
    'at most 4 controls per block: "value" is the knob position from 0 to 100, or null ' +
    'when the control is a choice rather than a knob (fill in "text" in that case). ' +
    'In "chain", list the short labels along the signal path, starting at the guitar ' +
    'and ending at the output.\n\n' +
    'Exact format:\n' +
    '{"patches":[{"patchName":"","appliesTo":"","summary":"",' +
    '"chain":["Guitar","COMP","OD","PREAMP","PA"],' +
    '"blocks":[{"slot":"PREAMP","model":"","enabled":true,' +
    '"params":[{"label":"Gain","value":70,"text":null}],"note":""}],' +
    '"ctrl":{"target":"WAH","action":"","when":""},' +
    '"listenFor":"","notes":""}]}'
  )
}

/* -------------------------------------------------------------- markdown */

export function practicePlanSystemPrompt(locale: Locale): string {
  return (
    'You are a guitar, bass and drums teacher. Be direct and practical: short ' +
    'markdown, no filler, no encouragement padding. ' +
    proseDirective(locale)
  )
}

export function techniqueSystemPrompt(locale: Locale): string {
  return (
    'You are an instrument teacher. Be objective: short markdown with short ' +
    'headings, and no restating of the question. ' +
    proseDirective(locale)
  )
}

export function toneAdviceSystemPrompt(locale: Locale): string {
  return (
    'You know guitar tone and multi-effects units. Answer in markdown with short ' +
    '### headings. Keep device control names, block names and model names exactly ' +
    'as the unit prints them, in English. ' +
    proseDirective(locale)
  )
}

/* ------------------------------------------------------ machine-readable */

/**
 * These two return data, not prose, so they take no locale at all.
 *
 * The video classifier answers with role identifiers the app already knows, and
 * the ChordPro converter reformats the user's own chart — chord symbols and
 * ChordPro directives are the same in every language. Passing a language here
 * would only give the model licence to translate something it should not.
 */
export function classifyVideosSystemPrompt(): string {
  return (
    'Classify YouTube videos for a guitar practice app. Answer with valid JSON ' +
    'only: no commentary, no code fences.'
  )
}

export function toChordProSystemPrompt(): string {
  return (
    'You convert plain-text chord sheets into ChordPro. Keep the lyrics exactly ' +
    'as written and place each chord inline in square brackets at the syllable ' +
    'it falls on. Answer with the ChordPro only: no commentary, no code fences.'
  )
}
