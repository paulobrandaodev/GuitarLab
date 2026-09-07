import { useEffect, useState, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  NeuInput,
  NeuSelect,
  Spinner,
  Badge,
  cx
} from '../../components/ui'
import { IconSpotify, IconX } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import { useStrings } from '../../lib/i18n'
import { parseDuration } from '@shared/format'
import type {
  NewSetlistInput,
  NewSongInput,
  SetlistView,
  SongView,
  SpotifyPlaylistView,
  PlaylistImportView,
  TuningView
} from '@shared/types'

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

/* --------------------------------------------- adding things by hand */

/**
 * A day picked in the browser's date field, as the unix timestamp the database
 * stores. Midday, deliberately: a date stored at midnight lands on the previous
 * day for anyone west of UTC, and a show would show up on the wrong date.
 */
function dayToUnix(value: string): number | null {
  if (!value) return null
  const ms = new Date(`${value}T12:00:00`).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** A number the user may have left blank. Anything unreadable counts as blank. */
function optionalNumber(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * A setlist typed in by hand.
 *
 * The show is booked before the songs are chosen, so the name is the only
 * thing this asks for. The rest is here because the user often does know the
 * date and the venue, and typing them now beats coming back for them.
 */
export function NewSetlistDialog({
  bands,
  onCreate,
  onClose
}: {
  bands: string[]
  onCreate: (input: NewSetlistInput) => Promise<void>
  onClose: () => void
}): ReactNode {
  const str = useStrings()
  const [form, setForm] = useState({ name: '', band: '', eventDate: '', venue: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = form.name.trim().length > 0

  const create = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        name: form.name.trim(),
        band: form.band.trim() || null,
        eventDate: dayToUnix(form.eventDate),
        venue: form.venue.trim() || null,
        notes: form.notes.trim() || null
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={str.manual.newSetlist} onClose={onClose}>
      <div className="scroll-area min-h-0 flex-1 space-y-3">
        <NeuInput
          label={`${str.manual.setlistName} · ${str.manual.required}`}
          placeholder={str.manual.setlistNamePlaceholder}
          value={form.name}
          autoFocus
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />

        <div>
          <NeuInput
            label={str.manual.band}
            placeholder={str.manual.bandPlaceholder}
            value={form.band}
            onChange={(e) => setForm({ ...form, band: e.target.value })}
          />
          {bands.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bands.map((b) => (
                <button
                  key={b}
                  onClick={() => setForm({ ...form, band: form.band === b ? '' : b })}
                  className={cx(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    form.band === b ? 'neu-glow gradient-text' : 'neu-press text-txt-dim'
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <NeuInput
            label={str.manual.eventDate}
            type="date"
            value={form.eventDate}
            onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
          />
          <NeuInput
            label={str.manual.venue}
            placeholder={str.manual.venuePlaceholder}
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
          />
        </div>

        <div>
          <label className="micro-label mb-2 block">{str.manual.notes}</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="neu-inset text-txt h-20 w-full resize-none rounded-[16px] p-3 text-sm outline-none"
          />
        </div>

        <p className="text-txt-micro text-[11px]">{str.manual.setlistHint}</p>

        {error && <div className="neu-inset text-danger rounded-[14px] p-3 text-[12px]">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <NeuButton onClick={onClose}>{str.common.cancel}</NeuButton>
          <NeuButton variant="accent" onClick={create} disabled={!ready || busy}>
            {busy ? <Spinner size={14} /> : str.manual.create}
          </NeuButton>
        </div>
      </div>
    </Modal>
  )
}

/**
 * A song typed in by hand.
 *
 * Title and artist are required and nothing else is, because those two are what
 * every other feature searches with: the tab sites, archive.org and the lyrics
 * service are all queried as "artist title", and a song missing either one is a
 * row that can never fetch its own files.
 *
 * The extra fields are folded away by default. They are the same ones the song
 * screen edits, so anything skipped here has an obvious place to be filled in
 * later — and importing a Guitar Pro file fills most of them in by itself.
 */
export function NewSongDialog({
  setlists,
  defaultSetlistId,
  onCreated,
  onOpenSong,
  onClose
}: {
  setlists: SetlistView[]
  defaultSetlistId: number | null
  onCreated: (song: SongView, setlist: SetlistView | null) => void
  onOpenSong: (songId: number) => void
  onClose: () => void
}): ReactNode {
  const str = useStrings()
  const [tunings, setTunings] = useState<TuningView[]>([])
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The library song this one would duplicate, once the user has been warned. */
  const [duplicate, setDuplicate] = useState<{ id: number; title: string; artist: string | null } | null>(
    null
  )
  const [form, setForm] = useState({
    title: '',
    artist: '',
    album: '',
    year: '',
    genre: '',
    duration: '',
    musicalKey: '',
    bpm: '',
    timeSignature: '',
    tuningId: '',
    capo: '',
    notes: '',
    setlistId: defaultSetlistId ? String(defaultSetlistId) : ''
  })

  useEffect(() => {
    void api.songs.tunings().then(setTunings)
  }, [])

  const durationMs = parseDuration(form.duration)
  const badDuration = form.duration.trim().length > 0 && durationMs === null
  const ready = form.title.trim().length > 0 && form.artist.trim().length > 0 && !badDuration

  /** `skipDuplicateCheck` is the "criar assim mesmo" path, after the warning. */
  const create = async (skipDuplicateCheck: boolean): Promise<void> => {
    if (!ready || busy) return
    const title = form.title.trim()
    const artist = form.artist.trim()
    setBusy(true)
    setError(null)
    try {
      if (!skipDuplicateCheck) {
        const found = await api.songs.findDuplicate(title, artist)
        if (found) {
          setDuplicate(found)
          return
        }
      }
      const setlistId = form.setlistId ? Number(form.setlistId) : null
      const song = await api.songs.create({
        title,
        artist,
        album: form.album.trim() || null,
        year: optionalNumber(form.year),
        genre: form.genre.trim() || null,
        durationMs,
        musicalKey: form.musicalKey.trim() || null,
        bpm: optionalNumber(form.bpm),
        timeSignature: form.timeSignature.trim() || null,
        tuningId: form.tuningId ? Number(form.tuningId) : null,
        capo: optionalNumber(form.capo),
        notes: form.notes.trim() || null,
        setlistId
      } satisfies NewSongInput)
      onCreated(song, setlists.find((l) => l.id === setlistId) ?? null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={str.manual.newSong} onClose={onClose} wide>
      <div className="scroll-area min-h-0 flex-1 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <NeuInput
            label={`${str.manual.songTitle} · ${str.manual.required}`}
            placeholder={str.manual.songTitlePlaceholder}
            value={form.title}
            autoFocus
            onChange={(e) => {
              // editing either half of the pair answers the warning it raised
              setDuplicate(null)
              setForm({ ...form, title: e.target.value })
            }}
          />
          <NeuInput
            label={`${str.manual.artist} · ${str.manual.required}`}
            placeholder={str.manual.artistPlaceholder}
            value={form.artist}
            onChange={(e) => {
              setDuplicate(null)
              setForm({ ...form, artist: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create(false)
            }}
          />
        </div>

        {setlists.length > 0 && (
          <NeuSelect
            label={str.manual.addTo}
            value={form.setlistId}
            onChange={(v) => setForm({ ...form, setlistId: v })}
            options={[
              { value: '', label: str.manual.onlyLibrary },
              ...setlists.map((l) => ({
                value: String(l.id),
                label: l.band ? `${l.name} · ${l.band}` : l.name
              }))
            ]}
          />
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="neu-press text-txt-dim rounded-[12px] px-3 py-1.5 text-[11px] font-semibold"
        >
          {expanded ? str.manual.fewerFields : str.manual.moreFields}
        </button>

        {expanded && (
          <div className="neu-inset space-y-3 rounded-[16px] p-3.5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NeuInput
                label={str.manual.album}
                value={form.album}
                onChange={(e) => setForm({ ...form, album: e.target.value })}
              />
              <NeuInput
                label={str.manual.year}
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
              <NeuInput
                label={str.manual.genre}
                value={form.genre}
                onChange={(e) => setForm({ ...form, genre: e.target.value })}
              />
              <NeuInput
                label={str.manual.duration}
                /* m:ss reads the same in every language this app speaks */
                placeholder="4:32"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
              <NeuInput
                label={str.manual.key}
                placeholder="Em, A, F#m"
                value={form.musicalKey}
                onChange={(e) => setForm({ ...form, musicalKey: e.target.value })}
              />
              <NeuInput
                label={str.manual.bpm}
                type="number"
                value={form.bpm}
                onChange={(e) => setForm({ ...form, bpm: e.target.value })}
              />
              <NeuInput
                label={str.manual.timeSignature}
                placeholder="4/4"
                value={form.timeSignature}
                onChange={(e) => setForm({ ...form, timeSignature: e.target.value })}
              />
              <NeuSelect
                label={str.manual.tuning}
                value={form.tuningId}
                onChange={(v) => setForm({ ...form, tuningId: v })}
                options={[
                  { value: '', label: str.manual.noTuning },
                  ...tunings.map((t) => ({
                    value: String(t.id),
                    label: `${t.name} (${t.strings.join(' ')})`
                  }))
                ]}
              />
              <NeuInput
                label={str.manual.capo}
                type="number"
                value={form.capo}
                onChange={(e) => setForm({ ...form, capo: e.target.value })}
              />
            </div>
            <div>
              <label className="micro-label mb-2 block">{str.manual.notes}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="neu-inset text-txt h-20 w-full resize-none rounded-[16px] p-3 text-sm outline-none"
              />
            </div>
          </div>
        )}

        {badDuration && (
          <div className="neu-inset text-warn rounded-[14px] p-3 text-[12px]">
            {str.manual.durationInvalid}
          </div>
        )}

        {duplicate && (
          <div className="neu-inset space-y-2 rounded-[14px] p-3 text-[12px]">
            <div className="text-warn">
              {str.manual.duplicate(duplicate.title, duplicate.artist ?? str.common.empty)}
            </div>
            <div className="flex flex-wrap gap-2">
              <NeuButton
                className="!px-3 !py-1.5 !text-[11px]"
                onClick={() => {
                  onOpenSong(duplicate.id)
                  onClose()
                }}
              >
                {str.manual.duplicateOpen}
              </NeuButton>
              <NeuButton
                className="!px-3 !py-1.5 !text-[11px]"
                variant="accent"
                onClick={() => void create(true)}
                disabled={busy}
              >
                {str.manual.duplicateAnyway}
              </NeuButton>
            </div>
          </div>
        )}

        <p className="text-txt-micro text-[11px]">{str.manual.songHint}</p>

        {error && <div className="neu-inset text-danger rounded-[14px] p-3 text-[12px]">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <NeuButton onClick={onClose}>{str.common.cancel}</NeuButton>
          <NeuButton variant="accent" onClick={() => void create(false)} disabled={!ready || busy}>
            {busy ? <Spinner size={14} /> : str.manual.create}
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
