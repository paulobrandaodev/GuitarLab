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
      'The one outside requirement: reads tags, measures loudness and draws the waveform. The app can fetch it for you.',
    spotifyHint:
      'Login opens in your browser (PKCE, no password in the app). Used for metadata and for driving an already-running Spotify over Connect.',
    youtubeQuota: (used: number, limit: number) =>
      `Today's quota: ${used}/${limit} units. Each search costs 100, so roughly 100 songs a day.`,
    llmHint:
      'The primary provider is tried first; if it fails, the app falls through to the fallbacks in order.',
    labGpu: (gpu: string) => `GPU: ${gpu}`,
    labGpuUnknown: 'not reported',
    labOffline: 'Install and start it in the Lab tab. Only needed for stems and automatic analysis.',

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

  stage: {
    emptyTitle: 'Empty setlist',
    emptyBody: 'Add songs to a setlist to use Stage Mode.',
    backToSetlist: 'Back to the setlist',
    exit: 'Exit (Esc)',
    exitLabel: 'Exit stage mode',
    smaller: 'Smaller type (−)',
    bigger: 'Bigger type (+)',
    repertoire: 'Set',
    repertoireKey: 'Set (L)',
    noChart: 'No chord chart or lyrics saved for this song.',
    noChartHint: 'Chords & Lyrics, on the song screen, is where they go.',
    retunes: 'Tuning changes',
    previous: 'previous',
    next: 'next',
    upNext: 'up next',
    lastOfSet: 'last of the set',
    switchTo: (tuning: string) => `switch to ${tuning}`,
    scrollPlay: 'Scroll on its own (A)',
    scrollPause: 'Stop scrolling (A)',
    scrollSpeed: 'scroll speed',
    metronome: 'Metronome',
    metronomeBpm: (bpm: number) => `Metronome · ${bpm} bpm`,
    metronomeHint: "Click at this song's tempo (M)",
    metronomeNoBpm: 'This song has no BPM on file',
    help: '←/→ or a pedal changes song · ↑/↓ and space scroll the chart · A auto-scroll · M metronome · +/− size · L set · Esc exits'
  },

  setlist: {
    library: 'Library',
    noSongs: 'No songs yet',
    noSongsBody:
      'Point the app at your files and import. Tablature (.gp) and audio live in separate folders.',
    import: 'Import',
    chooseFolders: 'Choose folders'
  },

  manual: {
    newSetlist: 'New setlist',
    renameSetlist: 'Edit the setlist',
    setlistRenamed: (name: string) => `Setlist renamed to "${name}"`,
    newSong: 'New song',
    addSong: 'Add song',
    required: 'required',
    create: 'Create',
    createAndOpen: 'Create and open',
    moreFields: 'more fields',
    fewerFields: 'fewer fields',

    setlistHint:
      'Only the name is required. The date, the venue and the notes can wait until you know them.',
    setlistName: 'Setlist name',
    setlistNamePlaceholder: 'e.g. Friday at the Roadhouse',
    band: 'Band',
    bandPlaceholder: 'e.g. Metallica covers',
    eventDate: 'Show date',
    venue: 'Venue',
    venuePlaceholder: 'e.g. The Roadhouse',
    setlistCreated: (name: string) => `Setlist "${name}" created, and now active`,

    songHint:
      'Only the title and the artist are required — the app fills the rest in for you when you import the tab or the audio.',
    songTitle: 'Title',
    songTitlePlaceholder: 'e.g. Master of Puppets',
    artist: 'Artist',
    artistPlaceholder: 'e.g. Metallica',
    album: 'Album',
    year: 'Year',
    genre: 'Genre',
    duration: 'Duration',
    durationInvalid: 'That duration did not parse — write it the way a player shows it, like 4:32.',
    key: 'Key',
    bpm: 'BPM',
    timeSignature: 'Time signature',
    tuning: 'Tuning',
    noTuning: '— none —',
    capo: 'Capo',
    notes: 'Notes',
    addTo: 'Put it straight in the setlist',
    onlyLibrary: '— library only —',
    songCreated: (title: string) => `"${title}" is in the library`,
    songCreatedIn: (title: string, setlist: string) => `"${title}" joined ${setlist}`,
    duplicate: (title: string, artist: string) =>
      `"${title}", by ${artist}, is already in your library.`,
    duplicateOpen: 'Open the one you have',
    duplicateAnyway: 'Create it anyway'
  },

  lab: {
    title: 'Audio Lab',
    subtitle: 'Stem separation and analysis, running on your own machine',
    on: 'Lab running',
    off: 'Lab stopped',
    jobs: {
      stems: 'Separate stems',
      rhythm: 'BPM and beat grid',
      harmony: 'Key and chords',
      transcribe: 'Audio → MIDI',
      lyrics: 'Transcribe lyrics'
    },
    jobDesc: {
      stems: 'Demucs splits the track into vocals, drums, bass, guitar, piano and other. Gives you the guitar-only and the backing track.',
      rhythm: 'Finds tempo, beats and bars so the A/B loop can snap to the grid.',
      harmony: 'Finds the key and the chord progression over time.',
      transcribe: 'basic-pitch turns the audio into MIDI — a first draft of a tab.',
      lyrics: 'faster-whisper transcribes the lyrics with timestamps.'
    },
    run: 'Run',
    rerun: 'Run again',
    sent: (job: string) => `${job} sent to the lab`,
    sendFailed: 'Could not submit the job',
    jobStatus: {
      queued: 'queued',
      running: 'running',
      done: 'done',
      error: 'error',
      canceled: 'canceled'
    },
    stemsMade: (count: number) => `Stems produced (${count})`,
    openFolder: 'open folder',
    history: 'Job history',
    chooseSong: 'song',
    chooseSongPlaceholder: '— pick a song —',
    noSongs: 'No song has local audio',
    noSongsDesc: 'The lab needs the audio file. Put mp3/wav/flac in your songs folder and import.',
    songNoAudio: 'This song has no local audio yet',
    songNoAudioDesc:
      'The lab listens to the recording. Grab the track with the WAV button in the setlist, or put the file in your audio folder and import.',
    goToSetlist: 'Go to the setlist',
    demucsModel: {
      six: '6 stems (guitar included)',
      four: '4 stems (best quality)',
      fourFt: '4 stems fine-tuned (slower)'
    },
    setup: {
      title: 'Install the lab',
      intro:
        'The lab runs the heavy models on your machine. It is not in the installer, so the installer stays small — pick below and the app downloads and sets it all up.',
      gpuFound: (name: string, driver: string) => `${name} · driver ${driver}`,
      gpuNone: 'No NVIDIA card found — the CPU pack is the right one here',
      recommended: 'recommended',
      packCpu: 'Processor (CPU)',
      packCpuDesc: 'Works anywhere. Separating a song takes minutes rather than seconds.',
      packCuda: 'NVIDIA card (CUDA)',
      packCudaDesc:
        'Much faster. Needs only the NVIDIA driver — no CUDA Toolkit, no Docker.',
      install: (size: string) => `Install · ${size}`,
      installing: 'Installing',
      cancel: 'Cancel install',
      canceled: 'Install canceled',
      timeWarning:
        'Anywhere from a few minutes to half an hour, depending on your connection. You can leave this tab — the download carries on.',
      phase: {
        uv: 'preparing the installer',
        python: 'downloading Python',
        venv: 'creating the environment',
        torch: 'downloading PyTorch',
        demucs: 'installing Demucs',
        base: 'installing the rest',
        done: 'done',
        error: 'failed'
      },
      ready: 'Lab installed',
      packInUse: (pack: string) => `${pack} pack`,
      start: 'Start',
      stop: 'Stop',
      starting: 'Starting',
      remove: 'Remove the lab',
      removeConfirm:
        "This deletes the lab's Python environment. Downloaded models are kept. Continue?",
      removeModels: 'Delete the models',
      removeModelsConfirm:
        'This deletes the downloaded models. They will be fetched again when needed. Continue?',
      stale: 'This install is from an earlier version',
      staleDesc: 'Reinstall to match the versions this build of the app expects.',
      diskRuntime: 'environment',
      diskModels: 'models',
      models: 'Models',
      modelsDesc:
        'Downloaded the first time you use each one. Get them ahead of time so no job stalls waiting.',
      download: 'Download',
      downloading: 'Downloading',
      downloaded: 'downloaded',
      folders: 'Folders'
    }
  },
  tools: {
    ffmpeg: {
      title: 'FFmpeg',
      missing: 'FFmpeg was not found',
      missingDesc:
        'The app uses FFmpeg to read, convert and measure the loudness of audio. Importing music does not work without it.',
      install: 'Download and install',
      installing: 'Downloading FFmpeg',
      extracting: 'Installing',
      installed: (path: string) => `Installed by the app at ${path}`,
      remove: 'Remove',
      onPath: 'Found on the system'
    }
  },
  update: {
    available: (version: string) => `Version ${version} available`,
    download: 'Download',
    downloading: 'Downloading the update',
    ready: (version: string) => `Version ${version} ready to install`,
    restart: 'Restart and update',
    later: 'Later',
    upToDate: 'You are on the latest version',
    check: 'Check for updates'
  },
  errors: {
    songNotFound: 'Song not found',
    titleRequired: 'The song needs a title',
    artistRequired: 'The song needs an artist',
    setlistNameRequired: 'The setlist needs a name',
    fileNotFound: (path: string) => `File not found: ${path}`,
    windowUnavailable: 'No window available',
    noLocalAudio: 'This song has no local audio file imported',
    noLyrics: 'The result had no usable lyrics',
    emptyQueue: 'Nothing queued — import songs and mark your progress.',
    aiNoJson: 'The AI did not return a readable JSON patch — try again.',
    aiNoBlocks: 'The AI answered, but with no usable blocks — try again.',
    labUnreachable: (detail: string) => `Lab unavailable: ${detail}. Open the Lab tab to start it.`,
    labRefused: (detail: string) => `The lab refused the job: ${detail}`,
    spotifyNotConnected: 'Spotify is not connected',
    spotifyNotConfigured: 'The Spotify Client ID is not set — add it in Settings',
    encryptionUnavailable:
      'The operating system offers no encryption, so the key was not stored.'
  }
}
