import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  NeuInput,
  NeuSelect,
  Badge,
  Spinner,
  EmptyState,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import { Markdown } from '../../components/ui/markdown'
import { IconTone, IconSparkle, IconTuner } from '../../components/ui/icons'
import { api, isError, formatRelative, type InsightView } from '../../lib/api'
import { useAiStatusLine } from '../../lib/aiActivity'
import type {
  SongView,
  RigView,
  TonePlanView,
  TonePatchView,
  PatchBlock,
  PatchParam,
  PitchShifterPlan
} from '@shared/types'
import { useStrings } from '../../lib/i18n'

/** Object.entries, but keeping the value typed as the string it is. */
function outputEntries(map: Record<string, string>): Array<[string, string]> {
  return Object.entries(map)
}
import { RIG_DEFAULT } from '@shared/types'

/* ------------------------------------------------------------------ knobs */

/**
 * A knob drawn the way it sits on the pedal: pointer at 7 o'clock for 0 and
 * 5 o'clock for 100, with the travelled arc filled in. Reading a row of these
 * is much faster than reading "Gain 70, Bass 45, Mid 60" as a sentence.
 */
function Knob({ param }: { param: PatchParam }): ReactNode {
  const size = 46
  const r = 17
  const c = size / 2
  const sweep = 270
  /*
   * Degrees measured clockwise from 3 o'clock in SVG's y-down space, so 135 is
   * the lower-left corner (knob at minimum) and 135 + 270 = 405 is lower-right
   * (maximum) — the usual travel of a real pedal knob.
   */
  const start = 135

  const point = (deg: number, radius: number): [number, number] => {
    const rad = (deg * Math.PI) / 180
    return [c + radius * Math.cos(rad), c + radius * Math.sin(rad)]
  }

  const hasValue = param.value !== null
  const angle = start + ((param.value ?? 0) / 100) * sweep
  const [px, py] = point(angle, r - 3)
  const [tx, ty] = point(angle, r - 10)

  // background track and the filled portion, as two arcs on the same circle
  const arc = (from: number, to: number): string => {
    const [x1, y1] = point(from, r)
    const [x2, y2] = point(to, r)
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }

  return (
    <div className="flex w-14 flex-col items-center gap-1">
      {hasValue ? (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path
            d={arc(start, start + sweep)}
            fill="none"
            stroke="var(--color-edge)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path
            d={arc(start, angle)}
            fill="none"
            stroke="var(--color-accent-2)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={c} cy={c} r={r - 5} fill="var(--color-raised)" stroke="var(--color-edge)" />
          <line
            x1={tx}
            y1={ty}
            x2={px}
            y2={py}
            stroke="var(--color-accent-1)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // a selector, not a knob — show the chosen option in a switch-like chip
        <div
          className="neu-inset text-txt grid h-[46px] w-14 place-items-center rounded-[10px] px-1 text-center text-[9px] leading-tight font-semibold"
          title={param.text ?? ''}
        >
          <span className="line-clamp-3">{param.text ?? '—'}</span>
        </div>
      )}
      <span className="text-txt-micro w-full truncate text-center text-[9px] font-semibold uppercase">
        {param.label}
      </span>
      {hasValue && <span className="text-txt-dim text-[10px] tabular-nums">{param.value}</span>}
    </div>
  )
}

/* -------------------------------------------------------- chain diagram */

/**
 * The signal path as a single row of plugged-in boxes. Drawn in SVG with a
 * viewBox so it scales down to whatever width the card has instead of
 * overflowing — the whole point is that it fits on screen at a glance.
 */
function ChainDiagram({ chain }: { chain: string[] }): ReactNode {
  if (chain.length === 0) return null

  const boxW = 92
  const boxH = 40
  const gap = 26
  const padding = 6
  const width = chain.length * boxW + (chain.length - 1) * gap + padding * 2
  const height = boxH + 26

  return (
    <div className="w-full overflow-x-auto">
      {/* `height: auto` lets the boxes scale with the viewBox ratio rather than
          letterboxing inside a fixed height; below 420px the wrapper scrolls. */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ height: 'auto', maxWidth: width, minWidth: Math.min(width, 420) }}
        role="img"
        aria-label={`Cadeia de sinal: ${chain.join(' para ')}`}
      >
        {chain.map((label, i) => {
          const x = padding + i * (boxW + gap)
          const y = 18
          const isEnd = i === 0 || i === chain.length - 1
          return (
            <g key={`${label}-${i}`}>
              {i > 0 && (
                <>
                  {/* cable between this box and the previous one */}
                  <line
                    x1={x - gap}
                    y1={y + boxH / 2}
                    x2={x - 6}
                    y2={y + boxH / 2}
                    stroke="var(--color-edge)"
                    strokeWidth={2}
                  />
                  <polygon
                    points={`${x - 6},${y + boxH / 2 - 4} ${x},${y + boxH / 2} ${x - 6},${y + boxH / 2 + 4}`}
                    fill="var(--color-accent-2)"
                  />
                </>
              )}
              <rect
                x={x}
                y={y}
                width={boxW}
                height={boxH}
                rx={10}
                fill={isEnd ? 'var(--color-sunken)' : 'var(--color-raised)'}
                stroke={isEnd ? 'var(--color-accent-2)' : 'var(--color-edge)'}
                strokeWidth={isEnd ? 1.5 : 1}
              />
              <text
                x={x + boxW / 2}
                y={y + boxH / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={isEnd ? 'var(--color-accent-2)' : 'var(--color-txt)'}
              >
                {label.length > 13 ? `${label.slice(0, 12)}…` : label}
              </text>
              {/* full label under the box, since the one inside gets clipped */}
              {label.length > 13 && (
                <title>{label}</title>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------- pedal card */

function PedalCard({ block }: { block: PatchBlock }): ReactNode {
  return (
    <div
      className={cx(
        'neu-raised-sm flex flex-col rounded-[16px] p-3',
        !block.enabled && 'opacity-45'
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="micro-label truncate">{block.slot}</span>
        <span
          className={cx(
            'h-2 w-2 shrink-0 rounded-full',
            block.enabled ? 'bg-ok' : 'bg-txt-micro'
          )}
          title={block.enabled ? 'ligado' : 'desligado'}
        />
      </div>
      <div className="mb-2.5 truncate text-[13px] font-bold" title={block.model}>
        {block.model || '—'}
      </div>
      {block.params.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {block.params.map((p, i) => (
            <Knob key={`${p.label}-${i}`} param={p} />
          ))}
        </div>
      )}
      {block.note && (
        <p className="text-txt-micro mt-2.5 text-[10px] leading-snug">{block.note}</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ afinação */

/**
 * How to play the song without retuning. The guitar stays in E standard (a
 * physical Drop D at most) and the pitch shifter covers the rest, so a set that
 * jumps between Eb, D and drop tunings needs one guitar.
 */
function PitchCard({ plan }: { plan: PitchShifterPlan }): ReactNode {
  return (
    <NeuCard className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <IconTuner width={15} height={15} className="text-accent-2" />
        <span className="gradient-text text-sm font-bold">Afinação e pitch shifter</span>
        <Badge tone="accent">guitarra em {plan.playedTuning}</Badge>
        {plan.recordTuning && plan.recordTuning !== plan.playedTuning && (
          <Badge tone="info">disco em {plan.recordTuning}</Badge>
        )}
        <Badge tone={plan.enabled ? 'ok' : 'neutral'}>
          {plan.enabled
            ? `PS ${plan.semitones > 0 ? '+' : ''}${plan.semitones}`
            : 'sem pitch shifter'}
        </Badge>
      </div>
      <p className="text-txt-dim text-[12px] leading-relaxed">{plan.note}</p>
    </NeuCard>
  )
}

/* ---------------------------------------------------------------- CTRL */

/** The one assignable footswitch, and what this patch spends it on. */
function CtrlCard({ ctrl }: { ctrl: NonNullable<TonePatchView['ctrl']> }): ReactNode {
  return (
    <div className="neu-inset flex items-start gap-3 rounded-[16px] p-3">
      <span
        className="neu-raised-sm text-accent-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[10px] font-bold"
        title="Footswitch atribuível"
      >
        CTRL
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-bold">{ctrl.target}</div>
        <p className="text-txt-dim text-[12px] leading-relaxed">{ctrl.action}</p>
        {ctrl.when && <p className="text-txt-micro mt-0.5 text-[11px]">quando: {ctrl.when}</p>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- patch card */

/**
 * One patch, with its own chain diagram.
 *
 * A song that goes clean in the middle needs two patches, not one averaged
 * compromise, so each gets its own card, numbered in playing order and labelled
 * with the part of the song it belongs to.
 */
function PatchCard({
  patch,
  index,
  total
}: {
  patch: TonePatchView
  index: number
  total: number
}): ReactNode {
  return (
    <NeuCard className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {total > 1 && (
          <span className="neu-inset text-accent-2 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[11px] font-bold tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
        <span className="gradient-text text-sm font-bold">{patch.patchName}</span>
        {patch.appliesTo && <Badge tone="info">{patch.appliesTo}</Badge>}
        {patch.provider && (
          <span className="text-txt-micro ml-auto text-[10px]">
            {patch.provider} · {patch.model}
          </span>
        )}
      </div>

      {patch.summary && (
        <p className="text-txt-dim text-[13px] leading-relaxed">{patch.summary}</p>
      )}

      <div className="neu-inset rounded-[16px] px-3 py-2">
        <div className="micro-label mb-1">Cadeia de sinal</div>
        <ChainDiagram chain={patch.chain} />
      </div>

      {patch.blocks.length > 0 && (
        <div>
          <div className="micro-label mb-2">Blocos e ajustes</div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {patch.blocks.map((b, i) => (
              <PedalCard key={`${b.slot}-${i}`} block={b} />
            ))}
          </div>
        </div>
      )}

      {patch.ctrl && <CtrlCard ctrl={patch.ctrl} />}

      <div className="grid gap-3 sm:grid-cols-2">
        {patch.listenFor && (
          <div className="neu-inset rounded-[16px] p-3">
            <div className="micro-label mb-1.5">O que escutar no original</div>
            <p className="text-txt-dim text-[12px] leading-relaxed">{patch.listenFor}</p>
          </div>
        )}
        {patch.notes && (
          <div className="neu-inset rounded-[16px] p-3">
            <div className="micro-label mb-1.5">Observações</div>
            <p className="text-txt-dim text-[12px] leading-relaxed">{patch.notes}</p>
          </div>
        )}
      </div>
    </NeuCard>
  )
}

/* ----------------------------------------------------------------- tab */

export function ToneTab({ song }: { song: SongView }): ReactNode {
  const str = useStrings()
  const { toast, show, clear } = useToast()
  const [rig, setRig] = useState<RigView>(RIG_DEFAULT)
  const [plan, setPlan] = useState<TonePlanView | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingRig, setSavingRig] = useState(false)
  /**
   * The prose second opinion, kept as an optional extra to the patch.
   *
   * Stored in the database once written, like the patch beside it, so coming
   * back to this song shows the explanation instead of an empty card and a
   * button that costs another request to press.
   */
  const [advice, setAdvice] = useState<InsightView | null>(null)
  const [adviceLoading, setAdviceLoading] = useState(false)
  /** What the model is thinking right now, mirrored under the button. */
  const aiStatus = useAiStatusLine()

  const load = useCallback(async () => {
    /*
     * The insight lookup is wrapped and allowed to fail on its own: a preload
     * without the channel throws on the property access, which inside
     * `Promise.all` would take the rig and the patch down with it. A song with
     * no stored explanation is the normal case, so an absent one is `null`.
     */
    const [savedRig, savedPlan, savedAdvice] = await Promise.all([
      api.gear.rig(),
      api.gear.patch(song.id),
      (async () => api.insights.get(song.id, 'tone_advice'))().catch(() => null)
    ])
    setRig(savedRig)
    setPlan(savedPlan)
    setAdvice(savedAdvice)
  }, [song.id])

  useEffect(() => {
    void load()
  }, [load])

  const saveRig = async (): Promise<void> => {
    setSavingRig(true)
    try {
      await api.gear.setRig(rig)
      show('Equipamento salvo', 'ok')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao salvar', 'danger')
    } finally {
      setSavingRig(false)
    }
  }

  const suggest = async (): Promise<void> => {
    setLoading(true)
    try {
      // save first, so the AI always sees what is on screen
      await api.gear.setRig(rig)
      const res = await api.llm.tonePatch(song.id)
      if (isError(res)) show(res.error, 'danger')
      else {
        setPlan(res)
        show(
          res.patches.length > 1
            ? `${res.patches.length} patches — a música troca de timbre no meio`
            : 'Patch pronto',
          'ok'
        )
      }
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao consultar a IA', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const askAdvice = async (): Promise<void> => {
    setAdviceLoading(true)
    try {
      const res = await api.llm.toneAdvice(song.id)
      if (isError(res)) show(res.error, 'danger')
      else {
        setAdvice({
          content: res.content,
          provider: res.provider,
          model: res.model,
          createdAt: Math.floor(Date.now() / 1000)
        })
      }
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao consultar a IA', 'danger')
    } finally {
      setAdviceLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* the rig the suggestion is written for */}
      <NeuCard className="p-4">
        <div className="micro-label mb-3">Seu equipamento</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <NeuInput
              label="Guitarra"
              value={rig.guitar}
              placeholder="ex.: Ibanez JEM (chinesa)"
              onChange={(e) => setRig({ ...rig, guitar: e.target.value })}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <NeuInput
              label="Pedaleira / processador"
              value={rig.processor}
              placeholder="ex.: Boss GT-1"
              onChange={(e) => setRig({ ...rig, processor: e.target.value })}
            />
          </div>
          <div className="w-52">
            <NeuSelect
              label="Saída"
              value={rig.output}
              onChange={(v) => setRig({ ...rig, output: v as RigView['output'] })}
              options={outputEntries(str.labels.output).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <NeuButton onClick={saveRig} disabled={savingRig}>
            {savingRig ? <Spinner size={14} /> : 'Salvar'}
          </NeuButton>
        </div>
        <p className="text-txt-micro mt-3 text-[11px]">
          A sugestão é escrita para som direto — a IA já compensa o brilho e a falta de gabinete
          real que a {str.labels.output[rig.output].toLowerCase()} expõe.
        </p>
      </NeuCard>

      {/* what to do about the tuning, before any knob is touched */}
      {plan?.pitchShifter && <PitchCard plan={plan.pitchShifter} />}

      {/* the patches themselves */}
      <NeuCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="micro-label">
            {plan && plan.patches.length > 1
              ? `${plan.patches.length} patches para ${rig.processor || 'sua pedaleira'}`
              : `Patch sugerido para ${rig.processor || 'sua pedaleira'}`}
          </div>
          <NeuButton variant="accent" onClick={suggest} disabled={loading}>
            <span className="flex items-center gap-2">
              {loading ? <Spinner size={14} /> : <IconSparkle width={15} height={15} />}
              {plan ? 'Gerar de novo' : 'Sugerir patch'}
            </span>
          </NeuButton>
        </div>

        {loading && aiStatus && (
          <p className="text-txt-micro mt-3 line-clamp-2 text-[11px] italic">{aiStatus}</p>
        )}

        {!plan && (
          <EmptyState
            icon={<IconTone width={24} height={24} />}
            title="Tire o timbre na pedaleira"
            description="A IA usa o tom, gênero, afinação e os trechos da música mais a sua guitarra e pedaleira para montar os patches bloco a bloco, com a cadeia de ligação, a posição de cada knob e o que pôr no botão CTRL."
          />
        )}
      </NeuCard>

      {plan?.patches.map((patch, i) => (
        <PatchCard
          key={`${patch.patchName}-${i}`}
          patch={patch}
          index={i}
          total={plan.patches.length}
        />
      ))}

      {/* prose fallback for the nuances a patch diagram cannot carry */}
      <NeuCard className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="micro-label">Explicação em texto</div>
          <div className="flex items-center gap-3">
            {advice && (
              <span className="text-txt-micro text-[10px]">
                {formatRelative(advice.createdAt)}
                {advice.provider ? ` · ${advice.provider}` : ''}
              </span>
            )}
            <NeuButton
              onClick={askAdvice}
              disabled={adviceLoading}
              title={
                advice
                  ? 'Consulta a IA de novo e substitui a explicação salva'
                  : 'Consulta a IA e guarda a explicação'
              }
            >
              <span className="flex items-center gap-2">
                {adviceLoading ? <Spinner size={14} /> : <IconTone width={15} height={15} />}
                {advice ? 'Explicar de novo' : 'Explicar'}
              </span>
            </NeuButton>
          </div>
        </div>

        {adviceLoading && aiStatus && (
          <p className="text-txt-micro mb-2 line-clamp-2 text-[11px] italic">{aiStatus}</p>
        )}
        {advice ? (
          <Markdown content={advice.content} />
        ) : (
          <p className="text-txt-micro text-[11px]">
            Um texto corrido sobre o timbre, para quando você quiser o porquê de cada ajuste. Fica
            salvo depois da primeira busca.
          </p>
        )}
      </NeuCard>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
