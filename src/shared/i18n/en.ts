import { plural } from './index'
import type { Catalog } from './catalog'

/**
 * English strings.
 *
 * Declared `: Catalog`, so anything missing, spare, or with the wrong argument
 * list is a compile error. Do not restructure this file — change `pt-BR.ts`,
 * the source of truth, and let the compiler point out what needs updating here.
 */
export const en: Catalog = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    remove: 'Remove',
    open: 'Open',
    back: 'Back',
    search: 'Search',
    loading: 'Loading',
    retry: 'Try again',
    confirm: 'Confirm',
    none: 'none',
    never: 'never',
    now: 'just now',
    yes: 'Yes',
    no: 'No',
    change: 'change',
    test: 'test',
    show: 'show',
    hide: 'hide',
    empty: '—'
  },

  units: {
    hour: 'h',
    minute: 'min',
    bpm: 'BPM',
    seconds: (n: number) => `${n} ${plural(n, 'second', 'seconds')}`,
    songs: (n: number) => `${n} ${plural(n, 'song', 'songs')}`,
    sections: (n: number) => `${n} ${plural(n, 'section', 'sections')}`,
    tracks: (n: number) => `${n} ${plural(n, 'track', 'tracks')}`
  },

  nav: {
    setlist: 'Setlist',
    practice: 'Practice',
    progress: 'Progress',
    lab: 'Lab',
    settings: 'Settings',
    tuner: 'Tuner',
    song: 'Song',
    stage: 'Stage'
  },

  labels: {
    status: {
      not_started: 'Not started',
      learning: 'Learning',
      shaky: 'Shaky',
      solid: 'Solid',
      gig_ready: 'Gig ready'
    },
    instrument: {
      guitar: 'Guitar',
      bass: 'Bass',
      drums: 'Drums',
      vocals: 'Vocals'
    },
    role: {
      lesson_tabs: 'Lesson w/ Tabs',
      backing_track: 'Backing Track',
      guitar_only: 'Guitar Only',
      bass_only: 'Bass Only',
      drums_only: 'Drums Only',
      official: 'Official',
      live: 'Live',
      cover: 'Cover',
      unknown: 'Unclassified'
    },
    output: {
      pa: 'PA / mixing desk',
      fones: 'Headphones',
      amp: 'Amplifier'
    },
    sort: {
      ordem: 'order',
      banda: 'band',
      musica: 'song',
      afinacao: 'tuning',
      duracao: 'length'
    },
    sortDir: {
      ordem: { asc: 'show order', desc: 'show order' },
      banda: { asc: 'A–Z', desc: 'Z–A' },
      musica: { asc: 'A–Z', desc: 'Z–A' },
      afinacao: {
        asc: 'E standard on top, rest A–Z',
        desc: 'E standard on top, rest Z–A'
      },
      duracao: { asc: 'shortest → longest', desc: 'longest → shortest' }
    }
  },

  settings: {
    title: 'Settings',
    intro:
      'Paste your keys here — they are encrypted on this machine and never leave it. Anything switched off only disables its own feature; the app keeps working.',
    firstSteps: 'First steps',
    firstStepsHint:
      'Only FFmpeg is required — without it, importing audio fails. Everything else is optional.',
    todoFfmpeg: 'Install FFmpeg and put it on your PATH',
    todoLlm: 'Set up an AI provider (or run Ollama locally)',
    todoSpotify: 'Add your Spotify Client ID (optional)',
    todoYoutube: 'Add your YouTube API key (optional)',

    noEncryption: 'No system encryption',
    noEncryptionBody:
      'API keys cannot be stored — storing nothing beats storing them in plain text. You can still use a .env file, and the rest of the settings work normally.',

    saved: 'Saved',
    saveFailed: 'Could not save',
    keyStored: 'key stored',
    notConfigured: 'not set',
    keepPlaceholder: '•••••••• (leave empty to keep)',
    envWarning:
      'An environment variable is setting this value and outranks anything you save here. Remove it from the environment to use this field.',

    source: {
      env: 'environment variable',
      user: 'saved by you',
      dotenv: 'from the .env file',
      default: 'default'
    },

    groupAi: 'Artificial intelligence',
    groupAiSub: 'Practice plans, technique breakdowns and tone patches',
    groupSpotify: 'Spotify',
    groupSpotifySub: 'Metadata and controlling the running player',
    groupYoutube: 'YouTube',
    groupYoutubeSub: 'Finding lessons, backing tracks and playthroughs',
    groupLab: 'Audio lab',
    groupLabSub: 'Stem separation and automatic analysis',
    groupFfmpeg: 'FFmpeg',

    primaryProvider: 'Primary provider',
    primaryProviderHint: 'If it fails, the app tries the fallbacks below, in order.',
    fallback: 'Fallbacks',
    fallbackHint:
      'Comma-separated, tried in that order. Leaving Ollama last covers the case where everything else is down.',

    language: 'Language',
    languageAuto: (name: string) => `Automatic (${name})`,
    languageHint: 'Automatic follows your operating system.',

    folders: 'Folders',
    folderGuitarPro: 'Guitar Pro',
    folderAudio: 'Audio',
    folderStems: 'Stems',
    folderDb: 'Database',
    folderSaved: 'Folder saved — restarting GuitarLab…',
    foldersHint:
      'Changing a folder restarts GuitarLab — paths are read once, at startup. Keys, models and URLs restart nothing. Songs already imported keep pointing at the files where they are.',

    connect: 'Connect',
    disconnect: 'Disconnect',
    disconnected: 'Disconnected',
    connected: 'Spotify connected',
    connecting: 'Opening Spotify in your browser…',
    connectFailed: 'Could not connect',

    ffmpegMissing: 'not found on PATH',
    ffmpegHint:
      'The one hard requirement: reads tags, measures loudness and draws the waveform. No Docker needed.',
    spotifyHint:
      'Login opens in your browser (PKCE, no password in the app). Used for metadata and for driving an already-running Spotify over Connect.',
    youtubeQuota: (used: number, limit: number) =>
      `Today's quota: ${used}/${limit} units. Each search costs 100, so roughly 100 songs a day.`,
    llmHint:
      'The primary provider is tried first; if it fails, the app falls through to the fallbacks in order.',
    labGpu: (gpu: string) => `GPU: ${gpu}`,
    labGpuUnknown: 'not reported',
    labOffline: 'Start it with "npm run lab:up". Only needed for stems and automatic analysis.',

    fields: {
      spotifyClientId: 'Client ID',
      spotifyClientIdHint:
        'Create an app at developer.spotify.com/dashboard. This is the PKCE flow, so there is no client secret.',
      spotifyRedirectUri: 'Redirect URI',
      spotifyRedirectUriHint:
        'Must be registered exactly like this in your Spotify app settings.',
      youtubeApiKey: 'API key',
      youtubeApiKeyHint:
        'console.cloud.google.com → enable "YouTube Data API v3" → create a credential. The free quota covers about 100 songs a day.',
      geminiApiKey: 'Gemini — key',
      geminiModel: 'Gemini — model',
      openaiApiKey: 'OpenAI — key',
      openaiModel: 'OpenAI — model',
      openaiBaseUrl: 'OpenAI — base URL',
      openaiBaseUrlHint: 'Point this at any OpenAI-compatible service.',
      groqApiKey: 'Groq — key',
      groqModel: 'Groq — model',
      ollamaBaseUrl: 'Ollama — base URL',
      ollamaBaseUrlHint:
        'Local models: no key, and nothing leaves your machine. Install from ollama.com.',
      ollamaModel: 'Ollama — model',
      labUrl: 'Lab URL',
      demucsModel: 'Demucs model',
      demucsModelHint: 'htdemucs_6s gives 6 stems; htdemucs gives 4 at better quality.',
      demucsSegment: 'Segment',
      demucsSegmentHint: 'Chunks the audio to fit in GPU memory. Smaller = less VRAM.',
      ffmpegPath: 'FFmpeg path',
      ffmpegPathHint: 'Empty uses whatever is on your PATH. ffprobe is derived from the same path.'
    }
  },

  support: {
    title: 'Support the project',
    body:
      'GuitarLab is free and open source, and always will be — there is no paid tier. If it helps you, you can give something back.',
    sponsor: 'GitHub Sponsors',
    sponsorHint: 'No fees at all. Needs a GitHub account.',
    kofi: 'Ko-fi',
    kofiHint: 'No account needed. Card or PayPal, from any country.',
    otherWays: 'Reporting a bug or translating a screen helps just as much.'
  },

  setup: {
    ffmpegMissing:
      'FFmpeg was not found. Without it, importing audio does not work — it is the app’s one hard requirement.',
    howToInstall: 'how to install',
    openSettings: 'settings',
    dismiss: 'dismiss'
  },

  setlist: {
    library: 'Library',
    noSongs: 'No songs yet',
    noSongsBody:
      'Point the app at your files and import. Tablature (.gp) and audio live in separate folders.',
    import: 'Import',
    chooseFolders: 'Choose folders'
  },

  errors: {
    songNotFound: 'Song not found',
    fileNotFound: (path: string) => `File not found: ${path}`,
    windowUnavailable: 'No window available',
    noLocalAudio: 'This song has no local audio file imported',
    noLyrics: 'The result had no usable lyrics',
    emptyQueue: 'Nothing queued — import songs and mark your progress.',
    aiNoJson: 'The AI did not return a readable JSON patch — try again.',
    aiNoBlocks: 'The AI answered, but with no usable blocks — try again.',
    labUnreachable: (detail: string) => `Lab unavailable: ${detail}. Run "npm run lab:up".`,
    labRefused: (detail: string) => `The lab refused the job: ${detail}`,
    spotifyNotConnected: 'Spotify is not connected',
    spotifyNotConfigured: 'The Spotify Client ID is not set — add it in Settings',
    encryptionUnavailable:
      'The operating system offers no encryption, so the key was not stored.'
  }
}
