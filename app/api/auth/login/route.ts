import { NextResponse, type NextRequest } from 'next/server'
import { authorizationServer, oauth, oidcClient, redirectUri } from '@/lib/auth/oidc'
import { OIDC_COOKIE, cookieOptions, signValue } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'))
  const as = await authorizationServer()

  const codeVerifier = oauth.generateRandomCodeVerifier()
  const state = oauth.generateRandomState()
  const nonce = oauth.generateRandomNonce()

  const url = new URL(as.authorization_endpoint!)
  url.searchParams.set('client_id', oidcClient().client_id)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)

  const res = NextResponse.redirect(url)
  res.cookies.set(OIDC_COOKIE, await signValue({ codeVerifier, state, nonce, returnTo }, 600), cookieOptions(600))
  return res
}

function safeReturnTo(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}
