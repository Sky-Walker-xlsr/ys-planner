import type { NextRequest } from 'next/server'
import { getUserSession, verifyValue } from '@/lib/auth/session'
import { serverEnv } from '@/lib/env'
import { createAuthCode, findClient, type McpClient } from '@/lib/mcp/oauth'

export type ConsentRequest = { uid: string; clientId: string; redirectUri: string; state: string | null; codeChallenge: string }

// Absenden der Einwilligung (app/oauth/authorize). Der signierte Auftrag ist an den eingeloggten User gebunden.
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== serverEnv.appUrl) return new Response('Forbidden', { status: 403 })
  const session = await getUserSession()
  const form = await req.formData().catch(() => null)
  const signed = form?.get('request')
  const consent = await verifyValue<ConsentRequest>(typeof signed === 'string' ? signed : undefined)
  if (!session || !consent || consent.uid !== session.uid) return new Response('Anfrage abgelaufen. Bitte erneut verbinden.', { status: 400 })

  const client: McpClient | null = await findClient(consent.clientId)
  if (!client?.redirect_uris.includes(consent.redirectUri)) return new Response('Unbekannter Client', { status: 400 })

  const target = new URL(consent.redirectUri)
  if (consent.state) target.searchParams.set('state', consent.state)
  target.searchParams.set('iss', serverEnv.appUrl)
  if (form?.get('decision') === 'approve') {
    target.searchParams.set('code', await createAuthCode({
      clientId: client.client_id,
      userId: session.uid,
      redirectUri: consent.redirectUri,
      codeChallenge: consent.codeChallenge,
    }))
  } else {
    target.searchParams.set('error', 'access_denied')
  }
  return Response.redirect(target.toString(), 303)
}
