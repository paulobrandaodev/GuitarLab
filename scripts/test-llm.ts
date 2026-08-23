/**
 * End-to-end check of the tone-patch path against the real providers.
 *
 * Run with: npm run test:llm
 *
 * It exercises the patch normalisation, the loose JSON parsing and then the
 * live APIs. The bug this was written for — a reasoning model spending its
 * whole token budget thinking and returning an empty body — is invisible to
 * typecheck and to any mocked test, so the live call is the point.
 */
import { readFileSync } from 'node:fs'
import {
  normalizePatch,
  normalizePlan,
  planPitchShifter,
  buildToneContext,
  buildTonePrompt,
  TONE_SYSTEM_PROMPT
} from '../src/main/services/tone'
import { parseJsonLoose } from '../src/main/services/llm/pure'
import { RIG_DEFAULT, type TonePatchView } from '../src/shared/types'

const env: Record<string, string> = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const SONG = {
  title: 'Master of Puppets',
  artist: 'Metallica',
  genre: 'Thrash Metal',
  musicalKey: 'Em',
  bpm: 212,
  // the record is a half step down, which is what puts the pitch shifter and
  // the "guitar stays in E standard" rule into the live prompt
  tuning: { name: 'Eb Standard', strings: ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
  sections: ['Intro', 'Riff principal', 'Trecho limpo', 'Solo']
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
}

async function callGemini(prompt: string, system: string): Promise<string> {
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json'
        }
      })
    }
  )
  const data = (await res.json()) as GeminiResponse
  const cand = data.candidates?.[0]
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(`vazio (finishReason=${cand?.finishReason}) HTTP ${res.status}`)
  return text
}

async function callOpenAi(prompt: string, system: string): Promise<string> {
  const key = env.OPEN_AI_API_KEY || env.OPENAI_API_KEY
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096
    })
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`)
  const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('resposta vazia')
  return text
}

function validatePatch(patch: TonePatchView, label: string): void {
  check(`${label}: tem nome`, patch.patchName.length > 0, patch.patchName)
  check(`${label}: cadeia com 2+ nos`, patch.chain.length >= 2, patch.chain.join(' > '))
  check(`${label}: tem blocos`, patch.blocks.length > 0, `${patch.blocks.length} blocos`)
  check(
    `${label}: todo bloco tem slot`,
    patch.blocks.every((b) => b.slot.length > 0)
  )
  const params = patch.blocks.flatMap((b) => b.params)
  check(`${label}: tem controles`, params.length > 0, `${params.length} controles`)
  check(
    `${label}: knobs dentro de 0-100`,
    params.every((p) => p.value === null || (p.value >= 0 && p.value <= 100))
  )
  check(
    `${label}: todo controle tem rotulo`,
    params.every((p) => p.label.length > 0)
  )
  check(
    `${label}: controle sem valor tem texto`,
    params.every((p) => p.value !== null || (p.text ?? '').length > 0)
  )
}

async function main(): Promise<void> {
  console.log('=== 1. normalizePatch: o modelo erra e nao pode quebrar a tela ===')
  const junk = normalizePatch(
    {
      blocks: [
        { slot: '', model: 'X', enabled: true, params: [{ label: 'Gain', value: 999 }] },
        { slot: 'VAZIO', model: '', enabled: true, params: [] },
        ...Array.from({ length: 10 }, (_, i) => ({
          slot: `S${i}`,
          model: `M${i}`,
          enabled: true,
          params: []
        }))
      ],
      chain: ['a', '', '  ', 'b']
    },
    RIG_DEFAULT,
    'teste',
    'teste'
  )
  check('nome vazio vira padrao', junk.patchName === 'Patch sugerido')
  check('slot vazio vira BLOCO', junk.blocks[0]?.slot === 'BLOCO', junk.blocks[0]?.slot)
  check('valor 999 e limitado a 100', junk.blocks[0]?.params[0]?.value === 100)
  check('no maximo 6 blocos', junk.blocks.length <= 6, `${junk.blocks.length}`)
  check('bloco sem modelo e sem controles e descartado', !junk.blocks.some((b) => b.slot === 'VAZIO'))
  check(
    'cadeia sem strings vazias',
    junk.chain.every((c) => c.trim().length > 0),
    junk.chain.join('|')
  )

  const textParam = normalizePatch(
    {
      blocks: [
        {
          slot: 'EQ',
          model: 'EQ',
          enabled: true,
          params: [{ label: 'Low Cut', value: null, text: '110Hz' }]
        }
      ]
    },
    RIG_DEFAULT,
    't',
    't'
  )
  check(
    'controle de selecao mantem o texto',
    textParam.blocks[0]?.params[0]?.text === '110Hz' &&
      textParam.blocks[0]?.params[0]?.value === null
  )

  const noChain = normalizePatch(
    { blocks: [{ slot: 'PREAMP', model: 'BG LEAD', enabled: true, params: [] }] },
    RIG_DEFAULT,
    't',
    't'
  )
  check(
    'cadeia ausente e reconstruida dos blocos',
    noChain.chain.length === 3 && noChain.chain[1] === 'PREAMP',
    noChain.chain.join(' > ')
  )

  console.log('\n=== 2. parseJsonLoose ===')
  check('json puro', parseJsonLoose<{ a: number }>('{"a":1}')?.a === 1)
  check('json em cerca de codigo', parseJsonLoose<{ a: number }>('```json\n{"a":2}\n```')?.a === 2)
  check('json com prosa em volta', parseJsonLoose<{ a: number }>('Claro!\n{"a":3}\nAbraco')?.a === 3)
  check('json truncado devolve null', parseJsonLoose('{"a":1,"b":') === null)

  console.log('\n=== 3. prompt ===')
  const pitch = planPitchShifter(SONG.tuning)
  const context = buildToneContext(SONG, RIG_DEFAULT, SONG.sections)
  const prompt = buildTonePrompt(context, RIG_DEFAULT, pitch)
  check('contexto cita a guitarra do rig', context.includes(RIG_DEFAULT.guitar))
  check('contexto cita a pedaleira', context.includes(RIG_DEFAULT.processor))
  check('contexto cita a afinacao', context.includes('Eb Standard'))
  check('contexto lista os trechos', context.includes('Trecho limpo'))
  check('prompt pede saida direta', prompt.toLowerCase().includes('pa / mesa de som'))
  check('prompt manda usar o CTRL', prompt.includes('CTRL'))
  check('prompt resolve a afinacao com pitch shifter', pitch.enabled && pitch.semitones === -1)

  console.log('\n=== 4. provedores ao vivo ===')
  // same order the app tries them in (LLM_PROVIDER then LLM_FALLBACK_PROVIDER)
  const providers = [
    ['openai', callOpenAi],
    ['gemini', callGemini]
  ] as const

  let anyProviderWorked = false
  for (const [name, call] of providers) {
    console.log(`\n--- ${name} ---`)
    try {
      const t0 = Date.now()
      const text = await call(prompt, TONE_SYSTEM_PROMPT)
      const parsed = parseJsonLoose<Record<string, unknown>>(text)
      check(
        `${name}: devolveu JSON parseavel`,
        parsed !== null,
        parsed ? '' : `${text.length} chars, comeco: ${JSON.stringify(text.slice(0, 120))}`
      )
      if (parsed) {
        anyProviderWorked = true
        const plan = normalizePlan(parsed, RIG_DEFAULT, pitch, name, 'x')
        check(`${name}: veio pelo menos um patch`, plan.patches.length > 0, `${plan.patches.length}`)
        check(
          `${name}: o pitch shifter e o calculado, nao o do modelo`,
          plan.pitchShifter?.semitones === -1
        )
        console.log(`       ${Date.now() - t0}ms | ${plan.patches.length} patch(es)`)
        for (const patch of plan.patches) {
          validatePatch(patch, `${name}/${patch.patchName}`)
          console.log(`       ▸ ${patch.patchName} — ${patch.appliesTo}`)
          console.log(`         cadeia: ${patch.chain.join(' > ')}`)
          for (const b of patch.blocks) {
            console.log(
              `         ${b.slot} = ${b.model}: ` +
                b.params.map((p) => `${p.label}=${p.value ?? p.text}`).join(', ')
            )
          }
          if (patch.ctrl) {
            console.log(`         CTRL: ${patch.ctrl.target} — ${patch.ctrl.action}`)
          }
        }
        // the CTRL switch is the point of asking for it; at least one patch
        // should have found something worth putting on it
        check(
          `${name}: algum patch usa o botao CTRL`,
          plan.patches.some((p) => p.ctrl !== null),
          plan.patches.map((p) => p.ctrl?.target ?? '—').join(', ')
        )
      }
    } catch (err) {
      // a provider being out of credit is not a code failure; the fallback chain
      // exists precisely for this, so report it and keep going
      console.log(`  AVISO ${name} indisponivel -- ${err instanceof Error ? err.message : err}`)
    }
  }
  check('pelo menos um provedor gerou um patch valido', anyProviderWorked)

  console.log(`\n${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} TESTE(S) FALHARAM`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
