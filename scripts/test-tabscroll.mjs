/**
 * Guards the tab auto-scroll regression: the score must follow the playback
 * cursor instead of jumping to the end of the tab.
 *
 * Run with: npm run test:tabscroll
 *
 * alphaTab positions the view with, in essence:
 *
 *     offset    = getOffset(scrollElement, container)
 *     scrollTo  = offset.y + systemTop + scrollOffsetY
 *
 * and `getOffset` measures the container *relative to* the scroll element:
 *
 *     top = container.top + scrollElement.scrollTop - scrollElement.top
 *
 * When the scroll element and the container are the same node those two `top`
 * values cancel and the offset degenerates to the current `scrollTop`, so every
 * auto-scroll adds the position again — the view accelerates to the bottom of
 * the score. When the container is nested inside the scroller the offset is a
 * constant 0 and the target is the system position, which is what we want.
 *
 * This reproduces both layouts with real DOM boxes and alphaTab's own formula,
 * then checks the app's built markup actually uses the nested one.
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const PAGE = `data:text/html,${encodeURIComponent(`
<style>
  body { margin: 0 }
  .viewport { height: 400px; overflow-y: auto; }
  .content { height: 4000px; }
</style>
<!-- layout A: scroller IS the alphaTab container (the bug) -->
<div id="a" class="viewport"><div class="content"></div></div>
<!-- layout B: alphaTab container nested inside the scroller (the fix) -->
<div id="b" class="viewport"><div id="bInner"><div class="content"></div></div></div>
`)}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  await win.loadURL(PAGE)

  console.log('=== 1. geometria: formula do alphaTab nos dois layouts ===')
  const sim = await win.webContents.executeJavaScript(`
    (() => {
      // alphaTab's UiFacade.getOffset, transcribed
      function getOffset(scrollElement, container) {
        const b = container.getBoundingClientRect()
        let top = b.top + window.pageYOffset
        if (scrollElement) {
          const name = scrollElement.nodeName.toLowerCase()
          if (name !== 'html' && name !== 'body') {
            const sb = scrollElement.getBoundingClientRect()
            top = top + scrollElement.scrollTop - (sb.top + window.pageYOffset)
          }
        }
        return { y: top }
      }

      // walk a score forwards: each "system" sits 150px below the previous one
      function simulate(scroller, container) {
        const positions = []
        for (let system = 0; system < 12; system++) {
          const systemTop = system * 150
          const offset = getOffset(scroller, container)
          const target = offset.y + systemTop
          scroller.scrollTop = target
          positions.push(Math.round(scroller.scrollTop))
        }
        return positions
      }

      const a = document.getElementById('a')
      const b = document.getElementById('b')
      return {
        sameNode: simulate(a, a),
        nested: simulate(b, document.getElementById('bInner')),
        max: a.scrollHeight - a.clientHeight
      }
    })()
  `)

  console.log(`   mesmo no (antes): ${sim.sameNode.join(', ')}`)
  console.log(`   aninhado (agora): ${sim.nested.join(', ')}`)
  console.log(`   scroll maximo   : ${sim.max}`)

  const expected = Array.from({ length: 12 }, (_, i) => i * 150)
  check(
    'layout aninhado segue a posicao do sistema',
    JSON.stringify(sim.nested) === JSON.stringify(expected),
    sim.nested.join(',')
  )
  check(
    'layout de no unico dispara para o fim (bug reproduzido)',
    sim.sameNode[sim.sameNode.length - 1] >= sim.max,
    `termina em ${sim.sameNode[sim.sameNode.length - 1]} de ${sim.max}`
  )
  check(
    'layout aninhado NAO chega ao fim',
    sim.nested[sim.nested.length - 1] < sim.max,
    `termina em ${sim.nested[sim.nested.length - 1]}`
  )

  console.log('\n=== 2. o app usa o layout aninhado? ===')
  const src = readFileSync(
    join(import.meta.dirname, '../src/renderer/src/features/practice/AlphaTabView.tsx'),
    'utf8'
  )
  check(
    'existe um ref separado para a area de rolagem',
    /const scrollRef = useRef<HTMLDivElement>\(null\)/.test(src)
  )
  check(
    'scrollElement aponta para a area de rolagem, nao para o container',
    /settings\.player\.scrollElement = scrollRef\.current/.test(src)
  )
  check(
    'o container fica dentro do elemento que rola',
    /ref=\{scrollRef\}[\s\S]{0,400}ref=\{containerRef\}/.test(src),
    'scrollRef envolve containerRef no JSX'
  )
  check('scroll continuo ligado', /ScrollMode\.Continuous/.test(src))
  check('cursor habilitado', /enableCursor = true/.test(src))
  check('cursor de batida animado habilitado', /enableAnimatedBeatCursor = true/.test(src))

  console.log('\n=== 3. o CSS do cursor esta no bundle? ===')
  const cssFile = readFileSync(
    join(import.meta.dirname, '../src/renderer/src/design/tokens.css'),
    'utf8'
  )
  check('.at-cursor-bar estilizado', /\.at-cursor-bar\s*\{[^}]*background/.test(cssFile))
  check('.at-cursor-beat estilizado', /\.at-cursor-beat\s*\{[^}]*background/.test(cssFile))

  console.log(`\n${failures === 0 ? 'ROLAGEM DA TAB OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
})
