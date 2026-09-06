import { useEffect, useState, type ReactNode } from 'react'
import { NeuButton, NeuInput, Spinner, cx } from '../../components/ui'
import type { SettingSource, SettingView } from '@shared/types'

/**
 * One configurable setting, with where its value is coming from.
 *
 * The origin badge is the point of this component. Precedence is
 * environment > what you saved > .env > default, and without saying so the app
 * produces an unanswerable bug report: someone pastes a key, the field looks
 * filled, and nothing changes because a shell variable outranks it. Showing the
 * source turns that into something a person can see.
 */

const SOURCE_LABEL: Record<SettingSource, string> = {
  env: 'variável de ambiente',
  user: 'salvo por você',
  dotenv: 'do arquivo .env',
  default: 'padrão'
}

/** Only 'env' is a surprise worth flagging; the others are expected. */
const SOURCE_TONE: Record<SettingSource, string> = {
  env: 'text-warn',
  user: 'text-ok',
  dotenv: 'text-txt-micro',
  default: 'text-txt-micro'
}

export function SettingField({
  view,
  label,
  hint,
  placeholder,
  disabled,
  onSave
}: {
  view: SettingView
  label: string
  hint?: string
  placeholder?: string
  /** Set when secrets cannot be stored, e.g. no keyring on Linux. */
  disabled?: string
  onSave: (value: string) => Promise<void>
}): ReactNode {
  const [draft, setDraft] = useState(view.value)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reveal, setReveal] = useState(false)

  // A refresh from the main process wins over an untouched draft, but must not
  // wipe something half-typed.
  useEffect(() => {
    if (!dirty) setDraft(view.value)
  }, [view.value, dirty])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      setDirty(false)
      setReveal(false)
      // A secret is never echoed back, so clear the box: what stays on screen
      // would otherwise look like the stored value and it is not.
      if (view.secret) setDraft('')
    } finally {
      setSaving(false)
    }
  }

  const stored = view.secret && view.present
  const isSecret = view.secret && !reveal

  return (
    <div className="py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="micro-label">{label}</span>
        <span className={cx('text-[10px]', SOURCE_TONE[view.source])}>
          {view.source === 'default' && !view.present ? 'não configurado' : SOURCE_LABEL[view.source]}
        </span>
        {stored && <span className="text-ok text-[10px]">chave guardada</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <NeuInput
            type={isSecret ? 'password' : 'text'}
            value={draft}
            spellCheck={false}
            autoComplete="off"
            disabled={Boolean(disabled) && view.secret}
            placeholder={stored ? '•••••••• (deixe vazio para manter)' : placeholder}
            onChange={(e) => {
              setDraft(e.target.value)
              setDirty(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty) void save()
            }}
          />
        </div>

        {view.secret && draft && (
          <NeuButton className="!px-2.5 !py-1 !text-[10px]" onClick={() => setReveal((v) => !v)}>
            {reveal ? 'ocultar' : 'ver'}
          </NeuButton>
        )}

        <NeuButton
          variant={dirty ? 'accent' : 'default'}
          className="!px-3 !py-1.5 !text-[11px]"
          disabled={!dirty || saving || (Boolean(disabled) && view.secret)}
          onClick={() => void save()}
        >
          {saving ? <Spinner size={12} /> : 'salvar'}
        </NeuButton>
      </div>

      {disabled && view.secret ? (
        <p className="text-danger mt-1.5 text-[11px] leading-snug">{disabled}</p>
      ) : (
        hint && <p className="text-txt-micro mt-1.5 text-[11px] leading-snug">{hint}</p>
      )}

      {view.source === 'env' && (
        <p className="text-warn mt-1.5 text-[11px] leading-snug">
          Uma variável de ambiente está definindo esse valor e tem prioridade sobre o que você
          salvar aqui. Remova-a do ambiente para usar este campo.
        </p>
      )}
    </div>
  )
}
