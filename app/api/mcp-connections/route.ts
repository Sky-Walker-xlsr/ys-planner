import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { getUserSession } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

// Eigene MCP-Verbindungen anzeigen und trennen. Die Tabelle ist nur per Service-Role erreichbar;
// jede Abfrage filtert deshalb auf den User aus der Session.
export async function GET() {
  const session = await getUserSession()
  if (!session) return jsonError('unauthorized', 401)
  const { data, error } = await createServiceClient()
    .from('mcp_tokens')
    .select('id, created_at, last_used_at, mcp_clients(client_name)')
    .eq('user_id', session.uid)
    .gt('refresh_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) return jsonError('Verbindungen konnten nicht geladen werden', 500)
  return NextResponse.json(
    (data ?? []).map((t) => ({
      id: t.id,
      created_at: t.created_at,
      last_used_at: t.last_used_at,
      client_name: (t.mcp_clients as unknown as { client_name: string } | null)?.client_name ?? 'Unbekannt',
    })),
  )
}

export async function DELETE(req: NextRequest) {
  const session = await getUserSession()
  if (!session) return jsonError('unauthorized', 401)
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return jsonError('id fehlt')
  const { data, error } = await createServiceClient().from('mcp_tokens').delete().eq('id', id).eq('user_id', session.uid).select('id')
  if (error || !data?.length) return jsonError('Verbindung nicht gefunden', 404)
  return NextResponse.json({ ok: true })
}
