import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { saveChordMap } from '../db/repo'
import { normalizeChordSpans } from '@shared/chords'
import { config } from '../config'
import type { AnalysisJobView, AnalysisType } from '@shared/types'

/**
 * Client for the optional Docker sidecar that runs Demucs, librosa/madmom,
 * basic-pitch and faster-whisper on the GPU. Everything here degrades to a
 * clear "lab offline" state rather than throwing, because the whole app is
 * designed to work with the container stopped.
 */

/**
 * The container sees the media through its own mounts (`/data/stems/...`), so
 * every path it hands back has to be translated to the Windows path Electron
 * can actually open. Without this the stems land in the database as
 * `/data/stems/...`, which resolves to nothing on the host and leaves the
 * player silent.
 *
 * Mirrors the `PATH_MAP` in docker-compose.yml, in the other direction.
 */
const CONTAINER_MOUNTS: Array<{ container: string; host: () => string }> = [
  { container: '/data/stems', host: () => config.paths.stems },
  { container: '/data/songs', host: () => config.paths.songs },
  { container: '/data/gptabs', host: () => config.paths.gptabs }
]

export function toHostPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  // already a host path (drive letter or UNC) — nothing to translate
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')) return path

  for (const mount of CONTAINER_MOUNTS) {
    if (normalized === mount.container || normalized.startsWith(`${mount.container}/`)) {
      const rest = normalized.slice(mount.container.length).replace(/^\/+/, '')
      const root = mount.host().replace(/\\/g, '/').replace(/\/+$/, '')
      return rest ? `${root}/${rest}` : root
    }
  }
  return path
}

export interface LabHealth {
  reachable: boolean
  gpu: string | null
  cuda: boolean
  models: string[]
  detail: string
}

export async function labHealth(): Promise<LabHealth> {
  try {
    const res = await fetch(`${config.lab.url}/health`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) {
      return { reachable: false, gpu: null, cuda: false, models: [], detail: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as {
      gpu?: string
      cuda?: boolean
      models?: string[]
    }
    return {
      reachable: true,
      gpu: data.gpu ?? null,
      cuda: Boolean(data.cuda),
      models: data.models ?? [],
      detail: data.cuda ? `CUDA ativo em ${data.gpu ?? 'GPU'}` : 'rodando em CPU'
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      reachable: false,
      gpu: null,
      cuda: false,
      models: [],
      detail: msg.includes('timeout') ? 'container não respondeu' : 'container parado'
    }
  }
}

function toView(row: typeof schema.analysisJobs.$inferSelect): AnalysisJobView {
  return {
    id: row.id,
    songId: row.songId,
    type: row.type,
    status: row.status,
    progress: row.progress,
    error: row.error,
    result: row.resultJson ? (JSON.parse(row.resultJson) as Record<string, unknown>) : null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt
  }
}

export function listJobs(songId?: number): AnalysisJobView[] {
  const db = getDb()
  const rows = songId
    ? db.select().from(schema.analysisJobs).where(eq(schema.analysisJobs.songId, songId)).all()
    : db.select().from(schema.analysisJobs).all()
  return rows.map(toView)
}

/** Queue a job locally and hand it to the container. */
export async function submitJob(
  songId: number,
  type: AnalysisType,
  audioPath: string,
  params: Record<string, unknown> = {}
): Promise<AnalysisJobView | { error: string }> {
  const db = getDb()
  const health = await labHealth()
  if (!health.reachable) {
    return { error: `Laboratório indisponível: ${health.detail}. Rode "npm run lab:up".` }
  }

  const body: Record<string, unknown> = { audio_path: audioPath, ...params }
  if (type === 'stems') {
    body.model = params.model ?? config.lab.demucsModel
    body.segment = params.segment ?? config.lab.demucsSegment
    body.out_dir = config.paths.stems
  }

  const job = db
    .insert(schema.analysisJobs)
    .values({ songId, type, status: 'queued', paramsJson: JSON.stringify(body) })
    .returning()
    .get()

  try {
    const res = await fetch(`${config.lab.url}/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      db.update(schema.analysisJobs)
        .set({ status: 'error', error: `HTTP ${res.status}: ${detail}` })
        .where(eq(schema.analysisJobs.id, job.id))
        .run()
      return { error: `Laboratório recusou o job: ${detail}` }
    }
    const data = (await res.json()) as { job_id?: string }
    db.update(schema.analysisJobs)
      .set({ status: 'running', remoteJobId: data.job_id ?? null })
      .where(eq(schema.analysisJobs.id, job.id))
      .run()

    const updated = db
      .select()
      .from(schema.analysisJobs)
      .where(eq(schema.analysisJobs.id, job.id))
      .get()!
    return toView(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.update(schema.analysisJobs)
      .set({ status: 'error', error: message })
      .where(eq(schema.analysisJobs.id, job.id))
      .run()
    return { error: message }
  }
}

/** Poll the container for one job and mirror its state into the local row. */
export async function refreshJob(jobId: number): Promise<AnalysisJobView | null> {
  const db = getDb()
  const row = db.select().from(schema.analysisJobs).where(eq(schema.analysisJobs.id, jobId)).get()
  if (!row || !row.remoteJobId) return row ? toView(row) : null
  if (row.status === 'done' || row.status === 'error') return toView(row)

  try {
    const res = await fetch(`${config.lab.url}/jobs/${row.remoteJobId}`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return toView(row)
    const data = (await res.json()) as {
      status?: string
      progress?: number
      result?: Record<string, unknown>
      error?: string
    }

    const status =
      data.status === 'done'
        ? 'done'
        : data.status === 'error'
          ? 'error'
          : data.status === 'running'
            ? 'running'
            : row.status

    db.update(schema.analysisJobs)
      .set({
        status,
        progress: data.progress ?? row.progress,
        resultJson: data.result ? JSON.stringify(data.result) : row.resultJson,
        error: data.error ?? row.error,
        finishedAt: status === 'done' || status === 'error' ? Math.floor(Date.now() / 1000) : null
      })
      .where(eq(schema.analysisJobs.id, jobId))
      .run()

    if (status === 'done' && data.result) applyJobResult(row.songId, row.type, data.result)

    const updated = db
      .select()
      .from(schema.analysisJobs)
      .where(eq(schema.analysisJobs.id, jobId))
      .get()!
    return toView(updated)
  } catch {
    return toView(row)
  }
}

const STEM_KIND: Record<string, string> = {
  vocals: 'stem_vocals',
  drums: 'stem_drums',
  bass: 'stem_bass',
  guitar: 'stem_guitar',
  piano: 'stem_piano',
  other: 'stem_other'
}

/** Fold a finished analysis back into the song record. */
function applyJobResult(songId: number, type: AnalysisType, result: Record<string, unknown>): void {
  const db = getDb()

  if (type === 'stems') {
    const stems = (result.stems ?? {}) as Record<string, string>
    for (const [name, rawPath] of Object.entries(stems)) {
      const kind = STEM_KIND[name]
      if (!kind || !rawPath) continue
      const path = toHostPath(rawPath)
      // `path` is unique, so a re-run with the same output overwrites the row
      // for that stem instead of piling up duplicates
      db.insert(schema.mediaAssets)
        .values({ songId, kind: kind as never, path })
        .onConflictDoUpdate({
          target: schema.mediaAssets.path,
          set: { songId, kind: kind as never }
        })
        .run()
    }
    return
  }

  if (type === 'rhythm') {
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
    const bpm = typeof result.bpm === 'number' ? result.bpm : null
    // never silently overwrite a tempo the Guitar Pro file declared
    if (bpm && song && song.bpmSource !== 'gp') {
      db.update(schema.songs)
        .set({ bpm, bpmSource: 'analysis' })
        .where(eq(schema.songs.id, songId))
        .run()
    }
    return
  }

  if (type === 'harmony') {
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
    const key = typeof result.key === 'string' ? result.key : null
    if (key && song && song.keySource !== 'gp') {
      db.update(schema.songs)
        .set({ musicalKey: key, keySource: 'analysis' })
        .where(eq(schema.songs.id, songId))
        .run()
    }

    /*
     * The chord track is the point of this job — the key is a by-product. It is
     * stored whole rather than folded into the song row, because what the
     * screen draws is chord *over time*, the way Chordify lays it out.
     */
    const spans = normalizeChordSpans(result.chords)

    if (spans.length) {
      saveChordMap(songId, {
        key,
        bpm: typeof result.bpm === 'number' ? result.bpm : (song?.bpm ?? null),
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
        source: 'analysis',
        beatsMs: Array.isArray(result.beats) ? (result.beats as number[]).map(Number) : [],
        spans
      })
    }
    return
  }

  if (type === 'lyrics') {
    const lrc = typeof result.lrc === 'string' ? result.lrc : null
    if (lrc) {
      db.insert(schema.charts)
        .values({ songId, kind: 'lyrics', format: 'lrc', content: lrc })
        .run()
    }
  }
}

/** Poll every running job — called on a timer from the main process. */
export async function refreshAllRunning(): Promise<AnalysisJobView[]> {
  const db = getDb()
  const running = db
    .select()
    .from(schema.analysisJobs)
    .where(eq(schema.analysisJobs.status, 'running'))
    .all()
  const out: AnalysisJobView[] = []
  for (const job of running) {
    const updated = await refreshJob(job.id)
    if (updated) out.push(updated)
  }
  return out
}
