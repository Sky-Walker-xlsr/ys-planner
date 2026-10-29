'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { PlannerIcon } from '@/components/ui/avatar'
import { PriorityBadge, Segmented } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { MySchedule } from './my-schedule'
import { getBrowserClient } from '@/lib/supabase/browser'
import { dueBucket, dueTextClass, formatShort } from '@/lib/dates'
import { STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/types'

export type MyTaskRow = {
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

type Row = MyTaskRow
type View = 'list' | 'schedule'

export function MyTasks() {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const router = useRouter()
  const pathname = usePathname()
  const view: View = useSearchParams().get('view') === 'schedule' ? 'schedule' : 'list'
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

  function setView(next: View) {
    router.replace(next === 'schedule' ? `${pathname}?view=schedule` : pathname, { scroll: false })
  }

  // Fälligkeit verschieben: nur in Plannern mit Bearbeitungsrecht (RLS liefert sonst keine Zeile zurück)
  async function move(id: string, dueDate: string) {
    const prev = rows?.find((r) => r.id === id)
    if (!prev) return
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, due_date: dueDate } : r)) ?? rs)
    const { data, error } = await db.from('tasks').update({ due_date: dueDate }).eq('id', id).select('id')
    if (error || !data?.length) {
      setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, due_date: prev.due_date } : r)) ?? rs)
      toast(error ? 'Datum konnte nicht geändert werden' : 'Keine Bearbeitungsrechte in diesem Planner')
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Meine Aufgaben</h1>
          <p className="text-sm text-text-2">Alle dir zugewiesenen, offenen Aufgaben über alle Planner</p>
        </div>
        <Segmented label="Ansicht" value={view} onChange={setView} options={[{ value: 'list', label: 'Liste' }, { value: 'schedule', label: 'Zeitplan' }]} />
      </header>
      {view === 'schedule' && rows !== null && (
        <div className="flex-1"><MySchedule rows={rows} onMove={(id, d) => void move(id, d)} /></div>
      )}
      {view === 'schedule' && rows === null && <p className="p-5 text-sm text-text-2">Lädt …</p>}
      {view === 'list' && (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-5">
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
                          <span className={`inline-flex w-20 items-center gap-1 text-xs ${dueTextClass(r.due_date)}`}>
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
      )}
    </div>
  )
}
