/**
 * The lab runtime's rules: asset names, venv layout, install argv, GPU probing.
 *
 * Run with: npm run test:labsetup
 *
 * This is the file that replaced a Docker container, and almost every way it
 * can fail is a string that is only wrong on somebody else's machine — a
 * Windows `Scripts` where Linux wants `bin`, a torch index that quietly gives
 * the CPU build to someone who paid for the CUDA download, an `nvidia-smi` that
 * answers with a message instead of a row. None of that shows up on the machine
 * it was written on, so all of it is pure and all of it is asserted here.
 *
 * Nothing in here touches the network or the filesystem.
 */
import {
  LAB_MODELS,
  MIN_CUDA_DRIVER_MAJOR,
  PYTHON_VERSION,
  TORCH_VERSION,
  UV_VERSION,
  candidatePorts,
  findModel,
  formatBytes,
  installSteps,
  j,
  markerIsCurrent,
  packApproxBytes,
  parseNvidiaSmi,
  recommendedPack,
  runtimeLayout,
  sidecarArgs,
  sidecarEnv,
  stepProgress,
  torchIndexUrl,
  uvAsset,
  type InstallMarker
} from '../src/main/services/labsetup-core'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

function throws(label: string, fn: () => unknown): void {
  try {
    fn()
    check(label, false, 'nao lancou')
  } catch {
    check(label, true)
  }
}

console.log('\n=== 1. o binario do uv ===')

for (const [platform, arch, expected] of [
  ['win32', 'x64', 'uv-x86_64-pc-windows-msvc.zip'],
  ['linux', 'x64', 'uv-x86_64-unknown-linux-gnu.tar.gz'],
  ['darwin', 'arm64', 'uv-aarch64-apple-darwin.tar.gz']
] as const) {
  const asset = uvAsset(platform, arch)
  check(`asset de ${platform}/${arch}`, asset.name === expected, asset.name)
  check(
    `url de ${platform}/${arch} carrega a versao fixada`,
    asset.url === `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${expected}`
  )
}
throws('plataforma sem build do uv e um erro, nao um undefined', () => uvAsset('sunos', 'sparc'))

console.log('\n=== 2. o layout no disco ===')

const win = runtimeLayout('C:/Users/x/AppData/Roaming/guitarlab/lab-runtime', 'win32')
const nix = runtimeLayout('/home/x/.config/guitarlab/lab-runtime', 'linux')

check('windows usa Scripts', win.venvBin.endsWith('/venv/Scripts'), win.venvBin)
check('linux usa bin', nix.venvBin.endsWith('/venv/bin'), nix.venvBin)
check('windows tem .exe', win.python.endsWith('/venv/Scripts/python.exe'), win.python)
check('linux nao tem .exe', nix.python.endsWith('/venv/bin/python'), nix.python)
check('o uv fica na raiz do runtime', win.uv.endsWith('/lab-runtime/uv.exe'), win.uv)
check('o marcador fica na raiz', nix.marker.endsWith('/lab-runtime/installed.json'), nix.marker)

// The whole point of joining with '/' is that the assertion above holds on both
// operating systems. A path built with node:path would embed the host's
// separator and this suite would only be meaningful on one of them.
check('nenhuma barra invertida sobra', !win.python.includes('\\'), win.python)
check('j() colapsa barras repetidas', j('a/', '/b//', 'c') === 'a/b/c', j('a/', '/b//', 'c'))

console.log('\n=== 3. o marcador de instalacao ===')

const fresh: InstallMarker = {
  pack: 'cuda',
  uvVersion: UV_VERSION,
  pythonVersion: PYTHON_VERSION,
  torchVersion: TORCH_VERSION,
  installedAt: 0
}
check('um marcador atual e aceito', markerIsCurrent(fresh))
check('sem marcador nao esta instalado', !markerIsCurrent(null))
check('uv antigo invalida', !markerIsCurrent({ ...fresh, uvVersion: '0.0.1' }))
check('python antigo invalida', !markerIsCurrent({ ...fresh, pythonVersion: '3.9' }))
check('torch antigo invalida', !markerIsCurrent({ ...fresh, torchVersion: '2.0.0' }))

console.log('\n=== 4. os passos da instalacao ===')

for (const pack of ['cpu', 'cuda'] as const) {
  const steps = installSteps(pack, win, 'C:/app/resources/lab/requirements')
  const ids = steps.map((s) => s.id).join(',')
  check(`${pack}: cinco passos na ordem certa`, ids === 'python,venv,torch,demucs,base', ids)

  const torch = steps.find((s) => s.id === 'torch')!
  const index = torch.args[torch.args.indexOf('--index-url') + 1]
  check(`${pack}: usa o indice ${pack} do pytorch`, index === torchIndexUrl(pack), index)
  check(
    `${pack}: torch e torchaudio na mesma versao fixada`,
    torch.args.includes(`torch==${TORCH_VERSION}`) &&
      torch.args.includes(`torchaudio==${TORCH_VERSION}`)
  )

  // The reason demucs is its own step: resolved together with base.txt it
  // would be free to pull the default PyPI torch over the pinned one.
  const order = steps.findIndex((s) => s.id === 'demucs')
  check(`${pack}: demucs depois do torch e antes do base`, order === 3, String(order))

  for (const step of steps) {
    if (step.id === 'python' || step.id === 'venv') continue
    check(
      `${pack}/${step.id}: instala no python do venv`,
      step.args[step.args.indexOf('--python') + 1] === win.python
    )
  }
}

check(
  'o indice de cpu e o de cuda sao diferentes',
  torchIndexUrl('cpu') !== torchIndexUrl('cuda')
)
check('cuda pesa muito mais que cpu', packApproxBytes('cuda') > packApproxBytes('cpu') * 4)

console.log('\n=== 5. o progresso acumulado ===')

const steps = installSteps('cuda', win, '/req')
check('comeca em zero', stepProgress(steps, 0, 0) === 0)
check('termina em um', stepProgress(steps, steps.length, 0) === 1)
check(
  'nunca anda para tras',
  (() => {
    let last = -1
    for (let i = 0; i <= steps.length; i++) {
      for (const within of [0, 0.5, 1]) {
        const value = stepProgress(steps, i, within)
        if (value < last) return false
        last = value
      }
    }
    return true
  })()
)
check('um `within` acima de 1 nao estoura', stepProgress(steps, 1, 99) <= 1)
check('um `within` negativo nao volta', stepProgress(steps, 2, -5) >= stepProgress(steps, 2, 0))

console.log('\n=== 6. a leitura do nvidia-smi ===')

const gpu = parseNvidiaSmi('NVIDIA GeForce RTX 4070, 566.36\n')
check('le nome e driver', gpu?.name === 'NVIDIA GeForce RTX 4070' && gpu?.driver === '566.36')
check('sobrevive a CRLF', parseNvidiaSmi('NVIDIA A100, 535.12\r\n')?.driver === '535.12')
check('pega a primeira de varias placas', parseNvidiaSmi('A, 550.1\nB, 550.1')?.name === 'A')
check('saida vazia e ausencia de placa', parseNvidiaSmi('') === null)
check('so espaco em branco e ausencia', parseNvidiaSmi('\n  \n') === null)
// The laptop case: the driver is installed, the discrete card is switched off.
check(
  'a mensagem de "sem dispositivos" nao vira uma placa',
  parseNvidiaSmi('No devices were found') === null
)
check('uma falha do driver nao vira uma placa', parseNvidiaSmi('Failed to initialize NVML') === null)
check('uma linha sem virgula e ignorada', parseNvidiaSmi('lixo sem virgula') === null)

console.log('\n=== 7. qual pacote recomendar ===')

check('sem placa, cpu', recommendedPack(null) === 'cpu')
check(
  'driver moderno, cuda',
  recommendedPack({ name: 'RTX 4070', driver: `${MIN_CUDA_DRIVER_MAJOR}.10` }) === 'cuda'
)
check(
  'driver anterior ao runtime CUDA 12, cpu',
  recommendedPack({ name: 'GTX 1060', driver: `${MIN_CUDA_DRIVER_MAJOR - 1}.99` }) === 'cpu'
)
check('driver ilegivel, cpu', recommendedPack({ name: 'X', driver: 'sei la' }) === 'cpu')

console.log('\n=== 8. subir o sidecar ===')

const ports = candidatePorts()
check('8756 continua sendo a primeira', ports[0] === 8756, String(ports[0]))
check('ha alternativas quando a porta esta ocupada', ports.length > 1)
check('as portas sao unicas', new Set(ports).size === ports.length)

const args = sidecarArgs(8760)
check('sobe pelo uvicorn', args.join(' ').includes('-m uvicorn app.main:app'), args.join(' '))
check('a porta entra como string', args[args.indexOf('--port') + 1] === '8760')
// Binding to 0.0.0.0 would put an unauthenticated job runner that shells out to
// Demucs on every interface of the machine. The container published only on
// loopback for the same reason.
check('escuta so no loopback', args[args.indexOf('--host') + 1] === '127.0.0.1')

const env = sidecarEnv({ modelsDir: '/m', stemsDir: '/s', parentPid: 4242 })
check('TORCH_HOME aponta para os modelos', env.TORCH_HOME === '/m')
check('HF_HOME fica sob os modelos', env.HF_HOME === '/m/hf', env.HF_HOME)
check('XDG_CACHE_HOME fica sob os modelos', env.XDG_CACHE_HOME === '/m/cache')
check('STEMS_DIR e repassado', env.STEMS_DIR === '/s')
check('o pid do pai vai como string', env.GUITARLAB_PARENT_PID === '4242')

console.log('\n=== 9. o catalogo de modelos ===')

check('os ids sao unicos por familia', (() => {
  const keys = LAB_MODELS.map((m) => `${m.family}-${m.id}`)
  return new Set(keys).size === keys.length
})())
check('todo modelo tem um tamanho', LAB_MODELS.every((m) => m.approxBytes > 0))
check('o padrao do demucs esta no catalogo', Boolean(findModel('demucs', 'htdemucs_6s')))
check('o padrao do whisper esta no catalogo', Boolean(findModel('whisper', 'small')))
check('um modelo inexistente devolve undefined', findModel('demucs', 'nao-existe') === undefined)

console.log('\n=== 10. tamanhos legiveis ===')

check('bytes', formatBytes(512) === '512 B', formatBytes(512))
check('megabytes', formatBytes(320_000_000).endsWith('MB'), formatBytes(320_000_000))
check('gigabytes', formatBytes(2_700_000_000).endsWith('GB'), formatBytes(2_700_000_000))
check('zero nao vira "0 B"', formatBytes(0) === '—', formatBytes(0))
check('NaN nao quebra a tela', formatBytes(Number.NaN) === '—')

console.log(`\n${failures === 0 ? 'LABORATORIO OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
