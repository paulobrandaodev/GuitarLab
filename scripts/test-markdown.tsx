/**
 * The markdown the models write, as the screen renders it.
 *
 * Run with: npm run test:markdown
 *
 * Rendered with react-dom/server, so this checks the real component rather than
 * a copy of its regexes. What it guards: no answer should ever reach the screen
 * with literal `###` or `**` in it, headings must carry the app's gradient, and
 * the nested bullets the models love must survive as a list.
 */
// tsx transpiles JSX in classic mode here, so React has to be in scope
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/renderer/src/components/ui/markdown'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

const html = (content: string): string => renderToStaticMarkup(<Markdown content={content} />)
/** The visible text, the way a reader sees it. */
const text = (content: string): string =>
  html(content)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const answer = `Para chegar no timbre clássico de Alex Lifeson em **Tom Sawyer**, você precisa de um som britânico crocante.

### 1. Amplificador e Gabinete (O Coração)
*   **Modelo de Amp:** Marshall Plexi (Super Lead 1959) ou Hiwatt DR103.
*   **Ganho (Gain):** \`5.5 / 10\` (Crunch clássico, não metal).
    *   *Drive:* \`1.5 / 10\` (Quase zero).

### 2. Equalização (EQ)
1. Graves: \`4.0 / 10\`
2. Médios: \`7.0 / 10\`
`

console.log('=== 1. a resposta da IA vira leitura, não código-fonte ===')
const out = html(answer)
const visible = text(answer)
check('nenhum ### sobra na tela', !visible.includes('###'), visible.slice(0, 60))
check('nenhum ** sobra na tela', !visible.includes('**'))
check('nenhuma crase sobra na tela', !visible.includes('`'))
check('o texto em si continua lá', visible.includes('Alex Lifeson') && visible.includes('Marshall Plexi'))

console.log('\n=== 2. estrutura ===')
check('título vira heading', /<h3[^>]*>1\. Amplificador/.test(out), 'h3')
check('título usa o degradê laranja', /<h3[^>]*class="[^"]*gradient-text/.test(out))
check('negrito vira <strong>', out.includes('<strong'), '')
check('código inline vira <code>', out.includes('<code'), '')
check('itálico vira <em>', out.includes('<em'), '')
check('bullets viram lista', (out.match(/<li/g) ?? []).length >= 4, `${(out.match(/<li/g) ?? []).length} itens`)
check('a lista numerada mantém o número', visible.includes('1. Graves') || /1\.\s*Graves/.test(visible), visible.slice(-80))
// four spaces of indent is one nesting level in the answers the models write
check('o sub-item fica indentado', /margin-left:\s*(?:16|32|48)px/.test(out))
check('e ganha um marcador diferente do topo', out.includes('◦'))

console.log('\n=== 3. casos de borda ===')
check('texto vazio não quebra', html('') === html(''))
check(
  'parágrafos separados continuam separados',
  (html('linha um\n\nlinha dois').match(/<p/g) ?? []).length === 2
)
check(
  'quebra simples junta no mesmo parágrafo',
  (html('linha um\nlinha dois').match(/<p/g) ?? []).length === 1
)
const fenced = html('```\nGain = 70\nBass = 55\n```')
check('bloco de código vira <pre>', fenced.includes('<pre'), '')
check('e preserva as linhas', fenced.includes('Gain = 70\nBass = 55'))
check('régua horizontal vira <hr>', html('a\n\n---\n\nb').includes('<hr'))
check(
  'asterisco solto no meio da frase não vira nada',
  text('2 * 3 = 6').includes('2 * 3 = 6'),
  text('2 * 3 = 6')
)

console.log(`\n${failures === 0 ? 'MARKDOWN OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
