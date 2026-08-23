/**
 * Chord detection, end to end, through the app's own code.
 *
 * Run with: npm run test:chordmap   (needs the lab container up)
 *
 * Everything else in the suite checks the pieces; this one runs the whole
 * chain the "Detectar acordes" button runs — submit the job to the container,
 * poll it the way the main process does, fold the result back into the
 * database — and then reads the chord map out the way the screen does.
 *
 * It exists because the failure it caught was invisible from either end: the
 * container answered `done` and the app stored nothing, because the image had
 * a stale copy of the sidecar baked in and was still returning a result with no
 * chords in it. Only running both halves together shows that.
 */
import { app } from 'electron'
import { initDb } from '../src/main/db/client'
import { getChordMap, deleteChordMap, listMedia, listSongs } from '../src/main/db/repo'
import { submitJob, refreshJob, labHealth } from '../src/main/services/lab'
import { spanAt, distinctChords, NO_CHORD } from '../src/shared/chords'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

/** Thrown to unwind out of `done()`; caught by the runner, never a real error. */
class Finished extends Error {}

function done(): never {
  console.log(`\n${failures === 0 ? 'CIFRA AUTOMATICA OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
  throw new Finished()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function run(): Promise<void> {
  initDb()

  const health = await labHealth()
  if (!health.reachable) {
    // the container is optional, so a machine without it skips instead of failing
    console.log(`  pula tudo -- laboratorio fora do ar (${health.detail}); suba com npm run lab:up`)
    done()
  }
  check('o laboratorio esta no ar', true, health.detail)

  // the song asked for by name, else any song with local audio
  const songs = listSongs()
  const wanted = process.argv.slice(2).find((a) => !a.startsWith('-'))
  const withAudio = songs.filter((s) => s.hasAudio)
  const song =
    (wanted ? withAudio.find((s) => s.title.toLowerCase().includes(wanted.toLowerCase())) : null) ??
    withAudio.find((s) => /tom sawyer/i.test(s.title)) ??
    withAudio[0]

  check('ha musica com audio local', Boolean(song), `${withAudio.length} com audio`)
  if (!song) done()

  const audio = listMedia(song.id).find((m) => m.kind === 'audio_master')
  console.log(`\n=== ${song.title} — ${audio?.path} ===`)
  if (!audio) done()

  // start from nothing, so a stale map cannot pass for a fresh detection
  deleteChordMap(song.id)
  check('mapa anterior apagado', getChordMap(song.id) === null)

  const started = Date.now()
  const submitted = await submitJob(song.id, 'harmony', audio.path, {})
  // an AnalysisJobView also has an `error` field (null when healthy), so the
  // union is narrowed on the value, never on the key
  if (typeof (submitted as { error?: unknown }).error === 'string') {
    check('o job foi aceito', false, (submitted as { error: string }).error)
    done()
  }
  const job = submitted as Exclude<typeof submitted, { error: string }>
  check('o job foi aceito', true, `job ${job.id}`)

  // the main process polls on a timer; do the same, with a ceiling
  let status = job.status
  for (let i = 0; i < 150 && status !== 'done' && status !== 'error'; i++) {
    await sleep(4000)
    const updated = await refreshJob(job.id)
    if (!updated) break
    if (updated.status !== status) console.log(`   ${updated.status} ${(updated.progress * 100).toFixed(0)}%`)
    status = updated.status
  }
  check('o job terminou', status === 'done', `${status} em ${((Date.now() - started) / 1000).toFixed(0)}s`)

  const map = getChordMap(song.id)
  check('o mapa de acordes foi gravado', map !== null)
  if (!map) done()

  check('tem blocos', map.spans.length > 0, `${map.spans.length} blocos`)
  check('tem tom', Boolean(map.key), map.key ?? '')
  check('tem andamento', map.bpm !== null, map.bpm ? `${map.bpm} bpm` : '')
  check('tem a grade de batidas', map.beatsMs.length > 1, `${map.beatsMs.length} batidas`)

  const ordered = map.spans.every((s, i) => i === 0 || map.spans[i - 1].endMs <= s.startMs)
  check('os blocos nao se sobrepoem', ordered)
  check(
    'todo bloco tem duracao',
    map.spans.every((s) => s.endMs > s.startMs)
  )
  check(
    'a cobertura chega ao fim da musica',
    song.durationMs !== null
      ? map.spans[map.spans.length - 1].endMs > song.durationMs * 0.9
      : true,
    `${(map.spans[map.spans.length - 1].endMs / 1000).toFixed(0)}s de ${((song.durationMs ?? 0) / 1000).toFixed(0)}s`
  )

  const vocab = distinctChords(map.spans)
  check('mais de um acorde foi detectado', vocab.length > 1, vocab.slice(0, 12).join(' '))
  const avg =
    map.spans.reduce((a, s) => a + (s.endMs - s.startMs), 0) / map.spans.length / 1000
  // a decoder with the change penalty too low fragments; too high collapses
  check('os blocos tem tamanho legivel', avg > 0.5 && avg < 30, `media de ${avg.toFixed(1)}s`)

  const middle = map.spans[Math.floor(map.spans.length / 2)]
  check(
    'a leitura encontra o acorde do momento',
    spanAt(map.spans, middle.startMs + 1) === Math.floor(map.spans.length / 2),
    `${middle.label} em ${(middle.startMs / 1000).toFixed(1)}s`
  )

  console.log('\n   primeiros blocos:')
  for (const s of map.spans.slice(0, 8)) {
    const label = s.label === NO_CHORD ? '(silêncio)' : s.label
    console.log(
      `     ${(s.startMs / 1000).toFixed(1).padStart(7)}s → ${(s.endMs / 1000).toFixed(1).padStart(7)}s  ${label}`
    )
  }

  done()
}

app.whenReady().then(() =>
  run().catch((err) => {
    if (err instanceof Finished) return
    console.log(` FALHA erro inesperado -- ${err instanceof Error ? err.message : String(err)}`)
    app.exit(1)
  })
)
