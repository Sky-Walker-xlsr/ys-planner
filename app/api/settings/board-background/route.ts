import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { isWebp, MAX_UPLOAD_BYTES } from '@/lib/file-access'
import { requestContext } from '@/lib/file-routes'
import { filesBucket, objectResponse } from '@/lib/r2'

// Persönlicher Board-Hintergrund. Der Schlüssel kommt nur aus der Session: niemand erreicht fremde Bilder.
const key = (userId: string) => `backgrounds/${userId}.webp`

async function user(req: NextRequest) {
  const ctx = await requestContext(req)
  return ctx && ctx.actor.id !== null ? { db: ctx.db, id: ctx.actor.id } : null
}

export async function GET(req: NextRequest) {
  const me = await user(req)
  if (!me) return jsonError('unauthorized', 401)
  const obj = await filesBucket().get(key(me.id))
  if (!obj) return jsonError('Nicht gefunden', 404)
  return objectResponse(obj, { name: 'hintergrund.webp', mime: 'image/webp' })
}

// Multipart, Feld "file": kommt bereits als WebP (max. Full HD) vom Browser
export async function POST(req: NextRequest) {
  const me = await user(req)
  if (!me) return jsonError('unauthorized', 401)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return jsonError('Keine Datei')
  if (file.size > MAX_UPLOAD_BYTES) return jsonError('Datei ist grösser als 10 MB', 413)
  const content = await file.arrayBuffer()
  if (!isWebp(new Uint8Array(content))) return jsonError('Nur WebP-Bilder erlaubt', 415)

  await filesBucket().put(key(me.id), content, { httpMetadata: { contentType: 'image/webp' } })
  const at = new Date().toISOString()
  const { error } = await me.db.from('user_settings').update({ board_bg_image_at: at, board_bg_color: null }).eq('user_id', me.id)
  if (error) return jsonError('Hintergrund konnte nicht gespeichert werden', 500)
  return NextResponse.json({ board_bg_image_at: at })
}

export async function DELETE(req: NextRequest) {
  const me = await user(req)
  if (!me) return jsonError('unauthorized', 401)
  await filesBucket().delete(key(me.id))
  const { error } = await me.db.from('user_settings').update({ board_bg_image_at: null }).eq('user_id', me.id)
  if (error) return jsonError('Hintergrund konnte nicht entfernt werden', 500)
  return NextResponse.json({ ok: true })
}
