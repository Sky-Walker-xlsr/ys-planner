import { NextResponse, type NextRequest } from 'next/server'
import { getGuestSession, getUserSession } from '@/lib/auth/session'
import { mintGuestToken, mintUserToken } from '@/lib/auth/supabase-token'
import { findLinkById } from '@/lib/share'

// Liefert ein kurzlebiges Supabase-JWT für den Browser-Client.
// ?link=<share_link_id> → Gast-Token (Link wird bei jedem Refresh neu geprüft).
export async function GET(req: NextRequest) {
  const linkId = req.nextUrl.searchParams.get('link')
  const headers = { 'Cache-Control': 'no-store' }

  if (linkId) {
    const guest = await getGuestSession(linkId)
    if (!guest) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
    const link = await findLinkById(linkId)
    if (!link.ok || link.link.planner_id !== guest.plannerId) {
      return NextResponse.json({ error: link.ok ? 'invalid' : link.reason }, { status: 401, headers })
    }
    const { token, expiresAt } = await mintGuestToken({ ...guest, perm: link.link.permission })
    return NextResponse.json({ access_token: token, expires_at: expiresAt }, { headers })
  }

  const user = await getUserSession()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
  const { token, expiresAt } = await mintUserToken(user.uid)
  return NextResponse.json({ access_token: token, expires_at: expiresAt }, { headers })
}
