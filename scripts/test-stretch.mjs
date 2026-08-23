/**
 * Proves the time-stretcher does what the stem player asks of it.
 *
 * Run with: npm run test:stretch
 *
 * Web Audio cannot slow a track down without dropping its pitch — `playbackRate`
 * is resampling — so the player runs the sources fast or slow and puts the
 * SoundTouch worklet in the path to push the pitch back. The contract is not
 * obvious and easy to get backwards: the processor computes
 * `pitch × 2^(semitones/12) ÷ playbackRate`, so the node's `playbackRate` has to
 * be set to the *same* number as the source's, not to its inverse. Set it the
 * wrong way round and 70% speed comes out an octave and a half down while
 * everything still compiles, still plays, and still looks right on screen.
 *
 * So this renders real audio in a real renderer and measures what came out.
 */
import { app, protocol, net, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'worklet',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

// its own profile, so a killed run never leaves the app's caches half written
app.setPath('userData', join(app.getPath('temp'), 'setlist-lab-test-stretch'))

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

/** Prefer the file the build emitted; fall back to the one in node_modules. */
function processorPath() {
  const assets = resolve('out/renderer/assets')
  if (existsSync(assets)) {
    const built = readdirSync(assets).find(
      (f) => f.startsWith('soundtouch-processor') && f.endsWith('.js')
    )
    if (built) return join(assets, built)
  }
  return resolve('node_modules/@soundtouchjs/audio-worklet/.dist/soundtouch-processor.js')
}

app.whenReady().then(async () => {
  const file = processorPath()
  console.log(`processador: ${file}`)
  check('o worklet existe em disco', existsSync(file), file)
  if (!existsSync(file)) {
    app.exit(1)
    return
  }
  check('o build emitiu o worklet', file.includes('out'), file)

  /*
   * The page is served from the custom scheme rather than from a data: URL:
   * `AudioWorklet` only exists in a secure context, and a data: document has an
   * opaque origin, so `ctx.audioWorklet` comes back undefined there. The app
   * itself runs from `app://bundle`, which is registered the same way.
   */
  protocol.handle('worklet', (request) => {
    if (new URL(request.url).pathname.endsWith('.js')) {
      return net.fetch(pathToFileURL(file).toString())
    }
    return new Response('<html><body></body></html>', {
      headers: { 'content-type': 'text/html' }
    })
  })

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  await win.loadURL('worklet://local/page.html')

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const RATE = 44100
      const TONE = 440
      const SECONDS = 2

      /** Estimate the fundamental by counting zero crossings, skipping the ramp-up. */
      const frequencyOf = (data) => {
        const from = Math.floor(data.length * 0.5)
        const to = data.length
        let crossings = 0
        for (let i = from + 1; i < to; i++) {
          if (data[i - 1] <= 0 && data[i] > 0) crossings++
        }
        return crossings / ((to - from) / RATE)
      }

      const peakOf = (data) => {
        let peak = 0
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
        return peak
      }

      /** Render a 440 Hz sine through the graph the player builds. */
      const render = async ({ sourceRate, stretch, semitones }) => {
        const ctx = new OfflineAudioContext(2, RATE * SECONDS, RATE)
        if (stretch) await ctx.audioWorklet.addModule('worklet://local/soundtouch-processor.js')

        // a long tone so the source never runs dry, even at half speed
        const buffer = ctx.createBuffer(2, RATE * SECONDS * 4, RATE)
        for (let channel = 0; channel < 2; channel++) {
          const data = buffer.getChannelData(channel)
          for (let i = 0; i < data.length; i++) {
            data[i] = Math.sin((2 * Math.PI * TONE * i) / RATE) * 0.8
          }
        }

        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = sourceRate

        if (stretch) {
          const node = new AudioWorkletNode(ctx, 'soundtouch-processor', {
            outputChannelCount: [2]
          })
          node.parameters.get('playbackRate').value = sourceRate
          node.parameters.get('pitchSemitones').value = semitones ?? 0
          source.connect(node)
          node.connect(ctx.destination)
        } else {
          source.connect(ctx.destination)
        }

        source.start(0)
        const rendered = await ctx.startRendering()
        const data = rendered.getChannelData(0)
        return { hz: frequencyOf(data), peak: peakOf(data) }
      }

      const out = {}
      out.plain = await render({ sourceRate: 1, stretch: false })
      out.resampled = await render({ sourceRate: 0.5, stretch: false })
      out.slowCompensated = await render({ sourceRate: 0.5, stretch: true })
      out.fastCompensated = await render({ sourceRate: 1.25, stretch: true })
      out.upAnOctave = await render({ sourceRate: 1, stretch: true, semitones: 12 })
      out.downAnOctave = await render({ sourceRate: 1, stretch: true, semitones: -12 })
      out.slowAndTransposed = await render({ sourceRate: 0.7, stretch: true, semitones: 2 })
      return out
    })()
  `).catch((err) => ({ error: String(err) }))

  if (result.error) {
    check('o worklet carregou no renderer', false, result.error)
    app.exit(1)
    return
  }

  const nearHz = (measured, expected, tolerance = 0.08) =>
    Math.abs(measured - expected) / expected <= tolerance
  const hz = (r) => `${r.hz.toFixed(1)} Hz, pico ${r.peak.toFixed(2)}`

  console.log('\n=== 1. a medicao confere consigo mesma ===')
  check('440 Hz sem nada no caminho', nearHz(result.plain.hz, 440), hz(result.plain))
  check(
    'so reamostrando, meia velocidade derruba uma oitava',
    nearHz(result.resampled.hz, 220),
    hz(result.resampled)
  )

  console.log('\n=== 2. velocidade sem mexer no tom ===')
  check('sai som de verdade', result.slowCompensated.peak > 0.1, hz(result.slowCompensated))
  check(
    'a 50% o tom volta para 440 Hz',
    nearHz(result.slowCompensated.hz, 440),
    hz(result.slowCompensated)
  )
  check(
    'a 125% o tom tambem fica em 440 Hz',
    nearHz(result.fastCompensated.hz, 440),
    hz(result.fastCompensated)
  )

  console.log('\n=== 3. tom sem mexer na velocidade ===')
  check('+12 semitons dobra a frequencia', nearHz(result.upAnOctave.hz, 880), hz(result.upAnOctave))
  check(
    '-12 semitons corta a frequencia pela metade',
    nearHz(result.downAnOctave.hz, 220),
    hz(result.downAnOctave)
  )

  console.log('\n=== 4. os dois juntos ===')
  check(
    '70% de velocidade com +2 semitons da 494 Hz',
    nearHz(result.slowAndTransposed.hz, 440 * Math.pow(2, 2 / 12)),
    hz(result.slowAndTransposed)
  )

  console.log(
    `\n${failures === 0 ? 'TIME-STRETCH OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`
  )
  app.exit(failures === 0 ? 0 : 1)
})
