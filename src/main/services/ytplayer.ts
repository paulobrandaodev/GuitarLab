import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/**
 * A one-page HTTP origin, purely so YouTube will play inside the app.
 *
 * The renderer is served from `app://bundle`. The YouTube IFrame player refuses
 * to start on any origin that is not http(s) — it answers "erro de configuração
 * do player" — and rewriting Origin/Referer from the main process does not help,
 * because the player validates the embedding page over postMessage against its
 * real origin, which stays `app://bundle`.
 *
 * So the embed gets an origin it accepts: this server hands out one page on
 * `http://127.0.0.1:<port>`, the renderer puts that page in an iframe, and the
 * page carries the actual YouTube player. Chromium treats 127.0.0.1 as a
 * trustworthy origin, so embedding it from the secure `app://` context is not
 * mixed content and is not blocked.
 *
 * The whole app is not moved onto this origin on purpose: `app://` is what makes
 * alphaTab's workers, the soundfont and the `media://` fetches behave, and none
 * of that needs re-proving. Only the video is out here.
 *
 * The port is ephemeral and the path carries a per-launch token, so nothing else
 * on the machine can guess the URL and drive the player.
 */

let server: Server | null = null
let origin: string | null = null
const token = randomBytes(9).toString('hex')

const PLAYER_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>GuitarLab · player</title>
<style>
  html, body { margin: 0; height: 100%; background: #16161b; overflow: hidden; }
  #player { width: 100%; height: 100%; border: 0; }
  #fallback {
    position: absolute; inset: 0; display: none; place-items: center; text-align: center;
    color: #8b8b98; font: 500 13px/1.5 system-ui, sans-serif; padding: 24px;
  }
</style>
</head>
<body>
<div id="player"></div>
<div id="fallback"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
(function () {
  var player = null
  var ready = false
  /** Set before the API finished loading; replayed on ready. */
  var pendingVideo = null
  var loop = null

  function send(type, data) {
    var msg = { source: 'guitarlab-yt', type: type }
    if (data) for (var k in data) msg[k] = data[k]
    // the parent is the app's own renderer on app://bundle, which is not an
    // origin postMessage will accept as a target, so '*' it is — the payload is
    // playback state and carries nothing worth protecting
    parent.postMessage(msg, '*')
  }

  function fail(text) {
    var el = document.getElementById('fallback')
    el.textContent = text
    el.style.display = 'grid'
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: location.origin
      },
      events: {
        onReady: function () {
          ready = true
          send('ready')
          if (pendingVideo) {
            load(pendingVideo.videoId, pendingVideo.start)
            pendingVideo = null
          }
        },
        onStateChange: function (e) { send('state', { state: e.data }) },
        onError: function (e) {
          // 101/150 = the uploader disabled embedding; nothing to do but say so
          send('error', { code: e.data })
          if (e.data === 101 || e.data === 150) {
            fail('O dono desse vídeo bloqueou a reprodução fora do YouTube. Abra no navegador.')
          }
        }
      }
    })
  }

  function load(videoId, start) {
    if (!ready) { pendingVideo = { videoId: videoId, start: start }; return }
    document.getElementById('fallback').style.display = 'none'
    player.cueVideoById({ videoId: videoId, startSeconds: start || 0 })
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== 'guitarlab-app') return
    try {
      switch (data.type) {
        case 'load': load(data.videoId, data.start); break
        case 'play': if (ready) player.playVideo(); break
        case 'pause': if (ready) player.pauseVideo(); break
        case 'seek': if (ready) player.seekTo(data.seconds, true); break
        case 'rate': if (ready) player.setPlaybackRate(data.rate); break
        case 'volume': if (ready) player.setVolume(Math.round(data.volume * 100)); break
        case 'loop': loop = data.range || null; break
      }
    } catch (err) {
      send('error', { code: -1, message: String(err) })
    }
  })

  // the API has no timeupdate event, so the clock is polled; 150ms is smooth
  // enough for a progress bar and cheap enough to leave running
  setInterval(function () {
    if (!ready || !player.getCurrentTime) return
    var t = player.getCurrentTime() || 0
    if (loop && t >= loop.end) {
      player.seekTo(loop.start, true)
      t = loop.start
    }
    send('time', {
      seconds: t,
      duration: player.getDuration() || 0,
      rate: player.getPlaybackRate ? player.getPlaybackRate() : 1
    })
  }, 150)

  // if the API script never arrives (offline), say so instead of a black box
  setTimeout(function () {
    if (!window.YT || !window.YT.Player) {
      fail('Não deu para carregar o player do YouTube. Verifique a conexão.')
    }
  }, 8000)
})()
</script>
</body>
</html>
`

/** Boot the player origin. Safe to call more than once. */
export async function startPlayerServer(): Promise<string> {
  if (origin) return origin

  server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== `/${token}/player.html`) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('não encontrado')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(PLAYER_HTML)
  })

  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo
  origin = `http://127.0.0.1:${port}`
  return origin
}

/** The URL the renderer puts in its iframe, or null before the server is up. */
export function playerUrl(): string | null {
  return origin ? `${origin}/${token}/player.html` : null
}

export function stopPlayerServer(): void {
  server?.close()
  server = null
  origin = null
}
