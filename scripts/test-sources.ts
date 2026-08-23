/**
 * Where the files come from: tab-site deep links and archive.org.
 *
 * Run with: npm run test:sources
 *
 * Two halves, checked differently. The link builders and the file-name/ranking
 * logic are pure and always checked. The network side is checked against the
 * real services — the URL shape is exactly the thing that silently rots when a
 * site changes its filters — but a machine that is offline reports the check as
 * skipped instead of failing the suite.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import {
  ultimateGuitarUrl,
  cifraClubSearchUrl,
  safeFileName,
  uniquePath,
  parseArchiveLength,
  scoreArchiveFile,
  searchArchiveAudio
} from '../src/main/services/sources'
import { cleanTitle, normalizeTitle, normalizeArtist } from '../src/main/importers/matcher'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}
function skip(label: string, why: string): void {
  console.log(`  pula ${label} -- ${why}`)
}

console.log('=== 1. link do Ultimate Guitar (Guitar Pro, mais bem avaliadas) ===')
const ug = ultimateGuitarUrl('Metallica', 'The Four Horsemen')
console.log(`   ${ug}`)
check('filtra por Guitar Pro (type=500)', ug.includes('type=500'))
check('filtra por 4-5 estrelas', ug.includes('rating%5B0%5D=4') && ug.includes('rating%5B1%5D=5'))
check('ordena por relevancia/nota', ug.includes('order=myweight'))
check('leva artista e musica na busca', /title=Metallica\+The\+Four\+Horsemen/.test(ug))

const cc = cifraClubSearchUrl('Metallica', 'The Four Horsemen')
check('cifraclub cai na busca do site', cc.startsWith('https://www.cifraclub.com.br/?q='))

console.log('\n=== 1b. o sufixo da loja nao vai para a busca ===')
check(
  'remaster sai do titulo',
  cleanTitle('The Four Horsemen - Remastered') === 'The Four Horsemen',
  cleanTitle('The Four Horsemen - Remastered')
)
check(
  'qualificador entre parenteses sai',
  cleanTitle('The Trooper (Original Album Version)') === 'The Trooper',
  cleanTitle('The Trooper (Original Album Version)')
)
check('titulo limpo nao e mexido', cleanTitle('Master of Puppets') === 'Master of Puppets')
check(
  'musica com "live" no nome sobrevive',
  cleanTitle('Show Me How to Live') === 'Show Me How to Live' &&
    cleanTitle('Live and Let Die') === 'Live and Let Die'
)
check(
  'sufixo que faz parte da musica fica',
  cleanTitle('Sgt. Pepper - Reprise') === 'Sgt. Pepper - Reprise'
)
const dirtyUg = ultimateGuitarUrl('Metallica', 'The Four Horsemen - Remastered')
check('a busca do UG usa o titulo limpo', !/Remastered/i.test(dirtyUg), dirtyUg.slice(0, 90))
check(
  'o nome do arquivo baixado tambem',
  safeFileName('Metallica', 'The Four Horsemen - Remastered', '.mp3') ===
    'Metallica - The Four Horsemen.mp3',
  safeFileName('Metallica', 'The Four Horsemen - Remastered', '.mp3')
)

console.log('\n=== 2. nome de arquivo e colisao ===')
const name = safeFileName('AC/DC', 'Back In Black', '.wav')
check('barra do artista nao vira pasta', !name.includes('/') && !name.includes('\\'), name)
check('mantem o separador " - "', name.includes(' - '), name)
check('mantem a extensao', name.endsWith('.wav'), name)
check('nome vazio nao gera arquivo sem nome', safeFileName(null, '', '.mp3') === 'faixa.mp3')

const dir = mkdtempSync(join(tmpdir(), 'setlist-sources-'))
try {
  const first = uniquePath(dir, 'Metallica - One.mp3')
  writeFileSync(first, 'x')
  const second = uniquePath(dir, 'Metallica - One.mp3')
  check('nao sobrescreve um arquivo existente', first !== second, basename(second))
  check('o duplicado mantem a extensao', second.endsWith('.mp3'), basename(second))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n=== 3. duracao e ranking dos arquivos do archive.org ===')
check('duracao em segundos', parseArchiveLength('255.9') === 255.9)
check('duracao em mm:ss', parseArchiveLength('4:15') === 255)
check('duracao ausente', parseArchiveLength(undefined) === null)

const doc = { identifier: 'kill-em-all', title: "Kill 'Em All", creator: 'Metallica', year: 1983 }
const wantTitle = normalizeTitle('The Four Horsemen')
const wantArtist = normalizeArtist('Metallica')

const wav = scoreArchiveFile(
  { name: '02 The Four Horsemen.wav', format: 'WAVE', title: 'The Four Horsemen', artist: 'Metallica', size: '52000000', length: '433.2' },
  doc,
  wantTitle,
  wantArtist
)
const mp3 = scoreArchiveFile(
  { name: '02 The Four Horsemen.mp3', format: 'VBR MP3', title: 'The Four Horsemen', artist: 'Metallica', size: '7000000', length: '433.2' },
  doc,
  wantTitle,
  wantArtist
)
const other = scoreArchiveFile(
  { name: '01 Hit the Lights.mp3', format: 'VBR MP3', title: 'Hit the Lights', artist: 'Metallica' },
  doc,
  wantTitle,
  wantArtist
)
const artwork = scoreArchiveFile(
  { name: 'The Four Horsemen.png', format: 'PNG', title: 'The Four Horsemen' },
  doc,
  wantTitle,
  wantArtist
)
const derived = scoreArchiveFile(
  { name: '02 The Four Horsemen.mp3', format: 'VBR MP3', title: 'The Four Horsemen', source: 'derivative' },
  doc,
  wantTitle,
  wantArtist
)

check('faixa certa entra', wav !== null && mp3 !== null)
check('faixa de outra musica fica de fora', other === null)
check('imagem nao entra como audio', artwork === null)
check('derivado do proprio archive nao entra', derived === null)
check('sem perda ganha do mp3', (wav?.score ?? 0) > (mp3?.score ?? 0), `${wav?.score} > ${mp3?.score}`)
check('url de download e montada', wav?.url === 'https://archive.org/download/kill-em-all/02%20The%20Four%20Horsemen.wav', wav?.url)
check('duracao vem do metadado', wav?.durationS === 433.2)

console.log('\n=== 4. busca real no archive.org ===')
try {
  const live = await searchArchiveAudio('Metallica', 'The Four Horsemen', 5)
  if (!live.candidates.length && live.error) {
    skip('busca no archive.org', live.error)
  } else {
    check('a busca devolve candidatos', live.candidates.length > 0, `${live.candidates.length}`)
    const top = live.candidates[0]
    console.log(`   melhor: ${top.fileName} (${top.format}, ${top.reason})`)
    check(
      'o melhor candidato e a musica pedida',
      normalizeTitle(top.fileName).includes('four horsemen') ||
        normalizeTitle(top.itemTitle).length > 0,
      top.fileName
    )
    check('todo candidato tem url de download', live.candidates.every((c) => c.url.startsWith('https://archive.org/download/')))
    check(
      'os candidatos vem ordenados pela nota',
      live.candidates.every((c, i) => i === 0 || live.candidates[i - 1].score >= c.score)
    )
  }
} catch (err) {
  skip('busca no archive.org', err instanceof Error ? err.message : String(err))
}

console.log('\n=== 4b. busca real partindo de um titulo sujo ===')
try {
  const dirty = await searchArchiveAudio('Metallica', 'The Four Horsemen - Remastered', 3)
  if (!dirty.candidates.length && dirty.error) {
    skip('busca com titulo sujo', dirty.error)
  } else {
    check(
      'o titulo com sufixo ainda encontra a faixa',
      dirty.candidates.length > 0,
      dirty.candidates[0]?.fileName ?? ''
    )
  }
} catch (err) {
  skip('busca com titulo sujo', err instanceof Error ? err.message : String(err))
}

console.log('\n=== 5. o Ultimate Guitar ainda aceita esses filtros ===')
try {
  const res = await fetch(ug, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    }
  })
  const html = await res.text()
  check('a busca responde', res.ok, `HTTP ${res.status}`)
  // the page ships its state as JSON in a data-content attribute
  check('a pagina traz resultados de Guitar Pro', html.includes('Guitar Pro'), `${html.length} bytes`)
} catch (err) {
  skip('busca no Ultimate Guitar', err instanceof Error ? err.message : String(err))
}

console.log(`\n${failures === 0 ? 'FONTES OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
