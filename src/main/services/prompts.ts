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

/**
 * The per-part walkthrough behind "Dicas para esta música".
 *
 * Two things make this prompt worth its own function. It asks the model to go
 * part by part rather than to summarise the song, because the answer is read
 * next to a tablature that is already open at one of those parts; and it pins
 * the difficulty to a five-star scale with the anchors spelled out, because
 * "difficult" from a model that has read a thousand transcription forums drifts
 * upward until everything is a five.
 *
 * The stars are asked for as literal filled/empty characters rather than a
 * number so they survive the markdown renderer with no parsing on our side.
 */
export function techniquePrompt(context: string, sectionScope: string | null): string {
  const scope = sectionScope
    ? `Focus on ${sectionScope}, but keep the same structure below.`
    : 'Cover every part of the song, in playing order.'

  return (
    `${context}\n\n${scope}\n\n` +
    'Write the answer as markdown, in this shape:\n\n' +
    '1. A `##` heading per part of the song, named after the section when the ' +
    'sections are listed above, and by what happens musically when they are not ' +
    '(for example "Intro - arpejo limpo").\n' +
    '2. Directly under each heading, one line exactly like ' +
    '`**Dificuldade:** ★★★☆☆ (3/5) - <six words on what makes it that hard>`. ' +
    'Use the filled star ★ and the empty star ☆, five characters in total.\n' +
    '3. Then, for that part: what is actually played (technique, position on the ' +
    'neck, which hand carries the work), what usually goes wrong, and one ' +
    'concrete exercise with the BPM to start at and the BPM to reach.\n' +
    '4. Finish with a `##` heading for the practice order - which parts to attack ' +
    'first and why.\n\n' +
    'The five-star scale is for THIS instrument and THIS song, anchored like ' +
    'this: 1 = open chords and whole notes; 2 = power chords and simple ' +
    'pentatonic phrases; 3 = fast alternate picking, barre chords, small ' +
    'stretches; 4 = sweep picking, tapping, wide stretches, fast position ' +
    'shifts; 5 = the hardest thing a guitarist plays, at the limit of the ' +
    'instrument. Most parts of most songs are 2 or 3 - do not inflate.\n\n' +
    'Be concrete and short: at most 120 words per part, no encouragement, no ' +
    'restating of the question.'
  )
}

/* ---------------------------------------------------------- song sections */

export function sectionsSystemPrompt(locale: Locale): string {
  return (
    'You know the arrangements of recorded songs bar by bar. Answer with valid ' +
    'JSON only: no commentary, no code fences. ' +
    jsonDirective(locale, ['sections.name'])
  )
}

/**
 * The song's structure, for when the Guitar Pro file carries no markers.
 *
 * The bar numbers are what make the answer useful - they are what the loop
 * buttons in the practice screen set - but a model that does not know the song
 * well will invent them, and a made-up bar range loops over the wrong music. So
 * bars are optional, the seconds are the fallback, and the model is told to
 * leave a field null rather than guess it.
 */
export function sectionsPrompt(context: string, barCount: number | null): string {
  const bars = barCount
    ? `The Guitar Pro file has ${barCount} bars, numbered from 1. Every bar number must fall inside that range.`
    : 'There is no tablature for this song, so leave every bar number null and give seconds instead.'

  return (
    `${context}\n\n` +
    'Break this song into the parts a guitarist would practise separately - ' +
    'intro, verse, chorus, bridge, solo, riff, breakdown, outro. Between 3 and ' +
    '14 parts, in playing order, covering the song from start to finish with no ' +
    'gaps.\n\n' +
    `${bars}\n\n` +
    'For each part give: "name" (what the player would call it, such as "Solo 1" ' +
    'or "Refrao"), "kind" (exactly one of intro, verse, chorus, bridge, solo, ' +
    'outro, riff, breakdown, other), "startBar" and "endBar" (1-based and ' +
    'inclusive, or null), and "startSec" and "endSec" (seconds from the start of ' +
    'the recording, or null).\n\n' +
    'ACCURACY OVER COMPLETENESS. If you do not actually know where a part falls, ' +
    'set that number to null. A null is fine; a confident wrong bar number sends ' +
    'the practice loop to the wrong music.\n\n' +
    'Exact format:\n' +
    '{"sections":[{"name":"","kind":"intro","startBar":1,"endBar":8,' +
    '"startSec":0,"endSec":19}]}'
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
