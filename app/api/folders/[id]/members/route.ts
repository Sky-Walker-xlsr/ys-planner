import { NextResponse, after, type NextRequest } from 'next/server'
import { getUserSession } from '@/lib/auth/session'
import { createRequestClient } from '@/lib/supabase/server'
import { isRole, jsonError } from '@/lib/api'
import { notifyInvited } from '@/lib/notify'

// Mitglied zu einem Ordner einladen → Zugriff auf alle Planner darin. RLS prüft Ordner-Owner.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getUserSession()
  if (!session) return jsonError('unauthorized', 401)
  const { userId, role } = (await req.json()) as { userId?: string; role?: string }
  if (!userId || !isRole(role)) return jsonError('Ungültige Eingabe')

  const db = createRequestClient(session)
  const { error } = await db.from('folder_members').upsert({ folder_id: id, user_id: userId, role }, { onConflict: 'folder_id,user_id' })
  if (error) return jsonError('Einladung nicht erlaubt', 403)

  const { data: folder } = await db.from('folders').select('name').eq('id', id).single()
  after(() =>
    notifyInvited({ kind: 'folder', targetId: id, targetName: folder?.name ?? '', userId, role, inviterName: session.name }),
  )
  return NextResponse.json({ ok: true })
}
