import type { NextRequest } from 'next/server'
import { randomToken } from '@/lib/auth/crypto'
import { oauthError, overRateLimit } from '@/lib/mcp/oauth'
import { isValidRedirectUri } from '@/lib/mcp/oauth-core'
import { createServiceClient } from '@/lib/supabase/server'

// RFC 7591: Claude meldet sich hier selbst an. Das gibt noch keinen Zugriff, den erteilt erst die Einwilligung.
export async function POST(req: NextRequest) {
  if (await overRateLimit(req.headers.get('cf-connecting-ip'))) return oauthError('temporarily_unavailable', 'Zu viele Anfragen', 429)
  const body = (await req.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null
  const uris = body?.redirect_uris
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(isValidRedirectUri)) {
    return oauthError('invalid_redirect_uri', 'redirect_uris: nur https oder localhost')
  }
  const name = typeof body?.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : 'Unbenannter Client'
  const clientId = `ysp_${randomToken(16)}`
  const { error } = await createServiceClient().from('mcp_clients').insert({ client_id: clientId, client_name: name, redirect_uris: uris })
  if (error) {
    console.error('MCP-Client konnte nicht registriert werden', error)
    return oauthError('server_error', undefined, 500)
  }
  return Response.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
