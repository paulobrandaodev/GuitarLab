import type Database from 'better-sqlite3'
import { cleanTitle } from '../importers/matcher'

/**
 * Repairs for data written by earlier versions of the app. Kept free of the
 * Electron `config` import so it can be exercised against a copy of a real
 * database from a test script.
 */

export interface MountMap {
  /** Path as the Docker container sees it, e.g. `/data/stems`. */
  container: string
  /** The same directory on the host, e.g. `F:/…/SetList/.stems`. */
  host: string
}

/**
 * Translate one container path to its host equivalent, or return null when the
 * path is not under any known mount (already a host path, or something else).
 */
export function translateContainerPath(path: string, mounts: MountMap[]): string | null {
  const normalized = path.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')) return null

  for (const mount of mounts) {
    const c = mount.container.replace(/\/+$/, '')
    if (normalized !== c && !normalized.startsWith(`${c}/`)) continue
    const rest = normalized.slice(c.length).replace(/^\/+/, '')
    const root = mount.host.replace(/\\/g, '/').replace(/\/+$/, '')
    return rest ? `${root}/${rest}` : root
  }
  return null
}

/**
 * Stem separation used to persist the container's own view of the filesystem
 * (`/data/stems/...`), which does not exist on the host — those rows pointed at
 * nothing and the stems never played. New rows are translated on the way in
 * (`toHostPath` in services/lab.ts); this fixes the ones already stored.
 *
 * Returns how many rows were rewritten and how many stale duplicates were
 * dropped, so callers can log something meaningful.
 */
export function repairContainerPaths(
  sqlite: Database.Database,
  mounts: MountMap[]
): { fixed: number; dropped: number } {
  const rows = sqlite
    .prepare("SELECT id, path FROM media_assets WHERE path LIKE '/%'")
    .all() as Array<{ id: number; path: string }>

  const update = sqlite.prepare('UPDATE media_assets SET path = ? WHERE id = ?')
  const drop = sqlite.prepare('DELETE FROM media_assets WHERE id = ?')

  let fixed = 0
  let dropped = 0
  for (const row of rows) {
    const host = translateContainerPath(row.path, mounts)
    if (!host || host === row.path) continue
    try {
      update.run(host, row.id)
      fixed++
    } catch {
      // the repaired path collides with a row that already holds it, so this
      // one is the stale duplicate
      drop.run(row.id)
      dropped++
    }
  }
  return { fixed, dropped }
}

/**
 * Drop the store's packaging from titles already in the library.
 *
 * Songs imported from a Spotify playlist came in as "The Four Horsemen -
 * Remastered" and "The Trooper (Original Album Version)". Beyond looking wrong
 * in the setlist, those names are what the tab and archive.org searches were
 * built from, and nothing is filed under them — the searches came back empty.
 * Only the title is touched, and only when the cleaner actually changes it.
 */
export function cleanStoredTitles(sqlite: Database.Database): {
  renamed: number
  examples: string[]
} {
  const rows = sqlite.prepare('SELECT id, title FROM songs').all() as Array<{
    id: number
    title: string
  }>
  const update = sqlite.prepare('UPDATE songs SET title = ? WHERE id = ?')
  const examples: string[] = []
  let renamed = 0

  const tx = sqlite.transaction(() => {
    for (const row of rows) {
      const cleaned = cleanTitle(row.title)
      if (!cleaned || cleaned === row.title) continue
      update.run(cleaned, row.id)
      renamed++
      if (examples.length < 3) examples.push(`${row.title} → ${cleaned}`)
    }
  })
  tx()

  return { renamed, examples }
}
