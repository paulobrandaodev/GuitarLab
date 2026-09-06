/**
 * Text-encoding recovery for Guitar Pro files.
 *
 * GP3/GP4/GP5 are binary formats that store strings as raw bytes in whatever
 * code page the author's machine used — for Brazilian and European tabs that is
 * almost always Windows-1252. alphaTab decodes as UTF-8 by default, and those
 * bytes are not valid UTF-8, so the decoder replaces each one with U+FFFD: the
 * "Papo Reto (Prazer <?> Sexo o Resto <?> Neg<?>cio)" in the score header, and
 * the same damage in every section marker the importer copies into the database.
 *
 * The fix is to notice the damage and read the file again under the legacy code
 * page. Detection has to look at the *decoded text*, not at the bytes: a GP7
 * file really is UTF-8 and must be left alone, and a heuristic over raw bytes
 * cannot tell the two apart on short strings like "Solo".
 *
 * Free of Node and DOM imports so the main process, the renderer and the test
 * script all share one definition of "this file came out broken".
 */

/** What alphaTab uses when nothing says otherwise, and what GP6/GP7 really are. */
export const GP_ENCODING_DEFAULT = 'utf-8'

/**
 * The code page GP3-GP5 authors actually wrote in. Latin-1 would cover the
 * accented vowels, but cp1252 also carries the curly quotes and dashes that
 * turn up in tab titles, and it is a superset for everything else.
 */
export const GP_ENCODING_LEGACY = 'windows-1252'

/** The character a UTF-8 decoder leaves behind on bytes that were never UTF-8. */
const REPLACEMENT = '�'

/** Structural view of an alphaTab score — just the parts that carry text. */
export interface ScoreTextLike {
  title?: string | null
  subTitle?: string | null
  artist?: string | null
  album?: string | null
  words?: string | null
  music?: string | null
  tracks?: Array<{ name?: string | null }>
  masterBars?: Array<{
    section?: { text?: string | null; marker?: string | null } | null
  }>
}

/** Every string a user will actually read, in one flat list. */
export function scoreText(score: ScoreTextLike): string[] {
  const out: string[] = []
  const push = (v: string | null | undefined): void => {
    if (typeof v === 'string' && v.length) out.push(v)
  }
  push(score.title)
  push(score.subTitle)
  push(score.artist)
  push(score.album)
  push(score.words)
  push(score.music)
  for (const track of score.tracks ?? []) push(track.name)
  for (const bar of score.masterBars ?? []) {
    push(bar.section?.text)
    push(bar.section?.marker)
  }
  return out
}

/** True when the decode left replacement characters behind. */
export function hasDecodeDamage(values: string[]): boolean {
  return values.some((v) => v.includes(REPLACEMENT))
}

/** True when this stored string was written by a decode that already failed. */
export function isDamagedText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes(REPLACEMENT)
}

/**
 * Load a score, retrying under the legacy code page when UTF-8 comes out broken.
 *
 * `load` is the caller's parse — the main process and the renderer reach
 * alphaTab differently — and it is given the encoding to apply. The retry only
 * happens when the first pass produced damage, so a clean UTF-8 file is parsed
 * exactly once, and a file that is broken under *both* encodings keeps the UTF-8
 * result rather than silently preferring the second guess.
 */
export function loadScoreRecovering<T extends ScoreTextLike>(
  load: (encoding: string) => T
): { score: T; encoding: string; recovered: boolean } {
  const score = load(GP_ENCODING_DEFAULT)
  if (!hasDecodeDamage(scoreText(score))) {
    return { score, encoding: GP_ENCODING_DEFAULT, recovered: false }
  }
  try {
    const retry = load(GP_ENCODING_LEGACY)
    if (!hasDecodeDamage(scoreText(retry))) {
      return { score: retry, encoding: GP_ENCODING_LEGACY, recovered: true }
    }
  } catch {
    // the legacy pass is a best effort; a parse failure means keep what we had
  }
  return { score, encoding: GP_ENCODING_DEFAULT, recovered: false }
}
