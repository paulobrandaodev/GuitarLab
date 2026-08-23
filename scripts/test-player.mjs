/**
 * Drives the built app to the stem player and works it, in a real renderer.
 *
 * Run with: npm run build && npm run test:player
 *
 * The unit tests around this cover arithmetic — the beat grid, the looping
 * playhead, the cifra alignment, the ordering — and `test:stretch` proves the
 * worklet transposes what it is told to. None of that proves the screen mounts.
 * A component with a dozen effects, an audio graph and a worklet has plenty of
 * ways to typecheck, build, and then throw on the first render; this loads the
 * real bundle over `app://` with the IPC bridge stubbed, clicks through to the
 * stems, and plays the actual files off disk.
 *
 * It reads the built output, so it needs `npm run build` first, and it fails
 * loudly rather than quietly testing a stale bundle.
 */
import { app, protocol, net, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync, statSync, readdirSync, writeFileSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  },
  // AudioWorklet only exists in a secure context, so the page must come from a
  // real origin — the same one the app itself is served from
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const DB_PATH = join(homedir(), 'AppData/Roaming/setlist-lab/setlist-lab.db')
/*
 * A profile of its own. Sharing the app's userData means sharing its caches, and
 * a test run that is killed half way through leaves them in a state that makes
 * the *next* load fail with a bare ERR_FAILED — in the app as well as here.
 */
app.setPath('userData', join(app.getPath('temp'), 'setlist-lab-test-player'))
const RENDERER = resolve('out/renderer')

/** Newest mtime under a directory — used to spot a stale bundle. */
function newestUnder(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const when = entry.isDirectory() ? newestUnder(full) : statSync(full).mtimeMs
    if (when > newest) newest = when
  }
  return newest
}

/** A song with stems, its chord track and its lyrics, plus a set to sort. */
function buildStub(db, songId) {
  const row = db
    .prepare(
      'SELECT id, title, artist_id, bpm, bpm_source, time_signature, duration_ms, musical_key FROM songs WHERE id = ?'
    )
    .get(songId)
  if (!row) return null
  const artist = row.artist_id
    ? db.prepare('SELECT name FROM artists WHERE id = ?').get(row.artist_id)?.name
    : null
  // two stems and the mix is enough to exercise the graph, and decodes fast
  const assets = db
    .prepare(
      "SELECT id, kind, path FROM media_assets WHERE song_id = ? AND kind IN ('audio_master','stem_guitar','stem_drums')"
    )
    .all(songId)
  const chart = db
    .prepare("SELECT content FROM charts WHERE song_id = ? AND kind = 'chord_map'")
    .get(songId)
  const lyrics = db
    .prepare("SELECT content, format FROM charts WHERE song_id = ? AND kind = 'lyrics'")
    .get(songId)

  const song = {
    id: row.id,
    title: row.title,
    artist,
    artistId: row.artist_id,
    album: null,
    year: null,
    genre: null,
    durationMs: row.duration_ms,
    musicalKey: row.musical_key,
    keySource: null,
    bpm: row.bpm,
    bpmSource: row.bpm_source,
    timeSignature: row.time_signature,
    capo: 0,
    difficulty: null,
    notes: null,
    loudnessLufs: null,
    tuning: null,
    mastery: 0,
    status: 'learning',
    hasGuitarPro: false,
    hasAudio: true,
    hasStems: true,
    lastPracticedAt: null
  }

  /* Invented neighbours, so the ordering has something to order. */
  const tuned = (id, title, artistName, tuning, durationMs) => ({
    ...song,
    id,
    title,
    artist: artistName,
    durationMs,
    hasStems: false,
    tuning: tuning ? { id, name: tuning, instrument: 'guitar', stringCount: 6, strings: [] } : null
  })
  const everySong = [
    song,
    tuned(101, 'Aerials', 'System of a Down', 'Drop C', 235000),
    tuned(102, 'Bulls on Parade', 'Rage Against the Machine', 'Drop D', 230000),
    tuned(103, 'Zombie', 'The Cranberries', null, 307000),
    tuned(104, 'Nothing Else Matters', 'Metallica', 'E Standard', 388000),
    tuned(105, 'Ainda e Cedo', 'Legiao Urbana', 'Eb Standard', 199000)
  ]

  /*
   * Words, not whole lines: the generated cifra splices `[Em]` markers between
   * the words, so no full line survives as a substring. Long ones from the
   * middle of the lyric — the first lines of an LRC are often its own
   * "title (year)" header, which would match anywhere on the screen.
   */
  const words = lyrics
    ? [
        ...new Set(
          String(lyrics.content)
            .split(/\r?\n/)
            .slice(4)
            .map((l) => l.replace(/\[[^\]]*\]/g, ' '))
            .join(' ')
            .split(/[^\p{L}']+/u)
            .filter((w) => w.length >= 7)
        )
      ]
    : []
  const sungWords = words.sort((a, b) => b.length - a.length).slice(0, 3)

  return {
    song,
    songs: everySong,
    titles: everySong.map((s) => s.title),
    sungWords,
    longest: [...everySong].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0].title,
    shortest: [...everySong].sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0))[0].title,
    charts: lyrics
      ? [{ id: 1, kind: 'lyrics', format: lyrics.format, content: lyrics.content, sourceUrl: null }]
      : [],
    setlists: [
      {
        id: 1,
        name: 'Show de teste',
        band: 'Banda',
        spotifyPlaylistId: null,
        eventDate: null,
        venue: null,
        notes: null,
        targetReadyDate: null,
        isActive: true,
        songCount: everySong.length,
        totalDurationMs: everySong.reduce((total, s) => total + (s.durationMs ?? 0), 0),
        readiness: 42
      }
    ],
    items: everySong.map((s, i) => ({
      itemId: i + 1,
      position: i,
      plannedKey: null,
      transitionNote: null,
      song: s
    })),
    media: assets.map((a) => ({
      id: a.id,
      songId,
      kind: a.kind,
      path: a.path,
      bytes: null,
      meta: null
    })),
    chordMap: chart ? { songId, updatedAt: 0, ...JSON.parse(chart.content) } : null
  }
}

/** The first song that has everything the run needs. */
function pickSong(db) {
  const rows = db
    .prepare(
      "SELECT s.id FROM songs s " +
        "JOIN media_assets stem ON stem.song_id = s.id AND stem.kind LIKE 'stem_%' " +
        "JOIN media_assets mix ON mix.song_id = s.id AND mix.kind = 'audio_master' " +
        "JOIN charts cm ON cm.song_id = s.id AND cm.kind = 'chord_map' " +
        "JOIN charts ly ON ly.song_id = s.id AND ly.kind = 'lyrics' AND ly.format = 'lrc' " +
        'GROUP BY s.id ORDER BY s.id'
    )
    .all()
  for (const row of rows) {
    const stub = buildStub(db, row.id)
    if (stub && stub.media.length >= 2 && stub.media.every((m) => existsSync(m.path))) return stub
  }
  return null
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(win, expression) {
  return win.webContents.executeJavaScript(expression)
}

async function waitFor(win, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await evaluate(
      win,
      `(() => { try { return ${expression} } catch (e) { return false } })()`
    )
    if (value) return value
    if (Date.now() > deadline) throw new Error(`tempo esgotado esperando ${label}`)
    await wait(250)
  }
}

/** Click the first button whose visible text starts with `label`. */
async function clickButton(win, label) {
  return evaluate(
    win,
    `(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.innerText.trim().startsWith(${JSON.stringify(label)})
      )
      if (!b || b.disabled) return false
      b.click()
      return true
    })()`
  )
}

/** Click the first button whose `title` starts with `prefix`. */
async function clickTitled(win, prefix) {
  return evaluate(
    win,
    `(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => (x.title || '').startsWith(${JSON.stringify(prefix)})
      )
      if (!b || b.disabled) return false
      b.click()
      return true
    })()`
  )
}

/*
 * A run that wedges must fail, not hang: the failure dump talks to a renderer
 * that may itself be the thing that broke.
 */
const watchdog = setTimeout(
  () => {
    console.log('\nFALHA: o teste travou e foi interrompido')
    app.exit(1)
  },
  4 * 60 * 1000
)

app.whenReady().then(async () => {
  if (!existsSync(join(RENDERER, 'index.html'))) {
    check('o bundle do renderer existe', false, `rode npm run build — nada em ${RENDERER}`)
    app.exit(1)
    return
  }
  const builtAt = newestUnder(RENDERER)
  // only src/ — the bundle is built from it, and editing this file is not a reason
  // to call the bundle stale
  const sourceAt = newestUnder(resolve('src'))
  check(
    'o bundle está mais novo que o código',
    builtAt >= sourceAt,
    builtAt >= sourceAt ? '' : 'rode npm run build antes — este teste lê out/renderer'
  )
  if (builtAt < sourceAt) {
    app.exit(1)
    return
  }

  if (!existsSync(DB_PATH)) {
    check('o banco do app existe', false, DB_PATH)
    app.exit(1)
    return
  }
  const db = new Database(DB_PATH, { readonly: true })
  const stub = pickSong(db)
  db.close()

  if (!stub) {
    check(
      'existe música com stems, acordes e letra sincronizada',
      false,
      'separe os stems e rode a análise de harmonia em alguma música'
    )
    app.exit(1)
    return
  }

  const stubFile = join(app.getPath('userData'), 'stub.json')
  writeFileSync(stubFile, JSON.stringify(stub), 'utf8')

  console.log(
    `música ${stub.song.id}: ${stub.song.title} — ${stub.media.length} faixas, ` +
      `${stub.chordMap ? stub.chordMap.spans.length : 0} blocos de acorde, ${stub.song.bpm} bpm`
  )

  protocol.handle('media', (request) => {
    const decoded = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    if (!existsSync(decoded)) return new Response('nao encontrado', { status: 404 })
    return net.fetch(pathToFileURL(decoded).toString())
  })
  protocol.handle('app', (request) => {
    const relative =
      decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    const target = normalize(join(RENDERER, relative))
    if (!target.startsWith(normalize(RENDERER))) return new Response('fora do bundle', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })

  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    webPreferences: {
      sandbox: false,
      preload: resolve('scripts/test-player-preload.cjs'),
      /*
       * The payload goes through a file, not through the argument itself. A
       * chord track plus a synced lyric is tens of kilobytes, and Windows caps a
       * command line at 32767 characters — over it, the renderer process simply
       * never spawns and the only symptom is a bare ERR_FAILED on the first load.
       */
      additionalArguments: [`--stub-file=${stubFile}`]
    }
  })

  const errors = []
  win.webContents.on('console-message', (...args) => {
    // Electron 43 passes an event object; older signatures pass (event, level, message)
    const event = args[0] ?? {}
    const level = typeof args[1] === 'number' ? args[1] : event.level
    const message = String(typeof args[2] === 'string' ? args[2] : (event.message ?? ''))
    const isError = level === 'error' || (typeof level === 'number' && level >= 2)
    // the harness serves no CSP header; the app itself does
    if (isError && !message.includes('Content-Security-Policy')) errors.push(message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`o renderer morreu: ${details.reason}`)
  })

  try {
    await win.loadURL('app://bundle/index.html')
    await waitFor(win, 'document.querySelectorAll("button").length > 3', 15000, 'a interface montar')
    check('o renderer montou', true)

    /* ------------------------------------------------------ player de stems */

    await clickTitled(win, 'Estudar')
    await waitFor(
      win,
      `document.body.innerText.includes(${JSON.stringify(stub.song.title)})`,
      10000,
      'a lista de músicas'
    )
    await evaluate(
      win,
      `(() => {
        const card = [...document.querySelectorAll('div')].find(
          (d) => d.className.includes('cursor-pointer') && d.innerText.includes(${JSON.stringify(stub.song.title)})
        )
        card.click()
        return true
      })()`
    )

    // the stub song has no Guitar Pro file, so the screen lands on the stems
    const speedSteps = await waitFor(
      win,
      `document.querySelectorAll('button[title^="Tocar a "]').length`,
      120000,
      'as faixas decodificarem'
    )
    check('a barra de velocidade tem os seis passos', speedSteps === 6, `${speedSteps}`)

    const ui = await evaluate(
      win,
      `(() => {
        const byTitle = (prefix) =>
          [...document.querySelectorAll('button')].filter((b) => (b.title || '').startsWith(prefix)).length
        return {
          text: document.body.innerText,
          metronome: byTitle('Metrônomo em'),
          semAndamento: byTitle('Sem andamento'),
          markA: byTitle('Marcar o início'),
          markB: byTitle('Marcar o fim'),
          snap: byTitle('Encaixar as marcações'),
          pitch: byTitle('Descer meio tom') + byTitle('Subir meio tom'),
          canvases: document.querySelectorAll('canvas').length
        }
      })()`
    )
    check('o metrônomo aparece com o bpm detectado', ui.metronome === 1 && ui.semAndamento === 0)
    check('tem os marcadores A e B', ui.markA === 1 && ui.markB === 1)
    check('tem o encaixe na batida', ui.snap === 1)
    check('tem os passos de tom', ui.pitch === 2)
    check('desenhou uma forma de onda por faixa', ui.canvases === stub.media.length, `${ui.canvases}`)
    check('mostra o andamento', /\d+ bpm/.test(ui.text))

    check('escolheu 80% da velocidade', await clickTitled(win, 'Tocar a 80'))
    check('ligou o metrônomo', await clickTitled(win, 'Metrônomo em'))
    await wait(300)
    const slowed = await evaluate(win, 'document.body.innerText')
    const expectedBpm = Math.round((stub.chordMap?.bpm ?? stub.song.bpm) * 0.8)
    check(
      'o bpm acompanha a velocidade',
      slowed.includes(`${expectedBpm} bpm`),
      `esperado ${expectedBpm} bpm, achei ${(slowed.match(/\d+ bpm/g) || []).join(', ')}`
    )

    check('apertou tocar', await clickTitled(win, 'Tocar'))
    await wait(2500)
    const clockOf = async () =>
      evaluate(
        win,
        `(() => {
          const el = [...document.querySelectorAll('span')].find((s) => /^\\d+:\\d\\d\\s/.test(s.innerText))
          return el ? el.innerText.replace(/\\s+/g, ' ') : null
        })()`
      )
    const clock = await clockOf()
    check('o cabeçote andou ao tocar', Boolean(clock) && !clock.startsWith('0:00'), String(clock))

    /* ------------------------------------------------------------ loop A–B */

    check('marcou o A', await clickTitled(win, 'Marcar o início'))
    await wait(1200)
    check('marcou o B', await clickTitled(win, 'Marcar o fim'))
    await wait(400)
    const loop = await evaluate(
      win,
      `(() => {
        const buttons = [...document.querySelectorAll('button')]
        const at = (p) => buttons.find((b) => (b.title || '').startsWith(p))
        const repeat = at('Repetir')
        return {
          a: at('Marcar o início').innerText.trim(),
          b: at('Marcar o fim').innerText.trim(),
          title: repeat.title,
          pressed: repeat.getAttribute('aria-pressed')
        }
      })()`
    )
    check('o A guardou um tempo', !loop.a.includes('—'), loop.a)
    check('o B guardou um tempo', !loop.b.includes('—'), loop.b)
    check('o loop ligou sozinho no trecho', loop.pressed === 'true', loop.title)
    check('o loop virou A–B', loop.title.includes('A–B'), loop.title)

    // long enough to run past B and come back round
    await wait(3000)
    const inside = await clockOf()
    check('continua tocando dentro do trecho', Boolean(inside), String(inside))

    /* --------------------------------------------------------- transposição */

    check('subiu meio tom', await clickTitled(win, 'Subir meio tom'))
    await wait(1500)
    const pitch = await evaluate(
      win,
      `(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.title === 'Voltar ao tom original')
        return { label: b.innerText.trim(), disabled: b.disabled }
      })()`
    )
    check('o worklet de tom carregou', !pitch.disabled)
    check('o controle mostra +1 semitom', pitch.label.startsWith('+1'), pitch.label)
    const stillPlaying = await clockOf()
    check('o áudio sobreviveu à troca de rota', Boolean(stillPlaying), String(stillPlaying))

    /* ------------------------------------------------ ordenação do setlist */

    await clickTitled(win, 'Setlist')
    // micro-labels are uppercased by CSS, so innerText never matches the source
    await waitFor(win, `/m.sicas do show/i.test(document.body.innerText)`, 15000, 'o setlist')

    const orderOf = async () =>
      evaluate(
        win,
        `(() => {
          const text = document.body.innerText
          return ${JSON.stringify(stub.titles)}
            .map((t) => ({ t, i: text.indexOf(t) }))
            .filter((x) => x.i >= 0)
            .sort((a, b) => a.i - b.i)
            .map((x) => x.t)
        })()`
      )

    const showOrder = await orderOf()
    check('a ordem do show é a de entrada', showOrder[0] === stub.titles[0], showOrder.join(' > '))

    check('ordenou por afinação', await clickButton(win, 'afinação'))
    await wait(300)
    const tuningAsc = await orderOf()
    check('E Standard no topo', tuningAsc[0] === 'Nothing Else Matters', tuningAsc.join(' > '))
    check('sem afinação por último', tuningAsc[tuningAsc.length - 1] === 'Zombie', tuningAsc.join(' > '))

    check('inverteu a afinação', await clickButton(win, 'afinação'))
    await wait(300)
    const tuningDesc = await orderOf()
    check('E Standard segue no topo', tuningDesc[0] === 'Nothing Else Matters', tuningDesc.join(' > '))
    check(
      'o resto inverteu para Z–A',
      tuningDesc.indexOf('Ainda e Cedo') < tuningDesc.indexOf('Aerials'),
      tuningDesc.join(' > ')
    )
    check('sem afinação continua por último', tuningDesc[tuningDesc.length - 1] === 'Zombie')

    check('ordenou por duração', await clickButton(win, 'duração'))
    await wait(300)
    const byDuration = await orderOf()
    check('menor primeiro', byDuration[0] === stub.shortest, byDuration.join(' > '))
    check('inverteu a duração', await clickButton(win, 'duração'))
    await wait(300)
    const byDurationDesc = await orderOf()
    check('maior primeiro', byDurationDesc[0] === stub.longest, byDurationDesc.join(' > '))

    check(
      'avisa que ordenado não se arrasta',
      await evaluate(win, `document.body.innerText.includes('para arrastar')`)
    )
    check('voltou para a ordem do show', await clickButton(win, 'ordem'))
    await wait(300)
    check('a ordem do show voltou', (await orderOf())[0] === stub.titles[0])

    /* -------------------------------------------------------- gerar a cifra */

    await evaluate(
      win,
      `(() => {
        const row = [...document.querySelectorAll('div')].find(
          (d) => d.className.includes('cursor-pointer') && d.innerText.includes(${JSON.stringify(stub.song.title)})
        )
        row.click()
        return true
      })()`
    )
    await waitFor(win, `document.body.innerText.includes('Abrir música')`, 8000, 'o detalhe da linha')
    await clickButton(win, 'Abrir música')
    await waitFor(win, `document.body.innerText.includes('Cifra & Letra')`, 10000, 'a tela da música')
    await clickButton(win, 'Cifra & Letra')
    await waitFor(win, `document.body.innerText.includes('Gerar dos acordes')`, 10000, 'a aba de cifra')

    const button = await evaluate(
      win,
      `(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Gerar dos acordes'))
        return { disabled: b.disabled, title: b.title }
      })()`
    )
    check('o botão de gerar cifra está ativo', !button.disabled, button.title)
    check('e explica o que vai sair', button.title.includes('linha a linha'), button.title)

    check('gerou a cifra', await clickButton(win, 'Gerar dos acordes'))
    await waitFor(win, `!document.body.innerText.includes('Sem cifra')`, 10000, 'a cifra montada')
    /*
     * Read the chart panel itself, not the page: the lyric also sits in the
     * Letra card next to it, so a match on `document.body` would pass even if
     * the cifra came out empty. The ChordPro reader draws every chord as its own
     * floating span, which is what makes them countable.
     */
    const cifra = await evaluate(
      win,
      `(() => {
        const panel = [...document.querySelectorAll('div')].find((d) =>
          typeof d.className === 'string' && d.className.includes('font-mono')
        )
        if (!panel) return { found: false }
        const spans = [...panel.querySelectorAll('span')]
        return {
          found: true,
          labels: spans.filter((s) => s.className.includes('gradient-text')).length,
          lyric: ${JSON.stringify(stub.sungWords ?? [])}.filter((w) => panel.innerText.includes(w)).length
        }
      })()`
    )
    check('a cifra apareceu no painel', cifra.found)
    check('com os acordes desenhados', cifra.labels > 5, `${cifra.labels} acordes`)
    check(
      'e a letra sincronizada dentro dela',
      stub.sungWords.length === 0 || cifra.lyric >= Math.min(2, stub.sungWords.length),
      `${cifra.lyric}/${stub.sungWords.length} palavras: ${stub.sungWords.join(', ')}`
    )

    check('nenhum erro no console', errors.length === 0, errors.slice(0, 4).join(' // '))
  } catch (err) {
    check('o roteiro terminou', false, String(err && err.message ? err.message : err))
    const dump = await evaluate(win, 'document.body.innerText.slice(0, 700)').catch(() => '(sem dom)')
    console.log(`--- tela ---\n${dump}`)
    if (errors.length) console.log(`--- console ---\n${errors.slice(0, 6).join('\n')}`)
  }

  console.log(`\n${failures === 0 ? 'PLAYER DE STEMS OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
})
