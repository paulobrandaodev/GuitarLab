import type { ReactNode, SVGProps } from 'react'

/** Line icons matching the reference's thin, rounded stroke style. */
function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }): ReactNode {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  )
}

export const IconSetlist = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M4 6h11M4 12h11M4 18h7" />
    <circle cx="19" cy="17" r="2.5" />
    <path d="M21.5 17V8l-4 1" />
  </Svg>
)

export const IconPractice = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M9 18V5l10-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
)

export const IconLab = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M9 3v6.5L4.2 18a2 2 0 0 0 1.7 3h12.2a2 2 0 0 0 1.7-3L15 9.5V3" />
    <path d="M8 3h8M7.5 14h9" />
  </Svg>
)

export const IconProgress = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M3 20h18" />
    <rect x="5" y="12" width="3.5" height="5" rx="1" />
    <rect x="10.25" y="8" width="3.5" height="9" rx="1" />
    <rect x="15.5" y="4" width="3.5" height="13" rx="1" />
  </Svg>
)

export const IconGuitar = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M14.5 9.5 20 4l-1-1-5.5 5.5" />
    <path d="M11 12a4 4 0 1 1-5.5 5.5A4 4 0 0 1 11 12Z" />
    <path d="M13.5 8.5 15.5 10.5" />
  </Svg>
)

export const IconBass = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M15 8.5 21 2.5" />
    <path d="M11.5 11.5a4.5 4.5 0 1 1-6 6.5 4.5 4.5 0 0 1 6-6.5Z" />
    <path d="M13.5 7 17 10.5" />
  </Svg>
)

export const IconDrums = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <ellipse cx="12" cy="9" rx="8" ry="3.5" />
    <path d="M4 9v6c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V9" />
    <path d="m6 6.5 3-3M18 6.5l-3-3" />
  </Svg>
)

export const IconMic = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
  </Svg>
)

export const IconPlay = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconPause = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <rect x="6.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconStop = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconLoop = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M17 2.5 20.5 6 17 9.5" />
    <path d="M3.5 12V9a3 3 0 0 1 3-3h14" />
    <path d="M7 21.5 3.5 18 7 14.5" />
    <path d="M20.5 12v3a3 3 0 0 1-3 3h-14" />
  </Svg>
)

export const IconMetronome = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M9 3h6l4 18H5L9 3Z" />
    <path d="M7 15h10M12 3v9" />
  </Svg>
)

export const IconSearch = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

export const IconSettings = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
)

export const IconTuner = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 21a9 9 0 1 0-9-9" />
    <path d="M12 12 8 8" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <path d="M3 12h2M12 3v2M19.5 5.5l-1.4 1.4" />
  </Svg>
)

export const IconPencil = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </Svg>
)

export const IconStage = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M3 9h18M4.5 9 7 3.5h10L19.5 9M5 9v11h14V9" />
    <path d="M10 20v-5h4v5" />
  </Svg>
)

export const IconTone = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M6 20V10M12 20V4M18 20v-7" />
    <circle cx="6" cy="7.5" r="2" />
    <circle cx="12" cy="16.5" r="2" />
    <circle cx="18" cy="10.5" r="2" />
  </Svg>
)

export const IconChart = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M5 3h11l4 4v14H5z" />
    <path d="M16 3v4h4M8.5 12h7M8.5 16h5" />
  </Svg>
)

export const IconYoutube = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="4" />
    <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSpotify = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M7.5 9.5c3-.8 6.5-.5 9 1M8 13c2.4-.6 5-.4 7 .9M8.5 16.2c1.9-.4 3.8-.3 5.5.7" />
  </Svg>
)

export const IconWave = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M2 12h2.5M7 6.5v11M11 3.5v17M15 8v8M19 10.5v3M21.5 12H22" />
  </Svg>
)

export const IconImport = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 3v12M8 11l4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
)

export const IconSparkle = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18.5 15.5 19 17l1.5.5L19 18l-.5 1.5L18 18l-1.5-.5L18 17z" />
  </Svg>
)

export const IconCheck = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Svg>
)

export const IconX = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconPlus = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconArrowLeft = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
)

export const IconGrid = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    {[5, 12, 19].map((y) =>
      [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" stroke="none" />)
    )}
  </Svg>
)

export const IconClock = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
)

export const IconFlame = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 22c4 0 7-2.8 7-6.5 0-4.5-4-6-4-9.5 0 0-3 1.5-3 5 0-1.5-1-3-2.5-4C9 9 7 11 7 15.5 7 19.2 8 22 12 22Z" />
  </Svg>
)

/** Drag handle: the two-column dot grip every reorderable list uses. */
export const IconGrip = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    {[6, 12, 18].map((y) =>
      [9, 15].map((x) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" stroke="none" />
      ))
    )}
  </Svg>
)

/** Download: the arrow into a tray, used by the tab and audio source buttons. */
export const IconDownload = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M12 3v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
  </Svg>
)

export const IconTrash = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </Svg>
)

/** Sheet of chord blocks — the detected chord map. */
export const IconChords = (p: SVGProps<SVGSVGElement>): ReactNode => (
  <Svg {...p}>
    <rect x="3" y="6" width="5" height="5" rx="1.2" />
    <rect x="10" y="6" width="5" height="5" rx="1.2" />
    <rect x="17" y="6" width="4" height="5" rx="1.2" />
    <path d="M3 15h18M3 19h12" />
  </Svg>
)

export const INSTRUMENT_ICON = {
  guitar: IconGuitar,
  bass: IconBass,
  drums: IconDrums,
  vocals: IconMic
} as const
