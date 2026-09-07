import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync, copyFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { config, saveLibraryPaths } from '../config'
import {
  activeSecrets,
  currentLocale,
  encryptionAvailable,
  saveSettings,
  settingViews
} from '../settings'
import { redactSecrets } from '../settings-core'
import { encryptionHint, ENCRYPTION_UNAVAILABLE } from '../secretbox'
import { probeProvider } from '../services/llm/probe'
import {
  asEnum,
  asHttpUrl,
  asOptionalNumber,
  asOptionalString,
  asString,
  asStringRecord
} from './guard'
import * as repo from '../db/repo'
import {
  importAll,
  importGuitarProDir,
  importAudioDir,
  attachAudioFile,
  attachGuitarProFile
} from '../importers/library'
import { parseGuitarProFile } from '../importers/guitarpro'
import { importPlaylist } from '../importers/playlist'
import * as youtube from '../services/youtube'
import { playerUrl, startPlayerServer } from '../services/ytplayer'
import * as spotify from '../services/spotify'
import * as lab from '../services/lab'
import * as sources from '../services/sources'
import { openTabBrowser, setDownloadListener } from '../services/tabdownload'
import * as lrclib from '../services/lrclib'
import { complete, llmStatus, parseJsonLoose } from '../services/llm'
import type { LlmListener } from '../services/llm'
import {
  RIG_SETTING_KEY,
  normalizePlan,
  planPitchShifter,
  buildToneContext
} from '../services/tone'
import {
  classifyVideosSystemPrompt,
  practicePlanSystemPrompt,
  techniqueSystemPrompt,
  toChordProSystemPrompt,
  toneAdviceSystemPrompt,
  tonePatchPrompt,
  tonePatchSystemPrompt
} from '../services/prompts'
import { mainLocale, mt } from '../i18n'
import { RIG_OUTPUT_EN } from '@shared/types'
import { ffmpegVersion } from '../media/ffmpeg'
import { nextLadderBpm } from '../practice/srs'
import type {
  ArchiveCandidate,
  DownloadProgress,
  IntegrationStatus,
  Instrument,
  NewSetlistInput,
  NewSongInput,
  ProgressStatus,
  YoutubeRole,
  RigView,
  TonePatchView,
  TonePlanView
} from '@shared/types'
import { RIG_DEFAULT } from '@shared/types'

type Handler = (...args: never[]) => unknown

/** Wrap every handler so a thrown error reaches the renderer as data, not a crash. */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      /*
       * Strip any API key that made it into the message before it leaves the
       * main process. An exception thrown by fetch can quote the URL or the
       * headers it was handed, and those carry keys. Best effort by
       * construction: it only masks values it knows, and a key mangled by
       * whatever threw slips past.
       */
      const message = redactSecrets(raw, activeSecrets())
      console.error(`[ipc] ${channel} failed:`, message)
      return { __error: message }
    }
  })
}

/**
 * Options that stream an LLM call's progress to the renderer.
 *
 * Every `complete()` call goes through this so the UI can narrate what the
 * model is doing — which provider is being tried, its reasoning as it arrives,
 * and whether it is waiting out a rate limit — instead of showing a spinner
 * that gives no clue whether anything is working.
 */
function streamTo(
  getWindow: () => BrowserWindow | null,
  task: string
): { task: string; onEvent: LlmListener } {
  return {
    task,
    onEvent: (event) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send('llm:progress', event)
    }
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /* ------------------------------------------------------------- library */

  handle('library:importAll', () => importAll())
  handle('library:importGuitarPro', () => importGuitarProDir())
  handle('library:importAudio', () => importAudioDir())
  handle('library:paths', () => ({
    gptabs: config.paths.gptabs,
    songs: config.paths.songs,
    stems: config.paths.stems,
    db: config.paths.db
  }))
  /*
   * Folders are read once at startup, so a change only takes effect on the next
   * launch — the app restarts itself rather than leaving half the process
   * pointing at the old library.
   */
  handle('library:setPaths', (raw: unknown) => {
    const next = asStringRecord(raw, 'paths', 8)
    for (const key of Object.keys(next)) {
      asEnum(key, 'folder', ['gptabs', 'songs', 'stems'] as const)
    }
    saveLibraryPaths(next as Partial<Record<'gptabs' | 'songs' | 'stems', string>>)
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 250)
    return { ok: true }
  })

  /* --------------------------------------------------------------- songs */

  handle('songs:list', () => repo.listSongs())
  /*
   * Validated, unlike the writes around it, because this one is fed by a form
   * rather than by the app's own data: an empty title is a thing that actually
   * happens here, and a song with no title is unreachable in every list that
   * sorts by it. The renderer disables the button too — this is the guard that
   * does not depend on the renderer being right.
   */
  handle('songs:create', (raw: unknown) => {
    const input = (raw ?? {}) as Record<string, unknown>
    const title = asString(input.title, 'title', 300).trim()
    const artist = asString(input.artist, 'artist', 300).trim()
    if (!title) throw new Error(mt().errors.titleRequired)
    if (!artist) throw new Error(mt().errors.artistRequired)
    return repo.createSong({
      title,
      artist,
      album: asOptionalString(input.album, 'album', 300),
      year: asOptionalNumber(input.year, 'year'),
      genre: asOptionalString(input.genre, 'genre', 120),
      durationMs: asOptionalNumber(input.durationMs, 'durationMs'),
      musicalKey: asOptionalString(input.musicalKey, 'musicalKey', 20),
      bpm: asOptionalNumber(input.bpm, 'bpm'),
      timeSignature: asOptionalString(input.timeSignature, 'timeSignature', 20),
      tuningId: asOptionalNumber(input.tuningId, 'tuningId'),
      capo: asOptionalNumber(input.capo, 'capo'),
      notes: asOptionalString(input.notes, 'notes'),
      setlistId: asOptionalNumber(input.setlistId, 'setlistId')
    } satisfies NewSongInput)
  })
  handle('songs:findDuplicate', (title: unknown, artist: unknown) =>
    repo.findSongDuplicate(asString(title, 'title', 300), asString(artist, 'artist', 300))
  )
  handle('songs:get', (id: number) => repo.getSong(id))
  handle('songs:update', (id: number, patch: Record<string, unknown>) => repo.updateSong(id, patch))
  handle('songs:delete', (id: number) => repo.deleteSong(id))
  handle('songs:media', (id: number) => repo.listMedia(id))
  handle('songs:tunings', () => repo.listTunings())

  /* ------------------------------------------------------------ sections */

  handle('sections:list', (songId: number) => repo.listSections(songId))
  handle('sections:create', (values: Record<string, unknown>) =>
    repo.createSection(values as never)
  )
  handle('sections:update', (id: number, patch: Record<string, unknown>) =>
    repo.updateSection(id, patch)
  )
  handle('sections:delete', (id: number) => repo.deleteSection(id))

  /* ------------------------------------------------------------ setlists */

  handle('setlists:list', () => repo.listSetlists())
  handle('setlists:items', (id: number) => repo.getSetlistItems(id))
  handle('setlists:create', (name: unknown, band?: unknown, extra?: unknown) => {
    const trimmed = asString(name, 'name', 200).trim()
    if (!trimmed) throw new Error(mt().errors.setlistNameRequired)
    const rest = (extra ?? {}) as Record<string, unknown>
    return repo.createSetlist(trimmed, asOptionalString(band, 'band', 120), null, {
      eventDate: asOptionalNumber(rest.eventDate, 'eventDate'),
      venue: asOptionalString(rest.venue, 'venue', 200),
      notes: asOptionalString(rest.notes, 'notes')
    } satisfies Omit<NewSetlistInput, 'name' | 'band'>)
  })
  handle('setlists:bands', () => repo.listBands())
  handle('setlists:removeSong', (setlistId: number, songId: number) =>
    repo.removeSongFromSetlist(setlistId, songId)
  )
  handle('setlists:addSong', (setlistId: number, songId: number) =>
    repo.addSongToSetlist(setlistId, songId)
  )
  handle('setlists:removeItem', (itemId: number) => repo.removeSetlistItem(itemId))
  handle('setlists:reorder', (setlistId: number, ids: number[]) =>
    repo.reorderSetlist(setlistId, ids)
  )
  handle('setlists:setActive', (id: number) => repo.setActiveSetlist(id))
  handle('setlists:delete', (id: number) => repo.deleteSetlist(id))
  handle('setlists:update', (id: number, patch: Record<string, unknown>) =>
    repo.updateSetlist(id, patch)
  )

  /* ------------------------------------------------------------ progress */

  handle('progress:list', (songId: number) => repo.listProgress(songId))
  handle(
    'progress:setStatus',
    (songId: number, instrument: Instrument, sectionId: number | null, status: ProgressStatus) =>
      repo.setProgressStatus(songId, instrument, sectionId, status)
  )
  handle(
    'progress:setTargetBpm',
    (songId: number, instrument: Instrument, sectionId: number | null, bpm: number) =>
      repo.setTargetBpm(songId, instrument, sectionId, bpm)
  )
  handle('progress:recordSession', (input: repo.RecordSessionInput) => repo.recordSession(input))
  handle('progress:dailyQueue', (budget: number) => repo.getDailyQueue(budget))
  handle('progress:queuePins', () => repo.listQueuePins())
  handle('progress:queued', (songId: number, sectionId: number | null) =>
    repo.isQueued(songId, sectionId)
  )
  handle('progress:enqueue', (songId: number, sectionId: number | null) =>
    repo.addToQueue(songId, sectionId)
  )
  handle('progress:dequeue', (songId: number, sectionId: number | null) =>
    repo.removeFromQueue(songId, sectionId)
  )
  handle('progress:clearQueue', () => repo.clearQueue())
  handle('progress:stats', () => repo.statsOverview())
  handle('progress:nextBpm', (current: number, target: number, step: number) =>
    nextLadderBpm(current, target, step)
  )

  /* -------------------------------------------------------------- charts */

  handle('charts:list', (songId: number) => repo.listCharts(songId))
  handle(
    'charts:save',
    (
      songId: number,
      kind: 'chords' | 'lyrics' | 'tab_text' | 'notes',
      format: 'chordpro' | 'lrc' | 'plain' | 'markdown',
      content: string,
      sourceUrl?: string
    ) => repo.upsertChart(songId, kind, format, content, sourceUrl)
  )

  handle('lyrics:fetch', async (songId: number) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    const found = await lrclib.findBest(song.artist, song.title, song.album, song.durationMs)
    if (!found) return { error: 'Nada encontrado no LRCLIB' }
    if (found.syncedLyrics) {
      repo.upsertChart(songId, 'lyrics', 'lrc', found.syncedLyrics, 'https://lrclib.net')
      return { format: 'lrc', synced: true, content: found.syncedLyrics }
    }
    if (found.plainLyrics) {
      repo.upsertChart(songId, 'lyrics', 'plain', found.plainLyrics, 'https://lrclib.net')
      return { format: 'plain', synced: false, content: found.plainLyrics }
    }
    return { error: 'Resultado sem letra utilizável' }
  })

  handle('lyrics:parseLrc', (lrc: string) => lrclib.parseLrc(lrc))

  /* ------------------------------------------------------------- guitar pro */

  handle('gp:parse', (path: string) => parseGuitarProFile(path))

  /** alphaTab needs the raw bytes in the renderer; send them over as a buffer. */
  handle('gp:readFile', (path: string) => {
    if (!existsSync(path)) return { __error: `Arquivo não encontrado: ${path}` }
    return readFileSync(path).buffer
  })

  handle('waveform:read', (songId: number) => {
    const assets = repo.listMedia(songId)
    const wave = assets.find((a) => a.kind === 'waveform')
    if (!wave || !existsSync(wave.path)) return null
    return JSON.parse(readFileSync(wave.path, 'utf8')) as { songId: number; peaks: number[] }
  })

  /* ------------------------------------------------------------- youtube */

  handle('youtube:refs', (songId: number) => repo.listYoutubeRefs(songId))
  /** `roles` narrows the search to specific slots — one query, one quota unit. */
  handle('youtube:search', async (songId: number, roles?: YoutubeRole[]) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    const result = await youtube.searchAndClassify(
      song.artist,
      song.title,
      roles?.length ? roles : undefined
    )
    // a partial result still gets saved: the error only says some slots are missing
    if (result.videos.length) youtube.saveClassified(songId, result.videos)
    if (result.error) return { error: result.error, videos: result.videos }
    return { videos: result.videos, quotaSpent: result.quotaSpent }
  })
  handle('youtube:addManual', (songId: number, url: string, role: YoutubeRole, title?: string) =>
    youtube.addManualRef(songId, url, role, title)
  )
  handle('youtube:setRole', (refId: number, role: YoutubeRole) => youtube.setRefRole(refId, role))
  handle('youtube:delete', (refId: number) => youtube.deleteRef(refId))
  /*
   * Where the in-app player lives. The renderer asks once and drops the URL in
   * an iframe; null means the local origin did not come up and the UI should
   * fall back to opening the video in the browser.
   */
  handle('youtube:playerUrl', async () => {
    if (!playerUrl()) await startPlayerServer()
    return playerUrl()
  })
  handle('youtube:quota', () => ({
    used: youtube.quotaUsedToday(),
    limit: config.youtube.quotaLimit,
    remaining: youtube.quotaRemaining(),
    searchesLeft: Math.floor(youtube.quotaRemaining() / 100)
  }))
  handle('youtube:manualUrl', (songId: number, role: YoutubeRole) => {
    const song = repo.getSong(songId)
    if (!song) return null
    return youtube.manualSearchUrl(song.artist, song.title, role)
  })

  /* ------------------------------------------------------------- spotify */

  handle('spotify:status', () => spotify.status())
  handle('spotify:connect', () => spotify.connect())
  handle('spotify:disconnect', () => spotify.disconnect())
  handle('spotify:search', (q: string) => spotify.searchTracks(q))
  handle('spotify:playback', () => spotify.playbackState())
  handle('spotify:devices', () => spotify.listDevices())
  handle('spotify:play', (uri?: string, positionMs?: number) => spotify.play(uri, positionMs))
  handle('spotify:pause', () => spotify.pause())
  handle('spotify:seek', (ms: number) => spotify.seek(ms))
  handle('spotify:playlists', () => spotify.listPlaylists())

  /** Read a Spotify playlist and turn it into a setlist for one of the bands. */
  handle(
    'spotify:importPlaylist',
    async (playlistId: string, setlistName: string, band: string | null) => {
      const tracks = await spotify.playlistTracks(playlistId)
      if ('error' in tracks) return { error: tracks.error }
      if (!tracks.length) return { error: 'A playlist não tem faixas utilizáveis' }
      return importPlaylist(tracks, setlistName, band, playlistId)
    }
  )

  handle('spotify:syncPlaylist', (setlistId: number) => {
    const items = repo.getSetlistItems(setlistId)
    const lists = repo.listSetlists()
    const list = lists.find((l) => l.id === setlistId)
    const uris = items
      .map((i) => i.song.id)
      .map((id) => repo.getSong(id)?.title)
      .filter(Boolean)
    void uris
    return {
      error:
        'Vincule cada música a uma faixa do Spotify primeiro (aba Música → Spotify) para sincronizar a playlist.',
      setlist: list?.name ?? null
    }
  })

  /* ------------------------------------------------------------- fontes */

  /*
   * Downloads report through one channel so the setlist row can show a bar
   * without every screen wiring up its own listener.
   */
  const sendProgress = (event: DownloadProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('sources:progress', event)
  }
  setDownloadListener(sendProgress)

  handle('sources:tabLinks', async (songId: number) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    return sources.tabLinks(song.artist, song.title)
  })

  /**
   * Open a tab site with its downloads pointed at gptabs/.
   *
   * The app cannot fetch the file itself — no API, and scraping is against
   * those sites' terms — but it can make the click land in the right folder and
   * import what arrives.
   */
  handle('sources:openTabBrowser', async (songId: number, site: 'ultimate' | 'cifraclub') => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    const links = await sources.tabLinks(song.artist, song.title)
    openTabBrowser(site === 'cifraclub' ? links.cifraClub : links.ultimateGuitar, songId, getWindow())
    return { ok: true, url: site === 'cifraclub' ? links.cifraClub : links.ultimateGuitar }
  })

  /**
   * The escape hatch for a tablature that came from anywhere else — a site that
   * does not let the app intercept the download, a friend's file, an old backup.
   * The file is copied into gptabs/ and hung on this song, so it behaves exactly
   * like one the app downloaded itself.
   */
  handle('sources:pickTabFile', async (songId: number) => {
    const win = getWindow()
    if (!win) return { error: 'Janela indisponível' }
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }

    const picked = await dialog.showOpenDialog(win, {
      title: 'Escolher arquivo Guitar Pro',
      properties: ['openFile'],
      filters: [{ name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'gp7'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }

    const source = picked.filePaths[0]
    // a file already sitting in gptabs/ is imported where it is, not duplicated
    const insideLibrary = resolve(source)
      .toLowerCase()
      .startsWith(resolve(config.paths.gptabs).toLowerCase())
    const target = insideLibrary ? source : sources.uniquePath(config.paths.gptabs, basename(source))
    if (!insideLibrary) copyFileSync(source, target)

    const report = await attachGuitarProFile(songId, target)
    const failed = report.errors[0]
    if (failed) return { error: failed.message }
    return { path: target, report }
  })

  handle('sources:archiveSearch', async (songId: number) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    const result = await sources.searchArchiveAudio(song.artist, song.title)
    if (result.error && !result.candidates.length) return { error: result.error, candidates: [] }
    return { candidates: result.candidates }
  })

  handle('sources:archiveDownload', async (songId: number, candidate: ArchiveCandidate) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }

    const fileName = sources.safeFileName(song.artist, song.title, candidate.ext || '.mp3')
    const dest = sources.uniquePath(config.paths.songs, fileName)
    const base = { songId, kind: 'audio' as const, fileName }

    // one event per 300 ms: a 90 MB wav would otherwise flood the renderer
    let lastTick = 0
    try {
      const file = await sources.downloadToFile(candidate.url, dest, (received, total) => {
        const now = Date.now()
        if (now - lastTick < 300 && received !== total) return
        lastTick = now
        sendProgress({ ...base, receivedBytes: received, totalBytes: total, status: 'downloading' })
      })

      sendProgress({ ...base, receivedBytes: file.bytes, totalBytes: file.bytes, status: 'importing' })
      const report = await attachAudioFile(songId, file.path)
      const failed = report.errors[0]
      sendProgress({
        ...base,
        receivedBytes: file.bytes,
        totalBytes: file.bytes,
        status: failed ? 'error' : 'done',
        message: failed ? failed.message : (report.details[0]?.note ?? 'importado')
      })
      if (failed) return { error: failed.message }
      return { path: file.path, bytes: file.bytes, report }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendProgress({ ...base, receivedBytes: 0, totalBytes: null, status: 'error', message })
      return { error: message }
    }
  })

  /* ------------------------------------------------------------- acordes */

  handle('chords:get', (songId: number) => repo.getChordMap(songId))
  handle('chords:clear', (songId: number) => repo.deleteChordMap(songId))

  /**
   * Chord detection runs in the lab container: beat tracking plus chroma
   * template matching over the local audio. It is the same job as the key
   * estimate, which is why there is no separate analysis type for it.
   */
  handle('chords:detect', async (songId: number) => {
    const assets = repo.listMedia(songId)
    const audio = assets.find((a) => a.kind === 'audio_master')
    if (!audio) {
      return {
        error:
          'Essa música não tem áudio local. Baixe a faixa (botão wav/mp3 no setlist) ou ' +
          'coloque o arquivo em songs/ e importe.'
      }
    }
    return lab.submitJob(songId, 'harmony', audio.path, {})
  })

  /* ----------------------------------------------------------------- lab */

  handle('lab:health', () => lab.labHealth())
  handle('lab:jobs', (songId?: number) => lab.listJobs(songId))
  handle('lab:submit', async (songId: number, type: string, params?: Record<string, unknown>) => {
    const assets = repo.listMedia(songId)
    const audio = assets.find((a) => a.kind === 'audio_master')
    if (!audio) return { error: 'Essa música não tem arquivo de áudio local importado' }
    return lab.submitJob(songId, type as never, audio.path, params ?? {})
  })
  handle('lab:refresh', (jobId: number) => lab.refreshJob(jobId))
  handle('lab:refreshAll', () => lab.refreshAllRunning())

  /* ----------------------------------------------------------------- llm */

  handle('llm:status', () => llmStatus())

  handle('llm:practiceePlan', async (budgetMinutes: number) => {
    const queue = repo.getDailyQueue(budgetMinutes)
    if (!queue.length) return { error: 'Nada na fila — importe músicas e marque o progresso.' }
    const lines = queue
      .map(
        (q) =>
          `- ${q.songTitle}${q.sectionName ? ` [${q.sectionName}]` : ''} (${q.instrument}) ` +
          `status=${q.status} domínio=${q.mastery}% ` +
          `bpm=${q.bestBpm ?? '?'}/${q.targetBpm ?? '?'} motivo=${q.reason}`
      )
      .join('\n')

    const result = await complete([
      {
        role: 'system',
        content: practicePlanSystemPrompt(mainLocale())
      },
      {
        role: 'user',
        content:
          `Monte um plano de treino de ${budgetMinutes} minutos com estes itens da fila:\n\n${lines}\n\n` +
          'Para cada item diga: quantos minutos, o que exatamente fazer (exercício concreto), ' +
          'e em que BPM começar. Termine com uma dica de foco para a sessão.'
      }
    ], streamTo(getWindow, 'plano de treino'))
    return { content: result.text, provider: result.provider, model: result.model }
  })

  handle('llm:techniqueBreakdown', async (songId: number, sectionId: number | null) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }
    const sections = repo.listSections(songId)
    const section = sectionId ? sections.find((s) => s.id === sectionId) : null
    const media = repo.listMedia(songId)
    const gp = media.find((m) => m.kind === 'guitarpro')

    const context = [
      `Música: ${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
      song.musicalKey ? `Tom: ${song.musicalKey}` : null,
      song.bpm ? `Andamento: ${song.bpm} BPM` : null,
      song.tuning ? `Afinação: ${song.tuning.name} (${song.tuning.strings.join(' ')})` : null,
      song.timeSignature ? `Compasso: ${song.timeSignature}` : null,
      section ? `Trecho: ${section.name} (${section.kind})` : 'Música inteira',
      gp ? `Trilhas no Guitar Pro: ${JSON.stringify(gp.meta?.tracks ?? []).slice(0, 500)}` : null
    ]
      .filter(Boolean)
      .join('\n')

    const result = await complete([
      {
        role: 'system',
        content: techniqueSystemPrompt(mainLocale())
      },
      {
        role: 'user',
        content:
          `${context}\n\nExplique: (1) quais dificuldades técnicas específicas esse trecho ` +
          'apresenta, (2) dois exercícios concretos para destravar cada uma, (3) em que BPM começar ' +
          'e como subir. Máximo 300 palavras.'
      }
    ], streamTo(getWindow, 'análise de técnica'))
    return { content: result.text, provider: result.provider, model: result.model }
  })

  /* ---------------------------------------------------------------- rig */

  handle('gear:rig', (): RigView => {
    const raw = repo.getSetting(RIG_SETTING_KEY)
    if (!raw) return RIG_DEFAULT
    try {
      return { ...RIG_DEFAULT, ...(JSON.parse(raw) as Partial<RigView>) }
    } catch {
      return RIG_DEFAULT
    }
  })

  handle('gear:setRig', (rig: RigView) => {
    repo.setSetting(RIG_SETTING_KEY, JSON.stringify(rig))
    return rig
  })

  handle('gear:patch', (songId: number): TonePlanView | null => {
    const saved = repo.getGearPatch(songId, 'guitar')
    if (!saved?.settingsJson) return null
    try {
      const parsed = JSON.parse(saved.settingsJson) as Record<string, unknown>
      if (Array.isArray(parsed.patches)) return parsed as unknown as TonePlanView
      // rows written before a song could have more than one patch hold a bare
      // patch object; wrap it so the screen only ever deals with plans
      const single = parsed as unknown as TonePatchView
      return {
        patches: [{ ...single, appliesTo: single.appliesTo ?? 'Música inteira', ctrl: single.ctrl ?? null }],
        pitchShifter: null,
        rig: single.rig,
        provider: single.provider,
        model: single.model
      }
    } catch {
      return null
    }
  })

  /**
   * Ask the model for a patch as structured data rather than prose, so the
   * screen can draw the signal chain and the knob positions instead of printing
   * a wall of text. Anything the model gets wrong structurally is repaired by
   * `normalizePatch` — a missing field should not blank the whole tab.
   */
  handle('llm:tonePatch', async (songId: number) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }

    const rawRig = repo.getSetting(RIG_SETTING_KEY)
    let rig: RigView = RIG_DEFAULT
    if (rawRig) {
      try {
        rig = { ...RIG_DEFAULT, ...(JSON.parse(rawRig) as Partial<RigView>) }
      } catch {
        /* keep the default rig */
      }
    }

    /*
     * Two things the model is not asked to work out on its own:
     *
     *  - the tuning maths, which is arithmetic over what the Guitar Pro file
     *    declares (guitar stays in E standard, at most a physical Drop D, the
     *    pitch shifter covers the rest);
     *  - the song's own section names, which is what lets a second patch say
     *    "entra no solo" instead of "na parte mais pesada".
     */
    const pitch = planPitchShifter(song.tuning)
    const sections = repo.listSections(songId).map((s) => s.name)
    const context = buildToneContext(song, rig, sections)

    const result = await complete(
      [
        { role: 'system', content: tonePatchSystemPrompt(mainLocale()) },
        {
          role: 'user',
          content: tonePatchPrompt(context, RIG_OUTPUT_EN[rig.output].toLowerCase(), pitch)
        }
      ],
      { json: true, ...streamTo(getWindow, 'patch de timbre') }
    )

    const parsed = parseJsonLoose<Record<string, unknown>>(result.text)
    if (!parsed) return { error: 'A IA não devolveu um patch em JSON legível — tente de novo.' }

    const plan = normalizePlan(parsed, rig, pitch, result.provider, result.model)
    if (!plan.patches.length) {
      return { error: 'A IA respondeu, mas sem nenhum bloco utilizável — tente de novo.' }
    }

    repo.upsertGearPatch({
      songId,
      instrument: 'guitar',
      device: rig.processor,
      patchName: plan.patches.map((p) => p.patchName).join(' · '),
      settingsJson: JSON.stringify(plan),
      notes: plan.patches[0].notes
    })
    return plan
  })

  handle('llm:toneAdvice', async (songId: number) => {
    const song = repo.getSong(songId)
    if (!song) return { error: 'Música não encontrada' }

    const rawRig = repo.getSetting(RIG_SETTING_KEY)
    let rig: RigView = RIG_DEFAULT
    if (rawRig) {
      try {
        rig = { ...RIG_DEFAULT, ...(JSON.parse(rawRig) as Partial<RigView>) }
      } catch {
        /* keep the default rig */
      }
    }

    // the prose answer sits next to the patch cards, so it has to start from the
    // same facts — same rig, same tuning decision, same footswitch
    const pitch = planPitchShifter(song.tuning)
    const sections = repo.listSections(songId).map((s) => s.name)
    const context = buildToneContext(song, rig, sections)

    const result = await complete(
      [
        {
          role: 'system',
          content: toneAdviceSystemPrompt(mainLocale())
        },
        {
          role: 'user',
          content:
            `${context}\n\n` +
            `Afinação na prática: ${pitch.note}\n\n` +
            'Explique o timbre dessa música para essa pedaleira: tipo de amp, ganho, EQ ' +
            '(graves/médios/agudos), quais efeitos ligar e com que ajuste. Se a música muda de ' +
            'timbre no meio, diga o que muda de um trecho para o outro. Diga também o que vale ' +
            'colocar no botão CTRL (o único footswitch atribuível) e o que escutar na gravação ' +
            'original para saber se acertou.'
        }
      ],
      streamTo(getWindow, 'explicação de timbre')
    )
    return { content: result.text, provider: result.provider, model: result.model }
  })

  /** Re-rank the YouTube candidates the rule-based classifier could not settle. */
  handle('llm:classifyVideos', async (videos: Array<{ videoId: string; title: string; channel: string }>) => {
    if (!videos.length) return { assignments: [] }
    const list = videos.map((v, i) => `${i}. "${v.title}" — canal: ${v.channel}`).join('\n')
    const result = await complete(
      [
        {
          role: 'system',
          content: classifyVideosSystemPrompt()
        },
        {
          role: 'user',
          content:
            `${list}\n\nPara cada índice devolva o papel mais provável entre: lesson_tabs ` +
            '(aula com tablatura), backing_track (base sem a guitarra), guitar_only (guitarra ' +
            'isolada), official, live, cover, unknown.\n' +
            'Formato: {"assignments":[{"index":0,"role":"lesson_tabs","confidence":0.9}]}'
        }
      ],
      { json: true, ...streamTo(getWindow, 'classificação de vídeos') }
    )
    const parsed = parseJsonLoose<{
      assignments: Array<{ index: number; role: string; confidence: number }>
    }>(result.text)
    return parsed ?? { assignments: [] }
  })

  /** Turn pasted chord-sheet text into clean ChordPro. */
  handle('llm:toChordPro', async (songId: number, rawText: string) => {
    const song = repo.getSong(songId)
    const result = await complete([
      {
        role: 'system',
        content: toChordProSystemPrompt()
      },
      {
        role: 'user',
        content:
          `${song ? `Música: ${song.title} — ${song.artist ?? ''}\n\n` : ''}` +
          `Converta para ChordPro (acordes entre colchetes na posição da sílaba, ` +
          `diretivas {title:} {artist:} {key:} e {start_of_verse}/{start_of_chorus}):\n\n${rawText}`
      }
    ], streamTo(getWindow, 'conversão para ChordPro'))
    const cleaned = result.text.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim()
    return { content: cleaned, provider: result.provider, model: result.model }
  })

  /* -------------------------------------------------------------- status */

  handle('status:integrations', async (): Promise<IntegrationStatus> => {
    const [sp, llm, labState, ffmpeg] = await Promise.all([
      spotify.status(),
      llmStatus(),
      lab.labHealth(),
      ffmpegVersion()
    ])
    return {
      spotify: sp,
      youtube: {
        configured: config.youtube.configured,
        quotaUsedToday: youtube.quotaUsedToday(),
        quotaLimit: config.youtube.quotaLimit,
        detail: config.youtube.configured
          ? `${Math.floor(youtube.quotaRemaining() / 100)} buscas restantes hoje`
          : 'YOUTUBE_API_KEY ausente no .env'
      },
      llm,
      lab: {
        url: config.lab.url,
        reachable: labState.reachable,
        gpu: labState.gpu,
        detail: labState.detail
      },
      ffmpeg: {
        available: ffmpeg !== null,
        version: ffmpeg,
        path: config.ffmpeg.path
      }
    }
  })

  /* ------------------------------------------------------------ settings */

  /*
   * Reading is cheap and the renderer refreshes often, so this returns the whole
   * catalogue. Secret values never appear: settingViews() reports only whether
   * something is set, plus where the effective value came from, which is what
   * the UI needs to explain "I pasted a key and nothing happened".
   */
  handle('settings:get', () => ({
    settings: settingViews(),
    encryption: { available: encryptionAvailable(), hint: encryptionHint() },
    locale: currentLocale()
  }))

  handle('settings:set', (raw: unknown) => {
    const patch = asStringRecord(raw, 'settings')
    const result = saveSettings(patch)
    if (!result.ok && result.error === ENCRYPTION_UNAVAILABLE) {
      return { ok: false, error: encryptionHint() }
    }
    return { ok: result.ok, changed: result.changed }
  })

  /*
   * A real call to the provider, not just "is a key present". available() is
   * the right check for routing but would report a mistyped key as fine.
   */
  handle('settings:testProvider', (name: unknown) =>
    probeProvider(asEnum(name, 'provider', ['gemini', 'openai', 'groq', 'ollama'] as const))
  )

  /* --------------------------------------------------------------- shell */

  /*
   * Restricted to http(s). This call hands its argument to the operating
   * system, which will act on file: URLs and on any registered custom scheme,
   * so an unvalidated string here is the one real hole in this file.
   */
  handle('shell:openExternal', (url: unknown) => shell.openExternal(asHttpUrl(url)))
  handle('shell:showItem', (path: string) => shell.showItemInFolder(path))
  handle('shell:pickFolder', async () => {
    const win = getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
}
