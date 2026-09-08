import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const now = sql`(unixepoch())`

/* ---------------------------------------------------------------- artists */
export const artists = sqliteTable('artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  mbid: text('mbid'),
  spotifyId: text('spotify_id'),
  imageUrl: text('image_url'),
  createdAt: integer('created_at').notNull().default(now)
})

/* ---------------------------------------------------------------- tunings */
// stringsJson: array low->high of note names, e.g. ["E2","A2","D3","G3","B3","E4"]
export const tunings = sqliteTable(
  'tunings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    instrument: text('instrument', { enum: ['guitar', 'bass', 'other'] })
      .notNull()
      .default('guitar'),
    stringCount: integer('string_count').notNull(),
    stringsJson: text('strings_json').notNull(),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [unique('tunings_unique').on(t.name, t.stringCount)]
)

/* ------------------------------------------------------------------ songs */
export const songs = sqliteTable(
  'songs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    artistId: integer('artist_id').references(() => artists.id, { onDelete: 'set null' }),
    album: text('album'),
    year: integer('year'),
    genre: text('genre'),
    durationMs: integer('duration_ms'),

    // external ids
    spotifyId: text('spotify_id'),
    mbRecordingId: text('mb_recording_id'),

    // musical facts, each paired with where the value came from
    musicalKey: text('musical_key'),
    keySource: text('key_source'),
    bpm: real('bpm'),
    bpmSource: text('bpm_source'),
    timeSignature: text('time_signature'),
    tuningId: integer('tuning_id').references(() => tunings.id, { onDelete: 'set null' }),
    capo: integer('capo').notNull().default(0),

    difficulty: integer('difficulty'),
    notes: text('notes'),

    // integrated loudness of the master audio, for cross-source gain matching
    loudnessLufs: real('loudness_lufs'),

    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('songs_title_idx').on(t.title), index('songs_artist_idx').on(t.artistId)]
)

/* ----------------------------------------------------------- song sections */
export const songSections = sqliteTable(
  'song_sections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['intro', 'verse', 'chorus', 'bridge', 'solo', 'outro', 'riff', 'breakdown', 'other']
    })
      .notNull()
      .default('other'),
    position: integer('position').notNull().default(0),
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    startBar: integer('start_bar'),
    endBar: integer('end_bar'),
    color: text('color'),
    source: text('source', { enum: ['gp', 'analysis', 'manual', 'ai'] })
      .notNull()
      .default('manual')
  },
  (t) => [index('sections_song_idx').on(t.songId)]
)

/* --------------------------------------------------------------- setlists */
export const setlists = sqliteTable('setlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Which of the user's bands this set is for — they play in more than one. */
  band: text('band'),
  /**
   * Set when the setlist came from a Spotify playlist. It is what makes a
   * second import of the same playlist a refresh instead of a duplicate.
   */
  spotifyPlaylistId: text('spotify_playlist_id'),
  eventDate: integer('event_date'),
  venue: text('venue'),
  notes: text('notes'),
  targetReadyDate: integer('target_ready_date'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now)
})

export const setlistItems = sqliteTable(
  'setlist_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setlistId: integer('setlist_id')
      .notNull()
      .references(() => setlists.id, { onDelete: 'cascade' }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    plannedKey: text('planned_key'),
    transitionNote: text('transition_note')
  },
  (t) => [
    index('setlist_items_setlist_idx').on(t.setlistId),
    unique('setlist_items_unique').on(t.setlistId, t.songId)
  ]
)

/* ----------------------------------------------------------------- charts */
export const charts = sqliteTable(
  'charts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    // `chord_map` is the time-aligned chord track detected from the audio; it
    // is stored as JSON rather than ChordPro because it carries timestamps.
    kind: text('kind', { enum: ['chords', 'lyrics', 'tab_text', 'notes', 'chord_map'] }).notNull(),
    format: text('format', {
      enum: ['chordpro', 'lrc', 'plain', 'markdown', 'json']
    }).notNull(),
    content: text('content').notNull(),
    sourceUrl: text('source_url'),
    transposedSemitones: integer('transposed_semitones').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('charts_song_idx').on(t.songId)]
)

/* ----------------------------------------------------------- media assets */
export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'guitarpro',
        'audio_master',
        'midi',
        'image',
        'waveform',
        'stem_vocals',
        'stem_drums',
        'stem_bass',
        'stem_guitar',
        'stem_piano',
        'stem_other'
      ]
    }).notNull(),
    path: text('path').notNull(),
    fileHash: text('file_hash'),
    bytes: integer('bytes'),
    metaJson: text('meta_json'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('media_song_idx').on(t.songId), unique('media_path_unique').on(t.path)]
)

/* ----------------------------------------------------------- youtube refs */
export const youtubeRefs = sqliteTable(
  'youtube_refs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    videoId: text('video_id').notNull(),
    role: text('role', {
      enum: [
        'lesson_tabs',
        'backing_track',
        'guitar_only',
        'bass_only',
        'drums_only',
        'official',
        'live',
        'cover',
        'unknown'
      ]
    })
      .notNull()
      .default('unknown'),
    title: text('title'),
    channel: text('channel'),
    durationS: integer('duration_s'),
    confidence: real('confidence').notNull().default(0),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('yt_song_idx').on(t.songId), unique('yt_song_video_unique').on(t.songId, t.videoId)]
)

/* ------------------------------------------------------------ gear patches */
export const gearPatches = sqliteTable(
  'gear_patches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    instrument: text('instrument', { enum: ['guitar', 'bass', 'drums', 'vocals'] })
      .notNull()
      .default('guitar'),
    device: text('device'),
    patchName: text('patch_name'),
    settingsJson: text('settings_json'),
    screenshotPath: text('screenshot_path'),
    notes: text('notes'),
    sectionId: integer('section_id').references(() => songSections.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('gear_song_idx').on(t.songId)]
)

/* ------------------------------------------------------- practice sessions */
export const practiceSessions = sqliteTable(
  'practice_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id').references(() => songSections.id, { onDelete: 'set null' }),
    instrument: text('instrument', { enum: ['guitar', 'bass', 'drums', 'vocals'] })
      .notNull()
      .default('guitar'),
    startedAt: integer('started_at').notNull().default(now),
    durationS: integer('duration_s').notNull().default(0),
    bpmTarget: real('bpm_target'),
    bpmAchieved: real('bpm_achieved'),
    cleanPasses: integer('clean_passes').notNull().default(0),
    totalPasses: integer('total_passes').notNull().default(0),
    mode: text('mode', {
      enum: ['gp_synth', 'stems', 'youtube', 'spotify', 'metronome', 'freeplay']
    })
      .notNull()
      .default('gp_synth'),
    notes: text('notes')
  },
  (t) => [index('sessions_song_idx').on(t.songId), index('sessions_started_idx').on(t.startedAt)]
)

/* --------------------------------------------------------------- progress */
// One row per (song, instrument, section). sectionId NULL = whole-song rollup.
export const progress = sqliteTable(
  'progress',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id').references(() => songSections.id, { onDelete: 'cascade' }),
    instrument: text('instrument', { enum: ['guitar', 'bass', 'drums', 'vocals'] })
      .notNull()
      .default('guitar'),
    status: text('status', {
      enum: ['not_started', 'learning', 'shaky', 'solid', 'gig_ready']
    })
      .notNull()
      .default('not_started'),
    mastery: real('mastery').notNull().default(0),
    bestBpm: real('best_bpm'),
    targetBpm: real('target_bpm'),
    lastPracticedAt: integer('last_practiced_at'),
    // SM-2
    srsEase: real('srs_ease').notNull().default(2.5),
    srsIntervalDays: real('srs_interval_days').notNull().default(0),
    srsReps: integer('srs_reps').notNull().default(0),
    srsDueAt: integer('srs_due_at'),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [
    index('progress_song_idx').on(t.songId),
    index('progress_due_idx').on(t.srsDueAt),
    unique('progress_unique').on(t.songId, t.sectionId, t.instrument)
  ]
)

/* ---------------------------------------------------------- practice queue */
/*
 * Songs and sections the user put on today's list by hand.
 *
 * The daily queue is otherwise derived — overdue, shaky, gig approaching — and
 * that is the right default, but there was no way to say "I want to work on
 * this one today". A row here pins an item to the top of the queue and keeps it
 * there until it is taken off. `sectionId` NULL means the whole song.
 */
export const practiceQueue = sqliteTable(
  'practice_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id').references(() => songSections.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedAt: integer('added_at').notNull().default(now)
  },
  (t) => [index('practice_queue_song_idx').on(t.songId)]
)

/* ---------------------------------------------------------- analysis jobs */
export const analysisJobs = sqliteTable(
  'analysis_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['stems', 'rhythm', 'harmony', 'transcribe', 'lyrics'] }).notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'error', 'canceled'] })
      .notNull()
      .default('queued'),
    progress: real('progress').notNull().default(0),
    remoteJobId: text('remote_job_id'),
    paramsJson: text('params_json'),
    resultJson: text('result_json'),
    error: text('error'),
    createdAt: integer('created_at').notNull().default(now),
    finishedAt: integer('finished_at')
  },
  (t) => [index('jobs_song_idx').on(t.songId), index('jobs_status_idx').on(t.status)]
)

/* ----------------------------------------------------------- llm insights */
export const llmInsights = sqliteTable(
  'llm_insights',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'practice_plan',
        'technique_breakdown',
        'tone_advice',
        'structure_summary',
        'daily_plan'
      ]
    }).notNull(),
    /**
     * Which part of the song the answer is about; NULL means the whole song.
     *
     * A technique breakdown is asked per section, so without this the cache
     * would hand the answer for the solo back to someone who opened the intro.
     */
    sectionId: integer('section_id').references(() => songSections.id, { onDelete: 'cascade' }),
    contentMd: text('content_md').notNull(),
    model: text('model'),
    provider: text('provider'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('insights_song_idx').on(t.songId)]
)

/* ----------------------------------------------------------- oauth/prefs */
export const oauthTokens = sqliteTable('oauth_tokens', {
  provider: text('provider').primaryKey(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: integer('expires_at'),
  scopes: text('scopes'),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

/* ------------------------------------------------------------------ types */
export type Song = typeof songs.$inferSelect
export type NewSong = typeof songs.$inferInsert
export type Section = typeof songSections.$inferSelect
export type NewSection = typeof songSections.$inferInsert
export type Progress = typeof progress.$inferSelect
export type MediaAsset = typeof mediaAssets.$inferSelect
export type YoutubeRef = typeof youtubeRefs.$inferSelect
export type PracticeSession = typeof practiceSessions.$inferSelect
export type AnalysisJob = typeof analysisJobs.$inferSelect
export type Tuning = typeof tunings.$inferSelect
export type Setlist = typeof setlists.$inferSelect
export type Chart = typeof charts.$inferSelect
export type GearPatch = typeof gearPatches.$inferSelect
export type PracticeQueueRow = typeof practiceQueue.$inferSelect
export type LlmInsight = typeof llmInsights.$inferSelect
