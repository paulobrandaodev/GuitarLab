import { useState, type ReactNode } from 'react'
import { useAiActivity, lastSentence } from '../lib/aiActivity'
import { Spinner, cx } from './ui'
import { IconSparkle, IconX } from './ui/icons'

/**
 * Global read-out of whatever the AI is doing, docked above the nav bar.
 *
 * Collapsed it is a single live line — which provider, what it is thinking
 * about, whether it is waiting out a rate limit. Expanded it shows the full
 * reasoning stream and the step log, so a slow call is visibly working rather
 * than indistinguishable from a hang.
 */
export function AiActivityBar(): ReactNode {
  const current = useAiActivity((s) => s.current)
  const history = useAiActivity((s) => s.history)
  const clear = useAiActivity((s) => s.clear)
  const [expanded, setExpanded] = useState(false)

  if (!current) return null

  const busy = !current.done && !current.failed
  const seconds = Math.round(current.elapsedMs / 1000)

  const headline = current.failed
    ? current.message || 'A IA falhou'
    : current.done
      ? `${current.task} pronta${current.provider ? ` · ${current.provider}` : ''}`
      : current.phase === 'reasoning' && current.reasoning
        ? lastSentence(current.reasoning)
        : current.phase === 'text'
          ? 'Escrevendo a resposta…'
          : current.message || `Consultando ${current.provider ?? 'a IA'}…`

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-40 flex justify-center px-4">
      <div
        className={cx(
          'neu-raised pointer-events-auto w-full max-w-3xl overflow-hidden rounded-[20px]',
          current.failed && 'ring-danger/40 ring-1'
        )}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
        >
          <span className="shrink-0">
            {busy ? (
              <Spinner size={15} />
            ) : current.failed ? (
              <IconX width={15} height={15} className="text-danger" />
            ) : (
              <IconSparkle width={15} height={15} className="text-ok" />
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="micro-label block">
              {current.task}
              {current.provider && ` · ${current.provider}`}
              {current.model && ` · ${current.model}`}
            </span>
            <span
              className={cx(
                'block truncate text-[12px]',
                current.failed ? 'text-danger' : 'text-txt-dim'
              )}
            >
              {headline}
            </span>
          </span>

          <span className="text-txt-micro shrink-0 text-[10px] tabular-nums">{seconds}s</span>

          {!busy && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                clear()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  clear()
                }
              }}
              className="text-txt-micro hover:text-txt shrink-0"
              title="Fechar"
            >
              <IconX width={13} height={13} />
            </span>
          )}
        </button>

        {expanded && (
          <div className="border-edge space-y-3 border-t px-4 py-3">
            {current.reasoning && (
              <div>
                <div className="micro-label mb-1">Raciocínio do modelo</div>
                <div className="scroll-area text-txt-dim max-h-40 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {current.reasoning}
                </div>
              </div>
            )}
            {current.text && (
              <div>
                <div className="micro-label mb-1">Resposta</div>
                <div className="scroll-area text-txt-dim max-h-32 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                  {current.text}
                </div>
              </div>
            )}
            {history.length > 0 && (
              <div>
                <div className="micro-label mb-1">Etapas</div>
                <ul className="space-y-0.5">
                  {history.map((h, i) => (
                    <li
                      key={i}
                      className={cx(
                        'text-[11px]',
                        h.phase === 'provider_fail' || h.phase === 'error'
                          ? 'text-danger'
                          : h.phase === 'waiting_quota'
                            ? 'text-warn'
                            : h.phase === 'done'
                              ? 'text-ok'
                              : 'text-txt-micro'
                      )}
                    >
                      {h.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!current.reasoning && busy && (
              <p className="text-txt-micro text-[11px]">
                Este provedor não expõe o raciocínio — o texto aparece quando começar a sair.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
