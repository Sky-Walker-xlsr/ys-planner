import { NextResponse, type NextRequest } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { findLinkByToken } from '@/lib/share'
import { setGuestSession } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/crypto'
import { serverEnv } from '@/lib/env'

// Prüft Share-Link (+ Passwort/Name) und setzt die Gast-Session
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const name = String(form.get('name') ?? '').trim().slice(0, 60)
  const password = String(form.get('password') ?? '')
  const back = (error?: string) =>
    NextResponse.redirect(`${serverEnv.appUrl}/s/${encodeURIComponent(token)}${error ? `?error=${error}` : ''}`, 303)

  const check = await findLinkByToken(token)
  if (!check.ok) return back()
  const link = check.link

  if (link.require_name && !name) return back('name')
  if (link.password_hash) {
    // Passwort-Versuche pro IP und Link begrenzen
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const limiter = getCloudflareContext().env.SHARE_LIMITER as unknown as { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined
    if (limiter && !(await limiter.limit({ key: `${link.id}:${ip}` })).success) return back('rate')
    if (!(await verifyPassword(password, link.password_hash))) return back('password')
  }

  await setGuestSession({
    gid: crypto.randomUUID(),
    linkId: link.id,
    plannerId: link.planner_id,
    perm: link.permission,
    name: name || null,
  })
  return back()
}
