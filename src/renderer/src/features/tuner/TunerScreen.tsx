import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PitchDetector } from 'pitchy'
import { NeuCard, NeuButton, NeuSelect, Badge, cx } from '../../components/ui'
import { api } from '../../lib/api'
import type { TuningView, SongView } from '@shared/types'
import { planPitchShifter } from '@shared/tuning'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function freqToNote(freq: number): { name: string; midi: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(freq / 440)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  return { name: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`, midi, cents }
}

function noteToFreq(name: string): number | null {
  const m = name.match(/^([A-G]#?)(-?\d+)$/)
  if (!m) return null
  const idx = NOTE_NAMES.indexOf(m[1])
  if (idx === -1) return null
  const midi = idx + (Number.parseInt(m[2], 10) + 1) * 12
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function TunerScreen({ songId }: { songId?: number }): ReactNode {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pitch, setPitch] = useState<{ freq: number; clarity: number } | null>(null)
  const [tunings, setTunings] = useState<TuningView[]>([])
  const [tuningId, setTuningId] = useState<string>('')
  const [song, setSong] = useState<SongView | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    void api.songs.tunings().then((t) => {
      setTunings(t)
      if (!songId) setTuningId(String(t.find((x) => x.name === 'E Standard')?.id ?? t[0]?.id ?? ''))
    })
    if (songId) {
      void api.songs.get(songId).then((s) => {
        setSong(s)
        if (s?.tuning) setTuningId(String(s.tuning.id))
      })
    }
  }, [songId])

  const stop = (): void => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    setListening(false)
    setPitch(null)
  }

  useEffect(() => stop, [])

  const start = async (): Promise<void> => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 4096
      source.connect(analyser)

      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      const buffer = new Float32Array(detector.inputLength)

      const tick = (): void => {
        analyser.getFloatTimeDomainData(buffer)
        const [freq, clarity] = detector.findPitch(buffer, ctx.sampleRate)
        // clarity gates out room noise; the range covers low B on a 5-string bass up to high frets
        if (clarity > 0.92 && freq > 28 && freq < 1400) setPitch({ freq, clarity })
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setListening(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não consegui acessar o microfone: ${err.message}`
          : 'Não consegui acessar o microfone'
      )
    }
  }

  const tuning = tunings.find((t) => String(t.id) === tuningId) ?? null
  const detected = pitch ? freqToNote(pitch.freq) : null

  // which string of the selected tuning is closest to what is being played
  interface NearestString {
    index: number
    name: string
    cents: number
  }
  let nearestString: NearestString | null = null
  if (pitch && tuning) {
    for (let i = 0; i < tuning.strings.length; i++) {
      const target = noteToFreq(tuning.strings[i])
      if (!target) continue
      const offset = Math.round(1200 * Math.log2(pitch.freq / target))
      if (Math.abs(offset) >= 250) continue
      if (nearestString === null || Math.abs(offset) < Math.abs(nearestString.cents)) {
        nearestString = { index: i, name: tuning.strings[i], cents: offset }
      }
    }
  }

  const cents = nearestString?.cents ?? detected?.cents ?? 0
  const inTune = Math.abs(cents) <= 5
  const needleAngle = Math.max(-45, Math.min(45, cents * 0.9))

  /*
   * The song's tuning is the record's, and the record is not always where the
   * guitar should be: with the pitch shifter carrying the drop, the strings stay
   * in E standard (or Drop D). Say so instead of silently pointing the tuner at
   * a tuning the player has decided not to use — and leave both a click away.
   */
  const pitchPlan = song?.tuning ? planPitchShifter(song.tuning) : null
  const playedTuning =
    pitchPlan?.enabled
      ? (tunings.find((t) => t.name === (pitchPlan.playedTuning === 'Drop D' ? 'Drop D' : 'E Standard')) ?? null)
      : null
  const onRecordTuning = song?.tuning ? String(song.tuning.id) === tuningId : false

  return (
    <div className="scroll-area h-full px-6 pb-4">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Afinador</h1>
          {song && <p className="text-txt-dim text-sm">{song.title}</p>}
        </div>
        <div className="w-64">
          <NeuSelect
            value={tuningId}
            onChange={setTuningId}
            options={tunings.map((t) => ({
              value: String(t.id),
              label: `${t.name} · ${t.strings.join(' ')}`
            }))}
          />
        </div>
      </div>

      {pitchPlan?.enabled && playedTuning && (
        <NeuCard className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <span className="gradient-text shrink-0 text-[13px] font-bold">
            Dá para ficar em {pitchPlan.playedTuning}
          </span>
          <p className="text-txt-dim min-w-[240px] flex-1 text-[12px] leading-relaxed">
            {pitchPlan.note}
          </p>
          <NeuButton
            className="!px-3 !py-1.5 !text-[11px]"
            onClick={() => setTuningId(String(onRecordTuning ? playedTuning.id : song?.tuning?.id))}
          >
            {onRecordTuning
              ? `afinar em ${playedTuning.name}`
              : `afinar como o disco (${song?.tuning?.name})`}
          </NeuButton>
        </NeuCard>
      )}

      <NeuCard className="mb-4 flex flex-col items-center p-8">
        {/* needle */}
        <div className="relative mb-6 h-32 w-72">
          <div className="neu-inset absolute inset-x-0 bottom-0 h-32 overflow-hidden rounded-t-full">
            {[-45, -22.5, 0, 22.5, 45].map((a) => (
              <div
                key={a}
                className="absolute bottom-0 left-1/2 h-[52%] w-px origin-bottom"
                style={{
                  transform: `translateX(-50%) rotate(${a}deg)`,
                  background: a === 0 ? 'rgba(61,220,132,.6)' : 'rgba(255,255,255,.1)'
                }}
              />
            ))}
          </div>
          <div
            className="absolute bottom-0 left-1/2 h-[48%] w-1 origin-bottom rounded-full transition-transform duration-100"
            style={{
              transform: `translateX(-50%) rotate(${needleAngle}deg)`,
              background: inTune ? '#3DDC84' : 'var(--gradient-hot)',
              boxShadow: inTune ? '0 0 12px rgba(61,220,132,.6)' : '0 0 10px rgba(255,138,92,.5)'
            }}
          />
          <div className="neu-raised absolute bottom-0 left-1/2 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full" />
        </div>

        <div
          className={cx(
            'text-6xl leading-none font-bold tabular-nums',
            inTune && pitch ? 'text-ok' : 'gradient-text'
          )}
        >
          {nearestString?.name ?? detected?.name ?? '—'}
        </div>
        <div className="text-txt-dim mt-2 text-sm tabular-nums">
          {pitch ? `${pitch.freq.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents` : 'toque uma corda'}
        </div>

        <div className="mt-6">
          {listening ? (
            <NeuButton onClick={stop}>Parar</NeuButton>
          ) : (
            <NeuButton variant="accent" onClick={start}>
              Ligar microfone
            </NeuButton>
          )}
        </div>
        {error && <p className="text-danger mt-3 text-xs">{error}</p>}
      </NeuCard>

      {tuning && (
        <NeuCard className="p-4">
          <div className="micro-label mb-3">{tuning.name}</div>
          <div className="flex flex-wrap justify-center gap-3">
            {tuning.strings.map((s, i) => {
              const isTarget = nearestString?.index === i
              return (
                <div
                  key={i}
                  className={cx(
                    'grid h-16 w-16 place-items-center rounded-full',
                    isTarget ? (inTune ? 'neu-glow' : 'neu-glow') : 'neu-inset'
                  )}
                >
                  <span
                    className={cx(
                      'text-lg font-bold',
                      isTarget ? (inTune ? 'text-ok' : 'gradient-text') : 'text-txt-micro'
                    )}
                  >
                    {s.replace(/\d+$/, '')}
                  </span>
                  <span className="text-txt-micro text-[9px]">{i + 1}ª</span>
                </div>
              )
            })}
          </div>
          <p className="text-txt-micro mt-4 text-center text-[11px]">
            Ordem da corda mais grave para a mais aguda. Verde quando estiver a menos de 5 cents.
          </p>
        </NeuCard>
      )}
    </div>
  )
}
