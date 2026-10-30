import { NextResponse, after, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { requestContext } from '@/lib/file-routes'
import { createServiceClient } from '@/lib/supabase/server'
import { randomToken, sha256Hex } from '@/lib/auth/crypto'
import { serverEnv } from '@/lib/env'
import { sendMail } from '@/lib/mail'

const TOKEN_HOURS = 24
const MAX_MAILS_PER_DAY = 10

// Zusätzliche Absender-Adresse hinterlegen. Aktiv erst nach Klick auf den Bestätigungslink.
export async function POST(req: NextRequest) {
  const ctx = await requestContext(req)
  if (!ctx || ctx.actor.id === null) return jsonError('unauthorized', 401)
  const { email: input } = (await req.json().catch(() => ({}))) as { email?: string }
  const email = input?.trim().toLowerCase() ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return jsonError('Ungültige Mail-Adresse')
  if ('email' in ctx.actor.session && ctx.actor.session.email?.toLowerCase() === email) {
    return jsonError('Deine Login-Adresse ist bereits erlaubt')
  }

  const token = randomToken()
  const db = createServiceClient()
  const { data: taken } = await db.from('user_sender_emails').select('user_id').eq('email', email).not('confirmed_at', 'is', null).maybeSingle()
  if (taken && taken.user_id !== ctx.actor.id) return jsonError('Diese Adresse ist bereits einem anderen Konto zugeordnet', 409)
  if (taken) return jsonError('Diese Adresse ist bereits bestätigt', 409)

  // Schutz vor Missbrauch als Mail-Versender
  const { data: allowed, error: limitError } = await db.rpc('mail_rate_hit', { u: ctx.actor.id, max_per_day: MAX_MAILS_PER_DAY })
  if (limitError) return jsonError('Adresse konnte nicht gespeichert werden', 500)
  if (!allowed) return jsonError('Zu viele Bestätigungsmails heute. Bitte morgen erneut versuchen.', 429)

  const { error } = await db.from('user_sender_emails').upsert(
    {
      user_id: ctx.actor.id,
      email,
      token_hash: await sha256Hex(token),
      token_expires_at: new Date(Date.now() + TOKEN_HOURS * 3600_000).toISOString(),
      confirmed_at: null,
    },
    { onConflict: 'user_id,email' },
  )
  if (error) return jsonError('Adresse konnte nicht gespeichert werden', 500)

  const link = `${serverEnv.appUrl}/api/inbox/senders/confirm?token=${encodeURIComponent(token)}`
  after(() =>
    sendMail(email, {
      subject: 'Absender-Adresse für ys-planner bestätigen',
      heading: 'Adresse bestätigen',
      paragraphs: [
        `Ein ys-planner-Konto möchte Aufgaben auch von ${email} per Mail erstellen.`,
        `Bestätige die Adresse innerhalb von ${TOKEN_HOURS} Stunden. Wenn du das nicht warst, ignoriere diese Mail.`,
      ],
      cta: { label: 'Adresse bestätigen', href: link },
      footer: 'Du erhältst diese Mail, weil diese Adresse in ys-planner hinterlegt wurde.',
    }),
  )
  return NextResponse.json({ ok: true })
}
