import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { requestContext } from '@/lib/file-routes'
import { deleteKeys } from '@/lib/r2'

// Task löschen inkl. seiner Dateien in R2 (die DB-Zeilen fallen per Cascade weg).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requestContext(req)
  if (!ctx) return jsonError('unauthorized', 401)

  const { data: files } = await ctx.db.from('task_files').select('storage_path').eq('task_id', id)
  // RLS entscheidet über das Löschen (ab editor bzw. Owner des Inbox-Tasks)
  const { data, error } = await ctx.db.from('tasks').delete().eq('id', id).select('id')
  if (error || !data?.length) return jsonError('Löschen nicht erlaubt', 403)
  await deleteKeys((files ?? []).map((f) => f.storage_path))
  return NextResponse.json({ ok: true })
}
