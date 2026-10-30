import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { randomToken, sha256Hex } from '@/lib/auth/crypto'
import { serverEnv } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/server'

export const mcpServerUrl = () => `${serverEnv.appUrl}/mcp`
export const MCP_SCOPE = 'planner'

const CODE_SECONDS = 300
const ACCESS_SECONDS = 3600
const REFRESH_SECONDS = 60 * 86400
const LAST_USED_RESOLUTION_MS = 5 * 60_000

export type McpClient = { client_id: string; client_name: string; redirect_uris: string[] }

export async function findClient(clientId: string | null | undefined): Promise<McpClient | null> {
  if (!clientId) return null
  const { data } = await createServiceClient()
    .from('mcp_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()
  return data as McpClient | null
}

export async function createAuthCode(opts: { clientId: string; userId: string; redirectUri: string; codeChallenge: string }) {
  const code = randomToken()
  const db = createServiceClient()
  await db.from('mcp_auth_codes').delete().lt('expires_at', new Date().toISOString())
  const { error } = await db.from('mcp_auth_codes').insert({
    code_hash: await sha256Hex(code),
    client_id: opts.clientId,
    user_id: opts.userId,
    redirect_uri: opts.redirectUri,
    code_challenge: opts.codeChallenge,
    expires_at: new Date(Date.now() + CODE_SECONDS * 1000).toISOString(),
  })
  if (error) throw error
  return code
}

/** Einmalig: Das Löschen entscheidet, wer den Code bekommt */
export async function consumeAuthCode(code: string) {
  const { data } = await createServiceClient()
    .from('mcp_auth_codes')
    .delete()
    .eq('code_hash', await sha256Hex(code))
    .select('client_id, user_id, redirect_uri, code_challenge, expires_at')
    .maybeSingle()
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null
  return data as { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: string }
}

async function newTokenFields() {
  const accessToken = `ysp_at_${randomToken()}`
  const refreshToken = `ysp_rt_${randomToken()}`
  const now = Date.now()
  return {
    response: { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: MCP_SCOPE },
    row: {
      access_hash: await sha256Hex(accessToken),
      access_expires_at: new Date(now + ACCESS_SECONDS * 1000).toISOString(),
      refresh_hash: await sha256Hex(refreshToken),
      refresh_expires_at: new Date(now + REFRESH_SECONDS * 1000).toISOString(),
    },
  }
}

export async function issueTokens(clientId: string, userId: string) {
  const { response, row } = await newTokenFields()
  const { error } = await createServiceClient().from('mcp_tokens').insert({ ...row, client_id: clientId, user_id: userId })
  if (error) throw error
  return response
}

/** Rotation: Der alte Refresh-Token gilt danach nicht mehr. null = ungültig oder abgelaufen. */
export async function refreshTokens(refreshToken: string, clientId: string) {
  const { response, row } = await newTokenFields()
  const { data } = await createServiceClient()
    .from('mcp_tokens')
    .update(row)
    .eq('refresh_hash', await sha256Hex(refreshToken))
    .eq('client_id', clientId)
    .gt('refresh_expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  return data ? response : null
}

export type McpUser = { id: string; name: string; email: string }

/** Prüft den Bearer-Token des MCP-Endpunkts */
export async function authenticateBearer(header: string | null): Promise<McpUser | null> {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1]
  if (!token) return null
  const db = createServiceClient()
  const { data } = await db
    .from('mcp_tokens')
    .select('id, last_used_at, users!inner(id, display_name, email)')
    .eq('access_hash', await sha256Hex(token))
    .gt('access_expires_at', new Date().toISOString())
    .maybeSingle()
  if (!data) return null
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > LAST_USED_RESOLUTION_MS) {
    await db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  }
  const user = data.users as unknown as { id: string; display_name: string; email: string }
  return { id: user.id, name: user.display_name, email: user.email }
}

/** Schutz der offenen Endpunkte (Registrierung, Token). Ohne Binding (lokal) kein Limit. */
export async function overRateLimit(ip: string | null) {
  const limiter = getCloudflareContext().env.OAUTH_LIMITER as unknown as { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined
  return !!limiter && !(await limiter.limit({ key: ip ?? 'unknown' })).success
}

export function oauthError(error: string, description?: string, status = 400) {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}
