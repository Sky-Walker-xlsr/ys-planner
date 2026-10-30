import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { taskUrl } from '@/lib/notify'
import { sendMail } from '@/lib/mail'
import { serverEnv } from '@/lib/env'
import { safeEqual } from '@/lib/auth/crypto'

const MAX_TASKS_PER_RUN = 100

type DueReminder = {
  task_id: string
  title: string
  planner_id: string | null
  planner_name: string | null
  due_date: string | null
  email: string
}

// Alle 5 Minuten (Cron Trigger): Erinnerung aus dem Task-Popup an alle Zugewiesenen.
export async function POST(req: NextRequest) {
  if (!(await safeEqual(req.headers.get('authorization') ?? '', `Bearer ${serverEnv.cronSecret}`))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const { data, error } = await db.rpc('claim_due_task_reminders', { max_rows: MAX_TASKS_PER_RUN })
  if (error) {
    console.error('Erinnerungen konnten nicht geladen werden', error)
    return NextResponse.json({ error: 'claim failed' }, { status: 500 })
  }

  const perTask = new Map<string, DueReminder[]>()
  for (const r of (data ?? []) as DueReminder[]) perTask.set(r.task_id, [...(perTask.get(r.task_id) ?? []), r])

  let sent = 0
  for (const [taskId, rows] of perTask) {
    const results = await Promise.all(rows.map((r) => sendReminder(r)))
    const ok = results.filter(Boolean).length
    sent += ok
    // Nur wenn niemand die Mail erhalten hat: Sonst bekämen sie die anderen im nächsten Lauf doppelt
    if (ok === 0) await db.from('tasks').update({ reminder_sent_at: null }).eq('id', taskId)
  }
  return NextResponse.json({ tasks: perTask.size, sent })
}

function sendReminder(r: DueReminder) {
  const href = r.planner_id ? taskUrl(r.planner_id, r.task_id) : `${serverEnv.appUrl}/eingang?task=${r.task_id}`
  const due = r.due_date ? `Fällig am ${r.due_date.split('-').reverse().join('.')}` : ''
  return sendMail(r.email, {
    subject: `Erinnerung: ${r.title}`,
    heading: 'Erinnerung an eine Aufgabe',
    paragraphs: ['Für diese Aufgabe wurde eine Erinnerung gesetzt:'],
    items: [{ title: r.title, meta: [r.planner_name ?? 'Eingang', due].filter(Boolean).join(' · '), href }],
    cta: { label: 'Aufgabe öffnen', href },
    footer: r.planner_id
      ? 'Du erhältst diese Mail, weil dir diese Aufgabe zugewiesen ist.'
      : 'Du erhältst diese Mail, weil du in deinem Eingang eine Erinnerung gesetzt hast.',
  }).catch((e) => {
    console.error('Mailversand fehlgeschlagen', e)
    return false
  })
}
