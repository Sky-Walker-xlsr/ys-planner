import 'server-only'
import * as oauth from 'oauth4webapi'
import { serverEnv } from '@/lib/env'

let discovered: { issuer: string; as: oauth.AuthorizationServer } | null = null

export async function authorizationServer(): Promise<oauth.AuthorizationServer> {
  const issuer = serverEnv.zitadelIssuer
  if (discovered?.issuer === issuer) return discovered.as
  const url = new URL(issuer)
  const as = await oauth.processDiscoveryResponse(url, await oauth.discoveryRequest(url, { algorithm: 'oidc' }))
  discovered = { issuer, as }
  return as
}

export function oidcClient(): oauth.Client {
  return { client_id: serverEnv.zitadelClientId }
}

export function clientAuth(): oauth.ClientAuth {
  const secret = serverEnv.zitadelClientSecret
  return secret ? oauth.ClientSecretPost(secret) : oauth.None()
}

export function redirectUri() {
  return `${serverEnv.appUrl}/api/auth/callback`
}

export { oauth }
