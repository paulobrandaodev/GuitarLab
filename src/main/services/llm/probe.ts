import { config } from '../../config'
import { clearLlmFailures } from './index'

/**
 * Ask a provider whether the configured credentials actually work.
 *
 * `available()` only checks that a key is present, which is the right answer
 * for routing — trying every provider for real before each request would be
 * slow — but it is a lie for a Test button: a key with a typo in it comes back
 * green. This makes the cheapest real call each provider offers and reports
 * what came back, in words the user can act on.
 *
 * Every branch is bounded by a timeout. A wrong base URL usually manifests as a
 * hang, not an error, and a Test button that spins forever is worse than one
 * that says "timed out".
 */

export interface ProbeResult {
  ok: boolean
  detail: string
}

const TIMEOUT_MS = 8000

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/timeout|abort/i.test(message)) return 'Timed out'
  return message
}

async function probeGemini(): Promise<ProbeResult> {
  const { apiKey, model } = config.llm.gemini
  if (!apiKey) return { ok: false, detail: 'No API key set' }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })

  if (res.ok) return { ok: true, detail: `Model ${model} is reachable` }
  if (res.status === 400 || res.status === 403) {
    return { ok: false, detail: 'The API key was rejected' }
  }
  if (res.status === 404) return { ok: false, detail: `No such model: ${model}` }
  return { ok: false, detail: `HTTP ${res.status}` }
}

/** Groq speaks the OpenAI API, so one probe covers both. */
async function probeOpenAiCompatible(name: 'openai' | 'groq'): Promise<ProbeResult> {
  const key = name === 'openai' ? config.llm.openai.apiKey : config.llm.groq.apiKey
  const model = name === 'openai' ? config.llm.openai.model : config.llm.groq.model
  const base = name === 'openai' ? config.llm.openai.baseUrl : 'https://api.groq.com/openai/v1'

  if (!key) return { ok: false, detail: 'No API key set' }

  const res = await fetch(`${base.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })

  if (res.status === 401) return { ok: false, detail: 'The API key was rejected' }
  if (res.status === 429) return { ok: false, detail: 'Rate limited — the key works, but is busy' }
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }

  const body = (await res.json()) as { data?: Array<{ id?: string }> }
  const ids = (body.data ?? []).map((m) => m.id).filter(Boolean) as string[]

  // A working key with an unavailable model is still worth reporting as ok:
  // the credential is fine and only the model name needs fixing.
  if (ids.length && !ids.includes(model)) {
    return { ok: true, detail: `The key works, but ${model} is not in this account's model list` }
  }
  return { ok: true, detail: `Model ${model} is reachable` }
}

async function probeOllama(): Promise<ProbeResult> {
  const { baseUrl, model } = config.llm.ollama
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
    // Local, so it either answers immediately or is not running at all.
    signal: AbortSignal.timeout(4000)
  })
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }

  const body = (await res.json()) as { models?: Array<{ name?: string }> }
  const names = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[]
  if (!names.length) return { ok: true, detail: 'Ollama is running, but has no models pulled' }

  // Ollama reports `name:tag`; a bare name in the config still matches.
  const wanted = model.split(':')[0]
  const has = names.some((n) => n === model || n.split(':')[0] === wanted)
  return has
    ? { ok: true, detail: `Model ${model} is pulled` }
    : { ok: true, detail: `Ollama is running — run "ollama pull ${model}" to use it` }
}

export async function probeProvider(name: string): Promise<ProbeResult> {
  // A probe is an explicit request to try again, so the failure breaker in
  // available() must not shadow the result the user asked for.
  clearLlmFailures(name)

  try {
    switch (name) {
      case 'gemini':
        return await probeGemini()
      case 'openai':
      case 'groq':
        return await probeOpenAiCompatible(name)
      case 'ollama':
        return await probeOllama()
      default:
        return { ok: false, detail: `Unknown provider: ${name}` }
    }
  } catch (err) {
    return { ok: false, detail: describe(err) }
  }
}
