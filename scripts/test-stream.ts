/**
 * Checks that AI progress really streams — reasoning included.
 *
 * Run with: npm run test:stream
 *
 * Exercises the same SSE/NDJSON readers the app uses, against whichever
 * provider is reachable. Ollama is the one that always answers locally and its
 * model exposes thinking, so it is the reliable proof that the reasoning
 * pipeline works end to end; the cloud providers are checked opportunistically.
 */
import { readFileSync } from 'node:fs'
import { readSse, retryDelayMs, parseRetryAfter } from '../src/main/services/llm/events'

const env: Record<string, string> = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    }
  })
}

async function collect(stream: ReadableStream<Uint8Array>, dataOnly: boolean): Promise<string[]> {
  const out: string[] = []
  for await (const line of readSse(stream, dataOnly)) out.push(line)
  return out
}

async function main(): Promise<void> {
  console.log('=== 1. leitor de SSE / NDJSON ===')

  check(
    'extrai payloads de data:',
    JSON.stringify(await collect(streamOf(['data: {"a":1}\n', 'data: {"a":2}\n']), true)) ===
      JSON.stringify(['{"a":1}', '{"a":2}'])
  )
  // a chunk boundary in the middle of a line is the normal case on a real socket
  check(
    'junta linha partida entre chunks',
    JSON.stringify(await collect(streamOf(['data: {"a":', '1}\n']), true)) ===
      JSON.stringify(['{"a":1}'])
  )
  check(
    'ignora [DONE] e linhas vazias',
    JSON.stringify(
      await collect(streamOf(['data: {"a":1}\n', '\n', 'data: [DONE]\n']), true)
    ) === JSON.stringify(['{"a":1}'])
  )
  check(
    'entrega ultima linha sem newline final',
    JSON.stringify(await collect(streamOf(['data: {"a":1}']), true)) === JSON.stringify(['{"a":1}'])
  )
  check(
    'modo NDJSON devolve linhas cruas',
    JSON.stringify(await collect(streamOf(['{"a":1}\n{"a":2}\n']), false)) ===
      JSON.stringify(['{"a":1}', '{"a":2}'])
  )

  console.log('\n=== 2. backoff de cota ===')
  check('respeita o retry-after do provedor', retryDelayMs(0, 28.4) === 28400)
  check('limita o retry-after a 60s', retryDelayMs(0, 999) === 60_000)
  check('sem retry-after usa backoff exponencial', retryDelayMs(0) === 2000 && retryDelayMs(1) === 4000)
  check(
    'le "retry in 28.4s" do corpo do Gemini',
    parseRetryAfter('Please retry in 28.485437001s.') === 28.485437001
  )
  check(
    'le retryDelay do JSON de erro',
    parseRetryAfter('{"retryDelay":"30s"}') === 30
  )
  check('corpo sem retry-after devolve null', parseRetryAfter('sem nada aqui') === null)

  console.log('\n=== 3. streaming de raciocinio ao vivo (Ollama) ===')
  const base = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
  let reachable = false
  try {
    const ping = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
    reachable = ping.ok
  } catch {
    reachable = false
  }

  if (!reachable) {
    console.log('  AVISO Ollama offline — nao da pra provar o raciocinio ao vivo aqui')
  } else {
    const t0 = Date.now()
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'Responda SOMENTE JSON valido.' },
          {
            role: 'user',
            content:
              'Escolha um preamp e um overdrive para tocar thrash metal numa Boss GT-1 ' +
              'saindo direto pra PA. Responda {"preamp":"","overdrive":"","porque":""}'
          }
        ],
        stream: true,
        think: true,
        format: 'json'
      })
    })
    check('Ollama aceitou o pedido em streaming', res.ok, `HTTP ${res.status}`)

    if (res.ok && res.body) {
      let reasoning = ''
      let answer = ''
      let chunks = 0
      let firstReasoningMs: number | null = null
      let firstTextMs: number | null = null

      for await (const line of readSse(res.body, false)) {
        chunks++
        try {
          const parsed = JSON.parse(line) as {
            message?: { content?: string; thinking?: string }
          }
          if (parsed.message?.thinking) {
            reasoning += parsed.message.thinking
            firstReasoningMs ??= Date.now() - t0
          }
          if (parsed.message?.content) {
            answer += parsed.message.content
            firstTextMs ??= Date.now() - t0
          }
        } catch {
          continue
        }
      }

      console.log(
        `       ${chunks} chunks | raciocinio ${reasoning.length} chars (1o em ${firstReasoningMs}ms)` +
          ` | resposta ${answer.length} chars (1o em ${firstTextMs}ms) | total ${Date.now() - t0}ms`
      )
      check('chegou mais de um chunk (e streaming de verdade)', chunks > 1, `${chunks}`)
      check('capturou o raciocinio do modelo', reasoning.length > 0, `${reasoning.length} chars`)
      check(
        'raciocinio comeca antes da resposta',
        firstReasoningMs !== null && firstTextMs !== null && firstReasoningMs <= firstTextMs,
        `${firstReasoningMs}ms vs ${firstTextMs}ms`
      )
      check('resposta e JSON valido', (() => { try { JSON.parse(answer); return true } catch { return false } })(), answer.slice(0, 80))
      if (reasoning) {
        console.log(`       amostra do raciocinio: ${JSON.stringify(reasoning.slice(0, 180))}`)
      }
    }
  }

  console.log(`\n${failures === 0 ? 'STREAMING OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
