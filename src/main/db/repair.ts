import type Database from 'better-sqlite3'
import { cleanTitle } from '../importers/matcher'
import { isDamagedText } from '@shared/gp'

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

/**
 * Remove the progress rows for instruments this app does not track.
 *
 * Importing a Guitar Pro file used to open one progress row per track, so a
 * five-track arrangement got a bass, a drum and a vocal row alongside the
 * guitar. Nobody ever touches those rows, they sit at `not_started`, and they
 * were averaged into the song's mastery ring — which is why a song whose guitar
 * part was solid still showed a third of the circle filled. Nothing of value is
 * lost: a row that was never practised carries no history.
 */
export function dropUntrackedProgress(
  sqlite: Database.Database,
  keep: string
): { deleted: number } {
  const found = sqlite
    .prepare('SELECT COUNT(*) AS n FROM progress WHERE instrument <> ?')
    .get(keep) as { n: number }
  if (found.n === 0) return { deleted: 0 }
  sqlite.prepare('DELETE FROM progress WHERE instrument <> ?').run(keep)
  return { deleted: found.n }
}

/** What a re-parse of a Guitar Pro file gives back to this repair. */
export interface GpTextSource {
  title: string | null
  artist: string | null
  sections: Array<{ name: string; startBar: number }>
}

/**
 * Re-read the Guitar Pro files behind text that was decoded with the wrong
 * encoding.
 *
 * The importer now retries GP3-GP5 under the legacy code page, so new imports
 * come in clean — but a title or section marker already stored as "Ot?rio eu
 * vou te avisar" is unrecoverable in place: the failed decode replaced the
 * original bytes with U+FFFD and threw them away. The file on disk still has
 * them, so the fix is to parse it again and overwrite only the damaged rows.
 *
 * The parser is injected rather than imported so this stays testable without
 * dragging alphaTab into a database test, and so a single unreadable file
 * (moved, deleted, corrupt) is skipped instead of aborting the whole pass.
 */
export function repairGuitarProText(
  sqlite: Database.Database,
  parse: (path: string) => GpTextSource
): { songs: number; sections: number } {
  const damaged = sqlite
    .prepare(
      `SELECT DISTINCT s.id AS songId, s.title AS title, m.path AS path
         FROM songs s
         JOIN media_assets m ON m.song_id = s.id AND m.kind = 'guitarpro'
        WHERE s.title LIKE '%' || char(65533) || '%'
           OR EXISTS (
                SELECT 1 FROM song_sections sec
                 WHERE sec.song_id = s.id
                   AND sec.name LIKE '%' || char(65533) || '%'
              )`
    )
    .all() as Array<{ songId: number; title: string; path: string }>
  if (!damaged.length) return { songs: 0, sections: 0 }

  const setTitle = sqlite.prepare('UPDATE songs SET title = ? WHERE id = ?')
  const setSection = sqlite.prepare('UPDATE song_sections SET name = ? WHERE id = ?')
  const readSections = sqlite.prepare(
    'SELECT id, name, start_bar AS startBar FROM song_sections WHERE song_id = ? ORDER BY position'
  )

  let songs = 0
  let sections = 0
  for (const row of damaged) {
    let parsed: GpTextSource
    try {
      parsed = parse(row.path)
    } catch {
      // the file moved or will not parse — leave the row alone rather than
      // replacing readable-ish text with nothing
      continue
    }

    const tx = sqlite.transaction(() => {
      if (isDamagedText(row.title) && parsed.title && !isDamagedText(parsed.title)) {
        setTitle.run(parsed.title, row.songId)
        songs++
      }

      const stored = readSections.all(row.songId) as Array<{
        id: number
        name: string
        startBar: number | null
      }>
      for (const section of stored) {
        if (!isDamagedText(section.name)) continue
        // match on the bar the marker sits at: names are exactly what is broken,
        // and the bar numbers survived the bad decode untouched
        const fresh = parsed.sections.find((s) => s.startBar === section.startBar)
        if (!fresh || isDamagedText(fresh.name)) continue
        setSection.run(fresh.name, section.id)
        sections++
      }
    })
    tx()
  }

  return { songs, sections }
}
