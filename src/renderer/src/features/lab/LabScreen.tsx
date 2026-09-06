import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  Badge,
  Spinner,
  EmptyState,
  Toast,
  useToast,
  NeuSelect,
  cx
} from '../../components/ui'
import { IconLab, IconWave, IconSparkle } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import { useNav } from '../../App'
import type { SongView, AnalysisJobView, MediaAssetView } from '@shared/types'

const JOB_LABEL: Record<string, string> = {
  stems: 'Separar stems',
  rhythm: 'BPM e grade de batidas',
  harmony: 'Tom e acordes',
  transcribe: 'Áudio → MIDI',
  lyrics: 'Transcrever letra'
}

const JOB_DESC: Record<string, string> = {
  stems: 'Demucs separa em vocal, bateria, baixo, guitarra, piano e outros. Gera seu guitar-only e backing track.',
  rhythm: 'Detecta andamento, batidas e compassos para travar o loop A/B na grade.',
  harmony: 'Detecta a tonalidade e a progressão de acordes ao longo do tempo.',
  transcribe: 'basic-pitch converte o áudio em MIDI — rascunho de tablatura.',
  lyrics: 'faster-whisper transcreve a letra com timestamp por palavra.'
}

function StatusPill({ status }: { status: string }): ReactNode {
  const tone =
    status === 'done' ? 'ok' : status === 'error' ? 'danger' : status === 'running' ? 'info' : 'neutral'
  const label =
    status === 'done'
      ? 'concluído'
      : status === 'error'
        ? 'erro'
        : status === 'running'
          ? 'rodando'
          : status === 'queued'
            ? 'na fila'
            : status
  return <Badge tone={tone}>{label}</Badge>
}

export function LabScreen({
  songId,
  embedded = false
}: {
  songId?: number
  /** Inside the song hub the song is already chosen and titled by the shell. */
  embedded?: boolean
}): ReactNode {
  const go = useNav((s) => s.go)
  const { toast, show, clear } = useToast()

  const [health, setHealth] = useState<{
    reachable: boolean
    gpu: string | null
    cuda: boolean
    detail: string
  } | null>(null)
  const [songs, setSongs] = useState<SongView[]>([])
  const [selected, setSelected] = useState<number | null>(songId ?? null)
  const [jobs, setJobs] = useState<AnalysisJobView[]>([])
  const [media, setMedia] = useState<MediaAssetView[]>([])
  const [model, setModel] = useState('htdemucs_6s')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setHealth(await api.lab.health())
    const list = await api.songs.list()
    setSongs(list.filter((s) => s.hasAudio))
    if (selected) {
      setJobs(await api.lab.jobs(selected))
      setMedia(await api.songs.media(selected))
    }
  }, [selected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return api.lab.onJobsUpdated(() => void refresh())
  }, [refresh])

  const submit = async (type: string): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await api.lab.submit(selected, type, type === 'stems' ? { model } : undefined)
      if (isError(res)) show(res.error, 'danger')
      else show(`${JOB_LABEL[type]} enviado para o container`, 'ok')
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao enviar o job', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const song = songs.find((s) => s.id === selected) ?? null
  const stems = media.filter((m) => m.kind.startsWith('stem_'))

  return (
    <div className={cx('scroll-area h-full pb-4', embedded ? 'px-0' : 'px-6')}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={cx('font-bold', embedded ? 'text-base' : 'text-xl')}>
            Laboratório de Áudio
          </h1>
          <p className="text-txt-dim text-sm">
            Separação de stems e análise rodando localmente na sua GPU
          </p>
        </div>
        <NeuCard className="px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className={cx(
                'h-2.5 w-2.5 rounded-full',
                health?.reachable ? 'bg-ok' : 'bg-danger',
                health?.reachable && 'animate-pulse-soft'
              )}
            />
            <div>
              <div className="text-xs font-semibold">
                {health?.reachable ? 'Container ativo' : 'Container parado'}
              </div>
              <div className="text-txt-micro text-[10px]">{health?.detail ?? '—'}</div>
            </div>
          </div>
        </NeuCard>
      </div>

      {!health?.reachable && (
        <NeuCard className="mb-5 p-4">
          <div className="flex items-start gap-3">
            <IconLab width={22} height={22} className="text-warn mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="mb-1 font-semibold">O laboratório está desligado</div>
              <p className="text-txt-dim text-xs leading-relaxed">
                Suba o container com{' '}
                <code className="neu-inset-sm rounded px-1.5 py-0.5 font-mono text-[11px]">
                  npm run lab:up
                </code>{' '}
                no terminal. Na primeira vez ele baixa a imagem CUDA e os modelos do Demucs, o que
                leva alguns minutos. O resto do app funciona normalmente sem ele.
              </p>
            </div>
          </div>
        </NeuCard>
      )}

      {songs.length === 0 ? (
        <EmptyState
          icon={<IconWave width={26} height={26} />}
          title="Nenhuma música com áudio local"
          description="O laboratório precisa do arquivo de áudio. Coloque mp3/wav/flac na pasta songs/ e importe."
          action={<NeuButton onClick={() => go({ name: 'setlist' })}>Ir para o Setlist</NeuButton>}
        />
      ) : (
        <>
          {!embedded && (
            <div className="mb-4 max-w-md">
              <NeuSelect
                label="música"
                value={selected ? String(selected) : ''}
                onChange={(v) => setSelected(v ? Number(v) : null)}
                options={[
                  { value: '', label: '— escolha uma música —' },
                  ...songs.map((s) => ({
                    value: String(s.id),
                    label: `${s.title}${s.artist ? ` — ${s.artist}` : ''}`
                  }))
                ]}
              />
            </div>
          )}

          {embedded && !song && (
            <EmptyState
              icon={<IconWave width={26} height={26} />}
              title="Essa música ainda não tem áudio local"
              description="O laboratório escuta a gravação. Baixe a faixa pelo botão WAV no setlist, ou coloque o arquivo na pasta de áudio e importe."
            />
          )}

          {song && (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Object.keys(JOB_LABEL).map((type) => {
                  const job = jobs.find((j) => j.type === type)
                  return (
                    <NeuCard key={type} className="flex flex-col p-4">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{JOB_LABEL[type]}</span>
                        {job && <StatusPill status={job.status} />}
                      </div>
                      <p className="text-txt-micro mb-3 text-[11px] leading-snug">
                        {JOB_DESC[type]}
                      </p>

                      {type === 'stems' && (
                        <div className="mb-3">
                          <NeuSelect
                            value={model}
                            onChange={setModel}
                            options={[
                              { value: 'htdemucs_6s', label: '6 stems (inclui guitarra)' },
                              { value: 'htdemucs', label: '4 stems (melhor qualidade)' },
                              { value: 'htdemucs_ft', label: '4 stems fine-tuned (mais lento)' }
                            ]}
                          />
                        </div>
                      )}

                      {job?.status === 'running' && (
                        <div className="neu-inset-sm mb-3 h-1.5 overflow-hidden rounded-full">
                          <div
                            className="gradient-bg h-full rounded-full transition-all"
                            style={{ width: `${Math.round(job.progress * 100)}%` }}
                          />
                        </div>
                      )}
                      {job?.error && (
                        <p className="text-danger mb-2 text-[11px] break-words">{job.error}</p>
                      )}

                      <NeuButton
                        className="mt-auto"
                        onClick={() => submit(type)}
                        disabled={busy || !health?.reachable || job?.status === 'running'}
                      >
                        {job?.status === 'done' ? 'Rodar de novo' : 'Rodar'}
                      </NeuButton>
                    </NeuCard>
                  )
                })}
              </div>

              {stems.length > 0 && (
                <NeuCard className="mb-4 p-4">
                  <div className="micro-label mb-3">Stems gerados ({stems.length})</div>
                  <div className="space-y-2">
                    {stems.map((s) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <span className="w-24 text-xs font-semibold capitalize">
                          {s.kind.replace('stem_', '')}
                        </span>
                        <audio
                          controls
                          preload="none"
                          src={api.mediaUrl(s.path)}
                          className="h-8 flex-1"
                        />
                        <button
                          onClick={() => void api.shell.showItem(s.path)}
                          className="text-txt-micro hover:text-txt text-[11px]"
                        >
                          abrir pasta
                        </button>
                      </div>
                    ))}
                  </div>
                </NeuCard>
              )}

              {jobs.length > 0 && (
                <NeuCard className="p-4">
                  <div className="micro-label mb-3">Histórico de jobs</div>
                  <div className="space-y-1.5">
                    {jobs.map((j) => (
                      <div key={j.id} className="flex items-center gap-2.5 text-xs">
                        <StatusPill status={j.status} />
                        <span className="flex-1 font-semibold">{JOB_LABEL[j.type] ?? j.type}</span>
                        <span className="text-txt-micro">
                          {new Date(j.createdAt * 1000).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    ))}
                  </div>
                </NeuCard>
              )}
            </>
          )}
        </>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
