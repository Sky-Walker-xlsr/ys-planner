import 'server-only'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveActor, type Actor } from '@/lib/api'
import { createRequestClient } from '@/lib/supabase/server'
import { isRole } from '@/lib/api'
import type { Role } from '@/lib/types'

/** Aufrufer (User oder Gast via ?link=) plus Supabase-Client mit dessen JWT. */
export async function requestContext(req: NextRequest): Promise<{ actor: Actor; db: SupabaseClient } | null> {
  const actor = await resolveActor(req.nextUrl.searchParams.get('link'))
  if (!actor) return null
  return { actor, db: createRequestClient(actor.session) }
}

export async function plannerRole(db: SupabaseClient, plannerId: string): Promise<Role | null> {
  const { data, error } = await db.rpc('planner_role', { p: plannerId })
  if (error) throw error
  return isRole(data) ? data : null
}
