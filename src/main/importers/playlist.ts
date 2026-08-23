import { eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import * as repo from '../db/repo'
import { matchSong, cleanTitle, type MatchCandidate } from './matcher'
import type { PlaylistTrack } from '../services/spotify'
import type { PlaylistImportView } from '@shared/types'

/**
 * Turn a Spotify playlist into a setlist.
 *
 * Tracks are matched against the existing library first — a song imported from
 * a Guitar Pro file and the same song on Spotify must end up as one row, not
 * two — and only genuinely new titles are created. The Spotify id and album
 * metadata are folded into whatever the song already knows.
 *
 * Importing the same playlist twice refreshes the setlist it already produced
 * instead of making a second copy of it: songs that left the playlist leave the
 * set, new ones are appended, and the order follows the playlist. The link is
 * the playlist id stored on the setlist, so renaming either side keeps working.
 */

export type PlaylistImportReport = PlaylistImportView

function upsertArtist(name: string | null): number | null {
  if (!name?.trim()) return null
  const db = getDb()
  const trimmed = name.trim()
  const existing = db.select().from(schema.artists).where(eq(schema.artists.name, trimmed)).get()
  if (existing) return existing.id
  return db.insert(schema.artists).values({ name: trimmed }).returning().get().id
}

function candidates(): MatchCandidate[] {
  const db = getDb()
  return db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.artists.name
    })
    .from(schema.songs)
    .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
    .all() as MatchCandidate[]
}

function titlesFor(songIds: number[]): Map<number, string> {
  if (!songIds.length) return new Map()
  const rows = getDb()
    .select({ id: schema.songs.id, title: schema.songs.title })
    .from(schema.songs)
    .where(inArray(schema.songs.id, songIds))
    .all()
  return new Map(rows.map((r) => [r.id, r.title]))
}

export function importPlaylist(
  tracks: PlaylistTrack[],
  setlistName: string,
  band: string | null,
  spotifyPlaylistId?: string | null
): PlaylistImportReport {
  const db = getDb()

  const existing = spotifyPlaylistId ? repo.findSetlistBySpotifyPlaylist(spotifyPlaylistId) : null
  const setlist = existing ?? repo.createSetlist(setlistName, band, spotifyPlaylistId ?? null)
  if (existing) {
    // the dialog carries the name and band the user wants this time round
    repo.updateSetlist(existing.id, { name: setlistName, band })
  }

  const report: PlaylistImportReport = {
    setlist,
    mode: existing ? 'updated' : 'created',
    created: 0,
    matched: 0,
    skipped: 0,
    removed: 0,
    details: []
  }

  /** Song ids in playlist order — what the setlist must end up holding. */
  const ordered: number[] = []
  const seen = new Set<number>()

  for (const track of tracks) {
    const artist = track.artists[0] ?? null
    const match = matchSong(track.name, artist, candidates())

    let songId: number
    if (match.songId) {
      songId = match.songId
      report.matched++
      report.details.push({ title: track.name, action: 'matched', note: match.reason })
    } else {
      const row = db
        .insert(schema.songs)
        .values({
          // Spotify hands over "Song - Remastered"; the library keeps the song
          title: cleanTitle(track.name),
          artistId: upsertArtist(artist),
          album: track.album,
          year: track.year,
          durationMs: track.durationMs,
          spotifyId: track.spotifyId
        })
        .returning()
        .get()
      songId = row.id
      report.created++
      report.details.push({ title: track.name, action: 'created' })
    }

    // fill in facts the existing row may be missing, without overwriting them
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
    if (song) {
      const patch: Record<string, unknown> = {}
      if (!song.spotifyId && track.spotifyId) patch.spotifyId = track.spotifyId
      if (song.durationMs == null && track.durationMs != null) patch.durationMs = track.durationMs
      if (!song.album && track.album) patch.album = track.album
      if (song.year == null && track.year != null) patch.year = track.year
      if (Object.keys(patch).length) {
        db.update(schema.songs).set(patch).where(eq(schema.songs.id, songId)).run()
      }
    }

    // a playlist can list the same track twice; the setlist should not
    if (seen.has(songId)) {
      report.skipped++
      report.details.push({ title: track.name, action: 'skipped', note: 'repetida na playlist' })
      continue
    }
    seen.add(songId)
    ordered.push(songId)
  }

  const sync = repo.syncSetlistSongs(setlist.id, ordered)
  report.removed = sync.removed
  const removedTitles = titlesFor(sync.removedSongIds)
  for (const songId of sync.removedSongIds) {
    report.details.push({
      title: removedTitles.get(songId) ?? `música #${songId}`,
      action: 'removed',
      note: 'saiu da playlist no Spotify'
    })
  }

  // re-read so songCount and readiness reflect what was just synced
  const fresh = repo.listSetlists().find((s) => s.id === setlist.id)
  if (fresh) report.setlist = fresh
  return report
}
