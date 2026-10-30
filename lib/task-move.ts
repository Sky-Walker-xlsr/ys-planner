import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { plannerRole } from '@/lib/file-routes'
import { deleteKeys, filesBucket } from '@/lib/r2'

export type MoveResult =
  | { ok: true; plannerId: string; bucketId: string; removedAssignees?: number; removedAttachments?: number }
  | { ok: false; error: string; status: number }

/**
 * Task in einen Planner verschieben (Rolle ≥ editor im Ziel, bei Planner-Tasks auch in der Quelle).
 * Aus dem Eingang macht der DB-Trigger persönliche Tags zu Labels und stellt die Dateipfade auf tasks/… um;
 * hier werden die Objekte in R2 nachgezogen. Zwischen Plannern bleibt der R2-Pfad gleich (public.move_task).
 */
export async function moveTask(db: SupabaseClient, id: string, plannerId: string, bucketId: string | null): Promise<MoveResult> {
  const { data: task } = await db.from('tasks').select('id, planner_id').eq('id', id).maybeSingle()
  if (!task) return { ok: false, error: 'Aufgabe nicht gefunden', status: 404 }
  if (task.planner_id === plannerId) return { ok: false, error: 'Aufgabe liegt bereits in diesem Planner', status: 409 }

  const role = await plannerRole(db, plannerId)
  if (role !== 'owner' && role !== 'editor') return { ok: false, error: 'Keine Bearbeitungsrechte in diesem Planner', status: 403 }

  // Ohne Angabe: erster Bucket
  let bucket = bucketId
  if (!bucket) {
    const { data } = await db.from('buckets').select('id').eq('planner_id', plannerId).order('position').limit(1).maybeSingle()
    bucket = data?.id ?? null
  }
  if (!bucket) return { ok: false, error: 'Der Planner hat keinen Bucket', status: 409 }

  if (task.planner_id) {
    const { data, error } = await db.rpc('move_task', { t: id, p: plannerId, b: bucket })
    if (error) return { ok: false, error: 'Verschieben nicht erlaubt', status: 403 }
    const result = data as { removed_assignees: number; removed_attachments: number }
    return { ok: true, plannerId, bucketId: bucket, removedAssignees: result.removed_assignees, removedAttachments: result.removed_attachments }
  }

  const { data: before } = await db.from('task_files').select('id, storage_path').eq('task_id', id)
  const { data: moved, error } = await db
    .from('tasks')
    .update({ planner_id: plannerId, bucket_id: bucket })
    .eq('id', id)
    .select('id')
  if (error || !moved?.length) return { ok: false, error: 'Verschieben nicht erlaubt', status: 403 }

  // Objekte inbox/… → tasks/… (R2 kennt kein Umbenennen: kopieren, dann löschen)
  if (before?.length) {
    const { data: after } = await db.from('task_files').select('id, storage_path').eq('task_id', id)
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
  return { ok: true, plannerId, bucketId: bucket }
}
