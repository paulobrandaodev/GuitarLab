import { create } from 'zustand'
import { api } from './api'
import type { LlmProgressEvent, LlmPhase } from '@shared/types'

/**
 * Live view of whatever the AI is doing right now.
 *
 * Every LLM call in the main process streams its progress here — which provider
 * is being tried, the model's own reasoning as it arrives, quota waits and
 * failures — so buttons and screens can show real feedback instead of a spinner
 * that gives no sign of whether anything is working.
 */

export interface AiActivity {
  requestId: string
  task: string
  phase: LlmPhase
  provider?: string
  model?: string
  /** The model's reasoning so far, when the provider exposes it. */
  reasoning: string
  /** The answer as it streams in. */
  text: string
  /** Latest status line, e.g. "gemini sem cota agora — nova tentativa em 28s". */
  message: string
  startedAt: number
  elapsedMs: number
  done: boolean
  failed: boolean
}

interface AiActivityStore {
  /** The call in flight, or the last one to finish. */
  current: AiActivity | null
  /** Status lines in order, for the expandable log. */
  history: Array<{ at: number; message: string; phase: LlmPhase }>
  apply: (event: LlmProgressEvent) => void
  clear: () => void
}

/** Reasoning can run to thousands of characters; only the tail is ever shown. */
const REASONING_CAP = 4000
const TEXT_CAP = 4000

function tail(existing: string, delta: string, cap: number): string {
  const next = existing + delta
  return next.length > cap ? next.slice(next.length - cap) : next
}

export const useAiActivity = create<AiActivityStore>((set) => ({
  current: null,
  history: [],

  apply: (event) =>
    set((state) => {
      const isNewRequest = state.current?.requestId !== event.requestId
      const base: AiActivity = isNewRequest
        ? {
            requestId: event.requestId,
            task: event.task,
            phase: event.phase,
            reasoning: '',
            text: '',
            message: '',
            startedAt: Date.now(),
            elapsedMs: 0,
            done: false,
            failed: false
          }
        : { ...(state.current as AiActivity) }

      base.phase = event.phase
      base.elapsedMs = event.elapsedMs ?? base.elapsedMs
      if (event.provider) base.provider = event.provider
      if (event.model) base.model = event.model

      if (event.phase === 'reasoning' && event.delta) {
        base.reasoning = tail(base.reasoning, event.delta, REASONING_CAP)
      } else if (event.phase === 'text' && event.delta) {
        base.text = tail(base.text, event.delta, TEXT_CAP)
      }

      if (event.message) base.message = event.message
      base.done = event.phase === 'done'
      base.failed = event.phase === 'error'

      const history = isNewRequest ? [] : [...state.history]
      // content deltas are far too chatty for the log; only status lines land here
      if (event.message) {
        history.push({ at: Date.now(), message: event.message, phase: event.phase })
        if (history.length > 40) history.shift()
      }

      return { current: base, history }
    }),

  clear: () => set({ current: null, history: [] })
}))

/** Subscribe once, at app start. Returns the unsubscribe function. */
export function connectAiActivity(): () => void {
  return api.llm.onProgress((event) => useAiActivity.getState().apply(event))
}

/** True while an AI call is in flight. */
export function useAiBusy(): boolean {
  return useAiActivity((s) => Boolean(s.current && !s.current.done && !s.current.failed))
}

/**
 * A one-line summary for a button or header: the live status when the model is
 * working, falling back to the tail of its reasoning so there is always
 * something moving on screen.
 */
export function useAiStatusLine(): string | null {
  return useAiActivity((s) => {
    const c = s.current
    if (!c || c.done) return null
    if (c.phase === 'reasoning' && c.reasoning) return lastSentence(c.reasoning)
    if (c.phase === 'text' && c.text) return 'Escrevendo a resposta…'
    return c.message || null
  })
}

/** The trailing fragment of the reasoning, trimmed to something readable. */
export function lastSentence(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const slice = clean.slice(clean.length - max)
  const boundary = slice.search(/[.!?]\s+\S/)
  return (boundary === -1 ? slice : slice.slice(boundary + 2)).trim()
}
