/**
 * End-to-end verification against the user's real files.
 * Runs under Electron (needs `app`), does the full import, prints what happened,
 * then exits. Not part of the shipped app.
 */
import { app } from 'electron'
import { initDb, getSqlite } from '../src/main/db/client'
import { importGuitarProDir, importAudioDir } from '../src/main/importers/library'
import { parseGuitarProFile } from '../src/main/importers/guitarpro'
import { ffmpegVersion, probeAudio } from '../src/main/media/ffmpeg'
import { listSongs, listSections, listMedia, getDailyQueue, statsOverview } from '../src/main/db/repo'
import { classifyVideo } from '../src/main/services/youtube'
import { findBest } from '../src/main/services/lrclib'
import { llmStatus, complete } from '../src/main/services/llm'
import { labHealth } from '../src/main/services/lab'
import { config } from '../src/main/config'
import type { ImportReport } from '../src/shared/types'

const line = (s = ''): void => console.log(s)
const h1 = (s: string): void => {
  line()
  line(`${'='.repeat(72)}`)
  line(`  ${s}`)
  line(`${'='.repeat(72)}`)
}
const h2 = (s: string): void => {
  line()
  line(`── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`)
}

function reportLines(r: ImportReport, label: string): void {
  line(
    `${label}: ${r.scanned} lidos · ${r.created} criados · ${r.matched} casados · ` +
      `${r.skipped} pulados · ${r.errors.length} erros`
  )
  for (const d of r.details) {
    line(`   [${d.action}] ${d.file.split(/[\\/]/).pop()}`)
    if (d.songTitle) line(`        → "${d.songTitle}" (id ${d.songId})`)
    if (d.note) line(`        ${d.note}`)
  }
  for (const e of r.errors) line(`   ERRO ${e.file}: ${e.message}`)
}

async function main(): Promise<void> {
  h1('SETLIST LAB — VERIFICAÇÃO PONTA A PONTA')

  h2('Ambiente')
  line(`FFmpeg: ${(await ffmpegVersion()) ?? 'NÃO ENCONTRADO'}`)
  line(`Banco:  ${config.paths.db}`)
  line(`gptabs: ${config.paths.gptabs}`)
  line(`songs:  ${config.paths.songs}`)

  // start from a clean database so the run is reproducible
  const sqlite0 = (initDb(), getSqlite())
  sqlite0.exec(`
    DELETE FROM media_assets; DELETE FROM song_sections; DELETE FROM charts;
    DELETE FROM progress; DELETE FROM setlist_items; DELETE FROM songs;
    DELETE FROM artists; DELETE FROM youtube_refs; DELETE FROM analysis_jobs;
    DELETE FROM tunings WHERE is_builtin = 0;
  `)
  line('banco limpo para o teste')

  /* ---------------------------------------------------------- gp parsing */

  h2('1. Parse direto dos arquivos Guitar Pro')
  const gpFiles = [
    'foo-fighters-all-my-life.gp3',
    'queens-of-the-stone-age-no-one-knows.gp4',
    'master_of_puppets_metallica_gp_v2.gp'
  ]
  for (const f of gpFiles) {
    try {
      const p = parseGuitarProFile(`${config.paths.gptabs}/${f}`)
      const inst = p.tracks
        .map((t) => `${t.name}=${t.instrument ?? 'ignorada'}`)
        .join(', ')
      line(`✔ ${f}`)
      line(`    "${p.title}" — ${p.artist} | ${p.tempo} bpm | ${p.timeSignature} | tom=${p.musicalKey ?? 'não declarado'}`)
      line(`    ${p.barCount} compassos, ${p.tracks.length} trilhas, ${p.sections.length} seções`)
      line(`    trilhas: ${inst}`)
      const tuned = p.tracks.find((t) => t.tuning.length)
      if (tuned) line(`    afinação: ${tuned.tuning.join(' ')} (${tuned.stringCount} cordas)`)
      if (p.lyrics) line(`    letra embutida: ${p.lyrics.length} caracteres — "${p.lyrics.slice(0, 60)}…"`)
      if (p.chordSymbols.length) {
        line(`    acordes: ${p.chordSymbols.length} — ${p.chordSymbols.slice(0, 8).map((c) => c.name).join(' ')}`)
      }
      if (p.sections.length) {
        line(`    seções: ${p.sections.slice(0, 6).map((s) => s.name).join(' | ')}${p.sections.length > 6 ? ' …' : ''}`)
      }
    } catch (err) {
      line(`✘ ${f}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /* -------------------------------------------------------- audio probe */

  h2('2. Leitura de tags dos áudios')
  for (const f of ['02.-Master Of Puppets.wav', '02 The Trooper (Original Album Version).mp3']) {
    try {
      const p = await probeAudio(`${config.paths.songs}/${f}`)
      line(`✔ ${f}`)
      line(`    ${p.codec} ${p.sampleRate}Hz ${p.channels}ch ${p.bitrateKbps ?? '—'}kbps ${(p.durationMs / 60000).toFixed(2)}min`)
      line(`    tags: artist="${p.tags.artist}" title="${p.tags.title}" album="${p.tags.album}" year=${p.tags.date}`)
    } catch (err) {
      line(`✘ ${f}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /* ------------------------------------------------------------ imports */

  h2('3. Importação Guitar Pro')
  reportLines(await importGuitarProDir(), 'GP')

  h2('4. Importação de áudio (com loudness e forma de onda)')
  reportLines(await importAudioDir(), 'Áudio')

  /* -------------------------------------------------------- golden test */

  h2('5. TESTE DE OURO — Master of Puppets casou tab + áudio?')
  const songs = listSongs()
  line(`total de músicas no banco: ${songs.length}`)
  line()
  for (const s of songs) {
    const media = listMedia(s.id)
    const kinds = media.map((m) => m.kind).join(', ')
    const secs = listSections(s.id)
    line(`• "${s.title}" — ${s.artist ?? 'sem artista'}`)
    line(`    tom=${s.musicalKey ?? '—'}(${s.keySource ?? '—'})  bpm=${s.bpm ?? '—'}(${s.bpmSource ?? '—'})  compasso=${s.timeSignature ?? '—'}`)
    line(`    afinação=${s.tuning?.name ?? '—'} ${s.tuning ? `[${s.tuning.strings.join(' ')}]` : ''}`)
    line(`    duração=${s.durationMs ? (s.durationMs / 60000).toFixed(2) + 'min' : '—'}  loudness=${s.loudnessLufs?.toFixed(1) ?? '—'} LUFS`)
    line(`    arquivos: ${kinds || 'nenhum'}`)
    line(`    seções: ${secs.length}  |  GP=${s.hasGuitarPro} áudio=${s.hasAudio} stems=${s.hasStems}`)
  }

  const mop = songs.find((s) => /master of puppets/i.test(s.title))
  line()
  if (mop && mop.hasGuitarPro && mop.hasAudio) {
    line(`✔✔ TESTE DE OURO PASSOU — "${mop.title}" é UMA música com tab GP7/8 E áudio WAV casados`)
    line(`    BPM declarado pelo Guitar Pro: ${mop.bpm} (fonte: ${mop.bpmSource})`)
    line(`    Tom declarado pelo Guitar Pro: ${mop.musicalKey} (fonte: ${mop.keySource})`)
    line(`    → quando o Laboratório rodar, comparamos a detecção do áudio contra estes valores`)
  } else if (mop) {
    line(`✘ TESTE DE OURO FALHOU — GP=${mop.hasGuitarPro} áudio=${mop.hasAudio} (deviam ser ambos true)`)
  } else {
    line('✘ Master of Puppets não encontrado')
  }

  const trooper = songs.find((s) => /trooper/i.test(s.title))
  if (trooper) {
    line(
      trooper.hasAudio && !trooper.hasGuitarPro
        ? `✔ Caminho sem tab OK — "${trooper.title}" existe só com áudio, como esperado`
        : `? "${trooper.title}" GP=${trooper.hasGuitarPro} áudio=${trooper.hasAudio}`
    )
  }

  /* ------------------------------------------------- youtube classifier */

  h2('6. Classificador de vídeos do YouTube (offline, sem gastar cota)')
  const samples: Array<[string, string]> = [
    ['Metallica - Master Of Puppets (Guitar Lesson WITH TABS)', 'GuitarLessons365'],
    ['Master of Puppets - Backing Track (No Guitar)', 'Karaoke Backing Tracks'],
    ['Metallica - Master of Puppets - Isolated Guitar Track', 'IsolatedTracks'],
    ['Metallica - Master Of Puppets (Official Music Video)', 'Metallica'],
    ['Master of Puppets Bass Only', 'BassCoversHD'],
    ['Como tocar Master of Puppets - aula de guitarra', 'Cifra Club']
  ]
  for (const [title, channel] of samples) {
    const c = classifyVideo(title, channel)
    line(`   ${c.role.padEnd(14)} ${String(Math.round(c.confidence * 100)).padStart(3)}%${c.ambiguous ? ' (ambíguo)' : '        '} — ${title.slice(0, 52)}`)
  }

  /* --------------------------------------------------------- integrações */

  h2('7. Integrações externas')
  line('IA — chamada real para exercitar a cadeia Gemini → Ollama:')
  try {
    const started = Date.now()
    const res = await complete([
      { role: 'system', content: 'Responda em uma linha, em português.' },
      { role: 'user', content: 'Em que tom está Master of Puppets do Metallica?' }
    ])
    line(`   ✔ respondeu via ${res.provider} (${res.model}) em ${((Date.now() - started) / 1000).toFixed(1)}s`)
    line(`     "${res.text.trim().slice(0, 140).replace(/\s+/g, ' ')}"`)
  } catch (err) {
    line(`   ✘ ${err instanceof Error ? err.message : String(err)}`)
  }
  const llm = await llmStatus()
  line(`   status: ${llm.detail}`)

  const lab = await labHealth()
  line(`Laboratório: ${lab.detail} (${config.lab.url})`)

  line('LRCLIB (letra sincronizada, sem chave):')
  try {
    const lrc = await findBest('Metallica', 'Master of Puppets', 'Master of Puppets', 515000)
    if (lrc) {
      line(`   ✔ achou "${lrc.trackName}" — ${lrc.artistName}`)
      line(`     sincronizada=${Boolean(lrc.syncedLyrics)} simples=${Boolean(lrc.plainLyrics)}`)
      if (lrc.syncedLyrics) {
        line(`     primeiras linhas: ${lrc.syncedLyrics.split('\n').slice(0, 2).join(' / ')}`)
      }
    } else {
      line('   — nada encontrado')
    }
  } catch (err) {
    line(`   ✘ ${err instanceof Error ? err.message : String(err)}`)
  }

  /* -------------------------------------------------------------- queue */

  h2('8. Fila de estudo e estatísticas')
  const queue = getDailyQueue(30)
  line(`fila para 30 min: ${queue.length} itens`)
  for (const q of queue.slice(0, 8)) {
    line(`   ${String(q.priority).padStart(3)}pts · ${q.estimatedMinutes}min · ${q.songTitle}${q.sectionName ? ` [${q.sectionName}]` : ''} (${q.instrument}) — ${q.reason}`)
  }
  const stats = statsOverview()
  line(`totais: ${JSON.stringify(stats.totals)}`)

  h1('FIM DA VERIFICAÇÃO')
  app.exit(0)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('FALHA NA VERIFICAÇÃO:', err)
    app.exit(1)
  })
})
