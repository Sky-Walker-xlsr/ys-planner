import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { decrypt, sha256Hex } from '@/lib/auth/crypto'
import { serverEnv } from '@/lib/env'

export type ShareLinkRow = {
  id: string
  planner_id: string
  permission: 'read' | 'edit'
  require_name: boolean
  password_hash: string | null
  expires_at: string | null
  revoked_at: string | null
}

export type LinkCheck =
  | { ok: true; link: ShareLinkRow }
  | { ok: false; reason: 'not_found' | 'revoked' | 'expired' }

function check(link: ShareLinkRow | null): LinkCheck {
  if (!link) return { ok: false, reason: 'not_found' }
  if (link.revoked_at) return { ok: false, reason: 'revoked' }
  if (link.expires_at && new Date(link.expires_at) <= new Date()) return { ok: false, reason: 'expired' }
  return { ok: true, link }
}

const LINK_COLUMNS = 'id, planner_id, permission, require_name, password_hash, expires_at, revoked_at'

/** Prüft einen Share-Link anhand des Klartext-Tokens (Service-Role). */
export async function findLinkByToken(token: string): Promise<LinkCheck> {
  const { data } = await createServiceClient()
    .from('share_links')
    .select(LINK_COLUMNS)
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle<ShareLinkRow>()
  return check(data)
}

export async function findLinkById(id: string): Promise<LinkCheck> {
  const { data } = await createServiceClient()
    .from('share_links')
    .select(LINK_COLUMNS)
    .eq('id', id)
    .maybeSingle<ShareLinkRow>()
  return check(data)
}

export async function shareUrlFromCiphertext(ciphertext: string) {
  const token = await decrypt(ciphertext, serverEnv.shareLinkSecret)
  return `${serverEnv.appUrl}/s/${token}`
}
