import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { requestContext } from '@/lib/file-routes'
import { deleteKeys } from '@/lib/r2'

// Planner löschen inkl. aller Dateien (Knowledge Base und Task-Anhänge) in R2.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requestContext(req)
  if (!ctx) return jsonError('unauthorized', 401)

  const [kb, tf] = await Promise.all([
    ctx.db.from('kb_files').select('storage_path').eq('planner_id', id),
    ctx.db.from('task_files').select('storage_path').eq('planner_id', id),
  ])
  // RLS: nur Owner dürfen löschen
  const { data, error } = await ctx.db.from('planners').delete().eq('id', id).select('id')
  if (error || !data?.length) return jsonError('Löschen nicht erlaubt', 403)
  await deleteKeys([...(kb.data ?? []), ...(tf.data ?? [])].map((f) => f.storage_path))
  return NextResponse.json({ ok: true })
}
