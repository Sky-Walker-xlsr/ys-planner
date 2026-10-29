import { NextResponse, after, type NextRequest } from 'next/server'
import { getUserSession } from '@/lib/auth/session'
import { createRequestClient } from '@/lib/supabase/server'
import { isRole, jsonError } from '@/lib/api'
import { notifyInvited } from '@/lib/notify'

// Mitglied zu einem Planner einladen (nur bestehende User). RLS prüft Owner-Rechte.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getUserSession()
  if (!session) return jsonError('unauthorized', 401)
  const { userId, role } = (await req.json()) as { userId?: string; role?: string }
  if (!userId || !isRole(role)) return jsonError('Ungültige Eingabe')

  const db = createRequestClient(session)
  const { error } = await db.from('planner_members').upsert({ planner_id: id, user_id: userId, role }, { onConflict: 'planner_id,user_id' })
  if (error) return jsonError('Einladung nicht erlaubt', 403)

  const { data: planner } = await db.from('planners').select('name').eq('id', id).single()
  after(() =>
    notifyInvited({ kind: 'planner', targetId: id, targetName: planner?.name ?? '', userId, role, inviterName: session.name }),
  )
  return NextResponse.json({ ok: true })
}
