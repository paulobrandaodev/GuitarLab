import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  Badge,
  EmptyState,
  Toast,
  useToast,
  NeuSelect,
  cx
} from '../../components/ui'
import { IconWave } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import { useStrings } from '../../lib/i18n'
import { useNav } from '../../App'
import { LabSetup } from './LabSetup'
import type { SongView, AnalysisJobView, MediaAssetView, AnalysisType } from '@shared/types'

const JOB_TYPES: AnalysisType[] = ['stems', 'rhythm', 'harmony', 'transcribe', 'lyrics']

export function LabScreen({
  songId,
  embedded = false
}: {
  songId?: number
  /** Inside the song hub the song is already chosen and titled by the shell. */
  embedded?: boolean
}): ReactNode {
  const go = useNav((s) => s.go)
  const s = useStrings()
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
    setSongs(list.filter((song) => song.hasAudio))
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

  const submit = async (type: AnalysisType): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await api.lab.submit(selected, type, type === 'stems' ? { model } : undefined)
      if (isError(res)) show(res.error, 'danger')
      else show(s.lab.sent(s.lab.jobs[type]), 'ok')
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : s.lab.sendFailed, 'danger')
    } finally {
      setBusy(false)
    }
  }

  const song = songs.find((item) => item.id === selected) ?? null
  const stems = media.filter((item) => item.kind.startsWith('stem_'))

  return (
    <div className={cx('scroll-area h-full pb-4', embedded ? 'px-0' : 'px-6')}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={cx('font-bold', embedded ? 'text-base' : 'text-xl')}>{s.lab.title}</h1>
          <p className="text-txt-dim text-sm">{s.lab.subtitle}</p>
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
                {health?.reachable ? s.lab.on : s.lab.off}
              </div>
              <div className="text-txt-micro text-[10px]">{health?.detail ?? s.common.empty}</div>
            </div>
          </div>
        </NeuCard>
      </div>

      {/*
       * The lab used to be a container the user had to start from a terminal,
       * and this is where the instructions to do that lived. It installs and
       * runs itself now, so the panel that replaced them belongs in the same
       * place: the first thing on the screen until there is a working lab.
       */}
      <LabSetup onChanged={() => void refresh()} />

      {songs.length === 0 ? (
        <EmptyState
          icon={<IconWave width={26} height={26} />}
          title={s.lab.noSongs}
          description={s.lab.noSongsDesc}
          action={<NeuButton onClick={() => go({ name: 'setlist' })}>{s.lab.goToSetlist}</NeuButton>}
        />
      ) : (
        <>
          {!embedded && (
            <div className="mb-4 max-w-md">
              <NeuSelect
                label={s.lab.chooseSong}
                value={selected ? String(selected) : ''}
                onChange={(value) => setSelected(value ? Number(value) : null)}
                options={[
                  { value: '', label: s.lab.chooseSongPlaceholder },
                  ...songs.map((item) => ({
                    value: String(item.id),
                    label: `${item.title}${item.artist ? ` — ${item.artist}` : ''}`
                  }))
                ]}
              />
            </div>
          )}

          {embedded && !song && (
            <EmptyState
              icon={<IconWave width={26} height={26} />}
              title={s.lab.songNoAudio}
              description={s.lab.songNoAudioDesc}
            />
          )}

          {song && (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {JOB_TYPES.map((type) => {
                  const job = jobs.find((item) => item.type === type)
                  return (
                    <NeuCard key={type} className="flex flex-col p-4">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{s.lab.jobs[type]}</span>
                        {job && (
                          <Badge
                            tone={
                              job.status === 'done'
                                ? 'ok'
                                : job.status === 'error'
                                  ? 'danger'
                                  : job.status === 'running'
                                    ? 'info'
                                    : 'neutral'
                            }
                          >
                            {s.lab.jobStatus[job.status]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-txt-micro mb-3 text-[11px] leading-snug">
                        {s.lab.jobDesc[type]}
                      </p>

                      {type === 'stems' && (
                        <div className="mb-3">
                          <NeuSelect
                            value={model}
                            onChange={setModel}
                            options={[
                              { value: 'htdemucs_6s', label: s.lab.demucsModel.six },
                              { value: 'htdemucs', label: s.lab.demucsModel.four },
                              { value: 'htdemucs_ft', label: s.lab.demucsModel.fourFt }
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
                        onClick={() => void submit(type)}
                        disabled={busy || !health?.reachable || job?.status === 'running'}
                      >
                        {job?.status === 'done' ? s.lab.rerun : s.lab.run}
                      </NeuButton>
                    </NeuCard>
                  )
                })}
              </div>

              {stems.length > 0 && (
                <NeuCard className="mb-4 p-4">
                  <div className="micro-label mb-3">{s.lab.stemsMade(stems.length)}</div>
                  <div className="space-y-2">
                    {stems.map((item) => (
                      <div key={item.id} className="flex items-center gap-3">
                        <span className="w-24 text-xs font-semibold capitalize">
                          {item.kind.replace('stem_', '')}
                        </span>
                        <audio
                          controls
                          preload="none"
                          src={api.mediaUrl(item.path)}
                          className="h-8 flex-1"
                        />
                        <button
                          onClick={() => void api.shell.showItem(item.path)}
                          className="text-txt-micro hover:text-txt text-[11px]"
                        >
                          {s.lab.openFolder}
                        </button>
                      </div>
                    ))}
                  </div>
                </NeuCard>
              )}

              {jobs.length > 0 && (
                <NeuCard className="p-4">
                  <div className="micro-label mb-3">{s.lab.history}</div>
                  <div className="space-y-1.5">
                    {jobs.map((item) => (
                      <div key={item.id} className="flex items-center gap-2.5 text-xs">
                        <Badge
                          tone={
                            item.status === 'done'
                              ? 'ok'
                              : item.status === 'error'
                                ? 'danger'
                                : item.status === 'running'
                                  ? 'info'
                                  : 'neutral'
                          }
                        >
                          {s.lab.jobStatus[item.status]}
                        </Badge>
                        <span className="flex-1 font-semibold">
                          {s.lab.jobs[item.type] ?? item.type}
                        </span>
                        <span className="text-txt-micro">
                          {new Date(item.createdAt * 1000).toLocaleString()}
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
