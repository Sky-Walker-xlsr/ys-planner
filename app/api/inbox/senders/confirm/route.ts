import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sha256Hex } from '@/lib/auth/crypto'
import { serverEnv } from '@/lib/env'

// Bestätigungslink aus der Mail: macht die Absender-Adresse aktiv.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const back = (state: string) => NextResponse.redirect(`${serverEnv.appUrl}/einstellungen?sender=${state}`)
  if (!token) return back('invalid')

  const db = createServiceClient()
  const { data: row } = await db
    .from('user_sender_emails')
    .select('id, token_expires_at')
    .eq('token_hash', await sha256Hex(token))
    .is('confirmed_at', null)
    .maybeSingle()
  if (!row || !row.token_expires_at || new Date(row.token_expires_at) < new Date()) return back('invalid')

  const { error } = await db
    .from('user_sender_emails')
    .update({ confirmed_at: new Date().toISOString(), token_hash: null, token_expires_at: null })
    .eq('id', row.id)
  // 23505: inzwischen von einem anderen Konto bestätigt
  return back(error ? (error.code === '23505' ? 'taken' : 'invalid') : 'confirmed')
}
