import { NextResponse } from 'next/server'
import { authorizationServer, oidcClient } from '@/lib/auth/oidc'
import { clearUserSession } from '@/lib/auth/session'
import { serverEnv } from '@/lib/env'

export async function POST() {
  await clearUserSession()
  const as = await authorizationServer()
  if (!as.end_session_endpoint) return NextResponse.redirect(`${serverEnv.appUrl}/`, 303)
  const url = new URL(as.end_session_endpoint)
  url.searchParams.set('client_id', oidcClient().client_id)
  url.searchParams.set('post_logout_redirect_uri', `${serverEnv.appUrl}/`)
  return NextResponse.redirect(url, 303)
}
