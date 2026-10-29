import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { requestContext } from '@/lib/file-routes'
import { serverEnv } from '@/lib/env'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Zufällige Adresse, z. B. k8f2qz7m (ohne leicht verwechselbare Zeichen) */
function randomLocal(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

// Aktuelle Mail-an-Planner-Adresse
export async function GET(req: NextRequest) {
  const ctx = await requestContext(req)
  if (!ctx || ctx.actor.id === null) return jsonError('unauthorized', 401)
  const { data } = await ctx.db.from('user_settings').select('inbox_local').eq('user_id', ctx.actor.id).maybeSingle()
  return NextResponse.json({ address: data?.inbox_local ? `${data.inbox_local}@${serverEnv.inboxDomain}` : null })
}

// Neue Mail-an-Planner-Adresse erzeugen; die alte ist sofort ungültig.
export async function POST(req: NextRequest) {
  const ctx = await requestContext(req)
  if (!ctx || ctx.actor.id === null) return jsonError('unauthorized', 401)
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = randomLocal()
    const { data, error } = await ctx.db
      .from('user_settings')
      .upsert({ user_id: ctx.actor.id, inbox_local: local })
      .select('inbox_local')
      .single()
    if (!error && data) return NextResponse.json({ address: `${data.inbox_local}@${serverEnv.inboxDomain}` })
    if (error?.code !== '23505') return jsonError('Adresse konnte nicht erzeugt werden', 500)
  }
  return jsonError('Adresse konnte nicht erzeugt werden', 500)
}
