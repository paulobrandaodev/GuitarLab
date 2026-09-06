/**
 * The local origin that lets YouTube play inside the app.
 *
 * Run with: npm run test:ytplayer
 *
 * The renderer lives on `app://bundle`, an origin the YouTube IFrame player
 * refuses to start on, so the embed is served from a one-page http server on
 * 127.0.0.1 instead. The video itself needs the network and a real browser, but
 * everything around it — that the origin comes up, that the page carries the
 * player and the message protocol the renderer speaks, and that the server
 * hands out nothing else — is checkable here, offline.
 *
 * `services/ytplayer` imports only node:http, node:crypto and node:net, so this
 * runs under tsx without booting Electron.
 */
import { startPlayerServer, playerUrl, stopPlayerServer } from '../src/main/services/ytplayer'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  console.log('=== 1. o servidor sobe ===')
  check('nao ha URL antes de subir', playerUrl() === null)

  const origin = await startPlayerServer()
  check('devolve uma origem http local', /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), origin)
  const url = playerUrl()
  check('a URL do player existe', typeof url === 'string' && url.startsWith(origin), url ?? 'null')
  check('subir de novo devolve a mesma origem', (await startPlayerServer()) === origin)

  console.log('\n=== 2. a pagina do player ===')
  const res = await fetch(url as string)
  check('responde 200', res.status === 200, String(res.status))
  check(
    'diz que e HTML em utf-8',
    (res.headers.get('content-type') ?? '').includes('text/html'),
    res.headers.get('content-type') ?? ''
  )
  const html = await res.text()
  check('carrega a IFrame API do YouTube', html.includes('https://www.youtube.com/iframe_api'))
  check('cria o player no elemento certo', html.includes("new YT.Player('player'"))
  check(
    'passa a propria origem para o player',
    html.includes('origin: location.origin'),
    'sem isso o YouTube recusa o embed'
  )

  console.log('\n=== 3. o protocolo que o renderer fala ===')
  // YoutubePlayer.tsx posts { source: 'guitarlab-app', type } and listens for
  // { source: 'guitarlab-yt', type }; a rename on one side is a silent breakage
  check('escuta as mensagens do app', html.includes("data.source !== 'guitarlab-app'"))
  check('responde como guitarlab-yt', html.includes("source: 'guitarlab-yt'"))
  for (const command of ['load', 'play', 'pause', 'seek', 'rate', 'volume', 'loop']) {
    check(`entende "${command}"`, html.includes(`case '${command}':`))
  }
  for (const event of ['ready', 'state', 'time', 'error']) {
    check(`emite "${event}"`, html.includes(`send('${event}'`))
  }
  check('o loop volta para o inicio do trecho', html.includes('player.seekTo(loop.start, true)'))

  console.log('\n=== 4. so a pagina do player e servida ===')
  const stray = await fetch(`${origin}/player.html`)
  check('sem o token da sessao, 404', stray.status === 404, String(stray.status))
  const root = await fetch(`${origin}/`)
  check('a raiz nao serve nada', root.status === 404, String(root.status))
  const post = await fetch(url as string, { method: 'POST' })
  check('so aceita GET', post.status === 404, String(post.status))

  console.log('\n=== 5. desligar ===')
  stopPlayerServer()
  check('a URL some ao desligar', playerUrl() === null)

  console.log(failures ? `\n${failures} VERIFICACAO(OES) FALHARAM` : '\nPLAYER DO YOUTUBE OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  stopPlayerServer()
  process.exit(1)
})
