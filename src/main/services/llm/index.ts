import { config } from '../../config'
import {
  readSse,
  retryDelayMs,
  parseRetryAfter,
  type LlmEvent,
  type LlmListener
} from './events'

export interface LlmMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmResult {
  text: string
  provider: string
  model: string
  /** The model's own reasoning, when the provider exposes it. */
  reasoning: string
}

export interface CompleteOptions {
  json?: boolean
  /** Receives streamed reasoning/answer deltas and status lines. */
  onEvent?: LlmListener
  /** Correlation id echoed in every event; generated when omitted. */
  requestId?: string
  /** Short label for the UI: "patch de timbre", "plano de treino"… */
  task?: string
}

/** What a driver reports back as it streams. */
export interface DriverSink {
  reasoning(delta: string): void
  text(delta: string): void
}

export interface LlmDriver {
  name: string
  model: string
  available(): Promise<boolean>
  /** Streams into `sink` and resolves with the full answer text. */
  stream(messages: LlmMessage[], opts: { json?: boolean }, sink: DriverSink): Promise<string>
}

/** Remember why a provider failed so status reporting can be specific. */
const lastFailure = new Map<string, { message: string; at: number }>()

function noteFailure(provider: string, message: string): void {
  lastFailure.set(provider, { message, at: Date.now() })
}

/**
 * Forget recorded failures, so a provider is retried immediately.
 *
 * The breaker in `available()` sits out a full minute after a failure, which is
 * right for a quota wall and wrong right after the user fixes the key: they
 * would paste a correct key, press Test, and still be told about the old error.
 * Called by the settings effects whenever a provider's credentials change.
 */
export function clearLlmFailures(provider?: string): void {
  if (provider) lastFailure.delete(provider)
  else lastFailure.clear()
}

/** A 429 is worth retrying; anything else should fall through to the next provider. */
class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

/* ---------------------------------------------------------------- Gemini */

class GeminiDriver implements LlmDriver {
  name = 'gemini'
  get model(): string {
    return config.llm.gemini.model
  }

  async available(): Promise<boolean> {
    if (!config.llm.gemini.apiKey) return false
    const failure = lastFailure.get(this.name)
    // a quota wall lasts minutes, not seconds — don't hammer it
    if (failure && Date.now() - failure.at < 60_000) return false
    return true
  }

  async stream(
    messages: LlmMessage[],
    opts: { json?: boolean },
    sink: DriverSink
  ): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n')

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.7,
        /*
         * Gemini 3.x is a reasoning model and its thinking tokens come out of
         * this same budget. On the tone-patch prompt it spends ~1500-2700 of
         * them before writing a character, so a small ceiling truncates the
         * answer — which used to surface as "resposta vazia".
         */
        maxOutputTokens: 16384,
        // stream the thinking too, so the UI can show what it is working through
        thinkingConfig: { includeThoughts: true },
        ...(opts.json ? { responseMimeType: 'application/json' } : {})
      }
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}` +
      ':streamGenerateContent?alt=sse'

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.llm.gemini.apiKey
      },
      body: JSON.stringify(body)
    })

    if (!res.ok || !res.body) {
      const detail = await res.text()
      if (res.status === 429) {
        const friendly = /free_tier/i.test(detail)
          ? 'cota gratuita do Gemini esgotada'
          : 'limite de requisições do Gemini atingido'
        noteFailure(this.name, friendly)
        throw new RateLimitError(`Gemini 429: ${friendly}`, parseRetryAfter(detail))
      }
      const friendly =
        res.status === 404
          ? `modelo "${this.model}" indisponível para esta chave`
          : res.status === 400 && /API key/i.test(detail)
            ? 'chave do Gemini inválida'
            : detail.slice(0, 200)
      noteFailure(this.name, friendly)
      throw new Error(`Gemini ${res.status}: ${friendly}`)
    }

    let answer = ''
    let finishReason: string | undefined
    for await (const payload of readSse(res.body)) {
      let parsed: {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> }
          finishReason?: string
        }>
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      const candidate = parsed.candidates?.[0]
      if (candidate?.finishReason) finishReason = candidate.finishReason
      for (const part of candidate?.content?.parts ?? []) {
        if (!part.text) continue
        if (part.thought) sink.reasoning(part.text)
        else {
          answer += part.text
          sink.text(part.text)
        }
      }
    }

    if (!answer) {
      const reason =
        finishReason === 'MAX_TOKENS'
          ? 'o modelo gastou todo o orçamento de tokens raciocinando'
          : finishReason === 'SAFETY'
            ? 'resposta bloqueada pelo filtro de segurança'
            : `finishReason=${finishReason ?? 'desconhecido'}`
      throw new Error(`Gemini devolveu resposta vazia (${reason})`)
    }
    return answer
  }
}

/* ---------------------------------------------------------------- OpenAI */

/**
 * Chat Completions with `stream: true`.
 *
 * Newer models (gpt-5*, o-series) reject `temperature` and renamed `max_tokens`
 * to `max_completion_tokens`, so the driver sends the modern shape and retries
 * with the legacy one only if the API says the parameter is unsupported. Some
 * deployments also emit `delta.reasoning_content`; when present it is surfaced
 * as reasoning, otherwise the user still sees the answer stream in.
 */
class OpenAiDriver implements LlmDriver {
  name = 'openai'
  get model(): string {
    return config.llm.openai.model
  }

  async available(): Promise<boolean> {
    if (!config.llm.openai.apiKey) return false
    const failure = lastFailure.get(this.name)
    if (failure && Date.now() - failure.at < 60_000) return false
    return true
  }

  private post(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${config.llm.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.openai.apiKey}`
      },
      body: JSON.stringify(body)
    })
  }

  async stream(
    messages: LlmMessage[],
    opts: { json?: boolean },
    sink: DriverSink
  ): Promise<string> {
    const base: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    }

    let res = await this.post({ ...base, max_completion_tokens: 8192 })

    if (!res.ok) {
      const detail = await res.text()
      if (res.status === 400 && /max_completion_tokens|unsupported_parameter/i.test(detail)) {
        res = await this.post({ ...base, max_tokens: 8192 })
      } else {
        const friendly =
          res.status === 401
            ? 'chave da OpenAI inválida ou revogada'
            : res.status === 429 && /credit|quota|billing/i.test(detail)
              ? 'conta OpenAI sem créditos — adicione saldo em platform.openai.com/settings/organization/billing'
              : res.status === 429
                ? 'limite de requisições da OpenAI atingido'
                : res.status === 404
                  ? `modelo "${this.model}" indisponível para esta chave`
                  : detail.slice(0, 200)
        noteFailure(this.name, friendly)
        // no point retrying an empty wallet; only a real rate limit is transient
        if (res.status === 429 && !/credit|quota|billing/i.test(detail)) {
          throw new RateLimitError(`OpenAI 429: ${friendly}`, parseRetryAfter(detail))
        }
        throw new Error(`OpenAI ${res.status}: ${friendly}`)
      }
    }

    if (!res.ok || !res.body) {
      const detail = (await res.text()).slice(0, 200)
      noteFailure(this.name, detail)
      throw new Error(`OpenAI ${res.status}: ${detail}`)
    }

    let answer = ''
    for await (const payload of readSse(res.body)) {
      let parsed: {
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string }
        }>
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = parsed.choices?.[0]?.delta
      if (delta?.reasoning_content) sink.reasoning(delta.reasoning_content)
      if (delta?.content) {
        answer += delta.content
        sink.text(delta.content)
      }
    }

    if (!answer) throw new Error('OpenAI devolveu resposta vazia')
    return answer
  }
}

/* ------------------------------------------------------------------ Groq */

class GroqDriver implements LlmDriver {
  name = 'groq'
  get model(): string {
    return config.llm.groq.model
  }

  async available(): Promise<boolean> {
    return Boolean(config.llm.groq.apiKey)
  }

  async stream(
    messages: LlmMessage[],
    opts: { json?: boolean },
    sink: DriverSink
  ): Promise<string> {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.groq.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        stream: true,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {})
      })
    })
    if (!res.ok || !res.body) {
      const detail = (await res.text()).slice(0, 300)
      if (res.status === 429) throw new RateLimitError(`Groq 429`, parseRetryAfter(detail))
      throw new Error(`Groq ${res.status}: ${detail}`)
    }

    let answer = ''
    for await (const payload of readSse(res.body)) {
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          answer += delta
          sink.text(delta)
        }
      } catch {
        continue
      }
    }
    if (!answer) throw new Error('Groq devolveu resposta vazia')
    return answer
  }
}

/* ---------------------------------------------------------------- Ollama */

class OllamaDriver implements LlmDriver {
  name = 'ollama'
  get model(): string {
    return config.llm.ollama.model
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${config.llm.ollama.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500)
      })
      return res.ok
    } catch {
      return false
    }
  }

  async stream(
    messages: LlmMessage[],
    opts: { json?: boolean },
    sink: DriverSink
  ): Promise<string> {
    const res = await fetch(`${config.llm.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        // models with the "thinking" capability stream their reasoning here
        think: true,
        ...(opts.json ? { format: 'json' } : {})
      })
    })
    if (!res.ok || !res.body) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    let answer = ''
    // Ollama streams bare NDJSON, one JSON object per line, not SSE
    for await (const line of readSse(res.body, false)) {
      try {
        const parsed = JSON.parse(line) as {
          message?: { content?: string; thinking?: string }
          error?: string
        }
        if (parsed.error) throw new Error(`Ollama: ${parsed.error}`)
        if (parsed.message?.thinking) sink.reasoning(parsed.message.thinking)
        if (parsed.message?.content) {
          answer += parsed.message.content
          sink.text(parsed.message.content)
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Ollama:')) throw err
        continue
      }
    }
    if (!answer) throw new Error('Ollama devolveu resposta vazia')
    return answer
  }
}

/* -------------------------------------------------------------- dispatch */

const DRIVERS: Record<string, LlmDriver> = {
  gemini: new GeminiDriver(),
  openai: new OpenAiDriver(),
  groq: new GroqDriver(),
  ollama: new OllamaDriver()
}

/** Primary provider first, then each fallback in the order configured. */
export function providerOrder(): string[] {
  return [config.llm.provider, ...config.llm.fallbackProviders].filter(
    (v, i, a) => v && a.indexOf(v) === i
  )
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let requestCounter = 0

/**
 * Run a prompt through the configured providers, streaming progress as it goes.
 *
 * Each provider is tried in order; a rate limit is retried with backoff (a free
 * tier that says "retry in 28s" is worth waiting for) while any other failure
 * moves straight on to the next provider. Every step is reported through
 * `onEvent` so the UI can narrate what is happening instead of showing a
 * spinner that might be stuck.
 */
export async function complete(
  messages: LlmMessage[],
  opts: CompleteOptions = {}
): Promise<LlmResult> {
  const requestId = opts.requestId ?? `llm-${Date.now()}-${++requestCounter}`
  const task = opts.task ?? 'consulta'
  const startedAt = Date.now()

  const emit = (event: Omit<LlmEvent, 'requestId' | 'task' | 'elapsedMs'>): void => {
    opts.onEvent?.({
      ...event,
      requestId,
      task,
      elapsedMs: Date.now() - startedAt
    })
  }

  emit({ phase: 'start', message: `Preparando ${task}` })

  const order = providerOrder()
  const errors: string[] = []

  for (const name of order) {
    const driver = DRIVERS[name]
    if (!driver) {
      errors.push(`${name}: provedor desconhecido`)
      emit({ phase: 'provider_skip', provider: name, message: `${name}: provedor desconhecido` })
      continue
    }
    if (!(await driver.available())) {
      const why = lastFailure.get(name)?.message ?? 'não configurado ou offline'
      errors.push(`${name}: ${why}`)
      emit({ phase: 'provider_skip', provider: name, message: `${name} indisponível — ${why}` })
      continue
    }

    const maxAttempts = 3
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      emit({
        phase: 'provider_try',
        provider: name,
        model: driver.model,
        message:
          attempt === 0
            ? `Consultando ${name} (${driver.model})`
            : `Tentativa ${attempt + 1} em ${name}`
      })

      let reasoning = ''
      const sink: DriverSink = {
        reasoning: (delta) => {
          reasoning += delta
          emit({ phase: 'reasoning', provider: name, model: driver.model, delta })
        },
        text: (delta) => emit({ phase: 'text', provider: name, model: driver.model, delta })
      }

      try {
        const text = await driver.stream(messages, { json: opts.json }, sink)
        emit({
          phase: 'done',
          provider: name,
          model: driver.model,
          message: `${name} respondeu`
        })
        return { text, provider: name, model: driver.model, reasoning }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (err instanceof RateLimitError && attempt < maxAttempts - 1) {
          const delay = retryDelayMs(attempt, err.retryAfterSeconds)
          emit({
            phase: 'waiting_quota',
            provider: name,
            message: `${name} sem cota agora — nova tentativa em ${Math.round(delay / 1000)}s`
          })
          await wait(delay)
          continue
        }
        errors.push(`${name}: ${message}`)
        emit({ phase: 'provider_fail', provider: name, message: `${name} falhou — ${message}` })
        break
      }
    }
  }

  const summary = `Nenhum provedor de IA disponível — ${errors.join(' | ')}`
  emit({ phase: 'error', message: summary })
  throw new Error(summary)
}

export async function llmStatus(): Promise<{
  provider: string
  fallback: string
  configured: boolean
  detail: string
}> {
  const order = providerOrder()
  const parts: string[] = []
  let anyReady = false

  for (const name of order) {
    const driver = DRIVERS[name]
    if (!driver) {
      parts.push(`${name}: provedor desconhecido`)
      continue
    }
    const ok = await driver.available()
    if (ok) anyReady = true
    const failure = lastFailure.get(driver.name)
    parts.push(
      `${name} (${driver.model}): ` + (ok ? 'pronto' : failure ? failure.message : 'não configurado')
    )
  }

  return {
    provider: config.llm.provider,
    fallback: config.llm.fallbackProviders.join(', '),
    configured: anyReady,
    detail: parts.join(' · ')
  }
}

export { parseJsonLoose } from './pure'
export type { LlmEvent, LlmListener } from './events'
