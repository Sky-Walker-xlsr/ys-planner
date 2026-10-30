import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { taskUrl } from '@/lib/notify'
import { sendMail } from '@/lib/mail'
import { serverEnv } from '@/lib/env'
import { safeEqual } from '@/lib/auth/crypto'

const MAX_PER_RUN = 100

type DueReminder = {
  task_id: string
  user_id: string
  title: string
  planner_id: string | null
  planner_name: string | null
  due_date: string | null
  email: string
}

// Alle 5 Minuten (Cron Trigger): verschickt fällige Erinnerungen aus dem Task-Popup.
export async function POST(req: NextRequest) {
  if (!(await safeEqual(req.headers.get('authorization') ?? '', `Bearer ${serverEnv.cronSecret}`))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const { data, error } = await db.rpc('claim_due_reminders', { max_rows: MAX_PER_RUN })
  if (error) {
    console.error('Erinnerungen konnten nicht geladen werden', error)
    return NextResponse.json({ error: 'claim failed' }, { status: 500 })
  }

  let sent = 0
  for (const r of (data ?? []) as DueReminder[]) {
    const href = r.planner_id ? taskUrl(r.planner_id, r.task_id) : `${serverEnv.appUrl}/eingang?task=${r.task_id}`
    const due = r.due_date ? `Fällig am ${r.due_date.split('-').reverse().join('.')}` : ''
    const ok = await sendMail(r.email, {
      subject: `Erinnerung: ${r.title}`,
      heading: 'Erinnerung an eine Aufgabe',
      paragraphs: ['Du wolltest an diese Aufgabe erinnert werden:'],
      items: [{ title: r.title, meta: [r.planner_name ?? 'Eingang', due].filter(Boolean).join(' · '), href }],
      cta: { label: 'Aufgabe öffnen', href },
      footer: 'Du erhältst diese Mail, weil du im Task eine Erinnerung gesetzt hast.',
    }).catch((e) => {
      console.error('Mailversand fehlgeschlagen', e)
      return false
    })
    if (ok) sent++
    // Nächster Lauf versucht es erneut
    else await db.from('task_reminders').update({ sent_at: null }).eq('task_id', r.task_id).eq('user_id', r.user_id)
  }
  return NextResponse.json({ claimed: data?.length ?? 0, sent })
}
