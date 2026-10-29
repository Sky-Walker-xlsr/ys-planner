import { NextResponse, after, type NextRequest } from 'next/server'
import { createRequestClient } from '@/lib/supabase/server'
import { jsonError, resolveActor } from '@/lib/api'
import { notifyMentioned } from '@/lib/notify'

// Kommentar schreiben; Erwähnte werden sofort benachrichtigt. Autor setzt die DB aus dem JWT.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { body, mentions, link } = (await req.json()) as { body?: string; mentions?: string[]; link?: string | null }
  const actor = await resolveActor(link)
  if (!actor) return jsonError('unauthorized', 401)
  if (!body?.trim()) return jsonError('Kommentar ist leer')

  const db = createRequestClient(actor.session)
  const { data: task } = await db.from('tasks').select('planner_id').eq('id', id).maybeSingle()
  if (!task) return jsonError('Aufgabe nicht gefunden', 404)
  const { data, error } = await db
    .from('comments')
    .insert({ task_id: id, planner_id: task.planner_id, body: body.trim(), mentions: Array.isArray(mentions) ? mentions : [] })
    .select('id, mentions')
    .single()
  if (error || !data) return jsonError('Kommentieren nicht erlaubt', 403)

  if ((data.mentions as string[]).length) {
    after(() => notifyMentioned({ commentId: data.id, actorId: actor.id, actorName: actor.name }))
  }
  return NextResponse.json({ ok: true, id: data.id })
}
