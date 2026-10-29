import { NextResponse, after, type NextRequest } from 'next/server'
import { createRequestClient } from '@/lib/supabase/server'
import { jsonError, resolveActor } from '@/lib/api'
import { notifyAssigned } from '@/lib/notify'

// Zuweisen läuft über den Server, damit die Benachrichtigung sofort rausgeht. RLS prüft die Rechte.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, link } = (await req.json()) as { userId?: string; link?: string | null }
  const actor = await resolveActor(link)
  if (!actor) return jsonError('unauthorized', 401)
  if (!userId) return jsonError('Ungültige Eingabe')

  const db = createRequestClient(actor.session)
  const { data: task } = await db.from('tasks').select('planner_id').eq('id', id).maybeSingle()
  if (!task) return jsonError('Aufgabe nicht gefunden', 404)
  const { error } = await db.from('task_assignees').insert({ task_id: id, user_id: userId, planner_id: task.planner_id })
  if (error && error.code !== '23505') return jsonError('Zuweisen nicht erlaubt', 403)

  if (!error) after(() => notifyAssigned({ taskId: id, userId, actorId: actor.id, actorName: actor.name }))
  return NextResponse.json({ ok: true })
}
