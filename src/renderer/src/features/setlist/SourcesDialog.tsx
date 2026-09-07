import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { NeuButton, NeuCard, Badge, Spinner, EmptyState, cx } from '../../components/ui'
import { IconDownload, IconWave, IconChart, IconCheck, IconImport } from '../../components/ui/icons'
import { Modal } from './SetlistDialogs'
import { api, isError, formatDuration } from '../../lib/api'
import type { ArchiveCandidate, DownloadProgress, SongView } from '@shared/types'

/**
 * Where a song's files come from.
 *
 * The two halves work differently on purpose, and the dialog says so:
 *
 *  - **Tablatura.** Ultimate Guitar and CifraClub have no public API and their
 *    terms forbid scraping, so the app opens the site's own search — Guitar Pro
 *    files, 4–5 stars — in a window whose downloads land straight in `gptabs/`
 *    and get imported. The click is the user's; the filing is the app's.
 *  - **Áudio.** archive.org has a real API, so that side is fully automatic.
 */

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '—'
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`
}

function ProgressBar({ progress }: { progress: DownloadProgress }): ReactNode {
  const pct =
    progress.totalBytes && progress.totalBytes > 0
      ? Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100)
      : null

  const label =
    progress.status === 'importing'
      ? 'importando (loudness + forma de onda)…'
      : progress.status === 'done'
        ? (progress.message ?? 'pronto')
        : progress.status === 'error'
          ? (progress.message ?? 'falhou')
          : pct !== null
            ? `${pct.toFixed(0)}% de ${sizeLabel(progress.totalBytes)}`
            : sizeLabel(progress.receivedBytes)

  return (
    <div className="mt-2">
      <div className="neu-inset-sm h-1.5 overflow-hidden rounded-full">
        <div
          className={cx(
            'h-full rounded-full transition-all',
            progress.status === 'error' ? 'bg-danger' : 'gradient-bg'
          )}
          style={{
            width:
              progress.status === 'done' || progress.status === 'error'
                ? '100%'
                : `${pct ?? 12}%`
          }}
        />
      </div>
      <div
        className={cx(
          'mt-1 text-[11px]',
          progress.status === 'error' ? 'text-danger' : 'text-txt-dim'
        )}
      >
        {progress.fileName} — {label}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- tablature */

function TabSources({
  song,
  progress,
  onChanged
}: {
  song: SongView
  progress: DownloadProgress | null
  onChanged: () => void
}): ReactNode {
  const [busy, setBusy] = useState<'ultimate' | 'cifraclub' | 'arquivo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const open = async (site: 'ultimate' | 'cifraclub'): Promise<void> => {
    setBusy(site)
    setError(null)
    try {
      const res = await api.sources.openTabBrowser(song.id, site)
      if (isError(res)) setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir o site')
    } finally {
      setBusy(null)
    }
  }

  /** Whatever the site would not hand over, the user can still point at. */
  const pickFile = async (): Promise<void> => {
    setBusy('arquivo')
    setError(null)
    try {
      const res = await api.sources.pickTabFile(song.id)
      if (isError(res)) setError(res.error)
      else if ('path' in res) {
        setPicked(res.path.split(/[\\/]/).pop() ?? res.path)
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar o arquivo')
    } finally {
      setBusy(null)
    }
  }

  return (
    <NeuCard className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="micro-label">Tablatura Guitar Pro</div>
        {song.hasGuitarPro && (
          <Badge tone="ok">
            <IconCheck width={11} height={11} /> já tem
          </Badge>
        )}
      </div>

      <p className="text-txt-dim text-[12px] leading-relaxed">
        Abre a busca já filtrada em <b>arquivos Guitar Pro com 4–5 estrelas</b>. O download que
        você clicar cai direto em <code className="text-txt">gptabs/</code> e entra na biblioteca
        sozinho — não precisa mover nada.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <NeuButton variant="accent" onClick={() => open('ultimate')} disabled={busy !== null}>
          <span className="flex items-center gap-2">
            {busy === 'ultimate' ? <Spinner size={14} /> : <IconDownload width={15} height={15} />}
            Ultimate Guitar
          </span>
        </NeuButton>
        <NeuButton onClick={() => open('cifraclub')} disabled={busy !== null}>
          <span className="flex items-center gap-2">
            {busy === 'cifraclub' ? <Spinner size={14} /> : <IconChart width={15} height={15} />}
            CifraClub
          </span>
        </NeuButton>
        <NeuButton onClick={pickFile} disabled={busy !== null} title="Escolher um .gp já baixado">
          <span className="flex items-center gap-2">
            {busy === 'arquivo' ? <Spinner size={14} /> : <IconImport width={15} height={15} />}
            Já tenho o arquivo
          </span>
        </NeuButton>
      </div>

      {picked && <div className="text-ok mt-2 text-[11px]">{picked} entrou na biblioteca</div>}

      <p className="text-txt-micro mt-2.5 text-[11px] leading-snug">
        Os dois sites não têm API pública e raspar o conteúdo fere os termos deles, então quem
        escolhe e clica é você — o app só decide onde o arquivo cai e importa o que chegar. Parte
        dos arquivos Guitar Pro do Ultimate Guitar exige conta Pro; a janela guarda o login entre
        as sessões, e o botão ao lado serve para qualquer .gp que você já tenha em mãos.
      </p>

      {error && <div className="text-danger mt-2 text-[11px]">{error}</div>}
      {progress?.kind === 'guitarpro' && <ProgressBar progress={progress} />}
    </NeuCard>
  )
}

/* ------------------------------------------------------------- archive.org */

function AudioSources({
  song,
  progress,
  onChanged
}: {
  song: SongView
  progress: DownloadProgress | null
  onChanged: () => void
}): ReactNode {
  const [candidates, setCandidates] = useState<ArchiveCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const search = useCallback(async () => {
    setCandidates(null)
    setError(null)
    try {
      const res = await api.sources.archiveSearch(song.id)
      if (isError(res)) {
        setError(res.error)
        setCandidates([])
      } else {
        setCandidates(res.candidates)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na busca')
      setCandidates([])
    }
  }, [song.id])

  useEffect(() => {
    void search()
  }, [search])

  const download = async (candidate: ArchiveCandidate): Promise<void> => {
    setDownloading(candidate.url)
    setError(null)
    try {
      const res = await api.sources.archiveDownload(song.id, candidate)
      if (isError(res)) setError(res.error)
      else onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no download')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <NeuCard className="flex min-h-0 flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="micro-label">Áudio no archive.org</div>
        <div className="flex items-center gap-2">
          {song.hasAudio && (
            <Badge tone="ok">
              <IconCheck width={11} height={11} /> já tem
            </Badge>
          )}
          <NeuButton className="!px-3 !py-1.5 !text-[11px]" onClick={search}>
            buscar de novo
          </NeuButton>
        </div>
      </div>

      <p className="text-txt-dim mb-3 text-[12px] leading-relaxed">
        Baixa direto para <code className="text-txt">songs/</code> e importa: duração, loudness
        EBU R128 e forma de onda saem na hora. Sem perda primeiro (wav/flac), mp3 depois.
      </p>

      {candidates === null && (
        <div className="grid place-items-center py-8">
          <Spinner size={22} />
        </div>
      )}

      {candidates?.length === 0 && (
        <EmptyState
          icon={<IconWave width={24} height={24} />}
          title="Nada no archive.org"
          description={
            error ??
            'Nenhuma faixa com esse título apareceu. Tente de novo ou coloque o arquivo em songs/ na mão.'
          }
        />
      )}

      {candidates && candidates.length > 0 && (
        <div className="scroll-area ring-room min-h-0 flex-1 space-y-1.5">
          {candidates.map((c) => (
            <div key={c.url} className="neu-inset rounded-[14px] p-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{c.fileName}</div>
                  <div className="text-txt-micro truncate text-[11px]">
                    {c.itemTitle}
                    {c.year ? ` · ${c.year}` : ''} · {c.reason}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={c.ext === '.wav' || c.ext === '.flac' ? 'accent' : 'neutral'}>
                    {c.format}
                  </Badge>
                  <Badge>{sizeLabel(c.sizeBytes)}</Badge>
                  {c.durationS !== null && (
                    <Badge>{formatDuration(Math.round(c.durationS * 1000))}</Badge>
                  )}
                  <NeuButton
                    className="!px-3 !py-1.5 !text-[11px]"
                    disabled={downloading !== null}
                    onClick={() => download(c)}
                  >
                    <span className="flex items-center gap-1.5">
                      {downloading === c.url ? (
                        <Spinner size={12} />
                      ) : (
                        <IconDownload width={13} height={13} />
                      )}
                      baixar
                    </span>
                  </NeuButton>
                </div>
              </div>
              {downloading === c.url && progress?.kind === 'audio' && (
                <ProgressBar progress={progress} />
              )}
            </div>
          ))}
        </div>
      )}

      {error && candidates?.length ? (
        <div className="text-danger mt-2 text-[11px]">{error}</div>
      ) : null}
      {progress?.kind === 'audio' && downloading === null && <ProgressBar progress={progress} />}
    </NeuCard>
  )
}

/* ------------------------------------------------------------------ dialog */

export function SourcesDialog({
  song,
  onClose,
  onChanged
}: {
  song: SongView
  onClose: () => void
  onChanged: () => void
}): ReactNode {
  const [progress, setProgress] = useState<DownloadProgress | null>(null)

  useEffect(() => {
    return api.sources.onProgress((event) => {
      if (event.songId !== song.id) return
      setProgress(event)
      // an import that finished changed the song's files
      if (event.status === 'done') onChanged()
    })
  }, [song.id, onChanged])

  return (
    <Modal title={`Arquivos de "${song.title}"`} onClose={onClose} wide>
      <div className="scroll-area ring-room min-h-0 flex-1 space-y-3">
        <TabSources song={song} progress={progress} onChanged={onChanged} />
        <AudioSources song={song} progress={progress} onChanged={onChanged} />
      </div>
    </Modal>
  )
}
