import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import { serverEnv } from '@/lib/env'

export const USER_COOKIE = 'ys_planner_session'
export const OIDC_COOKIE = 'ys_planner_oidc'
export const guestCookieName = (linkId: string) => `ys_planner_guest_${linkId}`

const USER_SESSION_DAYS = 14
const GUEST_SESSION_DAYS = 7

export type UserSession = { kind: 'user'; uid: string; name: string; email: string }
export type GuestSession = {
  kind: 'guest'
  gid: string
  linkId: string
  plannerId: string
  perm: 'read' | 'edit'
  name: string | null
}

function key() {
  return new TextEncoder().encode(serverEnv.sessionSecret)
}

export async function signValue(payload: Record<string, unknown>, maxAgeSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(key())
}

export async function verifyValue<T>(value: string | undefined): Promise<(T & { iat: number }) | null> {
  if (!value) return null
  try {
    const { payload } = await jwtVerify(value, key(), { algorithms: ['HS256'] })
    return payload as T & { iat: number }
  } catch {
    return null
  }
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
})

export async function setUserSession(session: Omit<UserSession, 'kind'>) {
  const maxAge = USER_SESSION_DAYS * 86400
  const jar = await cookies()
  jar.set(USER_COOKIE, await signValue({ ...session, kind: 'user' }, maxAge), cookieOptions(maxAge))
}

export async function getUserSession(): Promise<UserSession | null> {
  const jar = await cookies()
  const s = await verifyValue<UserSession>(jar.get(USER_COOKIE)?.value)
  return s?.kind === 'user' ? s : null
}

export async function requireUser(returnTo = '/'): Promise<UserSession> {
  const session = await getUserSession()
  if (!session) redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
  return session
}

export async function clearUserSession() {
  const jar = await cookies()
  jar.delete(USER_COOKIE)
}

export async function setGuestSession(session: Omit<GuestSession, 'kind'>) {
  const maxAge = GUEST_SESSION_DAYS * 86400
  const jar = await cookies()
  jar.set(guestCookieName(session.linkId), await signValue({ ...session, kind: 'guest' }, maxAge), cookieOptions(maxAge))
}

export async function getGuestSession(linkId: string): Promise<GuestSession | null> {
  const jar = await cookies()
  const s = await verifyValue<GuestSession>(jar.get(guestCookieName(linkId))?.value)
  return s?.kind === 'guest' && s.linkId === linkId ? s : null
}
