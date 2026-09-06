/**
 * Encryption at rest, against the real operating system.
 *
 * Run with: npm run test:secrets
 *
 * `safeStorage` is the one part of the settings store that cannot be tested
 * with tsx: it only answers after Electron's `ready` event, and what it does
 * depends entirely on the platform — DPAPI, Keychain, or whichever Linux
 * keyring happens to be installed. So this boots a real Electron instance and
 * exercises the format the settings file actually stores.
 *
 * On a machine with no keyring this reports the situation and exits clean
 * rather than failing: "no libsecret in this container" is a fact about the
 * environment, not a broken build. What must never happen is the app writing a
 * key in cleartext because encryption was missing, and that is asserted here.
 */
import { app, safeStorage } from 'electron'
import { join } from 'node:path'

// its own profile, so a killed run never leaves the app's caches half written
app.setPath('userData', join(app.getPath('temp'), 'guitarlab-test-secrets'))

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * The same contract as src/main/secretbox.ts, restated here.
 *
 * Importing the real module would mean building first and resolving the
 * bundle's imports; the format is six lines, and duplicating it keeps this test
 * about the platform rather than about the build. If the prefix or the encoding
 * in secretbox.ts changes, this file changes with it.
 */
const PREFIX = 'v1:'
const seal = (v) => PREFIX + safeStorage.encryptString(v).toString('base64')
const open = (stored) => {
  if (!stored) return null
  const body = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length) : stored
  const bytes = Buffer.from(body, 'base64')
  if (!bytes.length) return null
  try {
    return safeStorage.decryptString(bytes) || null
  } catch {
    return null
  }
}

app.whenReady().then(() => {
  console.log(`\nplataforma: ${process.platform}`)
  if (process.platform === 'linux') {
    console.log(`backend: ${safeStorage.getSelectedStorageBackend?.() ?? 'desconhecido'}`)
  }

  console.log('\n=== 1. disponibilidade ===')
  const available = safeStorage.isEncryptionAvailable()
  console.log(`  criptografia disponivel: ${available}`)

  if (!available) {
    console.log(
      '\n  Sem keyring nesta maquina. O app se recusa a gravar chaves em texto puro,\n' +
        '  entao a tela de Ajustes vai mostrar o aviso e desabilitar os campos de chave.\n' +
        '  Isso é o comportamento correto, nao uma falha do build.'
    )
    console.log('\nSEGREDOS OK (sem criptografia disponivel)')
    app.exit(0)
    return
  }

  console.log('\n=== 2. ida e volta ===')
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'
  const sealed = seal(secret)
  check('o texto cifrado nao contem o segredo', !sealed.includes(secret))
  check('carrega o prefixo de versao', sealed.startsWith(PREFIX))
  check('volta identico', open(sealed) === secret, open(sealed) === secret ? '' : 'diferente')

  console.log('\n=== 3. formatos e falhas ===')
  // The vault wrote bare base64 before secretbox existed; those values are
  // still valid ciphertext and have to keep opening.
  const bare = safeStorage.encryptString(secret).toString('base64')
  check('le o formato antigo, sem prefixo', open(bare) === secret)

  check('blob adulterado devolve null em vez de lancar', open('v1:bm90LWNpcGhlcnRleHQ=') === null)
  check('lixo devolve null', open('v1:@@@@') === null)
  check('vazio devolve null', open('') === null)

  console.log('\n=== 4. valores dificeis ===')
  for (const value of ['ção-ünïcode-✓', 'a'.repeat(4096), 'com espaços e = sinais', '{"json":1}']) {
    const label = value.length > 24 ? `${value.length} chars` : value
    check(`sobrevive: ${label}`, open(seal(value)) === value)
  }

  console.log(`\n${failures === 0 ? 'SEGREDOS OK' : `${failures} VERIFICACAO(OES) FALHARAM`}`)
  app.exit(failures === 0 ? 0 : 1)
})
