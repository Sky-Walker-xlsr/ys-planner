import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { canAccessFiles, MAX_UPLOAD_BYTES, normalizeMime, safeFileName } from '@/lib/file-access'
import { plannerRole, requestContext } from '@/lib/file-routes'
import { filesBucket } from '@/lib/r2'

// Datei an einen Task hochladen (multipart, Feld "file"). Bilder kommen bereits als WebP vom Browser.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requestContext(req)
  if (!ctx) return jsonError('unauthorized', 401)

  const { data: task } = await ctx.db.from('tasks').select('id, planner_id').eq('id', id).maybeSingle()
  if (!task) return jsonError('Aufgabe nicht gefunden', 404)
  const role = task.planner_id ? await plannerRole(ctx.db, task.planner_id) : null
  if (!canAccessFiles({ plannerRole: role, inboxOwner: !task.planner_id }, 'write')) return jsonError('forbidden', 403)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return jsonError('Keine Datei')
  if (file.size > MAX_UPLOAD_BYTES) return jsonError('Datei ist grösser als 10 MB', 413)
  const mime = normalizeMime(file.type)

  // Zeile zuerst (RLS prüft die Rolle nochmals); storage_path setzt der Trigger
  const { data: row, error } = await ctx.db
    .from('task_files')
    .insert({ task_id: id, planner_id: task.planner_id, name: safeFileName(file.name), mime_type: mime, size_bytes: file.size, storage_path: '' })
    .select('*')
    .single()
  if (error || !row) return jsonError('Hochladen nicht erlaubt', 403)

  try {
    await filesBucket().put(row.storage_path, file.stream(), { httpMetadata: { contentType: mime } })
  } catch (e) {
    console.error('R2-Upload fehlgeschlagen', e)
    await ctx.db.from('task_files').delete().eq('id', row.id)
    return jsonError('Hochladen fehlgeschlagen', 500)
  }
  return NextResponse.json(row)
}
