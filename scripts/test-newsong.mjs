/**
 * Adding a setlist and a song by hand, in a real renderer.
 *
 * Run with: npm run build && npm run test:newsong
 *
 * `test:manual` renders the two dialogs with react-dom/server, which proves
 * what they look like before anyone touches them, and `test:setlist` proves
 * what the database does with the result. Neither can type. This one loads the
 * built bundle over `app://` with the bridge stubbed, opens the dialogs from
 * the setlist screen the way a user does, types into the fields and asserts on
 * the payload the form ends up sending — including the parts that are easy to
 * get wrong and impossible to see: the duration going out in milliseconds, the
 * fields left blank going out as null rather than as empty strings, and the
 * "já existe" warning standing between a duplicate and the library.
 *
 * It reads `out/renderer`, so it needs a build, and it says so rather than
 * quietly testing a stale bundle.
 */
import { app, protocol, net, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

protocol.registerSchemesAsPrivileged([
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

// a profile of its own, so a killed run never leaves the app's caches half written
app.setPath('userData', join(app.getPath('temp'), 'guitarlab-test-newsong'))
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const evaluate = (win, expression) => win.webContents.executeJavaScript(expression)

async function waitFor(win, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await evaluate(
      win,
      `(() => { try { return ${expression} } catch (e) { return false } })()`
    )
    if (value) return value
    if (Date.now() > deadline) throw new Error(`tempo esgotado esperando ${label}`)
    await wait(200)
  }
}

/** Click the first enabled button whose visible text is exactly `label`. */
async function click(win, label) {
  const ok = await evaluate(
    win,
    `(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.innerText.trim() === ${JSON.stringify(label)} && !x.disabled
      )
      if (!b) return false
      b.click()
      return true
    })()`
  )
  await wait(120)
  return ok
}

/** Whether the button with this exact text is disabled (missing counts as true). */
function disabled(win, label) {
  return evaluate(
    win,
    `(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.innerText.trim() === ${JSON.stringify(label)}
      )
      return b ? b.disabled : true
    })()`
  )
}

/**
 * Text on the screen, matched loosely.
 *
 * `innerText` is what the user reads, so the field labels come back shouting:
 * the app's `micro-label` class uppercases them in CSS. Comparing folded is
 * simpler than restating that styling in every assertion.
 */
const contains = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase())

/**
 * Type into the field whose label starts with `labelText`.
 *
 * Through the native value setter and an `input` event, which is what React
 * listens to — assigning `.value` alone updates the DOM and leaves the
 * component's state behind, so the form would look filled and submit empty.
 */
async function type(win, labelText, value) {
  const ok = await evaluate(
    win,
    `(() => {
      const wanted = ${JSON.stringify(labelText)}.toLowerCase()
      const label = [...document.querySelectorAll('label')].find(
        (l) => l.innerText.trim().toLowerCase().startsWith(wanted)
      )
      const el = label && label.htmlFor ? document.getElementById(label.htmlFor) : null
      if (!el) return false
      const proto =
        el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      return true
    })()`
  )
  await wait(80)
  return ok
}

const body = (win) => evaluate(win, 'document.body.innerText')
/** Whether the screen is showing this text, whatever the CSS did to its case. */
const shows = async (win, text) => contains(await body(win), text)
/** Wait until the screen shows this text. */
async function waitForText(win, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!(await shows(win, text))) {
    if (Date.now() > deadline) throw new Error(`tempo esgotado esperando "${text}" na tela`)
    await wait(200)
  }
  return true
}
const calls = (win) => evaluate(win, 'window.__probe.calls()')
const lastCall = async (win, channel) => {
  const all = await calls(win)
  return [...all].reverse().find((c) => c.channel === channel) ?? null
}

const watchdog = setTimeout(() => {
  console.log('\nFALHA: o teste travou e foi interrompido')
  app.exit(1)
}, 3 * 60 * 1000)

app.whenReady().then(async () => {
  if (!existsSync(join(RENDERER, 'index.html'))) {
    check('o bundle do renderer existe', false, `rode npm run build — nada em ${RENDERER}`)
    app.exit(1)
    return
  }
  const builtAt = newestUnder(RENDERER)
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
    webPreferences: { sandbox: false, preload: resolve('scripts/test-newsong-preload.cjs') }
  })

  const errors = []
  win.webContents.on('console-message', (...args) => {
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

    /* ----------------------------------------------------------- setlist */

    console.log('\n=== 1. novo setlist ===')
    check('o botão "Novo setlist" está na tela', await click(win, 'Novo setlist'))
    await waitForText(win, 'Nome do setlist', 5000)
    check('sem nome, não dá para criar', await disabled(win, 'Criar'))

    check('dá para escolher uma banda que já existe', await click(win, 'Banda de teste'))
    check('o nome é digitável', await type(win, 'Nome do setlist', '  Show do Sesc  '))
    check('com o nome, o botão libera', !(await disabled(win, 'Criar')))
    await click(win, 'Criar')
    await wait(300)

    const created = await lastCall(win, 'setlists:create')
    check('o setlist foi criado', Boolean(created), JSON.stringify(created))
    check('o nome vai sem os espaços das pontas', created?.payload.name === 'Show do Sesc', created?.payload.name)
    check('a banda escolhida vai junto', created?.payload.band === 'Banda de teste', created?.payload.band)
    check(
      'os campos não preenchidos vão nulos, não vazios',
      created?.payload.extra?.eventDate === null &&
        created?.payload.extra?.venue === null &&
        created?.payload.extra?.notes === null,
      JSON.stringify(created?.payload.extra)
    )
    check(
      'o diálogo fecha e o setlist novo aparece',
      (await shows(win, 'Show do Sesc')) && !(await shows(win, 'Nome do setlist'))
    )

    /* -------------------------------------------------------------- song */

    console.log('\n=== 2. nova música ===')
    check('o botão "Nova música" está na tela', await click(win, 'Nova música'))
    await waitForText(win, 'Artista', 5000)
    check('sem nada preenchido, não dá para criar', await disabled(win, 'Criar'))

    await type(win, 'Título', 'Master of Puppets')
    check('só com o título, ainda não dá', await disabled(win, 'Criar'))
    await type(win, 'Artista', '  Metallica ')
    check('com título e artista, libera', !(await disabled(win, 'Criar')))

    check('os campos opcionais abrem', await click(win, 'mais campos'))
    await type(win, 'Duração', '8:35')
    await type(win, 'BPM', '212')
    await type(win, 'Álbum', 'Master of Puppets')

    await click(win, 'Criar')
    await wait(400)

    const song = await lastCall(win, 'songs:create')
    check('a música foi criada', Boolean(song), JSON.stringify(song?.payload))
    check('título e artista vão limpos', song?.payload.title === 'Master of Puppets' && song?.payload.artist === 'Metallica', `${song?.payload.title} / ${song?.payload.artist}`)
    check('a duração vira milissegundos', song?.payload.durationMs === 515000, `${song?.payload.durationMs}`)
    check('o bpm vai como número', song?.payload.bpm === 212, `${song?.payload.bpm}`)
    check('o álbum digitado vai junto', song?.payload.album === 'Master of Puppets', song?.payload.album)
    check(
      'o que ficou em branco vai nulo',
      song?.payload.year === null &&
        song?.payload.genre === null &&
        song?.payload.musicalKey === null &&
        song?.payload.timeSignature === null &&
        song?.payload.tuningId === null &&
        song?.payload.notes === null,
      JSON.stringify(song?.payload)
    )
    check('entra no setlist ativo por padrão', song?.payload.setlistId === 7, `${song?.payload.setlistId}`)
    check(
      'o diálogo fecha e o app avisa',
      (await shows(win, 'Master of Puppets')) && !(await shows(win, 'menos campos'))
    )

    /* --------------------------------------------------------- duplicada */

    console.log('\n=== 3. música que já existe ===')
    const duplicateTitle = await evaluate(win, 'window.__probe.duplicateTitle')
    await click(win, 'Nova música')
    await waitForText(win, 'Artista', 5000)
    await type(win, 'Título', duplicateTitle)
    await type(win, 'Artista', 'Alguem Que Ja Existe')

    const before = (await calls(win)).filter((c) => c.channel === 'songs:create').length
    await click(win, 'Criar')
    await wait(400)
    const after = (await calls(win)).filter((c) => c.channel === 'songs:create').length
    check('a repetida não é gravada de primeira', after === before, `${after - before} criadas`)
    check('o aviso aparece', await shows(win, 'já existe'))
    check('e oferece abrir a que existe', await shows(win, 'Abrir a que já existe'))

    check('dá para insistir', await click(win, 'Criar assim mesmo'))
    await wait(400)
    const forced = (await calls(win)).filter((c) => c.channel === 'songs:create').length
    check('insistindo, a música é criada', forced === before + 1, `${forced - before}`)

    check('nenhum erro no console do renderer', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (err) {
    check('o teste rodou até o fim', false, err instanceof Error ? err.message : String(err))
    // what the screen was showing when it gave up, which is the whole diagnosis
    try {
      console.log(`\ntela:\n${(await body(win)).slice(0, 1200)}`)
    } catch {
      console.log('\ntela: o renderer não respondeu')
    }
    if (errors.length) console.log(`\nerros do renderer:\n${errors.slice(0, 5).join('\n')}`)
  }

  clearTimeout(watchdog)
  console.log(`\n${failures === 0 ? 'CRIACAO MANUAL (RENDERER) OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
})
