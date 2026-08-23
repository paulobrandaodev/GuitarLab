import { useState, useEffect, type ReactNode } from 'react'
import { NeuButton, NeuInput, Badge, cx } from '../../components/ui'
import { IconCheck, IconX, IconFlame } from '../../components/ui/icons'
import { api } from '../../lib/api'
import type { Instrument } from '@shared/types'

/**
 * The tempo ladder. You mark each pass clean or not; clean passes raise the
 * BPM, mistakes hold or drop it. `bestBpm` is what the progress screen charts
 * over time — it is the most honest measure of whether practice is working.
 */
export function SpeedTrainer({
  songId,
  sectionId,
  instrument,
  originalBpm,
  onSpeedChange,
  onDone
}: {
  songId: number
  sectionId: number | null
  instrument: Instrument
  originalBpm: number
  onSpeedChange: (bpm: number) => void
  onDone: (message: string) => void
}): ReactNode {
  const [startBpm, setStartBpm] = useState(() => Math.round(originalBpm * 0.6))
  const [targetBpm, setTargetBpm] = useState(() => Math.round(originalBpm))
  const [currentBpm, setCurrentBpm] = useState(() => Math.round(originalBpm * 0.6))
  const [step, setStep] = useState(5)
  const [requiredPasses, setRequiredPasses] = useState(2)
  const [passesAtCurrent, setPassesAtCurrent] = useState(0)
  const [cleanPasses, setCleanPasses] = useState(0)
  const [totalPasses, setTotalPasses] = useState(0)
  const [bestBpm, setBestBpm] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  useEffect(() => {
    void api.progress.list(songId).then((rows) => {
      const row = rows.find(
        (r) => r.instrument === instrument && (r.sectionId ?? null) === sectionId
      )
      if (row?.bestBpm) setBestBpm(row.bestBpm)
      if (row?.targetBpm) setTargetBpm(Math.round(row.targetBpm))
    })
  }, [songId, sectionId, instrument])

  const begin = (): void => {
    setRunning(true)
    setStartedAt(Date.now())
    setCurrentBpm(startBpm)
    setPassesAtCurrent(0)
    setCleanPasses(0)
    setTotalPasses(0)
    onSpeedChange(startBpm)
    void api.progress.setTargetBpm(songId, instrument, sectionId, targetBpm)
  }

  const markPass = async (clean: boolean): Promise<void> => {
    setTotalPasses((t) => t + 1)
    if (!clean) {
      setPassesAtCurrent(0)
      setCurrentBpm((bpm) => {
        // a mistake drops one rung, never below the starting tempo
        const next = Math.max(startBpm, bpm - step)
        onSpeedChange(next)
        return next
      })
      return
    }

    setCleanPasses((c) => c + 1)
    if (bestBpm === null || currentBpm > bestBpm) setBestBpm(currentBpm)

    const passes = passesAtCurrent + 1
    if (passes < requiredPasses) {
      setPassesAtCurrent(passes)
      return
    }

    setPassesAtCurrent(0)
    if (currentBpm >= targetBpm) {
      await finish(true)
      return
    }
    const next = await api.progress.nextBpm(currentBpm, targetBpm, step)
    setCurrentBpm(next)
    onSpeedChange(next)
  }

  const finish = async (reachedTarget: boolean): Promise<void> => {
    const durationS = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
    await api.progress.recordSession({
      songId,
      sectionId,
      instrument,
      durationS,
      bpmTarget: targetBpm,
      bpmAchieved: bestBpm ?? currentBpm,
      cleanPasses,
      totalPasses,
      mode: 'gp_synth'
    })
    setRunning(false)
    onDone(
      reachedTarget
        ? `Chegou aos ${targetBpm} BPM limpo. Sessão registrada.`
        : `Sessão registrada — melhor tempo ${bestBpm ?? currentBpm} BPM.`
    )
  }

  const progressPct = Math.min(
    100,
    Math.round(((currentBpm - startBpm) / Math.max(1, targetBpm - startBpm)) * 100)
  )

  return (
    <div className="neu-inset mt-3.5 rounded-[18px] p-4">
      {!running ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <NeuInput
              label="começa em"
              type="number"
              value={startBpm}
              onChange={(e) => setStartBpm(Number(e.target.value))}
            />
          </div>
          <div className="w-28">
            <NeuInput
              label="alvo"
              type="number"
              value={targetBpm}
              onChange={(e) => setTargetBpm(Number(e.target.value))}
            />
          </div>
          <div className="w-24">
            <NeuInput
              label="degrau"
              type="number"
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
            />
          </div>
          <div className="w-32">
            <NeuInput
              label="passadas limpas"
              type="number"
              min={1}
              value={requiredPasses}
              onChange={(e) => setRequiredPasses(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <NeuButton variant="accent" onClick={begin}>
            Começar escada
          </NeuButton>
          {bestBpm && (
            <Badge tone="ok" title="Melhor tempo já tocado limpo neste trecho">
              <IconFlame width={12} height={12} /> recorde {Math.round(bestBpm)} bpm
            </Badge>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <div className="micro-label mb-1">tocando em</div>
            <div className="gradient-text text-3xl font-bold tabular-nums">{currentBpm}</div>
          </div>

          <div className="min-w-[160px] flex-1">
            <div className="text-txt-dim mb-1.5 flex justify-between text-[11px]">
              <span>{startBpm}</span>
              <span>
                passada {passesAtCurrent}/{requiredPasses}
              </span>
              <span>{targetBpm}</span>
            </div>
            <div className="neu-inset-sm h-2.5 overflow-hidden rounded-full">
              <div
                className="gradient-bg h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void markPass(true)}
              className="neu-press text-ok flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-sm font-semibold"
            >
              <IconCheck width={16} height={16} /> limpo
            </button>
            <button
              onClick={() => void markPass(false)}
              className="neu-press text-danger flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-sm font-semibold"
            >
              <IconX width={16} height={16} /> errei
            </button>
          </div>

          <div className="text-txt-dim text-xs tabular-nums">
            {cleanPasses}/{totalPasses} limpas
          </div>

          <NeuButton onClick={() => void finish(false)}>Encerrar</NeuButton>
        </div>
      )}
    </div>
  )
}
