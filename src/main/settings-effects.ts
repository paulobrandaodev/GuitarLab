import { clearToken } from './auth/vault'
import { resetFfmpegCache } from './media/ffmpeg'
import { clearLlmFailures } from './services/llm'
import { onSettingsChange } from './settings'

/**
 * Everything that has to happen when a setting changes, in one place.
 *
 * Making `config` resolve on every read removed most of the problem, but three
 * caches sit downstream of it and would otherwise keep serving stale answers
 * after the user fixes something in Settings. Keeping them here rather than
 * scattered across the modules means the list can be read in one go — and the
 * next person adding a cache has an obvious place to declare it.
 */

/** Which settings, when changed, invalidate what. */
const EFFECTS: Array<{ keys: string[]; run: () => void; why: string }> = [
  {
    keys: ['ffmpegPath'],
    why: 'ffmpegVersion memoises, so a corrected path would still report "not found"',
    run: () => resetFfmpegCache()
  },
  {
    keys: [
      'geminiApiKey',
      'openaiApiKey',
      'groqApiKey',
      'openaiBaseUrl',
      'ollamaBaseUrl',
      'geminiModel',
      'openaiModel',
      'groqModel',
      'ollamaModel',
      'llmProvider',
      'llmFallbackProvider'
    ],
    why: 'the 60s circuit breaker would keep reporting the error from before the fix',
    run: () => clearLlmFailures()
  },
  {
    keys: ['spotifyClientId'],
    why: 'a token minted for the old client id authenticates as a different app and 401s',
    run: () => clearToken('spotify')
  }
]

export function applySettingsEffects(changed: string[]): void {
  for (const effect of EFFECTS) {
    if (!changed.some((key) => effect.keys.includes(key))) continue
    try {
      effect.run()
    } catch (err) {
      // A failed invalidation must not fail the save the user just made.
      console.error('[settings] effect failed:', err)
    }
  }
}

/** Wire the effects to the store. Called once, from main/index.ts after ready. */
export function registerSettingsEffects(): void {
  onSettingsChange(applySettingsEffects)
}
