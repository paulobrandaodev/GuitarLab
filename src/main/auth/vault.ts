import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { ENCRYPTION_UNAVAILABLE, secretBox } from '../secretbox'

/**
 * OAuth tokens are encrypted with Electron's safeStorage, which uses DPAPI on
 * Windows, so they are bound to the OS user account. Tokens never touch .env
 * and never leave the machine.
 *
 * Unlike API keys, these live in the database rather than in settings.json, and
 * that is on purpose: a token is derivable — one click on Connect mints a new
 * one — so losing it when the library is copied to another machine costs
 * nothing. A key the user pasted is not derivable, which is why it lives
 * elsewhere. See the note at the top of settings.ts.
 */

function encrypt(value: string): string {
  try {
    return secretBox.seal(value)
  } catch (err) {
    // Better to store nothing than to write a bearer token in cleartext.
    if (err instanceof Error && err.message === ENCRYPTION_UNAVAILABLE) {
      throw new Error('System encryption is unavailable; refusing to store the token in cleartext')
    }
    throw err
  }
}

function decrypt(value: string): string | null {
  return secretBox.open(value)
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
