import { safeStorage } from 'electron'

/**
 * The one place that encrypts a value at rest.
 *
 * Backed by Electron's `safeStorage`: DPAPI on Windows, Keychain on macOS,
 * libsecret/kwallet on Linux. The key never leaves the OS, so ciphertext is
 * bound to the machine *and* the OS user — copying an encrypted value to
 * another machine produces garbage, not an error. That is why secrets live in
 * a file next to the database rather than inside it: the database is the user's
 * library and is meant to be copied around.
 *
 * Two rules, both deliberate:
 *
 * - When the OS refuses to encrypt, we store nothing. Writing an API key or a
 *   bearer token in cleartext because the keyring is missing trades a visible
 *   failure for an invisible one.
 * - Reading a value that cannot be decrypted returns null rather than throwing.
 *   A key left by a previous OS user is a normal thing to find, not a crash.
 *
 * `createSecretBox` takes the backend as an argument so tests can exercise the
 * format without booting Electron — `safeStorage` only answers after `ready`.
 */

/** Marks the current storage format, so a future change can be detected. */
const PREFIX = 'v1:'

/** Thrown by `seal` when the OS will not encrypt. Callers match on this. */
export const ENCRYPTION_UNAVAILABLE = 'ENCRYPTION_UNAVAILABLE'

export interface CryptoBackend {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

export interface SecretBox {
  /** Whether the OS will encrypt for us right now. */
  available(): boolean
  /** Encrypt for storage. Throws ENCRYPTION_UNAVAILABLE when it cannot. */
  seal(value: string): string
  /** Decrypt a stored value, or null when it cannot be read. */
  open(stored: string): string | null
}

export function createSecretBox(backend: CryptoBackend): SecretBox {
  return {
    available(): boolean {
      try {
        return backend.isEncryptionAvailable()
      } catch {
        // Before `ready`, safeStorage throws rather than answering false.
        return false
      }
    },

    seal(value: string): string {
      if (!backend.isEncryptionAvailable()) throw new Error(ENCRYPTION_UNAVAILABLE)
      return PREFIX + backend.encryptString(value).toString('base64')
    },

    open(stored: string): string | null {
      if (!stored) return null
      // Values written before this module existed are bare base64 with no
      // prefix — still valid ciphertext, so read them as they are.
      const body = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length) : stored

      // Buffer.from skips characters that are not base64 rather than failing,
      // so a hand-edited or truncated value arrives here as an empty buffer.
      // Decrypting that does not throw on every platform — it can return an
      // empty string — and an empty secret would read as "set but blank".
      const bytes = Buffer.from(body, 'base64')
      if (!bytes.length) return null

      try {
        return backend.decryptString(bytes) || null
      } catch {
        return null
      }
    }
  }
}

export const secretBox: SecretBox = createSecretBox(safeStorage)

/**
 * Why encryption is unavailable, in words a user can act on. Only Linux has a
 * real story here; elsewhere a refusal means something larger is wrong.
 */
export function encryptionHint(): string {
  if (process.platform === 'linux') {
    return 'No system keyring was found. Install gnome-keyring or kwallet, or start the app from a desktop session.'
  }
  return 'The operating system refused to provide encryption.'
}
