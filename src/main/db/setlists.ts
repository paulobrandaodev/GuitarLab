import type Database from 'better-sqlite3'

/**
 * Setlist mutations that are pure SQL over a `better-sqlite3` handle.
 *
 * Kept free of the Electron `config` import — like `repair.ts` — so the test
 * script can drive them against a copy of the real database instead of
 * re-implementing the same statements and testing a lookalike.
 */

/**
 * Delete a setlist and its items.
 *
 * The songs stay in the library: a setlist is a playlist over the library, not
 * the owner of the songs. If the deleted set was the active one, the next set
 * takes over so no screen comes back with nothing selected.
 */
export function deleteSetlistRow(sqlite: Database.Database, id: number): void {
  const tx = sqlite.transaction(() => {
    const row = sqlite.prepare('SELECT is_active FROM setlists WHERE id = ?').get(id) as
      | { is_active: number }
      | undefined
    sqlite.prepare('DELETE FROM setlist_items WHERE setlist_id = ?').run(id)
    sqlite.prepare('DELETE FROM setlists WHERE id = ?').run(id)
    if (row?.is_active) {
      const next = sqlite.prepare('SELECT id FROM setlists ORDER BY id LIMIT 1').get() as
        | { id: number }
        | undefined
      if (next) sqlite.prepare('UPDATE setlists SET is_active = 1 WHERE id = ?').run(next.id)
    }
  })
  tx()
}

export interface SyncResult {
  added: number
  removed: number
  removedSongIds: number[]
}

/**
 * Make the setlist hold exactly `orderedSongIds`, in that order.
 *
 * This is what a second import of the same Spotify playlist runs: songs dropped
 * from the playlist leave the set, new ones are appended and everything ends up
 * in the playlist's order. Rows that survive keep their id, so their planned key
 * and transition note are not thrown away on every refresh.
 */
export function syncSetlistItems(
  sqlite: Database.Database,
  setlistId: number,
  orderedSongIds: number[]
): SyncResult {
  const existing = sqlite
    .prepare('SELECT song_id AS songId FROM setlist_items WHERE setlist_id = ?')
    .all(setlistId) as Array<{ songId: number }>
  const existingIds = new Set(existing.map((r) => r.songId))
  const wanted = [...new Set(orderedSongIds)]
  const wantedIds = new Set(wanted)
  const removedSongIds = [...existingIds].filter((id) => !wantedIds.has(id))

  const del = sqlite.prepare('DELETE FROM setlist_items WHERE setlist_id = ? AND song_id = ?')
  const ins = sqlite.prepare(
    'INSERT OR IGNORE INTO setlist_items (setlist_id, song_id, position) VALUES (?, ?, ?)'
  )
  const pos = sqlite.prepare(
    'UPDATE setlist_items SET position = ? WHERE setlist_id = ? AND song_id = ?'
  )

  let added = 0
  const tx = sqlite.transaction(() => {
    for (const songId of removedSongIds) del.run(setlistId, songId)
    wanted.forEach((songId, i) => {
      if (!existingIds.has(songId)) {
        ins.run(setlistId, songId, i)
        added++
      }
      pos.run(i, setlistId, songId)
    })
  })
  tx()

  return { added, removed: removedSongIds.length, removedSongIds }
}
