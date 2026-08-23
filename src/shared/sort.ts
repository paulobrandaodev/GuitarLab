/**
 * Ordering for the song lists.
 *
 * The rule that is not obvious from the field names: sorting by tuning is not
 * alphabetical. The guitar lives in E standard, so every song that can be played
 * without touching a peg belongs at the top of the list no matter which way the
 * arrow points — that is the block you can play in one sitting. Only the rest
 * flips between A–Z and Z–A.
 *
 * Free of Node and DOM imports so the renderer and the test script can use it.
 */

export type SongSortKey = 'ordem' | 'banda' | 'musica' | 'afinacao' | 'duracao'
export type SortDir = 'asc' | 'desc'

/** The shape the comparators need — `SongView` satisfies it. */
export interface SortableSong {
  title: string
  artist: string | null
  durationMs: number | null
  tuning: { name: string } | null
}

export const SORT_KEYS: SongSortKey[] = ['ordem', 'banda', 'musica', 'afinacao', 'duracao']

export const SORT_LABEL: Record<SongSortKey, string> = {
  ordem: 'ordem',
  banda: 'banda',
  musica: 'música',
  afinacao: 'afinação',
  duracao: 'duração'
}

/** What the direction arrow means for each key, spelled out for the tooltip. */
export const SORT_DIR_LABEL: Record<SongSortKey, { asc: string; desc: string }> = {
  ordem: { asc: 'ordem do show', desc: 'ordem do show' },
  banda: { asc: 'A–Z', desc: 'Z–A' },
  musica: { asc: 'A–Z', desc: 'Z–A' },
  afinacao: { asc: 'E Standard no topo, resto A–Z', desc: 'E Standard no topo, resto Z–A' },
  duracao: { asc: 'menor → maior', desc: 'maior → menor' }
}

/** Names in the E-standard family, which never leave the top of the list. */
function isEStandard(name: string): boolean {
  return /^\s*e\s*standard\b/i.test(name)
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

/** Missing values sort last in both directions — an empty field is not a small one. */
function compareText(a: string | null, b: string | null, dir: SortDir): number {
  const left = a?.trim() ?? ''
  const right = b?.trim() ?? ''
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  const result = collator.compare(left, right)
  return dir === 'asc' ? result : -result
}

function compareNumber(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir === 'asc' ? a - b : b - a
}

function compareTuning(a: SortableSong, b: SortableSong, dir: SortDir): number {
  const left = a.tuning?.name ?? null
  const right = b.tuning?.name ?? null
  const leftE = left !== null && isEStandard(left)
  const rightE = right !== null && isEStandard(right)
  if (leftE !== rightE) return leftE ? -1 : 1
  // inside the E-standard block the order stays A–Z whichever way the arrow
  // points, so plain "E Standard" is always the very first row
  if (leftE && rightE) return compareText(left, right, 'asc')
  return compareText(left, right, dir)
}

export function compareSongs(
  a: SortableSong,
  b: SortableSong,
  key: SongSortKey,
  dir: SortDir
): number {
  switch (key) {
    case 'banda':
      return compareText(a.artist, b.artist, dir) || compareText(a.title, b.title, 'asc')
    case 'musica':
      return compareText(a.title, b.title, dir)
    case 'afinacao':
      return compareTuning(a, b, dir) || compareText(a.title, b.title, 'asc')
    case 'duracao':
      return compareNumber(a.durationMs, b.durationMs, dir) || compareText(a.title, b.title, 'asc')
    case 'ordem':
    default:
      return 0
  }
}

/**
 * A sorted copy. `ordem` returns the list untouched, which is what keeps the
 * setlist in the order the show is played in.
 */
export function sortSongs<T>(
  items: T[],
  get: (item: T) => SortableSong,
  key: SongSortKey,
  dir: SortDir
): T[] {
  if (key === 'ordem') return items
  // index as the final tiebreak keeps the sort stable across re-renders
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareSongs(get(a.item), get(b.item), key, dir) || a.index - b.index)
    .map((entry) => entry.item)
}
