/**
 * The lab runtime's rules, with no I/O and no Electron.
 *
 * Split from `labsetup.ts` for the same reason `settings-core.ts` is split from
 * `settings.ts`: every decision here — which asset to download, where the venv
 * python lands, what `uv pip install` is invoked with — is a pure function of
 * the platform and the chosen pack, and each one is a string that can only be
 * wrong on a machine that is not this one. `tsx` can test all of them.
 *
 * Nothing in this file may import `electron`, `node:fs`, or anything with a
 * side effect. Paths are joined with `/` rather than `node:path`, so the same
 * assertion holds whether the test runs on Windows or on the Linux runner.
 */

export type LabPack = 'cpu' | 'cuda'

/**
 * Join path segments with `/`. Node and Windows both accept forward slashes.
 *
 * Only the first segment keeps a leading slash, so an absolute POSIX root
 * survives while `j(root, '/hf')` still yields one separator rather than two.
 */
export function j(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, '/').replace(/\/+$/, '')
      return index === 0 ? normalized : normalized.replace(/^\/+/, '')
    })
    .filter(Boolean)
    .join('/')
}

// ─── uv ───────────────────────────────────────────────────────────────────────

/*
 * Pinned rather than tracking `latest`, because `latest` means the install a
 * user runs tomorrow is not the one that was tested today, and a uv release
 * that changes a flag would break the lab for everyone at once with no commit
 * to point at. Bumping this is a deliberate one-line change.
 */
export const UV_VERSION = '0.12.10'

const UV_ASSETS: Record<string, string> = {
  'win32:x64': 'uv-x86_64-pc-windows-msvc.zip',
  'win32:arm64': 'uv-aarch64-pc-windows-msvc.zip',
  'linux:x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux:arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'darwin:x64': 'uv-x86_64-apple-darwin.tar.gz',
  'darwin:arm64': 'uv-aarch64-apple-darwin.tar.gz'
}

export interface RemoteAsset {
  name: string
  url: string
}

export function uvAsset(platform: string, arch: string): RemoteAsset {
  const name = UV_ASSETS[`${platform}:${arch}`]
  if (!name) throw new Error(`sem build do uv para ${platform}/${arch}`)
  return {
    name,
    url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`
  }
}

// ─── the runtime on disk ──────────────────────────────────────────────────────

/*
 * 3.10, and the reason is basic-pitch.
 *
 * Its dependency table makes TensorFlow an unconditional requirement on
 * CPython 3.11 and later, but falls back to onnxruntime (Windows) and
 * tflite-runtime (Linux) below that. The container this replaces ran 3.11 and
 * therefore carried tensorflow 2.15 — around 600 MB, plus twenty-five extra
 * packages, for a model that runs on the CPU either way.
 *
 * Resolved both ways with `uv pip compile` before choosing: 3.11 gives 112
 * packages including tensorflow; 3.10 gives 86 on Windows and 100 on Linux
 * with none. Both land on numpy 1.26.4, so this is the same numeric stack the
 * container was proven against — see the `numpy<2` pin in base.txt, which is
 * what holds that true now that TensorFlow is not there to force it.
 */
export const PYTHON_VERSION = '3.10'
export const TORCH_VERSION = '2.6.0'

export interface RuntimeLayout {
  root: string
  /** The uv binary itself. */
  uv: string
  /** Where uv is told to keep the interpreters it downloads. */
  pythonDir: string
  venv: string
  /** `Scripts` on Windows, `bin` everywhere else. */
  venvBin: string
  /** The interpreter the sidecar and every `uv pip` call run through. */
  python: string
  /** Written last, so a half-finished install never looks complete. */
  marker: string
}

export function runtimeLayout(root: string, platform: string): RuntimeLayout {
  const win = platform === 'win32'
  const bin = win ? 'Scripts' : 'bin'
  const exe = win ? '.exe' : ''
  return {
    root: j(root),
    uv: j(root, `uv${exe}`),
    pythonDir: j(root, 'python'),
    venv: j(root, 'venv'),
    venvBin: j(root, 'venv', bin),
    python: j(root, 'venv', bin, `python${exe}`),
    marker: j(root, 'installed.json')
  }
}

/** What `installed.json` holds, so a stale runtime can be recognised as stale. */
export interface InstallMarker {
  pack: LabPack
  uvVersion: string
  pythonVersion: string
  torchVersion: string
  installedAt: number
}

export function markerIsCurrent(marker: InstallMarker | null): boolean {
  if (!marker) return false
  return (
    marker.uvVersion === UV_VERSION &&
    marker.pythonVersion === PYTHON_VERSION &&
    marker.torchVersion === TORCH_VERSION
  )
}

// ─── the two packs ────────────────────────────────────────────────────────────

/*
 * The whole point of installing after the fact instead of shipping it: CUDA is
 * roughly seven times the download of CPU, and which one a machine needs cannot
 * be known at build time. With pip wheels the GPU needs only the NVIDIA driver
 * — the CUDA runtime rides along inside the `nvidia-*-cu12` packages — which is
 * what makes replacing the container possible at all.
 */
export function torchIndexUrl(pack: LabPack): string {
  return pack === 'cuda'
    ? 'https://download.pytorch.org/whl/cu124'
    : 'https://download.pytorch.org/whl/cpu'
}

/** Rough download size, for the UI to show before the user commits to it. */
export function packApproxBytes(pack: LabPack): number {
  return pack === 'cuda' ? 2_700_000_000 : 400_000_000
}

/**
 * Rough size of the finished venv.
 *
 * Used as the denominator for progress inside an install step: uv prints a
 * summary rather than a per-package percentage when its output is not a
 * terminal, so the honest way to show movement during a 2.7 GB download is to
 * watch the venv grow on disk.
 *
 * The CPU figure is measured — a real install came to 1.83 GB. CUDA is that
 * plus the `nvidia-*-cu12` wheels, and is an extrapolation. Erring high is
 * deliberate: too low and the bar reaches its 0.98 ceiling early and sits there
 * looking hung, which is exactly the impression this is here to avoid.
 */
export function packApproxDiskBytes(pack: LabPack): number {
  return pack === 'cuda' ? 7_500_000_000 : 1_900_000_000
}

export interface InstallStep {
  id: 'python' | 'venv' | 'torch' | 'demucs' | 'base'
  /** Share of the whole install, so the bar advances at a believable rate. */
  weight: number
  args: string[]
}

/**
 * The install, as a list of `uv` invocations.
 *
 * Split into five rather than one `uv pip install` so the progress bar can say
 * what is happening: the CUDA pack is a 2.7 GB download, and a single opaque
 * spinner for twenty minutes is indistinguishable from a hang.
 *
 * Torch goes first and from its own index. Demucs declares a plain `torch`
 * dependency, so resolving it before torch is pinned would pull the default
 * PyPI wheel — the CPU one — and quietly undo the user's choice of the CUDA
 * pack.
 */
export function installSteps(pack: LabPack, layout: RuntimeLayout, reqDir: string): InstallStep[] {
  const py = ['--python', layout.python]
  const cuda = pack === 'cuda'
  return [
    {
      id: 'python',
      weight: cuda ? 0.06 : 0.14,
      args: ['python', 'install', PYTHON_VERSION]
    },
    {
      id: 'venv',
      weight: 0.02,
      args: ['venv', layout.venv, '--python', PYTHON_VERSION]
    },
    {
      id: 'torch',
      weight: cuda ? 0.72 : 0.42,
      args: [
        'pip',
        'install',
        ...py,
        '--index-url',
        torchIndexUrl(pack),
        `torch==${TORCH_VERSION}`,
        `torchaudio==${TORCH_VERSION}`
      ]
    },
    {
      id: 'demucs',
      weight: cuda ? 0.08 : 0.14,
      args: ['pip', 'install', ...py, '-r', j(reqDir, 'demucs.txt')]
    },
    {
      id: 'base',
      weight: cuda ? 0.12 : 0.28,
      args: ['pip', 'install', ...py, '-r', j(reqDir, 'base.txt')]
    }
  ]
}

/** Cumulative progress after `index` steps, plus a fraction of the one running. */
export function stepProgress(steps: InstallStep[], index: number, within: number): number {
  const total = steps.reduce((sum, s) => sum + s.weight, 0) || 1
  let done = 0
  for (let i = 0; i < index && i < steps.length; i++) done += steps[i].weight
  const current = steps[index]?.weight ?? 0
  const clamped = Math.min(1, Math.max(0, within))
  return Math.min(1, (done + current * clamped) / total)
}

// ─── GPU detection ────────────────────────────────────────────────────────────

export interface GpuInfo {
  name: string
  driver: string
}

/**
 * Read `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader`.
 *
 * `nvidia-smi` ships with the driver, so its absence is the cheapest reliable
 * "there is no NVIDIA GPU here" — and its presence with no rows is the laptop
 * case where the driver is installed but the discrete card is switched off.
 * Both have to answer null, or the UI recommends a 2.7 GB download that will
 * fall back to the CPU anyway.
 */
export function parseNvidiaSmi(stdout: string): GpuInfo | null {
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/no devices|not supported|failed|error/i.test(line)) return null
    const [name, driver] = line.split(',').map((part) => part.trim())
    if (!name || !driver) continue
    return { name, driver }
  }
  return null
}

/**
 * Which pack to put forward.
 *
 * Anything older than the 525 series predates the CUDA 12 runtime the cu124
 * wheels are built against, so a driver that old gets the CPU pack recommended
 * rather than a 2.7 GB download that ends in a loader error.
 */
export const MIN_CUDA_DRIVER_MAJOR = 525

export function recommendedPack(gpu: GpuInfo | null): LabPack {
  if (!gpu) return 'cpu'
  const major = Number.parseInt(gpu.driver.split('.')[0] ?? '', 10)
  if (!Number.isFinite(major) || major < MIN_CUDA_DRIVER_MAJOR) return 'cpu'
  return 'cuda'
}

// ─── running the sidecar ──────────────────────────────────────────────────────

export const DEFAULT_LAB_PORT = 8756

/**
 * Ports to try, in order.
 *
 * 8756 stays first so an existing `FORGE_LAB_URL` or firewall rule keeps
 * working. The rest exist because refusing to start over a port another program
 * happened to take is not an acceptable failure for a user who has no terminal.
 */
export function candidatePorts(base = DEFAULT_LAB_PORT, count = 20): number[] {
  return Array.from({ length: count }, (_, i) => base + i)
}

export function sidecarArgs(port: number): string[] {
  return ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)]
}

export interface SidecarEnvOptions {
  modelsDir: string
  stemsDir: string
  parentPid: number
}

/**
 * The environment the sidecar runs under.
 *
 * `TORCH_HOME` and `HF_HOME` are what the container set, and are why the model
 * downloads survive reinstalling the runtime. `XDG_CACHE_HOME` is new: under
 * Docker, numba's and librosa's caches lived in the container's ephemeral layer
 * and were silently rebuilt on every recreation. Pointed at a real directory,
 * the second analysis of a track starts in seconds rather than tens of seconds.
 */
export function sidecarEnv(opts: SidecarEnvOptions): Record<string, string> {
  return {
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    TORCH_HOME: opts.modelsDir,
    HF_HOME: j(opts.modelsDir, 'hf'),
    XDG_CACHE_HOME: j(opts.modelsDir, 'cache'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    STEMS_DIR: opts.stemsDir,
    GUITARLAB_PARENT_PID: String(opts.parentPid)
  }
}

// ─── models ───────────────────────────────────────────────────────────────────

export interface LabModel {
  id: string
  family: 'demucs' | 'whisper'
  /** Rough on-disk size. The UI shows this before the download starts. */
  approxBytes: number
}

/*
 * Deliberately short. Every extra entry is another multi-hundred-megabyte
 * download offered to someone who cannot tell from the name which one they
 * want, and the three Demucs bags here already cover "guitar separated",
 * "best quality" and "slowest, best of the four-stem models".
 */
export const LAB_MODELS: readonly LabModel[] = [
  // htdemucs_6s and whisper tiny are measured from a real download; the rest
  // are scaled from them. htdemucs_ft is four times the size of the others
  // because it is a bag of four fine-tuned models rather than one.
  { id: 'htdemucs_6s', family: 'demucs', approxBytes: 55_000_000 },
  { id: 'htdemucs', family: 'demucs', approxBytes: 80_000_000 },
  { id: 'htdemucs_ft', family: 'demucs', approxBytes: 320_000_000 },
  { id: 'tiny', family: 'whisper', approxBytes: 78_000_000 },
  { id: 'base', family: 'whisper', approxBytes: 150_000_000 },
  { id: 'small', family: 'whisper', approxBytes: 500_000_000 },
  { id: 'medium', family: 'whisper', approxBytes: 1_500_000_000 }
] as const

export function findModel(family: string, id: string): LabModel | undefined {
  return LAB_MODELS.find((m) => m.family === family && m.id === id)
}

/** Human-readable size, for a UI that has to talk in gigabytes without lying. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
