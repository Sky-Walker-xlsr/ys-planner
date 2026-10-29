import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { canAccessFiles } from '@/lib/file-access'
import { plannerRole, requestContext } from '@/lib/file-routes'
import { deleteKeys, filesBucket, objectResponse } from '@/lib/r2'

type Params = { params: Promise<{ fileId: string }> }

async function load(req: NextRequest, fileId: string) {
  const ctx = await requestContext(req)
  if (!ctx) return { error: jsonError('unauthorized', 401) }
  // RLS: Planner-Dateien ab viewer, Inbox-Dateien nur für den Owner
  const { data: file } = await ctx.db
    .from('task_files')
    .select('id, task_id, planner_id, name, mime_type, storage_path')
    .eq('id', fileId)
    .maybeSingle()
  if (!file) return { error: jsonError('Datei nicht gefunden', 404) }
  // Alter Supabase-Pfad: scripts/migrate-storage-to-r2.mjs ist noch nicht gelaufen
  if (!/^(tasks|inbox)\//.test(file.storage_path)) return { error: jsonError('Speicher-Migration ausstehend', 503) }
  const role = file.planner_id ? await plannerRole(ctx.db, file.planner_id) : null
  // Ohne Planner ist die Zeile nur für den Owner sichtbar (RLS) – Sichtbarkeit genügt
  return { ...ctx, file, access: { plannerRole: role, inboxOwner: !file.planner_id } }
}

export async function GET(req: NextRequest, { params }: Params) {
  const r = await load(req, (await params).fileId)
  if ('error' in r) return r.error
  if (!canAccessFiles(r.access, 'read')) return jsonError('forbidden', 403)
  const obj = await filesBucket().get(r.file.storage_path)
  if (!obj) return jsonError('Datei nicht gefunden', 404)
  return objectResponse(obj, { name: r.file.name, mime: r.file.mime_type, download: req.nextUrl.searchParams.has('download') })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const r = await load(req, (await params).fileId)
  if ('error' in r) return r.error
  if (!canAccessFiles(r.access, 'write')) return jsonError('forbidden', 403)
  const { data, error } = await r.db.from('task_files').delete().eq('id', r.file.id).select('id')
  if (error || !data?.length) return jsonError('Löschen nicht erlaubt', 403)
  await deleteKeys([r.file.storage_path])
  return NextResponse.json({ ok: true })
}
