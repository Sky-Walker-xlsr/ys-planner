'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { PlannerIcon } from '@/components/ui/avatar'
import { PriorityBadge, Segmented, Switch } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { MySchedule } from './my-schedule'
import { getBrowserClient } from '@/lib/supabase/browser'
import { DUE_BUCKET_LABEL, dueBucket, dueTextClass, formatShort, type DueBucket } from '@/lib/dates'
import { compareMyTasks, MY_TASKS_SORT_LABEL, type MyTasksSort } from '@/lib/my-tasks-sort'
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

const GROUPS: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none']

type Row = MyTaskRow
type View = 'list' | 'schedule'

export function MyTasks() {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const router = useRouter()
  const pathname = usePathname()
  const view: View = useSearchParams().get('view') === 'schedule' ? 'schedule' : 'list'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sort, setSort] = useState<MyTasksSort>('due')
  const [grouped, setGrouped] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const { data } = await db
      .from('task_assignees')
      .select('tasks!inner(id, title, status, priority, due_date, planner_id, planners(name, color))')
      .eq('user_id', me.id)
      .neq('tasks.status', 'done')
    setRows(((data ?? []) as unknown as { tasks: Row }[]).map((r) => r.tasks))
  }, [db, me.id])

  // Gespeicherte Sortierung/Gruppierung
  useEffect(() => {
    void db
      .from('user_settings')
      .select('my_tasks_sort, my_tasks_grouped')
      .eq('user_id', me.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        if (data.my_tasks_sort in MY_TASKS_SORT_LABEL) setSort(data.my_tasks_sort as MyTasksSort)
        setGrouped(data.my_tasks_grouped !== false)
      })
  }, [db, me.id])

  async function saveDisplay(patch: { my_tasks_sort?: MyTasksSort; my_tasks_grouped?: boolean }) {
    if (patch.my_tasks_sort) setSort(patch.my_tasks_sort)
    if (patch.my_tasks_grouped !== undefined) setGrouped(patch.my_tasks_grouped)
    const { error } = await db.from('user_settings').upsert({ user_id: me.id, ...patch })
    if (error) toast('Ansicht konnte nicht gespeichert werden')
  }

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

  const sorted = useMemo(() => [...(rows ?? [])].sort(compareMyTasks(sort)), [rows, sort])
  // Gruppiert: innerhalb der Gruppen gilt die gewählte Sortierung
  const groups = useMemo(() => {
    const by: Record<DueBucket, Row[]> = { overdue: [], today: [], week: [], later: [], none: [] }
    for (const r of sorted) by[dueBucket(r.due_date)].push(r)
    return by
  }, [sorted])

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
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-2">Sortieren nach</span>
            <select className="input h-8 w-auto" value={sort} onChange={(e) => void saveDisplay({ my_tasks_sort: e.target.value as MyTasksSort })}>
              {(Object.keys(MY_TASKS_SORT_LABEL) as MyTasksSort[]).map((k) => <option key={k} value={k}>{MY_TASKS_SORT_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={grouped} onChange={(v) => void saveDisplay({ my_tasks_grouped: v })} label="Gruppieren nach Fälligkeit" />
            <span>Gruppieren nach Fälligkeit</span>
          </label>
        </div>
        {rows === null && <p className="text-sm text-text-2">Lädt …</p>}
        {rows?.length === 0 && <p className="text-sm text-text-2">Dir sind keine offenen Aufgaben zugewiesen.</p>}
        {rows !== null && rows.length > 0 && !grouped && <TaskList rows={sorted} />}
        {rows !== null && grouped &&
          GROUPS.map((g) =>
            groups[g].length ? (
              <section key={g} aria-label={DUE_BUCKET_LABEL[g]}>
                <h2 className={`mb-2 text-sm font-semibold ${g === 'overdue' ? 'text-danger' : ''}`}>
                  {DUE_BUCKET_LABEL[g]} <span className="font-normal text-text-2">· {groups[g].length}</span>
                </h2>
                <TaskList rows={groups[g]} />
              </section>
            ) : null,
          )}
      </div>
      )}
    </div>
  )
}

function TaskList({ rows }: { rows: Row[] }) {
  return (
    <ul className="card divide-y divide-line">
      {rows.map((r) => (
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
  )
}
