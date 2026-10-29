import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { canAccessFiles, MAX_KB_BYTES } from '@/lib/file-access'
import { plannerRole, requestContext } from '@/lib/file-routes'
import { deleteKeys, filesBucket, objectResponse } from '@/lib/r2'

type Params = { params: Promise<{ fileId: string }> }

async function load(req: NextRequest, fileId: string) {
  const ctx = await requestContext(req)
  if (!ctx) return { error: jsonError('unauthorized', 401) }
  // RLS: nur sichtbar ab Rolle viewer
  const { data: file } = await ctx.db.from('kb_files').select('id, planner_id, name, storage_path').eq('id', fileId).maybeSingle()
  if (!file) return { error: jsonError('Datei nicht gefunden', 404) }
  // Alter Supabase-Pfad: scripts/migrate-storage-to-r2.mjs ist noch nicht gelaufen
  if (!file.storage_path.startsWith('kb/')) return { error: jsonError('Speicher-Migration ausstehend', 503) }
  const role = await plannerRole(ctx.db, file.planner_id)
  return { ...ctx, file, role }
}

// Inhalt lesen (Editor, Vorschau, Download)
export async function GET(req: NextRequest, { params }: Params) {
  const r = await load(req, (await params).fileId)
  if ('error' in r) return r.error
  if (!canAccessFiles({ plannerRole: r.role }, 'read')) return jsonError('forbidden', 403)
  const obj = await filesBucket().get(r.file.storage_path)
  // Fehlt das Objekt (z. B. frisch angelegt oder Seed), gilt die Datei als leer
  if (!obj) return new Response('', { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
  return objectResponse(obj, { name: r.file.name, mime: 'text/markdown', download: req.nextUrl.searchParams.has('download') })
}

// Inhalt speichern (Upload, Autosave)
export async function PUT(req: NextRequest, { params }: Params) {
  const r = await load(req, (await params).fileId)
  if ('error' in r) return r.error
  if (!canAccessFiles({ plannerRole: r.role }, 'write')) return jsonError('forbidden', 403)
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim()
  if (type && type !== 'text/markdown' && type !== 'text/plain') return jsonError('Nur Markdown erlaubt', 415)
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_KB_BYTES) return jsonError('Datei ist grösser als 2 MB', 413)
  await filesBucket().put(r.file.storage_path, body, { httpMetadata: { contentType: 'text/markdown' } })
  // updated_at/updated_by setzt der Trigger
  const { data } = await r.db.from('kb_files').update({ name: r.file.name }).eq('id', r.file.id).select('updated_at').maybeSingle()
  return NextResponse.json({ ok: true, updated_at: data?.updated_at ?? null })
}

// Datei löschen (Zeile + Objekt; Task-Verknüpfungen fallen per Cascade weg)
export async function DELETE(req: NextRequest, { params }: Params) {
  const r = await load(req, (await params).fileId)
  if ('error' in r) return r.error
  if (!canAccessFiles({ plannerRole: r.role }, 'write')) return jsonError('forbidden', 403)
  const { data, error } = await r.db.from('kb_files').delete().eq('id', r.file.id).select('id')
  if (error || !data?.length) return jsonError('Löschen nicht erlaubt', 403)
  await deleteKeys([r.file.storage_path])
  return NextResponse.json({ ok: true })
}
