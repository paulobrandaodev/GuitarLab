/**
 * Helpers with no Electron or config dependency, so they can be imported by
 * test scripts that run under plain Node.
 */

/** Best-effort JSON extraction — models like to wrap JSON in prose or fences. */
export function parseJsonLoose<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  for (let end = candidate.length; end > start; end--) {
    try {
      return JSON.parse(candidate.slice(start, end)) as T
    } catch {
      /* keep shrinking the window */
    }
  }
  return null
}
