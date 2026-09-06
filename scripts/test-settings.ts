/**
 * Settings precedence, secret redaction and the IPC argument guards.
 *
 * Run with: npm run test:settings
 *
 * The rule under test is the four-layer precedence — environment > what the
 * user saved > .env > default — and one consequence of it that is easy to get
 * wrong: an empty value must *delete* the stored key so the layer underneath
 * reappears, rather than storing an empty string that shadows it forever.
 *
 * Everything here is pure. The parts that need real encryption or a real
 * filesystem live in test-secrets.mjs, which runs inside Electron.
 */
import {
  SETTING_SPECS,
  redactSecrets,
  resolveSetting,
  viewFor,
  type ResolveInputs
} from '../src/main/settings-core'
import {
  asEnum,
  asHttpUrl,
  asId,
  asPathUnder,
  asString,
  asStringRecord
} from '../src/main/ipc/guard'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

function throws(label: string, fn: () => unknown): void {
  try {
    fn()
    check(label, false, 'nao lancou')
  } catch {
    check(label, true)
  }
}

const inputs = (
  processEnv: Record<string, string | undefined> = {},
  stored: Record<string, string> = {},
  fileEnv: Record<string, string> = {}
): ResolveInputs => ({ processEnv, stored, fileEnv })

console.log('\n=== 1. a tabela de precedencia ===')

// Every combination of the four layers being present or absent, for one key.
const KEY = 'geminiApiKey'
const ENV = 'GEMINI_API_KEY'
const DEFAULT = ''

for (const hasEnv of [false, true]) {
  for (const hasUser of [false, true]) {
    for (const hasFile of [false, true]) {
      const r = resolveSetting(
        KEY,
        inputs(
          hasEnv ? { [ENV]: 'from-env' } : {},
          hasUser ? { [KEY]: 'from-user' } : {},
          hasFile ? { [ENV]: 'from-file' } : {}
        )
      )
      const expected = hasEnv
        ? { value: 'from-env', source: 'env' }
        : hasUser
          ? { value: 'from-user', source: 'user' }
          : hasFile
            ? { value: 'from-file', source: 'dotenv' }
            : { value: DEFAULT, source: 'default' }

      check(
        `env=${Number(hasEnv)} user=${Number(hasUser)} file=${Number(hasFile)}`,
        r.value === expected.value && r.source === expected.source,
        `${r.source}:${r.value || '(vazio)'}`
      )
    }
  }
}

console.log('\n=== 2. vazio significa "nao definido", em toda camada ===')
check(
  'env vazio nao ganha do usuario',
  resolveSetting(KEY, inputs({ [ENV]: '' }, { [KEY]: 'user' })).source === 'user'
)
check(
  'valor salvo vazio deixa o .env aparecer',
  resolveSetting(KEY, inputs({}, { [KEY]: '' }, { [ENV]: 'file' })).source === 'dotenv'
)
check(
  'tudo vazio cai no padrao',
  resolveSetting('geminiModel', inputs({}, { geminiModel: '' }, {})).source === 'default'
)

console.log('\n=== 3. nomes alternativos de variavel ===')
check(
  'OPEN_AI_API_KEY é aceito',
  resolveSetting('openaiApiKey', inputs({ OPEN_AI_API_KEY: 'a' })).value === 'a'
)
check(
  'OPENAI_API_KEY tambem',
  resolveSetting('openaiApiKey', inputs({ OPENAI_API_KEY: 'b' })).value === 'b'
)
check(
  'a grafia antiga tem prioridade, que é a que o .env do app usa',
  resolveSetting('openaiApiKey', inputs({ OPEN_AI_API_KEY: 'a', OPENAI_API_KEY: 'b' })).value === 'a'
)

console.log('\n=== 4. o segredo nunca atravessa a ponte ===')
for (const spec of SETTING_SPECS.filter((s) => s.secret)) {
  const view = viewFor(spec.key, inputs({}, { [spec.key]: 'super-secret-value' }))
  check(
    `${spec.key}: value vazio, present true`,
    view.value === '' && view.present === true,
    `value=${JSON.stringify(view.value)}`
  )
}
const plain = viewFor('geminiModel', inputs({}, { geminiModel: 'algum-modelo' }))
check('nao-segredo devolve o valor', plain.value === 'algum-modelo' && !plain.secret)

console.log('\n=== 5. redacao de segredos ===')
const secret = 'sk-abcdefghijklmnop'
check(
  'a chave some da mensagem',
  !redactSecrets(`falhou ao chamar https://api/x?key=${secret}`, [secret]).includes(secret)
)
check(
  'a mensagem em volta sobrevive',
  redactSecrets(`erro: ${secret} invalida`, [secret]) === 'erro: •••• invalida'
)
check(
  'valor curto demais é ignorado, senao vira ruido',
  redactSecrets('erro no modelo gpt', ['gpt']) === 'erro no modelo gpt'
)
check('varias ocorrencias', redactSecrets(`${secret} e ${secret}`, [secret]) === '•••• e ••••')

console.log('\n=== 6. o catalogo esta coerente ===')
const keys = SETTING_SPECS.map((s) => s.key)
check('sem chave repetida', new Set(keys).size === keys.length)
check(
  'toda chave tem ao menos uma variavel de ambiente',
  SETTING_SPECS.every((s) => s.envKeys.length > 0)
)
check(
  'nenhum segredo tem valor padrao',
  SETTING_SPECS.filter((s) => s.secret).every((s) => s.fallback === ''),
  'um padrao para um segredo seria uma credencial no codigo'
)

console.log('\n=== 7. guards de argumento ===')
check('asId aceita inteiro positivo', asId(7) === 7)
throws('asId recusa zero', () => asId(0))
throws('asId recusa negativo', () => asId(-1))
throws('asId recusa fracao', () => asId(1.5))
throws('asId recusa string', () => asId('1'))

throws('asString recusa numero', () => asString(1, 'x'))
throws('asString respeita o limite', () => asString('abcdef', 'x', 3))

check('asEnum aceita valor da lista', asEnum('gemini', 'p', ['gemini', 'openai']) === 'gemini')
throws('asEnum recusa fora da lista', () => asEnum('claude', 'p', ['gemini', 'openai']))

check('asHttpUrl aceita https', asHttpUrl('https://ffmpeg.org/').startsWith('https://'))
throws('asHttpUrl recusa file:', () => asHttpUrl('file:///etc/passwd'))
throws('asHttpUrl recusa esquema registrado', () => asHttpUrl('ms-settings:privacy'))
throws('asHttpUrl recusa texto solto', () => asHttpUrl('nao e url'))

const root = process.platform === 'win32' ? 'C:/lib/gptabs' : '/lib/gptabs'
check('asPathUnder aceita dentro da raiz', Boolean(asPathUnder(`${root}/a.gp5`, [root])))
throws('asPathUnder recusa fora', () => asPathUnder(`${root}/../secrets.txt`, [root]))
throws('asPathUnder nao confunde prefixo', () => asPathUnder(`${root}-backup/a.gp5`, [root]))

check('asStringRecord aceita objeto plano', asStringRecord({ a: 'b' }, 'x').a === 'b')
throws('asStringRecord recusa array', () => asStringRecord(['a'], 'x'))
throws('asStringRecord recusa valor nao-string', () => asStringRecord({ a: 1 }, 'x'))
throws('asStringRecord respeita o teto de chaves', () =>
  asStringRecord({ a: '1', b: '2', c: '3' }, 'x', 2)
)

console.log(`\n${failures === 0 ? 'AJUSTES OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
process.exit(failures === 0 ? 0 : 1)
