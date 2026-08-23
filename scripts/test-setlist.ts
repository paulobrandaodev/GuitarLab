/**
 * Setlist, band and playlist-import checks against a copy of the real database.
 *
 * Run with: npm run test:setlist
 *
 * Works on a throwaway copy so it can insert and delete freely without touching
 * the user's library. Covers the schema migration (the `band` column is added to
 * databases that predate it), the add/remove paths behind the + and − buttons,
 * and the matcher rule that a Spotify track already in the library must not be
 * imported a second time. Also covers deleting a setlist and re-importing the
 * same Spotify playlist, which refreshes the set instead of duplicating it.
 */
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, copyFileSync, rmSync } from 'node:fs'
import { matchSong } from '../src/main/importers/matcher'
import { deleteSetlistRow, syncSetlistItems } from '../src/main/db/setlists'
import { cleanStoredTitles } from '../src/main/db/repair'

const REAL_DB = join(homedir(), 'AppData/Roaming/setlist-lab/setlist-lab.db')
const TMP_DB = join(homedir(), 'AppData/Local/Temp/setlist-lab-setlist-test.db')

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

/** The same ALTER the app runs on startup for pre-existing databases. */
function addMissingColumns(db: Database.Database): string[] {
  const added: string[] = []
  const additions: Array<[string, string, string]> = [
    ['setlists', 'band', 'TEXT'],
    ['setlists', 'spotify_playlist_id', 'TEXT']
  ]
  for (const [table, column, type] of additions) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (r) => r.name
    )
    if (cols.includes(column)) continue
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    added.push(`${table}.${column}`)
  }
  return added
}

if (!existsSync(REAL_DB)) {
  console.log(`FALHA: banco nao encontrado em ${REAL_DB}`)
  process.exit(1)
}

rmSync(TMP_DB, { force: true })
copyFileSync(REAL_DB, TMP_DB)
const db = new Database(TMP_DB)

console.log('=== 1. migracao da coluna band ===')
const added = addMissingColumns(db)
console.log(`   colunas adicionadas nesta rodada: ${added.length ? added.join(', ') : 'nenhuma'}`)
const cols = (db.prepare('PRAGMA table_info(setlists)').all() as Array<{ name: string }>).map(
  (r) => r.name
)
check('setlists tem a coluna band', cols.includes('band'))
check('setlists tem a coluna spotify_playlist_id', cols.includes('spotify_playlist_id'))
check('migracao e idempotente', addMissingColumns(db).length === 0)

console.log('\n=== 2. setlists por banda ===')
const insert = db.prepare('INSERT INTO setlists (name, band) VALUES (?, ?)')
const a = insert.run('Show Teste A', 'Banda Um').lastInsertRowid as number
const b = insert.run('Show Teste B', 'Banda Dois').lastInsertRowid as number
const c = insert.run('Sem banda', null).lastInsertRowid as number

const bands = (
  db
    .prepare(
      "SELECT DISTINCT band FROM setlists WHERE band IS NOT NULL AND band <> '' ORDER BY band"
    )
    .all() as Array<{ band: string }>
).map((r) => r.band)
check('bandas distintas sao listadas', bands.includes('Banda Um') && bands.includes('Banda Dois'), bands.join(', '))
check('setlist sem banda nao entra na lista', !bands.includes(''), bands.join(', '))

console.log('\n=== 3. adicionar e remover musicas (botoes + e -) ===')
const songs = db.prepare('SELECT id, title FROM songs LIMIT 3').all() as Array<{
  id: number
  title: string
}>
check('ha musicas na biblioteca para testar', songs.length > 0, `${songs.length}`)

if (songs.length) {
  const addItem = db.prepare(
    'INSERT INTO setlist_items (setlist_id, song_id, position) VALUES (?, ?, ?)'
  )
  songs.forEach((s, i) => addItem.run(a, s.id, i))
  const count = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE setlist_id = ?').get(a) as {
      n: number
    }).n
  check('musicas entram no setlist', count() === songs.length, `${count()}`)

  // the same song can sit in two bands' setlists at once
  addItem.run(b, songs[0].id, 0)
  const inTwo = (
    db.prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE song_id = ?').get(songs[0].id) as {
      n: number
    }
  ).n
  check('a mesma musica serve a duas bandas', inTwo >= 2, `${inTwo} setlists`)

  // the − button removes by (setlist, song), never touching the other band's set
  db.prepare('DELETE FROM setlist_items WHERE setlist_id = ? AND song_id = ?').run(a, songs[0].id)
  check('remover tira so do setlist alvo', count() === songs.length - 1, `${count()}`)
  const stillInB = (
    db
      .prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE setlist_id = ? AND song_id = ?')
      .get(b, songs[0].id) as { n: number }
  ).n
  check('o setlist da outra banda fica intacto', stillInB === 1)

  // UNIQUE(setlist_id, song_id) is what stops a double-add
  let duplicated = false
  try {
    addItem.run(b, songs[0].id, 1)
    duplicated = true
  } catch {
    duplicated = false
  }
  check('a mesma musica nao entra duas vezes no mesmo setlist', !duplicated)
}

console.log('\n=== 4. importacao de playlist reaproveita a biblioteca ===')
const library = db
  .prepare(
    'SELECT s.id, s.title, a.name AS artist FROM songs s LEFT JOIN artists a ON a.id = s.artist_id'
  )
  .all() as Array<{ id: number; title: string; artist: string | null }>

if (library.length) {
  const sample = library[0]
  const exact = matchSong(sample.title, sample.artist, library)
  check(
    'faixa identica casa com a musica existente',
    exact.songId === sample.id,
    `${sample.title} -> ${exact.reason}`
  )

  // Spotify titles carry suffixes the local file does not
  const noisy = matchSong(`${sample.title} - Remastered 2015`, sample.artist, library)
  check(
    'titulo com sufixo do Spotify ainda casa',
    noisy.songId === sample.id,
    `${noisy.reason} (score ${noisy.score.toFixed(2)})`
  )

  const unrelated = matchSong('Uma Musica Que Nao Existe Aqui', 'Artista Inventado', library)
  check('musica desconhecida nao casa por engano', unrelated.songId === null, unrelated.reason)
}

console.log('\n=== 5. reimportar a mesma playlist atualiza o setlist ===')
if (songs.length >= 3) {
  const playlistId = 'playlist-de-teste-123'
  const set = db
    .prepare('INSERT INTO setlists (name, band, spotify_playlist_id) VALUES (?, ?, ?)')
    .run('Show do Spotify', 'Banda Um', playlistId).lastInsertRowid as number

  // first import: the whole playlist lands in order
  const first = syncSetlistItems(db, set, [songs[0].id, songs[1].id])
  check('primeira importacao adiciona tudo', first.added === 2 && first.removed === 0)

  const found = db
    .prepare('SELECT id FROM setlists WHERE spotify_playlist_id = ?')
    .all(playlistId) as Array<{ id: number }>
  check('a playlist encontra o setlist que ela criou', found.length === 1 && found[0].id === set)

  // second import: one song left the playlist, another one showed up
  const second = syncSetlistItems(db, set, [songs[1].id, songs[2].id])
  check('a que sumiu da playlist sai do setlist', second.removed === 1, `${second.removed}`)
  check('a que apareceu entra', second.added === 1, `${second.added}`)
  check(
    'a que continua nao e duplicada',
    second.removedSongIds.length === 1 && second.removedSongIds[0] === songs[0].id
  )

  const after = db
    .prepare('SELECT song_id AS songId, position FROM setlist_items WHERE setlist_id = ? ORDER BY position')
    .all(set) as Array<{ songId: number; position: number }>
  check('o setlist fica com exatamente as faixas da playlist', after.length === 2, `${after.length}`)
  check(
    'a ordem segue a playlist',
    after[0].songId === songs[1].id && after[1].songId === songs[2].id,
    after.map((r) => r.songId).join(', ')
  )
  check('as posicoes ficam sem buracos', after.every((r, i) => r.position === i))

  // importing the very same playlist again changes nothing
  const third = syncSetlistItems(db, set, [songs[1].id, songs[2].id])
  check('reimportar sem mudancas e um no-op', third.added === 0 && third.removed === 0)

  console.log('\n=== 6. excluir setlist ===')
  const songCountBefore = (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n
  db.prepare('UPDATE setlists SET is_active = 0').run()
  db.prepare('UPDATE setlists SET is_active = 1 WHERE id = ?').run(set)

  deleteSetlistRow(db, set)
  const gone = db.prepare('SELECT COUNT(*) AS n FROM setlists WHERE id = ?').get(set) as { n: number }
  check('o setlist some', gone.n === 0)
  const orphans = db
    .prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE setlist_id = ?')
    .get(set) as { n: number }
  check('os itens do setlist somem junto', orphans.n === 0)
  const songCountAfter = (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n
  check('as musicas continuam na biblioteca', songCountAfter === songCountBefore, `${songCountAfter}`)
  const active = db.prepare('SELECT COUNT(*) AS n FROM setlists WHERE is_active = 1').get() as {
    n: number
  }
  check('outro setlist assume como ativo', active.n === 1, `${active.n} ativos`)
}

console.log('\n=== 7. limpeza dos titulos ja gravados ===')
{
  const ids: number[] = []
  const insertSong = db.prepare('INSERT INTO songs (title) VALUES (?)')
  for (const title of [
    'Uma Musica Qualquer - Remastered',
    'Outra Musica (Original Album Version)',
    'Musica Limpa'
  ]) {
    ids.push(insertSong.run(title).lastInsertRowid as number)
  }

  const cleaned = cleanStoredTitles(db)
  check('so os titulos sujos sao renomeados', cleaned.renamed >= 2, `${cleaned.renamed}`)
  const titles = ids.map(
    (id) => (db.prepare('SELECT title FROM songs WHERE id = ?').get(id) as { title: string }).title
  )
  check('sufixo depois do traco sai', titles[0] === 'Uma Musica Qualquer', titles[0])
  check('qualificador entre parenteses sai', titles[1] === 'Outra Musica', titles[1])
  check('titulo ja limpo nao e mexido', titles[2] === 'Musica Limpa', titles[2])
  check('rodar de novo nao muda nada', cleanStoredTitles(db).renamed === 0)

  db.prepare(`DELETE FROM songs WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
}

// clean up the scratch rows even though the file is thrown away
db.prepare('DELETE FROM setlists WHERE id IN (?, ?, ?)').run(a, b, c)
db.close()
rmSync(TMP_DB, { force: true })

console.log(`\n${failures === 0 ? 'SETLIST/BANDAS OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
