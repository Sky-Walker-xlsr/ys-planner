import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { recipients, taskUrl } from '@/lib/notify'
import { sendMail } from '@/lib/mail'
import { serverEnv } from '@/lib/env'
import { addDays, toISODate } from '@/lib/dates'

const TZ = 'Europe/Zurich'

type TaskRow = {
  id: string
  title: string
  status: string
  planner_id: string
  planners: { name: string } | null
  task_assignees: { user_id: string }[]
}

type SectionRow = {
  id: string
  title: string
  tasks: TaskRow | null
  section_items: { done: boolean }[]
}

// Täglich 07:00 Europe/Zurich (Cron Trigger läuft um 05:00 und 06:00 UTC; hier wird die lokale Stunde geprüft).
// Bündelt pro User alle Aufgaben und Abschnitte, die morgen fällig sind.
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()))
  if (!force && hour !== 7) return NextResponse.json({ skipped: true, hour })

  const tomorrow = addDays(toISODate(new Date(), TZ), 1)
  const db = createServiceClient()

  const [{ data: tasks }, { data: sections }] = await Promise.all([
    db
      .from('tasks')
      .select('id, title, status, planner_id, planners(name), task_assignees(user_id)')
      .eq('due_date', tomorrow)
      .neq('status', 'done'),
    db
      .from('task_sections')
      .select('id, title, tasks!inner(id, title, status, planner_id, planners(name), task_assignees(user_id)), section_items(done)')
      .eq('due_date', tomorrow)
      .neq('tasks.status', 'done'),
  ])

  type Item = { title: string; meta: string; href: string }
  const perUser = new Map<string, Item[]>()
  const add = (userIds: string[], item: Item) => {
    for (const id of userIds) {
      if (!perUser.has(id)) perUser.set(id, [])
      perUser.get(id)!.push(item)
    }
  }

  for (const t of (tasks ?? []) as unknown as TaskRow[]) {
    add(t.task_assignees.map((a) => a.user_id), {
      title: t.title,
      meta: `Aufgabe · ${t.planners?.name ?? ''}`,
      href: taskUrl(t.planner_id, t.id),
    })
  }
  for (const s of (sections ?? []) as unknown as SectionRow[]) {
    const t = s.tasks
    if (!t) continue
    const items = s.section_items
    if (items.length > 0 && items.every((i) => i.done)) continue
    add(t.task_assignees.map((a) => a.user_id), {
      title: `${s.title} (${t.title})`,
      meta: `Abschnitt · ${t.planners?.name ?? ''}`,
      href: taskUrl(t.planner_id, t.id),
    })
  }

  const to = await recipients([...perUser.keys()], 'notify_on_due')
  const dateText = tomorrow.split('-').reverse().join('.')
  let sent = 0
  for (const [userId, email] of to) {
    const items = perUser.get(userId)!
    await sendMail(email, {
      subject: items.length === 1 ? `Morgen fällig: ${items[0].title}` : `Morgen fällig: ${items.length} Einträge`,
      heading: `Morgen fällig (${dateText})`,
      paragraphs: ['Diese Aufgaben und Abschnitte sind dir zugewiesen und morgen fällig:'],
      items,
      cta: { label: 'Meine Aufgaben öffnen', href: `${serverEnv.appUrl}/meine-aufgaben` },
    })
    sent++
  }

  return NextResponse.json({ date: tomorrow, users: perUser.size, sent })
}
