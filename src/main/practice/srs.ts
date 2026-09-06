import type { DailyQueueItem, Instrument, ProgressStatus } from '@shared/types'

const DAY = 86400

/**
 * SM-2 adapted for instrument practice. The classic algorithm grades recall on
 * 0..5; here the grade comes from how cleanly the last session went, so a
 * section played at tempo with no mistakes behaves like a well-recalled card.
 */
export interface SrsState {
  ease: number
  intervalDays: number
  reps: number
  dueAt: number | null
}

/** grade: 0 = failed completely, 5 = clean at target tempo. */
export function reviewSrs(state: SrsState, grade: number, nowSec = Math.floor(Date.now() / 1000)): SrsState {
  const g = Math.max(0, Math.min(5, grade))

  if (g < 3) {
    // reset the ladder but keep some ease so it does not spiral
    return {
      ease: Math.max(1.3, state.ease - 0.2),
      intervalDays: 1,
      reps: 0,
      dueAt: nowSec + DAY
    }
  }

  const reps = state.reps + 1
  const ease = Math.max(1.3, state.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)))

  let intervalDays: number
  if (reps === 1) intervalDays = 1
  else if (reps === 2) intervalDays = 3
  else intervalDays = Math.round(state.intervalDays * ease)

  // practice intervals should not run away the way vocabulary cards can
  intervalDays = Math.min(intervalDays, 21)

  return { ease, intervalDays, reps, dueAt: nowSec + intervalDays * DAY }
}

/** Turn a practice session's outcome into an SM-2 grade. */
export function gradeFromSession(
  cleanPasses: number,
  totalPasses: number,
  bpmAchieved: number | null,
  bpmTarget: number | null
): number {
  if (totalPasses === 0) return 3
  const accuracy = cleanPasses / totalPasses
  const tempo = bpmTarget && bpmAchieved ? Math.min(1, bpmAchieved / bpmTarget) : 0.75
  const combined = accuracy * 0.6 + tempo * 0.4
  return Math.round(combined * 5)
}

const STATUS_URGENCY: Record<ProgressStatus, number> = {
  not_started: 100,
  learning: 80,
  shaky: 90,
  solid: 35,
  gig_ready: 10
}

export interface QueueCandidate {
  songId: number
  songTitle: string
  artist: string | null
  sectionId: number | null
  sectionName: string | null
  instrument: Instrument
  status: ProgressStatus
  mastery: number
  bestBpm: number | null
  targetBpm: number | null
  dueAt: number | null
  lastPracticedAt: number | null
  /** Whether the song sits in an active setlist, and how soon that show is. */
  inActiveSetlist: boolean
  daysToShow: number | null
  /** The user put this on the list by hand. */
  pinned: boolean
}

/**
 * Build today's practice queue inside a time budget. Priority blends: how
 * overdue the item is, how shaky it is, and how close the gig is. Sections the
 * user marked gig_ready are still cycled occasionally so they do not rot.
 */
export function buildDailyQueue(
  candidates: QueueCandidate[],
  budgetMinutes: number,
  nowSec = Math.floor(Date.now() / 1000)
): DailyQueueItem[] {
  const scored = candidates.map((c) => {
    const overdueDays = c.dueAt ? Math.max(0, (nowSec - c.dueAt) / DAY) : 3
    const neverPracticed = c.lastPracticedAt === null
    const staleDays = c.lastPracticedAt ? (nowSec - c.lastPracticedAt) / DAY : 30

    let priority = 0
    priority += Math.min(60, overdueDays * 12)
    priority += STATUS_URGENCY[c.status] * 0.5
    priority += Math.min(25, staleDays * 1.2)
    if (neverPracticed) priority += 20
    if (c.inActiveSetlist) priority += 25
    if (c.daysToShow !== null && c.daysToShow >= 0) {
      priority += Math.max(0, 40 - c.daysToShow * 2)
    }

    const reasons: string[] = []
    if (c.pinned) reasons.push('você adicionou')
    if (neverPracticed) reasons.push('nunca treinado')
    else if (overdueDays >= 1) reasons.push(`atrasado ${Math.floor(overdueDays)}d`)
    if (c.status === 'shaky') reasons.push('inseguro')
    if (c.status === 'not_started') reasons.push('não começou')
    if (c.daysToShow !== null && c.daysToShow <= 14) reasons.push(`show em ${c.daysToShow}d`)
    if (!reasons.length) reasons.push('manutenção')

    // shakier material needs longer blocks; polished material just needs a pass
    const estimatedMinutes =
      c.status === 'not_started' || c.status === 'learning' ? 10 : c.status === 'shaky' ? 8 : 4

    return {
      songId: c.songId,
      songTitle: c.songTitle,
      artist: c.artist,
      sectionId: c.sectionId,
      sectionName: c.sectionName,
      instrument: c.instrument,
      status: c.status,
      mastery: c.mastery,
      bestBpm: c.bestBpm,
      targetBpm: c.targetBpm,
      dueAt: c.dueAt,
      priority: Math.round(priority),
      estimatedMinutes,
      reason: reasons.join(' · '),
      pinned: c.pinned
    } satisfies DailyQueueItem
  })

  const queue: DailyQueueItem[] = []
  const songCount = new Map<number, number>()
  const instrumentCount = new Map<Instrument, number>()
  let spent = 0

  /*
   * Whatever the user pinned goes in first, in the order the caller listed it,
   * and ignores the budget. The budget shapes the *derived* part of the queue;
   * an item somebody deliberately put on today's list vanishing because the
   * estimate overflowed 30 minutes is a bug with an excuse. Split before the
   * sort below so the pinned order is the user's, not the scorer's.
   */
  for (const item of scored.filter((i) => i.pinned)) {
    queue.push(item)
    spent += item.estimatedMinutes
    songCount.set(item.songId, (songCount.get(item.songId) ?? 0) + 1)
    instrumentCount.set(item.instrument, (instrumentCount.get(item.instrument) ?? 0) + 1)
  }

  /*
   * Fill the rest of the budget, but spread across songs and instruments.
   * Without this the queue stacks every instrument of whichever song scores
   * highest, which is a worse session than touching three different songs.
   */
  const remaining = scored.filter((i) => !i.pinned)
  remaining.sort((a, b) => b.priority - a.priority)

  const penalised = (item: DailyQueueItem): number =>
    item.priority -
    (songCount.get(item.songId) ?? 0) * 35 -
    (instrumentCount.get(item.instrument) ?? 0) * 10

  while (remaining.length > 0 && spent < budgetMinutes) {
    remaining.sort((a, b) => penalised(b) - penalised(a))
    const idx = remaining.findIndex((i) => spent + i.estimatedMinutes <= budgetMinutes)
    if (idx === -1) break
    const [item] = remaining.splice(idx, 1)
    queue.push(item)
    spent += item.estimatedMinutes
    songCount.set(item.songId, (songCount.get(item.songId) ?? 0) + 1)
    instrumentCount.set(item.instrument, (instrumentCount.get(item.instrument) ?? 0) + 1)
  }
  return queue
}

/**
 * Next rung of the tempo ladder. Steps shrink as you approach target tempo,
 * because the last 10% is where control actually breaks down.
 */
export function nextLadderBpm(current: number, target: number, step = 5): number {
  const remaining = target - current
  if (remaining <= 0) return target
  const adaptiveStep = remaining < target * 0.1 ? Math.max(2, Math.round(step / 2)) : step
  return Math.min(target, current + adaptiveStep)
}
