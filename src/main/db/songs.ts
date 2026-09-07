import type Database from 'better-sqlite3'
import { cleanTitle, normalizeArtist, normalizeTitle } from '../importers/matcher'
import type { NewSongInput } from '@shared/types'

/**
 * Creating a song by hand.
 *
 * Plain SQL over a `better-sqlite3` handle, like `setlists.ts` and `repair.ts`,
 * and for the same reason: the test script drives these against a copy of the
 * real database instead of re-implementing the statements and testing a
 * lookalike.
 *
 * The importers own the other way songs get created — from a Guitar Pro file or
 * a Spotify playlist — and both of those go through the fuzzy matcher first so
 * one song never becomes two rows. Typing a song in by hand has to respect the
 * same rule, so the duplicate check here uses that very matcher's normalisers.
 */

/** Fields the user may fill in, beyond the two required ones. */
const OPTIONAL_COLUMNS = [
  ['album', 'album'],
  ['year', 'year'],
  ['genre', 'genre'],
  ['durationMs', 'duration_ms'],
  ['musicalKey', 'musical_key'],
  ['bpm', 'bpm'],
  ['timeSignature', 'time_signature'],
  ['tuningId', 'tuning_id'],
  ['notes', 'notes']
] as const

export interface DuplicateSong {
  id: number
  title: string
  artist: string | null
}

/** The artist row for this name, created if this is the first song by them. */
export function upsertArtistRow(sqlite: Database.Database, name: string | null): number | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  const existing = sqlite.prepare('SELECT id FROM artists WHERE name = ?').get(trimmed) as
    | { id: number }
    | undefined
  if (existing) return existing.id
  return sqlite.prepare('INSERT INTO artists (name) VALUES (?)').run(trimmed).lastInsertRowid as number
}

/**
 * The song already in the library that this title and artist would duplicate.
 *
 * Exact on the *normalised* pair, not fuzzy: the user is typing, so "master of
 * puppets" and "Master of Puppets " must collide, but two different songs that
 * merely sound alike must not be silently merged. The fuzzy end of the matcher
 * is for files, where nobody is around to be asked.
 */
export function findDuplicateSong(
  sqlite: Database.Database,
  title: string,
  artist: string | null
): DuplicateSong | null {
  const wantedTitle = normalizeTitle(title)
  if (!wantedTitle) return null
  const wantedArtist = normalizeArtist(artist ?? '')

  const rows = sqlite
    .prepare(
      `SELECT s.id, s.title, a.name AS artist
       FROM songs s LEFT JOIN artists a ON a.id = s.artist_id`
    )
    .all() as DuplicateSong[]

  return (
    rows.find(
      (r) =>
        normalizeTitle(r.title) === wantedTitle &&
        normalizeArtist(r.artist ?? '') === wantedArtist
    ) ?? null
  )
}

/**
 * Write the song, its artist and its guitar progress row.
 *
 * The progress row is what the importers open too: without one the song has no
 * mastery to roll up, so it would never surface in the practice queue and would
 * sit outside every readiness number instead of at the bottom of them.
 */
export function insertSongRow(
  sqlite: Database.Database,
  input: NewSongInput,
  instrument: string
): number {
  const title = cleanTitle(input.title ?? '')
  const artist = input.artist?.trim() ?? ''
  if (!title) throw new Error('song title is required')
  if (!artist) throw new Error('song artist is required')

  const columns: string[] = ['title', 'artist_id', 'capo']
  const values: unknown[] = [title, upsertArtistRow(sqlite, artist), input.capo ?? 0]

  for (const [key, column] of OPTIONAL_COLUMNS) {
    const value = input[key]
    if (value === undefined || value === null || value === '') continue
    columns.push(column)
    values.push(value)
  }

  /*
   * Both `source` columns say where a value came from, and the whole app reads
   * them — the song screen prints them next to the number, and the importers
   * refuse to overwrite what a user set. "manual" is what makes a hand-typed
   * BPM survive a later Guitar Pro import.
   */
  if (input.musicalKey) {
    columns.push('key_source')
    values.push('manual')
  }
  if (input.bpm != null) {
    columns.push('bpm_source')
    values.push('manual')
  }

  const tx = sqlite.transaction(() => {
    const id = sqlite
      .prepare(
        `INSERT INTO songs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
      )
      .run(...values).lastInsertRowid as number
    sqlite
      .prepare('INSERT INTO progress (song_id, section_id, instrument) VALUES (?, NULL, ?)')
      .run(id, instrument)
    return id
  })

  return tx()
}
