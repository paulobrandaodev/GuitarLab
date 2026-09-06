/** Types shared between main, preload and renderer. Keep this free of Node/DOM imports. */

export type Instrument = 'guitar' | 'bass' | 'drums' | 'vocals'
export type ProgressStatus = 'not_started' | 'learning' | 'shaky' | 'solid' | 'gig_ready'
export type SectionKind =
  | 'intro'
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'solo'
  | 'outro'
  | 'riff'
  | 'breakdown'
  | 'other'
export type PracticeMode = 'gp_synth' | 'stems' | 'youtube' | 'spotify' | 'metronome' | 'freeplay'
export type YoutubeRole =
  | 'lesson_tabs'
  | 'backing_track'
  | 'guitar_only'
  | 'bass_only'
  | 'drums_only'
  | 'official'
  | 'live'
  | 'cover'
  | 'unknown'
export type StemName = 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other'
export type AnalysisType = 'stems' | 'rhythm' | 'harmony' | 'transcribe' | 'lyrics'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export const INSTRUMENTS: Instrument[] = ['guitar', 'bass', 'drums', 'vocals']

/**
 * The instrument this app is about.
 *
 * The data model still stores one progress row per instrument — a Guitar Pro
 * file carries the whole band and the stem separator writes a bass and a drum
 * track — but nothing the user is scored on counts anything except the guitar.
 * Every readiness number, every practice-queue candidate and every session
 * written from the practice screen goes through this constant, so "100% focused
 * on guitar" is one edit away from being false rather than scattered across a
 * dozen literals.
 */
export const PRACTICE_INSTRUMENT: Instrument = 'guitar'

export const STATUS_ORDER: ProgressStatus[] = [
  'not_started',
  'learning',
  'shaky',
  'solid',
  'gig_ready'
]

/*
 * Display labels for these enums live in the string catalogue
 * (src/shared/i18n), not here. A pure types module cannot be
 * locale-aware without dragging language state into both processes.
 */

/** The three roles the practice screen offers as dedicated slots. */
export const PRIMARY_ROLES: YoutubeRole[] = ['lesson_tabs', 'backing_track', 'guitar_only']

/* ------------------------------------------------------------------ views */

export interface SongView {
  id: number
  title: string
  artist: string | null
  artistId: number | null
  album: string | null
  year: number | null
  genre: string | null
  durationMs: number | null
  musicalKey: string | null
  keySource: string | null
  bpm: number | null
  bpmSource: string | null
  timeSignature: string | null
  capo: number
  difficulty: number | null
  notes: string | null
  loudnessLufs: number | null
  tuning: TuningView | null
  /** Rolled-up mastery 0..100 across all tracked instruments. */
  mastery: number
  status: ProgressStatus
  hasGuitarPro: boolean
  hasAudio: boolean
  hasStems: boolean
  lastPracticedAt: number | null
}

export interface TuningView {
  id: number
  name: string
  instrument: 'guitar' | 'bass' | 'other'
  stringCount: number
  strings: string[]
}

export interface SectionView {
  id: number
  songId: number
  name: string
  kind: SectionKind
  position: number
  startMs: number | null
  endMs: number | null
  startBar: number | null
  endBar: number | null
  color: string | null
  source: 'gp' | 'analysis' | 'manual'
}

export interface ProgressView {
  id: number
  songId: number
  sectionId: number | null
  instrument: Instrument
  status: ProgressStatus
  mastery: number
  bestBpm: number | null
  targetBpm: number | null
  lastPracticedAt: number | null
  srsDueAt: number | null
}

export interface SetlistView {
  id: number
  name: string
  /** Which of the user's bands plays this set. */
  band: string | null
  /**
   * The Spotify playlist this set was imported from, when it came from one.
   * Re-importing the same playlist updates this set instead of creating a
   * second copy of it.
   */
  spotifyPlaylistId: string | null
  eventDate: number | null
  venue: string | null
  notes: string | null
  targetReadyDate: number | null
  isActive: boolean
  songCount: number
  totalDurationMs: number
  /** 0..100 across the songs in the setlist. */
  readiness: number
}

export interface SetlistItemView {
  itemId: number
  position: number
  plannedKey: string | null
  transitionNote: string | null
  song: SongView
}

export interface MediaAssetView {
  id: number
  songId: number
  kind: string
  path: string
  bytes: number | null
  meta: Record<string, unknown> | null
}

export interface YoutubeRefView {
  id: number
  songId: number
  videoId: string
  role: YoutubeRole
  title: string | null
  channel: string | null
  durationS: number | null
  confidence: number
  verified: boolean
  pinned: boolean
}

export interface AnalysisJobView {
  id: number
  songId: number
  type: AnalysisType
  status: JobStatus
  progress: number
  error: string | null
  result: Record<string, unknown> | null
  createdAt: number
  finishedAt: number | null
}

/* ------------------------------------------------------------- audio meta */

export interface AudioProbe {
  path: string
  durationMs: number
  sampleRate: number
  channels: number
  codec: string
  bitrateKbps: number | null
  bytes: number
  tags: {
    title?: string
    artist?: string
    album?: string
    albumArtist?: string
    genre?: string
    date?: string
    track?: string
  }
}

export interface GpTrackInfo {
  index: number
  name: string
  /** General MIDI program number. */
  midiProgram: number
  isPercussion: boolean
  stringCount: number
  /** Tuning note names, low string first, e.g. ["E2","A2","D3","G3","B3","E4"]. */
  tuning: string[]
  capo: number
  instrument: Instrument | null
}

export interface GpParseResult {
  title: string | null
  artist: string | null
  album: string | null
  tempo: number | null
  timeSignature: string | null
  musicalKey: string | null
  barCount: number
  tracks: GpTrackInfo[]
  sections: Array<{ name: string; startBar: number; endBar: number | null }>
}

/* ------------------------------------------------------- import reporting */

export interface ImportReport {
  scanned: number
  created: number
  matched: number
  skipped: number
  errors: Array<{ file: string; message: string }>
  details: Array<{
    file: string
    action: 'created' | 'matched' | 'skipped' | 'error'
    songId?: number
    songTitle?: string
    note?: string
  }>
}

/* ------------------------------------------------------------ integrations */

export interface IntegrationStatus {
  spotify: { configured: boolean; connected: boolean; detail: string }
  youtube: { configured: boolean; quotaUsedToday: number; quotaLimit: number; detail: string }
  llm: { provider: string; fallback: string; configured: boolean; detail: string }
  lab: { url: string; reachable: boolean; gpu: string | null; detail: string }
  ffmpeg: { available: boolean; version: string | null; path: string | null }
}

/* --------------------------------------------------------------- practice */

export interface SpeedTrainerState {
  sectionId: number | null
  instrument: Instrument
  currentBpm: number
  targetBpm: number
  stepBpm: number
  passesAtCurrent: number
  requiredPasses: number
  cleanPasses: number
  totalPasses: number
}

export interface DailyQueueItem {
  songId: number
  songTitle: string
  artist: string | null
  sectionId: number | null
  sectionName: string | null
  instrument: Instrument
  status: ProgressStatus
  mastery: number
  bestBpm: number | null
  targetBpm: number | null
  dueAt: number | null
  /** Higher = practice sooner. */
  priority: number
  estimatedMinutes: number
  reason: string
  /** The user put this on the list by hand; it stays there until taken off. */
  pinned: boolean
}

/** One entry of the hand-built practice queue. `sectionId` null = whole song. */
export interface QueuePinView {
  songId: number
  sectionId: number | null
  songTitle: string
  artist: string | null
  sectionName: string | null
  addedAt: number
}

/* -------------------------------------------------------------- gear/tone */

/** The rig the tone suggestions are written for. Editable in the Timbre tab. */
export interface RigView {
  guitar: string
  processor: string
  /** Where the signal ends up — changes the cabinet/EQ advice a lot. */
  output: 'pa' | 'fones' | 'amp'
}

export const RIG_DEFAULT: RigView = {
  guitar: 'Ibanez JEM (chinesa)',
  processor: 'Boss GT-1',
  output: 'pa'
}

/**
 * Rig output, in English, for the two places where the words are data rather
 * than interface: the AI prompt, and the signal chain persisted inside
 * gear_patches. Translating these would make a patch generated in Spanish
 * store `chain: ["Guitarra", "COMP", "PA / mesa de sonido"]` and then show
 * Spanish labels to a Portuguese reader. What the user sees comes from the
 * catalogue instead.
 */
export const RIG_OUTPUT_EN: Record<RigView['output'], string> = {
  pa: 'PA / mixing desk',
  fones: 'headphones',
  amp: 'amplifier'
}

/** One knob on a pedal block. `value` is 0–100 so it can be drawn as a knob. */
export interface PatchParam {
  label: string
  /** Percentage of the knob's travel, or null when the setting is a choice. */
  value: number | null
  /** Shown instead of a number for selector-style settings (amp type, mode). */
  text?: string | null
}

/** One effect block in the processor's chain. */
export interface PatchBlock {
  /** Block type as the processor names it: COMP, OD/DS, PREAMP, DELAY… */
  slot: string
  /** The specific model chosen inside that block. */
  model: string
  enabled: boolean
  params: PatchParam[]
  note?: string | null
}

/**
 * What the processor's assignable footswitch does in this patch.
 *
 * The GT-1 has exactly one CTRL switch, so this is a single choice per patch and
 * the model has to spend it on whatever that part of the song actually needs —
 * a wah sweep, a whammy dive, a solo boost, a delay tap.
 */
export interface CtrlAssignment {
  /** The block it acts on: "WAH", "WHAMMY", "DELAY", "PREAMP SOLO"… */
  target: string
  /** What one press does, in a line. */
  action: string
  /** Where in the song it earns its place. */
  when: string
}

/**
 * How the record's tuning is reached without retuning the guitar.
 *
 * The rule the player set: the guitar stays in E standard, at most a physical
 * Drop D. Anything below that is the pitch shifter's job, so one instrument
 * covers a set that jumps between tunings.
 */
export interface PitchShifterPlan {
  /** Whether the PS block carries any of the drop. */
  enabled: boolean
  /** Semitones the block adds; negative shifts down. */
  semitones: number
  /** What the player physically tunes to: "E padrão" or "Drop D". */
  playedTuning: string
  /** The tuning of the recording, for reference. */
  recordTuning: string
  note: string
}

/** One patch. A song with a clean part and a dirty part has more than one. */
export interface TonePatchView {
  patchName: string
  /** Where in the song this patch is used: "Intro e versos", "Solo"… */
  appliesTo: string
  summary: string
  /** Signal path from instrument to output, as short labels for the diagram. */
  chain: string[]
  blocks: PatchBlock[]
  /** What the single assignable footswitch does here, when it is worth using. */
  ctrl: CtrlAssignment | null
  /** What to listen for in the original recording to check the match. */
  listenFor: string
  /** Free-text caveats: output-level advice, alternatives, gotchas. */
  notes: string
  rig: RigView
  provider?: string
  model?: string
}

/** Everything the tone tab shows for one song. */
export interface TonePlanView {
  /** Chronological: the patch for the intro comes before the one for the solo. */
  patches: TonePatchView[]
  pitchShifter: PitchShifterPlan | null
  rig: RigView
  provider?: string
  model?: string
}

/* --------------------------------------------------------- IA em tempo real */

export type LlmPhase =
  | 'start'
  | 'provider_try'
  | 'provider_skip'
  | 'provider_fail'
  | 'waiting_quota'
  | 'reasoning'
  | 'text'
  | 'done'
  | 'error'

/** One step of an in-flight LLM call, streamed from the main process. */
export interface LlmProgressEvent {
  requestId: string
  phase: LlmPhase
  /** Short label for what the call is for: "patch de timbre", … */
  task: string
  provider?: string
  model?: string
  /** Incremental reasoning/answer text on the `reasoning` and `text` phases. */
  delta?: string
  message?: string
  elapsedMs?: number
}

/* --------------------------------------------------------- Spotify import */

export interface SpotifyPlaylistView {
  id: string
  name: string
  owner: string
  trackCount: number
  imageUrl: string | null
}

export interface PlaylistImportView {
  setlist: SetlistView
  /** Whether the playlist landed in a brand-new setlist or refreshed one. */
  mode: 'created' | 'updated'
  created: number
  matched: number
  skipped: number
  /** Songs that were in the setlist and are no longer in the playlist. */
  removed: number
  details: Array<{
    title: string
    action: 'created' | 'matched' | 'skipped' | 'removed'
    note?: string
  }>
}

/* ------------------------------------------------------------ fontes externas */

/** Deep links into the tab sites, built from the song's artist and title. */
export interface TabSourceLinks {
  query: string
  /** Guitar Pro tabs only (type=500), filtered to 4–5 star ratings. */
  ultimateGuitar: string
  /** Fallback: the song page on CifraClub when it could be resolved, else search. */
  cifraClub: string
  cifraClubResolved: boolean
}

/** One downloadable audio file found on archive.org. */
export interface ArchiveCandidate {
  identifier: string
  itemTitle: string
  creator: string | null
  year: number | null
  fileName: string
  /** archive.org's own format label, e.g. "VBR MP3", "Flac", "WAVE". */
  format: string
  ext: string
  sizeBytes: number | null
  durationS: number | null
  url: string
  /** 0..1 — how well this file matches the song being looked for. */
  score: number
  reason: string
}

export type DownloadKind = 'audio' | 'guitarpro'

/** Progress of a file coming down into gptabs/ or songs/. */
export interface DownloadProgress {
  songId: number
  kind: DownloadKind
  fileName: string
  receivedBytes: number
  totalBytes: number | null
  status: 'downloading' | 'importing' | 'done' | 'error'
  message?: string
}

/* --------------------------------------------------------------- acordes */

/** One chord in time, the way Chordify lays them out over the track. */
export interface ChordSpan {
  startMs: number
  endMs: number
  /** Chord symbol: "Em", "A7", "F#m", "N" for silence/no chord. */
  label: string
  /** 0..1 confidence of this individual chord. */
  confidence: number
}

/** The whole chord track for a song, detected from the audio. */
export interface ChordMapView {
  songId: number
  key: string | null
  bpm: number | null
  /** 0..1 confidence of the key estimate. */
  confidence: number
  source: 'analysis' | 'gp' | 'manual'
  beatsMs: number[]
  spans: ChordSpan[]
  updatedAt: number
}

/* ------------------------------------------------------------------ settings */

/** Where a resolved setting came from, shown next to each field. */
export type SettingSource = 'env' | 'user' | 'dotenv' | 'default'

export type SettingGroup = 'spotify' | 'youtube' | 'llm' | 'lab' | 'media' | 'app'

/**
 * One setting, as the renderer sees it.
 *
 * A secret's `value` is always empty and `present` says whether one is stored.
 * Modelling it this way means leaking a key would have to be written on
 * purpose rather than forgotten.
 */
export interface SettingView {
  key: string
  group: SettingGroup
  secret: boolean
  source: SettingSource
  present: boolean
  value: string
}

export interface SettingsSnapshot {
  settings: SettingView[]
  /** Whether the OS will encrypt secrets, and why not when it will not. */
  encryption: { available: boolean; hint: string }
  locale: string
}
