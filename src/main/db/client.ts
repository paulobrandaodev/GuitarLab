import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'
import * as schema from './schema'
import {
  repairContainerPaths,
  cleanStoredTitles,
  dropUntrackedProgress,
  repairGuitarProText
} from './repair'
import { parseGuitarProFile } from '../importers/guitarpro'
import { PRACTICE_INSTRUMENT } from '@shared/types'

let _db: BetterSQLite3Database<typeof schema> | null = null
let _sqlite: Database.Database | null = null

/**
 * Schema is created with plain DDL rather than drizzle-kit migrations so the
 * app is self-bootstrapping on first launch — no generate step required to run.
 * Drizzle still owns all reads/writes and the type layer.
 */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  mbid TEXT,
  spotify_id TEXT,
  image_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tunings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT 'guitar',
  string_count INTEGER NOT NULL,
  strings_json TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT tunings_unique UNIQUE (name, string_count)
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  album TEXT,
  year INTEGER,
  genre TEXT,
  duration_ms INTEGER,
  spotify_id TEXT,
  mb_recording_id TEXT,
  musical_key TEXT,
  key_source TEXT,
  bpm REAL,
  bpm_source TEXT,
  time_signature TEXT,
  tuning_id INTEGER REFERENCES tunings(id) ON DELETE SET NULL,
  capo INTEGER NOT NULL DEFAULT 0,
  difficulty INTEGER,
  notes TEXT,
  loudness_lufs REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS songs_title_idx ON songs(title);
CREATE INDEX IF NOT EXISTS songs_artist_idx ON songs(artist_id);

CREATE TABLE IF NOT EXISTS song_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  position INTEGER NOT NULL DEFAULT 0,
  start_ms INTEGER,
  end_ms INTEGER,
  start_bar INTEGER,
  end_bar INTEGER,
  color TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS sections_song_idx ON song_sections(song_id);

CREATE TABLE IF NOT EXISTS setlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  band TEXT,
  spotify_playlist_id TEXT,
  event_date INTEGER,
  venue TEXT,
  notes TEXT,
  target_ready_date INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS setlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  planned_key TEXT,
  transition_note TEXT,
  CONSTRAINT setlist_items_unique UNIQUE (setlist_id, song_id)
);
CREATE INDEX IF NOT EXISTS setlist_items_setlist_idx ON setlist_items(setlist_id);

CREATE TABLE IF NOT EXISTS charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  transposed_semitones INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS charts_song_idx ON charts(song_id);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  file_hash TEXT,
  bytes INTEGER,
  meta_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT media_path_unique UNIQUE (path)
);
CREATE INDEX IF NOT EXISTS media_song_idx ON media_assets(song_id);

CREATE TABLE IF NOT EXISTS youtube_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unknown',
  title TEXT,
  channel TEXT,
  duration_s INTEGER,
  confidence REAL NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT yt_song_video_unique UNIQUE (song_id, video_id)
);
CREATE INDEX IF NOT EXISTS yt_song_idx ON youtube_refs(song_id);

CREATE TABLE IF NOT EXISTS gear_patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL DEFAULT 'guitar',
  device TEXT,
  patch_name TEXT,
  settings_json TEXT,
  screenshot_path TEXT,
  notes TEXT,
  section_id INTEGER REFERENCES song_sections(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS gear_song_idx ON gear_patches(song_id);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES song_sections(id) ON DELETE SET NULL,
  instrument TEXT NOT NULL DEFAULT 'guitar',
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  duration_s INTEGER NOT NULL DEFAULT 0,
  bpm_target REAL,
  bpm_achieved REAL,
  clean_passes INTEGER NOT NULL DEFAULT 0,
  total_passes INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'gp_synth',
  notes TEXT
);
CREATE INDEX IF NOT EXISTS sessions_song_idx ON practice_sessions(song_id);
CREATE INDEX IF NOT EXISTS sessions_started_idx ON practice_sessions(started_at);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES song_sections(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL DEFAULT 'guitar',
  status TEXT NOT NULL DEFAULT 'not_started',
  mastery REAL NOT NULL DEFAULT 0,
  best_bpm REAL,
  target_bpm REAL,
  last_practiced_at INTEGER,
  srs_ease REAL NOT NULL DEFAULT 2.5,
  srs_interval_days REAL NOT NULL DEFAULT 0,
  srs_reps INTEGER NOT NULL DEFAULT 0,
  srs_due_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT progress_unique UNIQUE (song_id, section_id, instrument)
);
CREATE INDEX IF NOT EXISTS progress_song_idx ON progress(song_id);
CREATE INDEX IF NOT EXISTS progress_due_idx ON progress(srs_due_at);

CREATE TABLE IF NOT EXISTS practice_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES song_sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS practice_queue_song_idx ON practice_queue(song_id);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  remote_job_id TEXT,
  params_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_song_idx ON analysis_jobs(song_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON analysis_jobs(status);

CREATE TABLE IF NOT EXISTS llm_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  section_id INTEGER REFERENCES song_sections(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS insights_song_idx ON llm_insights(song_id);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at INTEGER,
  scopes TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Standard tunings, low string first. Seeded once on a fresh database. */
const BUILTIN_TUNINGS: Array<{
  name: string
  instrument: 'guitar' | 'bass'
  strings: string[]
}> = [
  { name: 'E Standard', instrument: 'guitar', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { name: 'Eb Standard', instrument: 'guitar', strings: ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
  { name: 'D Standard', instrument: 'guitar', strings: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { name: 'Drop D', instrument: 'guitar', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { name: 'Drop C#', instrument: 'guitar', strings: ['C#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
  { name: 'Drop C', instrument: 'guitar', strings: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { name: 'Drop B', instrument: 'guitar', strings: ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'] },
  // C standard is what Queens of the Stone Age use on No One Knows
  { name: 'C# Standard', instrument: 'guitar', strings: ['C#2', 'F#2', 'B2', 'E3', 'G#3', 'C#4'] },
  { name: 'C Standard', instrument: 'guitar', strings: ['C2', 'F2', 'A#2', 'D#3', 'G3', 'C4'] },
  { name: 'B Standard', instrument: 'guitar', strings: ['B1', 'E2', 'A2', 'D3', 'F#3', 'B3'] },
  { name: 'Open G', instrument: 'guitar', strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { name: 'Open D', instrument: 'guitar', strings: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { name: 'DADGAD', instrument: 'guitar', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { name: 'E Standard (7)', instrument: 'guitar', strings: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { name: 'E Standard (baixo 4)', instrument: 'bass', strings: ['E1', 'A1', 'D2', 'G2'] },
  { name: 'Eb Standard (baixo 4)', instrument: 'bass', strings: ['D#1', 'G#1', 'C#2', 'F#2'] },
  { name: 'D Standard (baixo 4)', instrument: 'bass', strings: ['D1', 'G1', 'C2', 'F2'] },
  { name: 'C Standard (baixo 4)', instrument: 'bass', strings: ['C1', 'F1', 'A#1', 'D#2'] },
  { name: 'Drop D (baixo 4)', instrument: 'bass', strings: ['D1', 'A1', 'D2', 'G2'] },
  { name: 'E Standard (baixo 5)', instrument: 'bass', strings: ['B0', 'E1', 'A1', 'D2', 'G2'] },
  { name: 'E Standard (baixo 6)', instrument: 'bass', strings: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'] }
]

function seed(sqlite: Database.Database): void {
  // Run every launch, not just on an empty table, so tunings added in a later
  // version reach databases that already exist. INSERT OR IGNORE makes it a
  // no-op for rows already present and never touches user-created tunings.
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO tunings (name, instrument, string_count, strings_json, is_builtin)
     VALUES (?, ?, ?, ?, 1)`
  )
  const tx = sqlite.transaction(() => {
    for (const t of BUILTIN_TUNINGS) {
      insert.run(t.name, t.instrument, t.strings.length, JSON.stringify(t.strings))
    }
  })
  tx()

  const sl = sqlite.prepare('SELECT COUNT(*) AS n FROM setlists').get() as { n: number }
  if (sl.n === 0) {
    sqlite
      .prepare('INSERT INTO setlists (name, is_active, notes) VALUES (?, 1, ?)')
      .run('Setlist da Banda', 'Setlist principal criado automaticamente.')
  }
}

/**
 * The schema is created with `CREATE TABLE IF NOT EXISTS`, which does nothing
 * for a table that already exists — so columns added after a database was first
 * created have to be patched in by hand.
 */
function addMissingColumns(sqlite: Database.Database): void {
  const columns = new Map<string, Set<string>>()
  const info = (table: string): Set<string> => {
    if (!columns.has(table)) {
      const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      columns.set(table, new Set(rows.map((r) => r.name)))
    }
    return columns.get(table) as Set<string>
  }

  const additions: Array<[string, string, string]> = [
    ['setlists', 'band', 'TEXT'],
    ['setlists', 'spotify_playlist_id', 'TEXT'],
    // the AI answers are cached per song *and* per section now
    ['llm_insights', 'section_id', 'INTEGER']
  ]
  for (const [table, column, type] of additions) {
    if (info(table).has(column)) continue
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[db] coluna ${table}.${column} adicionada`)
  }
}

/**
 * Carry the library across the rename from Setlist Lab to GuitarLab.
 *
 * Electron derives `userData` from the app name, so the new name points at an
 * empty directory and the app would come up with no songs, no setlists and no
 * practice history. Copy rather than move: if anything goes wrong the old
 * install is still there to fall back to. The `-wal` file matters — the database
 * runs in WAL mode, so the most recent writes may live only in it.
 */
function adoptLegacyDatabase(): void {
  if (existsSync(config.paths.db) || !existsSync(config.paths.legacyDb)) return
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${config.paths.legacyDb}${suffix}`
      if (existsSync(from)) copyFileSync(from, `${config.paths.db}${suffix}`)
    }
    console.log(`[db] biblioteca do Setlist Lab adotada de ${config.paths.legacyDb}`)
  } catch (err) {
    console.error('[db] não deu para adotar o banco antigo:', err)
  }
}

export function initDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db
  mkdirSync(dirname(config.paths.db), { recursive: true })
  adoptLegacyDatabase()
  const sqlite = new Database(config.paths.db)
  sqlite.exec(DDL)
  seed(sqlite)
  addMissingColumns(sqlite)

  // paths written by an older build pointed inside the Docker container
  const repaired = repairContainerPaths(sqlite, [
    { container: '/data/stems', host: config.paths.stems },
    { container: '/data/songs', host: config.paths.songs },
    { container: '/data/gptabs', host: config.paths.gptabs }
  ])
  if (repaired.fixed || repaired.dropped) {
    console.log(
      `[db] mídia: ${repaired.fixed} caminho(s) corrigidos do container para o host, ` +
        `${repaired.dropped} duplicata(s) removida(s)`
    )
  }
  const untracked = dropUntrackedProgress(sqlite, PRACTICE_INSTRUMENT)
  if (untracked.deleted) {
    console.log(
      `[db] ${untracked.deleted} linha(s) de progresso de outros instrumentos removidas — ` +
        'as porcentagens contam só a guitarra'
    )
  }

  const text = repairGuitarProText(sqlite, (path) => {
    const parsed = parseGuitarProFile(path)
    return { title: parsed.title, artist: parsed.artist, sections: parsed.sections }
  })
  if (text.songs || text.sections) {
    console.log(
      `[db] acentuação recuperada de ${text.songs} título(s) e ${text.sections} trecho(s) ` +
        'relendo os arquivos Guitar Pro'
    )
  }

  const titles = cleanStoredTitles(sqlite)
  if (titles.renamed) {
    console.log(
      `[db] ${titles.renamed} título(s) limpos do sufixo da loja: ${titles.examples.join(' · ')}`
    )
  }

  _sqlite = sqlite
  _db = drizzle(sqlite, { schema })
  return _db
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) return initDb()
  return _db
}

/** Escape hatch for raw queries (aggregations that Drizzle makes awkward). */
export function getSqlite(): Database.Database {
  if (!_sqlite) initDb()
  return _sqlite as Database.Database
}

export function closeDb(): void {
  _sqlite?.close()
  _sqlite = null
  _db = null
}

export { schema }
