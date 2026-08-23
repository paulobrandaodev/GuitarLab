/**
 * The progress protocol between an LLM call and the UI.
 *
 * Every provider streams, and the deltas are forwarded to the renderer live so
 * the user can watch the model think instead of staring at a spinner. Kept free
 * of Electron imports so test scripts can consume the same events.
 */

export type LlmPhase =
  | 'start'
  | 'provider_try'
  | 'provider_skip'
  | 'provider_fail'
  | 'waiting_quota'
  | 'reasoning'
  | 'text'
  | 'done'
  | 'error'

export interface LlmEvent {
  /** Correlates every event of one logical request. */
  requestId: string
  phase: LlmPhase
  /** What the request is for, so the UI can label it: "patch de timbre", … */
  task: string
  provider?: string
  model?: string
  /** Incremental reasoning/answer text for `reasoning` and `text` phases. */
  delta?: string
  /** Human-readable line for the status bar. */
  message?: string
  /** Milliseconds since the request started. */
  elapsedMs?: number
}

export type LlmListener = (event: LlmEvent) => void

/** Phases that carry a chunk of streamed content rather than a status line. */
export function isContentPhase(phase: LlmPhase): boolean {
  return phase === 'reasoning' || phase === 'text'
}

/**
 * Parse a Server-Sent Events body into its `data:` payloads.
 *
 * Gemini and OpenAI both stream SSE; Ollama streams bare NDJSON. `dataOnly`
 * false yields every non-empty line so the same reader serves both.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  dataOnly = true
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // keep the trailing partial line in the buffer for the next chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (dataOnly) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload && payload !== '[DONE]') yield payload
        } else {
          yield line
        }
      }
    }
    const tail = buffer.trim()
    if (tail) {
      if (!dataOnly) yield tail
      else if (tail.startsWith('data:')) {
        const payload = tail.slice(5).trim()
        if (payload && payload !== '[DONE]') yield payload
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** How long to wait before retrying a rate-limited provider. */
export function retryDelayMs(attempt: number, retryAfterSeconds?: number | null): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.min(60_000, Math.max(1000, Math.ceil(retryAfterSeconds * 1000)))
  }
  // 2s, 4s, 8s — enough for a per-minute window to roll over without stalling
  return Math.min(30_000, 2000 * 2 ** attempt)
}

/** Pull "retry in 28.4s" out of a provider's error body. */
export function parseRetryAfter(body: string): number | null {
  const explicit = body.match(/retry(?:ing)?\s+in\s+([\d.]+)\s*s/i)
  if (explicit) return Number.parseFloat(explicit[1])
  const seconds = body.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)
  if (seconds) return Number.parseFloat(seconds[1])
  return null
}
