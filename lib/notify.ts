import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { sendMail } from '@/lib/mail'
import { serverEnv } from '@/lib/env'
import { ROLE_LABEL, type Role, type UserSettings } from '@/lib/types'

type SettingFlag = 'notify_on_assign' | 'notify_on_due' | 'notify_on_mention' | 'notify_on_invite'

/** E-Mail-Adressen der User, die für dieses Ereignis Benachrichtigungen wollen */
export async function recipients(userIds: string[], flag: SettingFlag): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!userIds.length) return out
  const { data } = await createServiceClient()
    .from('user_settings')
    .select('user_id, notify_enabled, notify_email, notify_on_assign, notify_on_due, notify_on_mention, notify_on_invite')
    .in('user_id', userIds)
  for (const s of (data ?? []) as UserSettings[]) {
    if (s.notify_enabled && s[flag] && s.notify_email) out.set(s.user_id, s.notify_email)
  }
  return out
}

/** Mails laufen nach der Antwort weiter (Cloudflare: ctx.waitUntil via after()) */
export function taskUrl(plannerId: string, taskId: string) {
  return `${serverEnv.appUrl}/p/${plannerId}?task=${taskId}`
}

export async function notifyAssigned(opts: { taskId: string; userId: string; actorId: string | null; actorName: string }) {
  if (opts.userId === opts.actorId) return
  const db = createServiceClient()
  const { data: task } = await db.from('tasks').select('id, title, due_date, planner_id, planners(name)').eq('id', opts.taskId).single()
  if (!task) return
  const to = (await recipients([opts.userId], 'notify_on_assign')).get(opts.userId)
  if (!to) return
  const plannerName = (task.planners as unknown as { name: string } | null)?.name ?? ''
  await sendMail(to, {
    subject: `Dir wurde «${task.title}» zugewiesen`,
    heading: 'Neue Aufgabe zugewiesen',
    paragraphs: [`${opts.actorName} hat dir eine Aufgabe im Planner «${plannerName}» zugewiesen.`],
    items: [{ title: task.title, meta: task.due_date ? `Fällig am ${task.due_date.split('-').reverse().join('.')}` : undefined }],
    cta: { label: 'Aufgabe öffnen', href: taskUrl(task.planner_id, task.id) },
  })
}

export async function notifyMentioned(opts: { commentId: string; actorId: string | null; actorName: string }) {
  const db = createServiceClient()
  const { data: comment } = await db
    .from('comments')
    .select('id, body, mentions, task_id, planner_id, tasks(title)')
    .eq('id', opts.commentId)
    .single()
  if (!comment) return
  const ids = (comment.mentions as string[]).filter((id) => id !== opts.actorId)
  const to = await recipients(ids, 'notify_on_mention')
  const title = (comment.tasks as unknown as { title: string } | null)?.title ?? ''
  await Promise.all(
    [...to.values()].map((email) =>
      sendMail(email, {
        subject: `${opts.actorName} hat dich in «${title}» erwähnt`,
        heading: 'Du wurdest erwähnt',
        paragraphs: [`${opts.actorName} hat dich in einem Kommentar zur Aufgabe «${title}» erwähnt:`, comment.body],
        cta: { label: 'Kommentar ansehen', href: taskUrl(comment.planner_id, comment.task_id) },
      }),
    ),
  )
}

export async function notifyInvited(opts: {
  kind: 'planner' | 'folder'
  targetId: string
  targetName: string
  userId: string
  role: Role
  inviterName: string
}) {
  const to = (await recipients([opts.userId], 'notify_on_invite')).get(opts.userId)
  if (!to) return
  const what = opts.kind === 'planner' ? 'Planner' : 'Ordner'
  await sendMail(to, {
    subject: `Einladung zum ${what} «${opts.targetName}»`,
    heading: `Du wurdest zu einem ${what} eingeladen`,
    paragraphs: [
      `${opts.inviterName} hat dich als ${ROLE_LABEL[opts.role]} zum ${what} «${opts.targetName}» eingeladen.`,
      ...(opts.kind === 'folder' ? ['Du hast damit Zugriff auf alle Planner in diesem Ordner und seinen Unterordnern.'] : []),
    ],
    cta: { label: `${what} öffnen`, href: opts.kind === 'planner' ? `${serverEnv.appUrl}/p/${opts.targetId}` : serverEnv.appUrl },
  })
}
