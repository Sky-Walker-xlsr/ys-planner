import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { requestContext } from '@/lib/file-routes'
import { moveTask } from '@/lib/task-move'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requestContext(req)
  if (!ctx || ctx.actor.id === null) return jsonError('unauthorized', 401)
  const { plannerId, bucketId } = (await req.json().catch(() => ({}))) as { plannerId?: string; bucketId?: string | null }
  if (!plannerId) return jsonError('Planner fehlt')

  const result = await moveTask(ctx.db, id, plannerId, bucketId ?? null)
  if (!result.ok) return jsonError(result.error, result.status)
  return NextResponse.json(result)
}
