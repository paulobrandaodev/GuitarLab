import type { ProgressStatus } from '@shared/types'

/**
 * Mastery is stored per (song, instrument, section) and rolled up for display.
 * Status is the coarse, user-set judgement; mastery is the continuous number the
 * rings draw. When a user sets a status we snap mastery into that band so the two
 * never contradict each other on screen.
 */
export const STATUS_MASTERY: Record<ProgressStatus, number> = {
  not_started: 0,
  learning: 25,
  shaky: 50,
  solid: 78,
  gig_ready: 100
}

export function statusFromMastery(mastery: number): ProgressStatus {
  if (mastery >= 95) return 'gig_ready'
  if (mastery >= 70) return 'solid'
  if (mastery >= 40) return 'shaky'
  if (mastery > 0) return 'learning'
  return 'not_started'
}

/**
 * Blend of what the user says (status) and what the tempo ladder proves
 * (bestBpm against targetBpm). Playing a section at full tempo is the strongest
 * evidence of readiness, so it can pull mastery up, but a user who marked a
 * section shaky is never shown as gig-ready.
 */
export function computeMastery(
  status: ProgressStatus,
  bestBpm: number | null,
  targetBpm: number | null
): number {
  const base = STATUS_MASTERY[status]
  if (!bestBpm || !targetBpm || targetBpm <= 0) return base

  const ratio = Math.min(1, bestBpm / targetBpm)
  const tempoScore = ratio * 100
  // weight the user's own judgement slightly higher than the metronome
  const blended = base * 0.6 + tempoScore * 0.4

  const ceiling = status === 'gig_ready' ? 100 : status === 'solid' ? 92 : status === 'shaky' ? 68 : 45
  return Math.round(Math.min(ceiling, Math.max(base * 0.5, blended)))
}

/** Weighted by section length in bars so a 32-bar solo counts more than a 4-bar intro. */
export function rollupMastery(
  parts: Array<{ mastery: number; weight?: number }>
): number {
  if (!parts.length) return 0
  let sum = 0
  let weights = 0
  for (const p of parts) {
    const w = p.weight && p.weight > 0 ? p.weight : 1
    sum += p.mastery * w
    weights += w
  }
  return weights > 0 ? Math.round(sum / weights) : 0
}

/** Setlist readiness: the show is only as strong as its weakest songs. */
export function setlistReadiness(songMasteries: number[]): number {
  if (!songMasteries.length) return 0
  const mean = songMasteries.reduce((a, b) => a + b, 0) / songMasteries.length
  const worst = Math.min(...songMasteries)
  // pull the average toward the weakest song — one unlearned song sinks a set
  return Math.round(mean * 0.75 + worst * 0.25)
}
