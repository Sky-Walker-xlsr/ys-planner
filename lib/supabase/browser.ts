'use client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type TokenState = { token: string; expiresAt: number }

const clients = new Map<string, SupabaseClient>()

/**
 * Browser-Client. scope = 'user' oder die Share-Link-ID eines Gasts.
 * Das Supabase-JWT wird von /api/token geholt und kurz vor Ablauf erneuert.
 */
export function getBrowserClient(scope: string = 'user'): SupabaseClient {
  const existing = clients.get(scope)
  if (existing) return existing

  let state: TokenState | null = null
  let inflight: Promise<TokenState> | null = null

  async function fetchToken(): Promise<TokenState> {
    const url = scope === 'user' ? '/api/token' : `/api/token?link=${encodeURIComponent(scope)}`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 401) {
      window.location.href =
        scope === 'user'
          ? `/api/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`
          : location.pathname
      throw new Error('Nicht angemeldet')
    }
    if (!res.ok) throw new Error('Token konnte nicht geladen werden')
    const json = (await res.json()) as { access_token: string; expires_at: number }
    return { token: json.access_token, expiresAt: json.expires_at }
  }

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (state && state.expiresAt - now > 90) return state.token
    inflight ??= fetchToken().finally(() => {
      inflight = null
    })
    state = await inflight
    return state.token
  }

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken,
  })

  // Realtime braucht ein gültiges Token auch ohne laufende Requests: regelmässig erneuern
  setInterval(async () => {
    try {
      client.realtime.setAuth(await accessToken())
    } catch {
      /* nächster Versuch */
    }
  }, 60_000)

  clients.set(scope, client)
  return client
}
