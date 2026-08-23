import { safeStorage } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client'

/**
 * OAuth tokens are encrypted with Electron's safeStorage, which uses DPAPI on
 * Windows, so they are bound to the OS user account. Tokens never touch .env
 * and never leave the machine.
 */

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Better to store nothing than to write a bearer token in cleartext.
    throw new Error('Criptografia do sistema indisponível — não vou gravar o token em texto puro')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

export interface StoredToken {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string | null
}

export function saveToken(provider: string, token: StoredToken): void {
  const db = getDb()
  const values = {
    provider,
    accessTokenEnc: encrypt(token.accessToken),
    refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : null,
    expiresAt: token.expiresAt,
    scopes: token.scopes,
    updatedAt: Math.floor(Date.now() / 1000)
  }
  const existing = db
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.provider, provider))
    .get()
  if (existing) {
    db.update(schema.oauthTokens)
      .set(values)
      .where(eq(schema.oauthTokens.provider, provider))
      .run()
  } else {
    db.insert(schema.oauthTokens).values(values).run()
  }
}

export function loadToken(provider: string): StoredToken | null {
  const row = getDb()
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.provider, provider))
    .get()
  if (!row) return null
  const accessToken = decrypt(row.accessTokenEnc)
  if (!accessToken) return null
  return {
    accessToken,
    refreshToken: row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : null,
    expiresAt: row.expiresAt,
    scopes: row.scopes
  }
}

export function clearToken(provider: string): void {
  getDb().delete(schema.oauthTokens).where(eq(schema.oauthTokens.provider, provider)).run()
}

export function hasToken(provider: string): boolean {
  return loadToken(provider) !== null
}
