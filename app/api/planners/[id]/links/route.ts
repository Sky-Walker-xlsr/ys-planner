import { NextResponse, type NextRequest } from 'next/server'
import { getUserSession } from '@/lib/auth/session'
import { createRequestClient, createServiceClient } from '@/lib/supabase/server'
import { encrypt, hashPassword, randomToken, sha256Hex } from '@/lib/auth/crypto'
import { jsonError } from '@/lib/api'
import { serverEnv } from '@/lib/env'
import { shareUrlFromCiphertext } from '@/lib/share'

async function requireOwner(plannerId: string) {
  const session = await getUserSession()
  if (!session) return null
  const db = createRequestClient(session)
  const { data: role } = await db.rpc('planner_role', { p: plannerId })
  return role === 'owner' ? { session, db } : null
}

// Aktive Links inkl. URL (Token wird serverseitig entschlüsselt)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOwner(id)
  if (!ctx) return jsonError('forbidden', 403)
  const { data, error } = await ctx.db
    .from('share_links')
    .select('id, token_ciphertext, permission, require_name, expires_at, revoked_at, created_at')
    .eq('planner_id', id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) return jsonError('Links konnten nicht geladen werden', 500)
  const { data: withPw } = await createServiceClient()
    .from('share_links')
    .select('id, password_hash')
    .eq('planner_id', id)
    .not('password_hash', 'is', null)
  const protectedIds = new Set((withPw ?? []).map((r) => r.id))

  const now = new Date()
  const links = await Promise.all(
    (data ?? [])
      .filter((l) => !l.expires_at || new Date(l.expires_at) > now)
      .map(async (l) => ({
        id: l.id,
        url: await shareUrlFromCiphertext(l.token_ciphertext),
        permission: l.permission,
        require_name: l.require_name,
        has_password: protectedIds.has(l.id),
        expires_at: l.expires_at,
        created_at: l.created_at,
      })),
  )
  return NextResponse.json({ links })
}

// Neuen Link erstellen (Passwort wird gehasht, Token verschlüsselt abgelegt)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOwner(id)
  if (!ctx) return jsonError('forbidden', 403)
  const body = (await req.json()) as {
    permission?: string
    requireName?: boolean
    password?: string | null
    expiresAt?: string | null
  }
  if (body.permission !== 'read' && body.permission !== 'edit') return jsonError('Ungültige Berechtigung')
  if (body.password != null && body.password.length < 8) return jsonError('Passwort zu kurz (mind. 8 Zeichen)')
  let expiresAt: string | null = null
  if (body.expiresAt) {
    // Datum (YYYY-MM-DD) gilt bis Ende des Tages
    const d = new Date(`${body.expiresAt}T23:59:59`)
    if (Number.isNaN(d.getTime()) || d <= new Date()) return jsonError('Ablaufdatum muss in der Zukunft liegen')
    expiresAt = d.toISOString()
  }

  const token = randomToken(24)
  const { data, error } = await createServiceClient()
    .from('share_links')
    .insert({
      planner_id: id,
      token_hash: await sha256Hex(token),
      token_ciphertext: await encrypt(token, serverEnv.shareLinkSecret),
      permission: body.permission,
      require_name: !!body.requireName,
      password_hash: body.password ? await hashPassword(body.password) : null,
      expires_at: expiresAt,
      created_by: ctx.session.uid,
    })
    .select('id')
    .single()
  if (error || !data) return jsonError('Link konnte nicht erstellt werden', 500)
  return NextResponse.json({ id: data.id, url: `${serverEnv.appUrl}/s/${token}` })
}
