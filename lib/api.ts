import 'server-only'
import { NextResponse } from 'next/server'
import { getGuestSession, getUserSession, type GuestSession, type UserSession } from '@/lib/auth/session'
import { findLinkById } from '@/lib/share'

export type Actor =
  | { session: UserSession; id: string; name: string }
  | { session: GuestSession; id: null; name: string }

/** Ermittelt den Aufrufer: Gast (wenn link angegeben und gültig) oder eingeloggter User */
export async function resolveActor(linkId?: string | null): Promise<Actor | null> {
  if (linkId) {
    const guest = await getGuestSession(linkId)
    if (!guest) return null
    const link = await findLinkById(linkId)
    if (!link.ok || link.link.planner_id !== guest.plannerId) return null
    return { session: { ...guest, perm: link.link.permission }, id: null, name: guest.name || 'Gast' }
  }
  const user = await getUserSession()
  return user ? { session: user, id: user.uid, name: user.name } : null
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export const ROLES = ['owner', 'editor', 'viewer'] as const
export function isRole(v: unknown): v is (typeof ROLES)[number] {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
}
