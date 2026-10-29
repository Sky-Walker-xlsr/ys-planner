import 'server-only'
import { SignJWT, importJWK, type JWK } from 'jose'
import { serverEnv } from '@/lib/env'
import type { GuestSession } from './session'

// Supabase-kompatible Access Tokens, signiert mit dem in Supabase importierten
// ES256-Signing-Key (siehe README › Supabase JWT Signing Key).
export const TOKEN_TTL_SECONDS = 10 * 60

let cached: { raw: string; key: CryptoKey; kid: string } | null = null

async function signingKey() {
  const raw = serverEnv.supabaseJwtPrivateKey
  if (cached?.raw === raw) return cached
  const jwk = JSON.parse(raw) as JWK
  if (!jwk.kid) throw new Error('SUPABASE_JWT_PRIVATE_KEY braucht eine kid')
  // key_ops ["sign","verify"] (Format von Supabase) lehnt WebCrypto für private Schlüssel ab
  const { key_ops: _ops, use: _use, ext: _ext, ...signingJwk } = jwk
  const key = (await importJWK(signingJwk, 'ES256')) as CryptoKey
  cached = { raw, key, kid: jwk.kid }
  return cached
}

async function mint(sub: string, extra: Record<string, unknown> = {}) {
  const { key, kid } = await signingKey()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + TOKEN_TTL_SECONDS
  const token = await new SignJWT({ role: 'authenticated', ...extra })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setIssuer(`${serverEnv.supabaseUrl}/auth/v1`)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)
  return { token, expiresAt: exp }
}

export function mintUserToken(uid: string) {
  return mint(uid)
}

export function mintGuestToken(g: GuestSession) {
  return mint(g.gid, {
    share_link_id: g.linkId,
    planner_id: g.plannerId,
    share_permission: g.perm,
    ...(g.name ? { guest_name: g.name } : {}),
  })
}
