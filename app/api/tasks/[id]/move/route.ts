import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { plannerRole, requestContext } from '@/lib/file-routes'
import { deleteKeys, filesBucket } from '@/lib/r2'

// Task in einen Planner verschieben (Rolle ≥ editor im Ziel, bei Planner-Tasks auch in der Quelle).
// Aus dem Eingang macht der DB-Trigger persönliche Tags zu Labels und stellt die Dateipfade auf tasks/… um;
// hier werden die Objekte in R2 nachgezogen. Zwischen Plannern bleibt der R2-Pfad gleich (public.move_task).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requestContext(req)
  if (!ctx || ctx.actor.id === null) return jsonError('unauthorized', 401)
  const { plannerId, bucketId } = (await req.json().catch(() => ({}))) as { plannerId?: string; bucketId?: string | null }
  if (!plannerId) return jsonError('Planner fehlt')

  const { data: task } = await ctx.db.from('tasks').select('id, planner_id').eq('id', id).maybeSingle()
  if (!task) return jsonError('Aufgabe nicht gefunden', 404)
  if (task.planner_id === plannerId) return jsonError('Aufgabe liegt bereits in diesem Planner', 409)

  const role = await plannerRole(ctx.db, plannerId)
  if (role !== 'owner' && role !== 'editor') return jsonError('Keine Bearbeitungsrechte in diesem Planner', 403)

  // Ohne Angabe: erster Bucket
  let bucket = bucketId ?? null
  if (!bucket) {
    const { data } = await ctx.db.from('buckets').select('id').eq('planner_id', plannerId).order('position').limit(1).maybeSingle()
    bucket = data?.id ?? null
  }
  if (!bucket) return jsonError('Der Planner hat keinen Bucket', 409)

  if (task.planner_id) {
    const { data, error } = await ctx.db.rpc('move_task', { t: id, p: plannerId, b: bucket })
    if (error) return jsonError('Verschieben nicht erlaubt', 403)
    const result = data as { removed_assignees: number; removed_attachments: number }
    return NextResponse.json({
      ok: true, plannerId, bucketId: bucket,
      removedAssignees: result.removed_assignees, removedAttachments: result.removed_attachments,
    })
  }

  const { data: before } = await ctx.db.from('task_files').select('id, storage_path').eq('task_id', id)
  const { data: moved, error } = await ctx.db
    .from('tasks')
    .update({ planner_id: plannerId, bucket_id: bucket })
    .eq('id', id)
    .select('id')
  if (error || !moved?.length) return jsonError('Verschieben nicht erlaubt', 403)

  // Objekte inbox/… → tasks/… (R2 kennt kein Umbenennen: kopieren, dann löschen)
  if (before?.length) {
    const { data: after } = await ctx.db.from('task_files').select('id, storage_path').eq('task_id', id)
    const target = new Map((after ?? []).map((f) => [f.id as string, f.storage_path as string]))
    const r2 = filesBucket()
    const old: string[] = []
    for (const f of before) {
      const to = target.get(f.id)
      if (!to || to === f.storage_path) continue
      const obj = await r2.get(f.storage_path)
      if (!obj) continue
      await r2.put(to, obj.body, { httpMetadata: obj.httpMetadata })
      old.push(f.storage_path)
    }
    await deleteKeys(old)
  }
  return NextResponse.json({ ok: true, plannerId, bucketId: bucket })
}
