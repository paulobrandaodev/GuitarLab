/**
 * Stem pipeline check, from what the database holds to what the player can open.
 *
 * Run with: npm run test:stems
 *
 * The regression this guards: stem separation runs inside Docker and the
 * container reports its own paths (`/data/stems/...`). Those were persisted
 * verbatim, so every stem row pointed at a path that does not exist on Windows
 * and the player stayed silent. Playback itself is covered by test:media.
 */
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, copyFileSync, rmSync } from 'node:fs'
import { repairContainerPaths, translateContainerPath } from '../src/main/db/repair'

const REAL_DB = join(homedir(), 'AppData/Roaming/setlist-lab/setlist-lab.db')
const TMP_DB = join(homedir(), 'AppData/Local/Temp/setlist-lab-test.db')

const MOUNTS = [
  { container: '/data/stems', host: 'F:/Documentos/Guitarra/SetList/.stems' },
  { container: '/data/songs', host: 'F:/Documentos/Guitarra/SetList/songs' },
  { container: '/data/gptabs', host: 'F:/Documentos/Guitarra/SetList/gptabs' }
]

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('=== 1. translateContainerPath ===')
check(
  'traduz caminho de stem do container',
  translateContainerPath('/data/stems/Song/htdemucs/Song/guitar.flac', MOUNTS) ===
    'F:/Documentos/Guitarra/SetList/.stems/Song/htdemucs/Song/guitar.flac'
)
check(
  'traduz caminho de audio do container',
  translateContainerPath('/data/songs/a.mp3', MOUNTS) ===
    'F:/Documentos/Guitarra/SetList/songs/a.mp3'
)
check(
  'caminho do Windows fica intacto',
  translateContainerPath('F:/Documentos/x.flac', MOUNTS) === null
)
check(
  'caminho do Windows com barra invertida fica intacto',
  translateContainerPath('F:\\Documentos\\x.flac', MOUNTS) === null
)
check('caminho UNC fica intacto', translateContainerPath('//servidor/share/x.flac', MOUNTS) === null)
check(
  'mount desconhecido fica intacto',
  translateContainerPath('/outro/lugar/x.flac', MOUNTS) === null
)
check(
  'espacos e parenteses sobrevivem',
  translateContainerPath('/data/stems/02 The Trooper (Album)/bass.flac', MOUNTS) ===
    'F:/Documentos/Guitarra/SetList/.stems/02 The Trooper (Album)/bass.flac'
)

console.log('\n=== 2. reparo sobre uma copia do banco real ===')
if (!existsSync(REAL_DB)) {
  check('banco do app existe', false, REAL_DB)
} else {
  rmSync(TMP_DB, { force: true })
  copyFileSync(REAL_DB, TMP_DB)
  const db = new Database(TMP_DB)

  const before = db
    .prepare("SELECT COUNT(*) AS n FROM media_assets WHERE path LIKE '/data/%'")
    .get() as { n: number }
  console.log(`   linhas com caminho de container antes: ${before.n}`)

  const result = repairContainerPaths(db, MOUNTS)
  console.log(`   corrigidas: ${result.fixed}, duplicatas removidas: ${result.dropped}`)

  const after = db
    .prepare("SELECT COUNT(*) AS n FROM media_assets WHERE path LIKE '/data/%'")
    .get() as { n: number }
  check('nao sobrou caminho de container', after.n === 0, `${after.n} restantes`)

  const stems = db
    .prepare("SELECT kind, path FROM media_assets WHERE kind LIKE 'stem_%' ORDER BY kind")
    .all() as Array<{ kind: string; path: string }>
  check('existem stems registrados', stems.length > 0, `${stems.length} stems`)
  for (const s of stems) {
    check(`${s.kind} aponta para arquivo existente`, existsSync(s.path), s.path)
  }

  const master = db
    .prepare("SELECT path FROM media_assets WHERE kind = 'audio_master'")
    .all() as Array<{ path: string }>
  for (const m of master) {
    check('faixa original existe no disco', existsSync(m.path), m.path)
  }

  // running it twice must be a no-op, not a source of duplicates
  const second = repairContainerPaths(db, MOUNTS)
  check('reparo e idempotente', second.fixed === 0 && second.dropped === 0)

  db.close()
  rmSync(TMP_DB, { force: true })
}

console.log(`\n${failures === 0 ? 'PIPELINE DE STEMS OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
