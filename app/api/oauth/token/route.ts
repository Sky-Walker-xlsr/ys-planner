import type { NextRequest } from 'next/server'
import { consumeAuthCode, issueTokens, mcpServerUrl, oauthError, overRateLimit, refreshTokens } from '@/lib/mcp/oauth'
import { isValidCodeVerifier, isValidResource, pkceChallenge } from '@/lib/mcp/oauth-core'

export async function POST(req: NextRequest) {
  if (await overRateLimit(req.headers.get('cf-connecting-ip'))) return oauthError('temporarily_unavailable', 'Zu viele Anfragen', 429)
  const form = await req.formData().catch(() => null)
  const field = (k: string) => {
    const v = form?.get(k)
    return typeof v === 'string' ? v : null
  }
  const clientId = field('client_id')
  if (!clientId) return oauthError('invalid_client', 'client_id fehlt', 401)
  if (!isValidResource(field('resource'), mcpServerUrl())) return oauthError('invalid_target')

  const grant = field('grant_type')
  if (grant === 'authorization_code') {
    const code = field('code')
    const verifier = field('code_verifier')
    if (!code || !isValidCodeVerifier(verifier)) return oauthError('invalid_request', 'code und code_verifier nötig')
    const row = await consumeAuthCode(code)
    if (
      !row ||
      row.client_id !== clientId ||
      row.redirect_uri !== field('redirect_uri') ||
      row.code_challenge !== (await pkceChallenge(verifier))
    ) {
      return oauthError('invalid_grant')
    }
    return tokenResponse(await issueTokens(clientId, row.user_id))
  }

  if (grant === 'refresh_token') {
    const refresh = field('refresh_token')
    if (!refresh) return oauthError('invalid_request', 'refresh_token fehlt')
    const tokens = await refreshTokens(refresh, clientId)
    return tokens ? tokenResponse(tokens) : oauthError('invalid_grant')
  }

  return oauthError('unsupported_grant_type')
}

function tokenResponse(tokens: unknown) {
  return Response.json(tokens, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
}
