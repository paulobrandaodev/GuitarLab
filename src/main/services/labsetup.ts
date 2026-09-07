import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config'
import { settingValue } from '../settings'
import { directorySize, downloadToFile, extractArchive } from './download'
import {
  DEFAULT_LAB_PORT,
  LAB_MODELS,
  PYTHON_VERSION,
  TORCH_VERSION,
  UV_VERSION,
  candidatePorts,
  installSteps,
  markerIsCurrent,
  packApproxDiskBytes,
  parseNvidiaSmi,
  recommendedPack,
  runtimeLayout,
  sidecarArgs,
  sidecarEnv,
  stepProgress,
  uvAsset,
  type GpuInfo,
  type InstallMarker,
  type LabPack,
  type RuntimeLayout
} from './labsetup-core'
import { setManagedLabUrl } from './lab'
import type { LabSetupProgress, LabSetupStatus } from '@shared/types'

const run = promisify(execFile)

/**
 * The audio lab, installed and run by the app itself.
 *
 * This replaces the Docker container. Everything the lab needs — a CPython, a
 * venv, torch, Demucs, the models — is downloaded on demand into the user's
 * data directory and run as a child process. The sidecar's HTTP contract is
 * unchanged, so `lab.ts` did not have to learn anything new: it still talks to
 * a URL, and that URL now happens to belong to a process this module started.
 *
 * The reason it is built this way rather than frozen into the installer: which
 * of CPU or CUDA a machine needs cannot be known at build time, and shipping
 * both would mean a 3 GB download for everyone including the people who never
 * open the Lab screen. The installer stays at ~116 MB and the 400 MB (or 2.7
 * GB) is spent only by someone who asked for it, with a progress bar and a
 * cancel button.
 */

// ─── where everything lives ───────────────────────────────────────────────────

/** The runtime: uv, the interpreter and the venv. Overridable — it gets large. */
export function runtimeRoot(): string {
  return settingValue('labRuntimeDir') || join(config.userData, 'lab-runtime')
}

/** Model weights. Kept apart from the runtime so reinstalling does not re-download them. */
export function modelsRoot(): string {
  return settingValue('labModelsDir') || join(config.userData, 'lab-models')
}

/**
 * The sidecar's Python source.
 *
 * Shipped through `extraResources` rather than `files`, because the interpreter
 * reads these off the filesystem and nothing can be read out of an asar archive
 * by a process that is not Electron.
 */
export function labSourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'lab')
    : join(config.projectRoot, 'lab')
}

function layout(): RuntimeLayout {
  return runtimeLayout(runtimeRoot(), process.platform)
}

// ─── what is installed ────────────────────────────────────────────────────────

async function readMarker(): Promise<InstallMarker | null> {
  try {
    const raw = await readFile(layout().marker, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as InstallMarker
  } catch {
    /* absent or corrupt both mean "not installed" */
  }
  return null
}

let gpuCache: { value: GpuInfo | null; at: number } | null = null

/**
 * Ask the driver what card is present.
 *
 * Cached for a minute: the Lab screen and the Settings screen both want this,
 * and spawning nvidia-smi on every render is a visible stutter on a laptop
 * where the discrete GPU has to wake up to answer.
 */
export async function detectGpu(): Promise<GpuInfo | null> {
  if (gpuCache && Date.now() - gpuCache.at < 60_000) return gpuCache.value
  let value: GpuInfo | null = null
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=name,driver_version', '--format=csv,noheader'],
      { timeout: 5000, windowsHide: true }
    )
    value = parseNvidiaSmi(stdout)
  } catch {
    // No nvidia-smi means no NVIDIA driver, which is the answer, not an error.
    value = null
  }
  gpuCache = { value, at: Date.now() }
  return value
}

async function installedModels(): Promise<string[]> {
  const url = currentUrl()
  if (!url) return []
  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = (await res.json()) as { installed?: string[] }
    return data.installed ?? []
  } catch {
    return []
  }
}

export async function labSetupStatus(): Promise<LabSetupStatus> {
  const marker = await readMarker()
  const lay = layout()
  const installed = Boolean(marker) && existsSync(lay.python)
  const gpu = await detectGpu()
  const [runtimeBytes, modelBytes] = await Promise.all([
    installed ? directorySize(lay.root) : Promise.resolve(0),
    directorySize(modelsRoot())
  ])

  return {
    installed,
    /** True when a newer uv/python/torch pin means the runtime should be redone. */
    stale: installed && !markerIsCurrent(marker),
    pack: marker?.pack ?? null,
    busy: installing !== null,
    running: child !== null,
    port: currentPort,
    gpu: gpu ? { name: gpu.name, driver: gpu.driver } : null,
    recommendedPack: recommendedPack(gpu),
    runtimeDir: lay.root,
    modelsDir: modelsRoot(),
    runtimeBytes,
    modelBytes,
    models: LAB_MODELS.map((m) => ({ ...m })),
    installedModels: installed ? await installedModels() : []
  }
}

// ─── installing ───────────────────────────────────────────────────────────────

let installing: AbortController | null = null

type ProgressSink = (progress: LabSetupProgress) => void

/**
 * Download and set up the runtime.
 *
 * Steps run in order and the marker is written last, so an install killed at
 * any point leaves a runtime that reports itself as absent rather than as a
 * broken one. Cancelling is a real abort of the in-flight HTTP request and a
 * kill of the running uv, not a flag checked between steps — the torch step
 * alone can be twenty minutes.
 */
export async function installLab(pack: LabPack, onProgress: ProgressSink): Promise<void> {
  if (installing) throw new Error('já existe uma instalação em andamento')
  const controller = new AbortController()
  installing = controller
  const lay = layout()
  const steps = installSteps(pack, lay, join(labSourceDir(), 'requirements'))

  const emit = (
    phase: LabSetupProgress['phase'],
    progress: number,
    detail: string,
    error?: string
  ): void => onProgress({ phase, progress, detail, error })

  try {
    await mkdir(lay.root, { recursive: true })
    await mkdir(modelsRoot(), { recursive: true })

    // ---- uv itself
    if (!existsSync(lay.uv)) {
      const asset = uvAsset(process.platform, process.arch)
      const archive = join(lay.root, asset.name)
      emit('uv', 0, 'baixando o uv')
      await downloadToFile(asset.url, archive, {
        signal: controller.signal,
        onProgress: (p) =>
          emit(
            'uv',
            p.total ? (p.bytes / p.total) * 0.02 : 0,
            `uv: ${Math.round(p.bytes / 1e6)} MB`
          )
      })
      await extractArchive(archive, lay.root)
      await rm(archive, { force: true })
      // The tarball unpacks into a directory on some targets and flat on others.
      await hoistUv(lay)
      if (process.platform !== 'win32') await chmod(lay.uv, 0o755)
    }

    // ---- the five uv invocations
    const env = {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: lay.pythonDir,
      // Keeping the cache on the same volume as the venv lets uv hardlink into
      // it instead of copying, which is the difference between 7 GB and 14 GB
      // for the CUDA pack.
      UV_CACHE_DIR: join(lay.root, 'cache'),
      UV_NO_PROGRESS: '1'
    }
    const target = packApproxDiskBytes(pack)

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      let lastLine = ''
      emit(step.id, stepProgress(steps, i, 0), '')

      // uv prints a summary rather than a percentage when its output is not a
      // terminal, so movement during the long steps comes from watching the
      // venv grow on disk. Real bytes, not an animation.
      const poll = setInterval(() => {
        void directorySize(lay.venv).then((bytes) => {
          const within = Math.min(0.98, bytes / target)
          emit(step.id, stepProgress(steps, i, within), lastLine)
        })
      }, 2500)

      try {
        await runUv(lay.uv, step.args, env, controller.signal, (line) => {
          lastLine = line
        })
      } finally {
        clearInterval(poll)
      }
      emit(step.id, stepProgress(steps, i + 1, 0), lastLine)
    }

    // ---- reclaim the wheel cache; the venv already has what it needs
    await rm(join(lay.root, 'cache'), { recursive: true, force: true })

    const marker: InstallMarker = {
      pack,
      uvVersion: UV_VERSION,
      pythonVersion: PYTHON_VERSION,
      torchVersion: TORCH_VERSION,
      installedAt: Math.floor(Date.now() / 1000)
    }
    await writeFile(lay.marker, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    emit('done', 1, 'pronto')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const canceled = controller.signal.aborted
    emit('error', 0, '', canceled ? 'instalação cancelada' : message)
    if (!canceled) throw err
  } finally {
    installing = null
  }
}

export function cancelInstall(): void {
  installing?.abort()
}

/**
 * Remove the runtime.
 *
 * Models are left alone on purpose: they are the slow half of the download and
 * survive an "install the CUDA pack instead" round trip. `removeModels` is a
 * separate, explicit action.
 */
export async function removeLab(): Promise<void> {
  await stopSidecar()
  await rm(runtimeRoot(), { recursive: true, force: true })
}

export async function removeModels(): Promise<void> {
  await rm(modelsRoot(), { recursive: true, force: true })
}

/** Some uv archives unpack into `uv-<target>/uv`; flatten either shape. */
async function hoistUv(lay: RuntimeLayout): Promise<void> {
  if (existsSync(lay.uv)) return
  const { readdir, rename } = await import('node:fs/promises')
  const exe = process.platform === 'win32' ? 'uv.exe' : 'uv'
  for (const entry of await readdir(lay.root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('uv-')) continue
    const inner = join(lay.root, entry.name, exe)
    if (existsSync(inner)) {
      await rename(inner, lay.uv)
      await rm(join(lay.root, entry.name), { recursive: true, force: true })
      return
    }
  }
  throw new Error('o binário do uv não foi encontrado depois de extrair')
}

/** Run one uv command, streaming its output, and reject on a non-zero exit. */
function runUv(
  uv: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(uv, args, { env, windowsHide: true })
    const tail: string[] = []

    const consume = (buf: Buffer): void => {
      for (const raw of buf.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        onLine(line.slice(0, 200))
        tail.push(line)
        if (tail.length > 20) tail.shift()
      }
    }
    proc.stdout?.on('data', consume)
    proc.stderr?.on('data', consume)

    const abort = (): void => {
      killTree(proc)
      reject(new Error('cancelado'))
    }
    signal.addEventListener('abort', abort, { once: true })

    proc.on('error', (err) => {
      signal.removeEventListener('abort', abort)
      reject(err)
    })
    proc.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (code === 0) resolve()
      else reject(new Error(`uv ${args[0]} falhou (código ${code}): ${tail.slice(-4).join(' | ')}`))
    })
  })
}

// ─── the sidecar process ──────────────────────────────────────────────────────

let child: ChildProcess | null = null
let currentPort: number | null = null

function currentUrl(): string | null {
  return currentPort ? `http://127.0.0.1:${currentPort}` : null
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function pickPort(): Promise<number> {
  for (const port of candidatePorts()) {
    if (await portIsFree(port)) return port
  }
  throw new Error(`nenhuma porta livre a partir de ${DEFAULT_LAB_PORT}`)
}

/**
 * Start the sidecar and wait for it to answer.
 *
 * Returns the URL. Idempotent: calling it while the process is up is a no-op,
 * which is what lets both the Lab screen and startup call it without
 * coordinating.
 */
export async function startSidecar(): Promise<string> {
  if (child && currentPort) return `http://127.0.0.1:${currentPort}`
  const lay = layout()
  if (!existsSync(lay.python)) throw new Error('o laboratório ainda não está instalado')

  const port = await pickPort()
  const env = {
    ...process.env,
    ...sidecarEnv({
      modelsDir: modelsRoot(),
      stemsDir: config.paths.stems,
      parentPid: process.pid
    })
  }

  const proc = spawn(lay.python, sidecarArgs(port), {
    cwd: labSourceDir(),
    env,
    windowsHide: true,
    // A process group on POSIX, so demucs — a grandchild — dies with it.
    detached: process.platform !== 'win32'
  })
  proc.stdout?.on('data', (b: Buffer) => console.log('[lab]', b.toString().trimEnd()))
  proc.stderr?.on('data', (b: Buffer) => console.log('[lab]', b.toString().trimEnd()))
  proc.on('exit', (code) => {
    if (proc === child) {
      child = null
      currentPort = null
      setManagedLabUrl(null)
      if (code) console.error(`[lab] sidecar saiu com código ${code}`)
    }
  })

  child = proc
  currentPort = port
  const url = `http://127.0.0.1:${port}`
  setManagedLabUrl(url)

  await waitForHealth(url, 90_000)
  return url
}

/**
 * Poll /health until it answers.
 *
 * Ninety seconds because the first import of torch on a cold filesystem — a
 * CUDA venv is ~7 GB of DLLs — genuinely takes tens of seconds on a spinning
 * disk, and giving up early would report a working lab as broken.
 */
async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!child) throw new Error('o laboratório encerrou durante a inicialização')
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('o laboratório não respondeu a tempo')
}

/**
 * Kill a process and everything it spawned.
 *
 * `child.kill()` on Windows kills only the named process, and the sidecar runs
 * Demucs as a subprocess — so the naive version leaves a python holding several
 * gigabytes of VRAM after the app closes. `taskkill /T` walks the tree; on
 * POSIX the negative pid does the same through the process group.
 */
function killTree(proc: ChildProcess): void {
  if (!proc.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      proc.kill()
    }
    return
  }
  try {
    process.kill(-proc.pid, 'SIGTERM')
  } catch {
    proc.kill('SIGTERM')
  }
}

export async function stopSidecar(): Promise<void> {
  const proc = child
  child = null
  currentPort = null
  setManagedLabUrl(null)
  if (!proc) return
  killTree(proc)
  // Give it a moment to go, but never block quitting on it.
  await new Promise((r) => setTimeout(r, 300))
}

/** Start the lab if it is installed and the user has not turned auto-start off. */
export async function autoStartSidecar(): Promise<void> {
  if (settingValue('labAutoStart') === 'false') return
  const marker = await readMarker()
  if (!marker || !existsSync(layout().python)) return
  try {
    await startSidecar()
  } catch (err) {
    console.error('[lab] auto-start falhou:', err)
  }
}

// ─── models ───────────────────────────────────────────────────────────────────

/** Ask the sidecar to pull one model. Returns its job id, polled like any other. */
export async function fetchModel(family: string, id: string): Promise<{ jobId: string }> {
  const url = currentUrl() ?? (await startSidecar())
  const res = await fetch(`${url}/models/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ family, name: id })
  })
  if (!res.ok) throw new Error(`o laboratório recusou o download: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { job_id?: string }
  if (!data.job_id) throw new Error('o laboratório não devolveu um job')
  return { jobId: data.job_id }
}

/** One model-download job, straight from the sidecar. */
export async function modelJob(jobId: string): Promise<Record<string, unknown> | null> {
  const url = currentUrl()
  if (!url) return null
  try {
    const res = await fetch(`${url}/jobs/${jobId}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}
