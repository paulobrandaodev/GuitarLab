import { useEffect, useState, type ReactNode } from 'react'
import { NeuCard, NeuButton, NeuInput, Spinner, Badge, cx } from '../../components/ui'
import { IconSpotify, IconX } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import type { SetlistView, SongView, SpotifyPlaylistView, PlaylistImportView } from '@shared/types'

/** Shared shell: a centred panel over a dimming backdrop. */
export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="bg-void/70 fixed inset-0 z-50 grid place-items-center p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <NeuCard
        className={cx('flex max-h-[80vh] w-full flex-col p-5', wide ? 'max-w-2xl' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} className="text-txt-micro hover:text-txt" title="Fechar">
            <IconX width={16} height={16} />
          </button>
        </div>
        {children}
      </NeuCard>
    </div>
  )
}

/** Yes/no over the same shell, for anything that cannot be undone. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Excluir',
  onConfirm,
  onClose
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-txt-dim space-y-4 text-sm">
        <div>{message}</div>
        <div className="flex justify-end gap-2">
          <NeuButton onClick={onClose}>Cancelar</NeuButton>
          <NeuButton
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Spinner size={14} /> : confirmLabel}
          </NeuButton>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------- add a song to a setlist */

/**
 * Choose which band's setlist a song goes into. The user plays in more than
 * one, so "add to the active setlist" is the wrong default — the band is the
 * question being answered here.
 */
export function AddToSetlistDialog({
  song,
  setlists,
  onAdd,
  onCreate,
  onClose
}: {
  song: SongView
  setlists: SetlistView[]
  onAdd: (setlistId: number) => Promise<void>
  onCreate: (name: string, band: string | null) => Promise<SetlistView | null>
  onClose: () => void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBand, setNewBand] = useState('')

  // group by band so picking the right set is a two-level choice, not a long list
  const byBand = new Map<string, SetlistView[]>()
  for (const l of setlists) {
    const key = l.band?.trim() || 'Sem banda'
    if (!byBand.has(key)) byBand.set(key, [])
    byBand.get(key)?.push(l)
  }

  const add = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      await onAdd(id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const created = await onCreate(newName.trim(), newBand.trim() || null)
      if (created) {
        await onAdd(created.id)
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Adicionar "${song.title}"`} onClose={onClose}>
      <div className="scroll-area min-h-0 flex-1 space-y-4">
        {[...byBand.entries()].map(([band, lists]) => (
          <div key={band}>
            <div className="micro-label mb-1.5">{band}</div>
            <div className="space-y-1.5">
              {lists.map((l) => (
                <button
                  key={l.id}
                  disabled={busy}
                  onClick={() => void add(l.id)}
                  className="neu-press flex w-full items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.name}</span>
                  <Badge>{l.songCount} músicas</Badge>
                  {l.isActive && <Badge tone="accent">ativo</Badge>}
                </button>
              ))}
            </div>
          </div>
        ))}

        {setlists.length === 0 && !creating && (
          <p className="text-txt-micro text-[11px]">
            Nenhum setlist ainda — crie o primeiro e diga de qual banda ele é.
          </p>
        )}

        {creating ? (
          <div className="neu-inset space-y-2.5 rounded-[16px] p-3.5">
            <NeuInput
              label="Nome do setlist"
              placeholder="ex.: Show do Sesc"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <NeuInput
              label="Banda"
              placeholder="ex.: Cover Metallica"
              value={newBand}
              onChange={(e) => setNewBand(e.target.value)}
            />
            <div className="flex gap-2">
              <NeuButton variant="accent" onClick={create} disabled={busy || !newName.trim()}>
                {busy ? <Spinner size={14} /> : 'Criar e adicionar'}
              </NeuButton>
              <NeuButton onClick={() => setCreating(false)}>Cancelar</NeuButton>
            </div>
          </div>
        ) : (
          <NeuButton onClick={() => setCreating(true)}>+ novo setlist</NeuButton>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------ import a Spotify playlist */

export function ImportPlaylistDialog({
  bands,
  onDone,
  onClose
}: {
  bands: string[]
  onDone: (report: PlaylistImportView) => void
  onClose: () => void
}): ReactNode {
  const [playlists, setPlaylists] = useState<SpotifyPlaylistView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SpotifyPlaylistView | null>(null)
  const [name, setName] = useState('')
  const [band, setBand] = useState('')
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.spotify.playlists()
        if (isError(res)) setError(res.error)
        else setPlaylists(res)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao ler as playlists')
      }
    })()
  }, [])

  const runImport = async (): Promise<void> => {
    if (!selected) return
    setImporting(true)
    try {
      const res = await api.spotify.importPlaylist(
        selected.id,
        name.trim() || selected.name,
        band.trim() || null
      )
      if (isError(res)) setError(res.error)
      else {
        onDone(res)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
    } finally {
      setImporting(false)
    }
  }

  const visible = (playlists ?? []).filter((p) =>
    p.name.toLowerCase().includes(filter.trim().toLowerCase())
  )

  return (
    <Modal title="Importar playlist do Spotify" onClose={onClose} wide>
      {error && (
        <div className="neu-inset text-danger mb-3 rounded-[14px] p-3 text-[12px]">
          {error}
          {/connect|conectad/i.test(error) && (
            <div className="mt-2">
              <NeuButton
                className="!px-3 !py-1.5 !text-[11px]"
                onClick={async () => {
                  setError(null)
                  const res = await api.spotify.connect()
                  if (res.ok) {
                    const list = await api.spotify.playlists()
                    if (isError(list)) setError(list.error)
                    else setPlaylists(list)
                  } else setError(res.error ?? 'Falha ao conectar')
                }}
              >
                Conectar o Spotify
              </NeuButton>
            </div>
          )}
        </div>
      )}

      {!playlists && !error && (
        <div className="grid place-items-center py-10">
          <Spinner size={22} />
        </div>
      )}

      {playlists && (
        <>
          {!selected ? (
            <>
              <div className="mb-3">
                <NeuInput
                  placeholder="Filtrar playlists…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="scroll-area min-h-0 flex-1 space-y-1.5">
                {visible.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelected(p)
                      setName(p.name)
                    }}
                    className="neu-press flex w-full items-center gap-3 rounded-[14px] p-2.5 text-left"
                  >
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-[8px] object-cover"
                      />
                    ) : (
                      <span className="neu-inset grid h-10 w-10 shrink-0 place-items-center rounded-[8px]">
                        <IconSpotify width={16} height={16} className="text-txt-micro" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="text-txt-micro block truncate text-[11px]">{p.owner}</span>
                    </span>
                    <Badge>{p.trackCount} faixas</Badge>
                  </button>
                ))}
                {visible.length === 0 && (
                  <p className="text-txt-micro py-6 text-center text-[11px]">
                    Nenhuma playlist encontrada.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="neu-inset flex items-center gap-3 rounded-[14px] p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{selected.name}</span>
                  <span className="text-txt-micro text-[11px]">
                    {selected.trackCount} faixas
                  </span>
                </span>
                <NeuButton
                  className="!px-3 !py-1.5 !text-[11px]"
                  onClick={() => setSelected(null)}
                >
                  trocar
                </NeuButton>
              </div>

              <NeuInput
                label="Nome do setlist"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div>
                <NeuInput
                  label="Banda"
                  placeholder="ex.: Cover Metallica"
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                />
                {bands.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {bands.map((b) => (
                      <button
                        key={b}
                        onClick={() => setBand(b)}
                        className={cx(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          band === b ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                        )}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-txt-micro text-[11px]">
                As faixas que já existem na sua biblioteca são reaproveitadas — só as novas viram
                músicas novas. Importar de novo a mesma playlist <b>atualiza o setlist que ela já
                criou</b>: entra o que surgiu, sai o que você tirou lá no Spotify.
              </p>

              <NeuButton variant="accent" onClick={runImport} disabled={importing}>
                <span className="flex items-center gap-2">
                  {importing ? <Spinner size={14} /> : <IconSpotify width={15} height={15} />}
                  {importing ? 'Importando…' : 'Importar como setlist'}
                </span>
              </NeuButton>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
