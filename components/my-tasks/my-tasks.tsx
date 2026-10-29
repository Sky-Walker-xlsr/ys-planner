'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { PlannerIcon } from '@/components/ui/avatar'
import { PriorityBadge } from '@/components/ui/controls'
import { getBrowserClient } from '@/lib/supabase/browser'
import { dueBucket, formatShort, isDueSoon } from '@/lib/dates'
import { STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/types'

type Row = {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  planner_id: string
  planners: { name: string; color: string } | null
}

const GROUPS = [
  { key: 'overdue', title: 'Überfällig' },
  { key: 'today', title: 'Heute' },
  { key: 'week', title: 'Diese Woche' },
  { key: 'later', title: 'Später' },
] as const

export function MyTasks() {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const [rows, setRows] = useState<Row[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const { data } = await db
      .from('task_assignees')
      .select('tasks!inner(id, title, status, priority, due_date, planner_id, planners(name, color))')
      .eq('user_id', me.id)
      .neq('tasks.status', 'done')
    setRows(((data ?? []) as unknown as { tasks: Row }[]).map((r) => r.tasks))
  }, [db, me.id])

  useEffect(() => {
    void load()
    const channel = db.channel('db:my-tasks')
    for (const table of ['tasks', 'task_assignees']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(), 300)
      })
    }
    channel.subscribe()
    return () => {
      void db.removeChannel(channel)
    }
  }, [db, load])

  const groups = useMemo(() => {
    const by: Record<string, Row[]> = { overdue: [], today: [], week: [], later: [] }
    for (const r of rows ?? []) {
      const b = dueBucket(r.due_date)
      by[b === 'none' ? 'later' : b].push(r)
    }
    for (const list of Object.values(by)) {
      list.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title))
    }
    return by
  }, [rows])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b border-line bg-surface px-5 py-4">
        <h1 className="text-lg font-semibold">Meine Aufgaben</h1>
        <p className="text-sm text-text-2">Alle dir zugewiesenen, offenen Aufgaben über alle Planner</p>
      </header>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5">
        {rows === null && <p className="text-sm text-text-2">Lädt …</p>}
        {rows?.length === 0 && <p className="text-sm text-text-2">Dir sind keine offenen Aufgaben zugewiesen.</p>}
        {rows !== null &&
          GROUPS.map((g) =>
            groups[g.key].length ? (
              <section key={g.key} aria-label={g.title}>
                <h2 className={`mb-2 text-sm font-semibold ${g.key === 'overdue' ? 'text-danger' : ''}`}>
                  {g.title} <span className="font-normal text-text-2">· {groups[g.key].length}</span>
                </h2>
                <ul className="card divide-y divide-line">
                  {groups[g.key].map((r) => (
                    <li key={r.id}>
                      <Link href={`/p/${r.planner_id}?task=${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-bg">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.title}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-2">
                            {r.planners && <PlannerIcon name={r.planners.name} color={r.planners.color} size={14} />}
                            {r.planners?.name} · {STATUS_LABEL[r.status]}
                          </span>
                        </span>
                        <PriorityBadge priority={r.priority} />
                        {r.due_date && (
                          <span className={`inline-flex w-20 items-center gap-1 text-xs ${isDueSoon(r.due_date) ? 'font-medium text-danger' : 'text-text-2'}`}>
                            <Calendar size={13} /> {formatShort(r.due_date)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
      </div>
    </div>
  )
}
