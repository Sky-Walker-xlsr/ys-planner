import { NextResponse, type NextRequest } from 'next/server'
import { authorizationServer, clientAuth, oauth, oidcClient, redirectUri } from '@/lib/auth/oidc'
import { OIDC_COOKIE, setUserSession, verifyValue } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { AVATAR_COLORS } from '@/lib/design'
import { serverEnv } from '@/lib/env'

type OidcState = { codeVerifier: string; state: string; nonce: string; returnTo: string }

export async function GET(req: NextRequest) {
  const stored = await verifyValue<OidcState>(req.cookies.get(OIDC_COOKIE)?.value)
  if (!stored) return NextResponse.redirect(`${serverEnv.appUrl}/api/auth/login`)

  const as = await authorizationServer()
  const client = oidcClient()

  let claims: oauth.IDToken
  try {
    const params = oauth.validateAuthResponse(as, client, req.nextUrl.searchParams, stored.state)
    const response = await oauth.authorizationCodeGrantRequest(
      as, client, clientAuth(), params, redirectUri(), stored.codeVerifier,
    )
    const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
      expectedNonce: stored.nonce,
      requireIdToken: true,
    })
    claims = oauth.getValidatedIdTokenClaims(result)!
  } catch (err) {
    console.error('OIDC-Callback fehlgeschlagen', err)
    return new NextResponse('Anmeldung fehlgeschlagen. Bitte erneut versuchen.', { status: 400 })
  }

  const email = String(claims.email ?? '')
  const displayName =
    String(claims.name ?? '').trim() ||
    [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() ||
    String(claims.preferred_username ?? '') ||
    email

  const db = createServiceClient()
  const { data: user, error } = await db
    .from('users')
    .upsert(
      { zitadel_sub: claims.sub, email, display_name: displayName, avatar_color: avatarColor(claims.sub) },
      { onConflict: 'zitadel_sub' },
    )
    .select('id, email, display_name')
    .single()
  if (error || !user) {
    console.error('User-Upsert fehlgeschlagen', error)
    return new NextResponse('Benutzer konnte nicht angelegt werden.', { status: 500 })
  }

  await setUserSession({ uid: user.id, name: user.display_name, email: user.email })
  const res = NextResponse.redirect(`${serverEnv.appUrl}${stored.returnTo}`)
  res.cookies.delete(OIDC_COOKIE)
  return res
}

function avatarColor(seed: string) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
