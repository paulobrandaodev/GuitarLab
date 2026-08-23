import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  useId,
  useState,
  useRef,
  useEffect,
  useCallback
} from 'react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------ ProgressRing */

interface ProgressRingProps {
  /** 0..100 */
  value: number
  size?: number
  stroke?: number
  label?: string
  sublabel?: string
  /** The green pip from the reference, for a "ready" state. */
  showPip?: boolean
  children?: ReactNode
}

/**
 * The signature element from the reference: a gradient arc sitting in a sunken
 * circular well. Used for song mastery and setlist readiness.
 */
export function ProgressRing({
  value,
  size = 200,
  stroke = 16,
  label,
  sublabel,
  showPip = false,
  children
}: ProgressRingProps): ReactNode {
  const gradientId = useId()
  const clamped = Math.max(0, Math.min(100, value))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <div
        className="neu-inset absolute inset-0 rounded-full"
        style={{ borderRadius: '9999px' }}
        aria-hidden
      />
      <svg
        width={size}
        height={size}
        className="absolute -rotate-90"
        role="img"
        aria-label={`${Math.round(clamped)} por cento`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD15C" />
            <stop offset="45%" stopColor="#FF8A5C" />
            <stop offset="100%" stopColor="#FF4E8A" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.035)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        {children ?? (
          <>
            <span className="font-bold leading-none" style={{ fontSize: size * 0.2 }}>
              {Math.round(clamped)}
              <span style={{ fontSize: size * 0.1 }}>%</span>
            </span>
            {label && <span className="micro-label mt-2">{label}</span>}
            {sublabel && <span className="text-txt-dim mt-1 text-xs">{sublabel}</span>}
          </>
        )}
      </div>

      {showPip && (
        <span
          className="bg-ok absolute rounded-full"
          style={{
            width: size * 0.055,
            height: size * 0.055,
            right: size * 0.09,
            bottom: size * 0.12,
            boxShadow: '0 0 10px rgba(61,220,132,.6)'
          }}
          aria-label="Pronto pro show"
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------- NeuCard */

export function NeuCard({
  children,
  className,
  inset = false,
  as: As = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  inset?: boolean
  as?: 'div' | 'section' | 'article'
} & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <As
      className={cx(inset ? 'neu-inset' : 'neu-raised', 'rounded-[22px]', className)}
      {...rest}
    >
      {children}
    </As>
  )
}

/* --------------------------------------------------------------- NeuButton */

type ButtonVariant = 'default' | 'accent' | 'ghost' | 'danger'

export function NeuButton({
  children,
  variant = 'default',
  active = false,
  className,
  ...rest
}: {
  children: ReactNode
  variant?: ButtonVariant
  active?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  const base = 'rounded-[16px] px-4 py-2.5 text-sm font-medium transition-colors'
  const skin =
    variant === 'accent'
      ? 'gradient-bg text-void font-semibold'
      : active
        ? 'neu-glow gradient-text'
        : variant === 'ghost'
          ? 'text-txt-dim hover:text-txt bg-transparent'
          : variant === 'danger'
            ? 'neu-press text-danger'
            : 'neu-press text-txt'

  return (
    <button className={cx(base, skin, className)} {...rest}>
      {children}
    </button>
  )
}

/* --------------------------------------------------------------- IconButton */

export function IconButton({
  children,
  active = false,
  size = 44,
  title,
  className,
  ...rest
}: {
  children: ReactNode
  active?: boolean
  size?: number
  title?: string
} & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        'grid place-items-center rounded-[16px]',
        active ? 'neu-glow' : 'neu-press',
        active ? 'text-accent-2' : 'text-txt-dim hover:text-txt',
        className
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  )
}

/* --------------------------------------------------------------- NeuSlider */

/**
 * The tempo control, modeled on the "10 20 30 40 …" scale in the reference:
 * a sunken track with tick labels and a gradient knob.
 */
export function NeuSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ticks,
  formatTick,
  disabled = false
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  ticks?: number[]
  formatTick?: (t: number) => string
  disabled?: boolean
}): ReactNode {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className="w-full">
      <div className="neu-inset relative flex h-12 items-center rounded-full px-4">
        {ticks && (
          <div className="pointer-events-none absolute inset-x-4 flex justify-between">
            {ticks.map((t) => (
              <span
                key={t}
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: t <= value ? '#FF8A5C' : 'var(--color-txt-micro)' }}
              >
                {formatTick ? formatTick(t) : t}
              </span>
            ))}
          </div>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-4 z-10 h-12 w-[calc(100%-2rem)] cursor-pointer appearance-none bg-transparent"
          style={{ WebkitAppearance: 'none' }}
        />
        <span
          className="pointer-events-none absolute z-0 h-6 w-6 rounded-full"
          style={{
            left: `calc(1rem + ${pct}% - ${pct * 0.24}px)`,
            background: 'var(--gradient-hot)',
            boxShadow: '0 0 10px rgba(255,138,92,.5), 2px 2px 6px rgba(0,0,0,.5)'
          }}
        />
      </div>
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 24px; height: 24px;
          border-radius: 50%; background: transparent; cursor: pointer;
        }
        input[type=range]::-webkit-slider-runnable-track { background: transparent; height: 24px; }
      `}</style>
    </div>
  )
}

/* ---------------------------------------------------------------- ListRow */

/** The pill row from "Latest Destinations": soft icon square, title, trailing slot. */
export function ListRow({
  icon,
  label,
  title,
  trailing,
  onClick,
  active = false,
  children
}: {
  icon?: ReactNode
  label?: string
  title: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  active?: boolean
  children?: ReactNode
}): ReactNode {
  return (
    <div
      className={cx(
        'rounded-[22px] transition-shadow',
        active ? 'neu-glow' : 'neu-raised',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="flex items-center gap-4 p-3.5">
        {icon && (
          <div className="neu-inset grid h-12 w-12 shrink-0 place-items-center rounded-[16px]">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {label && <div className="micro-label mb-0.5">{label}</div>}
          <div className="truncate font-semibold">{title}</div>
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      {children}
    </div>
  )
}

/* ----------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = 'neutral',
  title
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'info'
  title?: string
}): ReactNode {
  const tones: Record<string, string> = {
    neutral: 'text-txt-dim',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
    info: 'text-info',
    accent: 'gradient-text'
  }
  return (
    <span
      title={title}
      className={cx(
        'neu-inset-sm inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

/* ----------------------------------------------------------------- Stat */

/** The "68% HUMIDITY / 23% OUTSIDE / 17km WIND" trio. */
export function Stat({
  value,
  unit,
  label
}: {
  value: ReactNode
  unit?: string
  label: string
}): ReactNode {
  return (
    <div className="text-center">
      <div className="text-2xl leading-none font-bold">
        {value}
        {unit && <span className="text-txt-dim ml-0.5 text-sm font-semibold">{unit}</span>}
      </div>
      <div className="micro-label mt-2">{label}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- Input */

export function NeuInput({
  label,
  className,
  ...rest
}: { label?: string } & InputHTMLAttributes<HTMLInputElement>): ReactNode {
  const id = useId()
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="micro-label mb-2 block">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cx(
          'neu-inset text-txt placeholder:text-txt-micro w-full rounded-[16px] px-4 py-3 text-sm outline-none',
          className
        )}
        {...rest}
      />
    </div>
  )
}

export function NeuSelect({
  label,
  options,
  value,
  onChange,
  className
}: {
  label?: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
  className?: string
}): ReactNode {
  const id = useId()
  return (
    <div className={cx('w-full', className)}>
      {label && (
        <label htmlFor={id} className="micro-label mb-2 block">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="neu-inset text-txt w-full cursor-pointer appearance-none rounded-[16px] px-4 py-3 text-sm outline-none"
        style={{ backgroundImage: 'none' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#212128' }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* --------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  value: T
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="neu-inset inline-flex gap-1 rounded-[18px] p-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'flex items-center gap-1.5 rounded-[13px] px-3.5 py-2 text-xs font-semibold transition-all',
            value === o.value
              ? 'neu-raised-sm gradient-text'
              : 'text-txt-micro hover:text-txt-dim'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ misc */

export function Spinner({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin-slow"
      aria-label="Carregando"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="rgba(255,255,255,.1)"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="#FF8A5C"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="neu-inset text-txt-micro mb-2 grid h-16 w-16 place-items-center rounded-full">
          {icon}
        </div>
      )}
      <h3 className="gradient-text text-base font-bold">{title}</h3>
      {description && <p className="text-txt-dim max-w-md text-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** Non-blocking status line for long actions — import, search, analysis. */
export type ToastTone = 'neutral' | 'ok' | 'warn' | 'danger'

export function Toast({
  message,
  tone = 'neutral',
  onDismiss
}: {
  message: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
  onDismiss?: () => void
}): ReactNode {
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!onDismiss) return
    timer.current = window.setTimeout(onDismiss, 6000)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [onDismiss, message])

  const toneClass =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-txt'

  return (
    <div className="neu-raised fixed bottom-24 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-[18px] px-5 py-3.5 shadow-xl">
      <div className="flex items-center gap-3">
        <span className={cx('text-sm', toneClass)}>{message}</span>
        {onDismiss && (
          <button onClick={onDismiss} className="text-txt-micro hover:text-txt text-xs">
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * `show` and `clear` are stable across renders. They end up in the dependency
 * arrays of the screens' data-loading callbacks, and a fresh function identity
 * every render turns those effects into a reload loop.
 */
export function useToast(): {
  toast: { message: string; tone: ToastTone } | null
  show: (message: string, tone?: ToastTone) => void
  clear: () => void
} {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)

  const show = useCallback(
    (message: string, tone: ToastTone = 'neutral') => setToast({ message, tone }),
    []
  )
  const clear = useCallback(() => setToast(null), [])

  return { toast, show, clear }
}

export { cx }
