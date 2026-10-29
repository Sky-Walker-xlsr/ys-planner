import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'
import { mintGuestToken, mintUserToken } from '@/lib/auth/supabase-token'
import type { GuestSession, UserSession } from '@/lib/auth/session'

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

/** Supabase-Client mit dem JWT des Users bzw. Gasts – RLS greift. */
export function createRequestClient(session: UserSession | GuestSession): SupabaseClient {
  let token: Promise<{ token: string; expiresAt: number }> | null = null
  return createClient(serverEnv.supabaseUrl, serverEnv.supabasePublishableKey, {
    auth: noSession,
    accessToken: async () => {
      token ??= session.kind === 'user' ? mintUserToken(session.uid) : mintGuestToken(session)
      return (await token).token
    },
  })
}

/** Service-Role-Client. Nur serverseitig (Login, Link-Prüfung, Mails, Cron). */
export function createServiceClient(): SupabaseClient {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, { auth: noSession })
}
