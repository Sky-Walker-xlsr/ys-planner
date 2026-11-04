'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Calendar, ChevronDown, Search, X } from 'lucide-react'
import { MySchedule } from '@/components/my-tasks/my-schedule'
import { PlannerIcon, UserAvatar } from '@/components/ui/avatar'
import { Checkbox, LabelPill, Popover, PriorityBadge, Segmented } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { TaskCheck, toggledStatus } from '@/components/ui/task-check'
import {
  activeFilterCount, filterTasks, GROUPING_LABEL, groupTasks, labelKey, NO_FILTERS, NOBODY,
  type AllTaskFilters, type AllTaskGrouping, type AllTaskRow,
} from '@/lib/all-tasks'
import { DUE_BUCKET_LABEL, dueTextClass, formatShort, type DueBucket } from '@/lib/dates'
import { compareMyTasks, MY_TASKS_SORT_LABEL, type MyTasksSort } from '@/lib/my-tasks-sort'
import { getBrowserClient } from '@/lib/supabase/browser'
import { PRIORITY_LABEL, STATUS_LABEL, type TaskPriority, type TaskStatus, type User } from '@/lib/types'

const PAGE = 1000
const SELECT = 'id, title, status, priority, due_date, planner_id, planners(name, color), task_assignees(user_id), task_labels(labels(id, name, color))'

type View = 'list' | 'schedule'

/** Alle offenen Tasks aller sichtbaren Planner (RLS), filterbar und unabhängig von Buckets. Erledigte nur im Planner. */
export function AllTasks() {
  const db = getBrowserClient()
  const router = useRouter()
  const pathname = usePathname()
  const view: View = useSearchParams().get('view') === 'schedule' ? 'schedule' : 'list'
  const [rows, setRows] = useState<AllTaskRow[] | null>(null)
  const [users, setUsers] = useState<Map<string, User>>(new Map())
  const [filters, setFilters] = useState<AllTaskFilters>(NO_FILTERS)
  const [sort, setSort] = useState<MyTasksSort>('due')
  const [grouping, setGrouping] = useState<AllTaskGrouping>('due')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Zählt eigene Änderungen: Ein Ladevorgang, der davor begann, darf sie nicht überschreiben
  const localVersion = useRef(0)

  const load = useCallback(async () => {
    const version = localVersion.current
    // Supabase liefert höchstens 1000 Zeilen pro Abfrage
    const all: AllTaskRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from('tasks').select(SELECT).not('planner_id', 'is', null).neq('status', 'done').order('id').range(from, from + PAGE - 1)
      if (error) {
        toast('Aufgaben konnten nicht geladen werden')
        return
      }
      all.push(...((data ?? []) as unknown as AllTaskRow[]))
      if (!data || data.length < PAGE) break
    }
    if (version !== localVersion.current) return
    setRows((prev) => (prev && JSON.stringify(prev) === JSON.stringify(all) ? prev : all))
    const ids = [...new Set(all.flatMap((r) => r.task_assignees.map((a) => a.user_id)))]
    if (ids.length) {
      const { data } = await db.from('users').select('id, email, display_name, avatar_color').in('id', ids)
      setUsers(new Map(((data ?? []) as User[]).map((u) => [u.id, u])))
    }
  }, [db])

  // Alle 5 Sekunden und beim Zurückkehren in den Tab aktualisieren
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const id = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [load])

  useEffect(() => {
    void load()
    const channel = db.channel('db:all-tasks')
    for (const table of ['tasks', 'task_assignees', 'task_labels', 'labels', 'planners']) {
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

  const options = useMemo(() => {
    const planners = new Map<string, string>()
    const labels = new Map<string, { name: string; color: string }>()
    for (const r of rows ?? []) {
      if (r.planners) planners.set(r.planner_id, r.planners.name)
      for (const l of r.task_labels) if (l.labels) labels.set(labelKey(l.labels.name), l.labels)
    }
    const byLabel = (a: { label: React.ReactNode; text: string }, b: { text: string }) => a.text.localeCompare(b.text, 'de')
    return {
      planners: [...planners].map(([value, text]) => ({ value, text, label: text })).sort(byLabel),
      labels: [...labels].map(([value, l]) => ({ value, text: l.name, label: <LabelPill name={l.name} color={l.color} /> })).sort(byLabel),
      assignees: [
        ...[...users.values()].map((u) => ({ value: u.id, text: u.display_name, label: u.display_name })).sort(byLabel),
        { value: NOBODY, text: 'Niemand', label: 'Niemand zugewiesen' },
      ],
    }
  }, [rows, users])

  const filtered = useMemo(() => filterTasks(rows ?? [], filters), [rows, filters])
  const sorted = useMemo(() => [...filtered].sort(compareMyTasks(sort)), [filtered, sort])
  const groups = useMemo(
    () => groupTasks(sorted, grouping, (id) => users.get(id)?.display_name ?? 'Unbekannt'),
    [sorted, grouping, users],
  )
  const set = <K extends keyof AllTaskFilters>(k: K, v: AllTaskFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  function setView(next: View) {
    router.replace(next === 'schedule' ? `${pathname}?view=schedule` : pathname, { scroll: false })
  }

  // Fälligkeit verschieben: nur in Plannern mit Bearbeitungsrecht (RLS liefert sonst keine Zeile zurück)
  async function move(id: string, dueDate: string) {
    const prev = rows?.find((r) => r.id === id)
    if (!prev) return
    localVersion.current++
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, due_date: dueDate } : r)) ?? rs)
    const { data, error } = await db.from('tasks').update({ due_date: dueDate }).eq('id', id).select('id')
    if (error || !data?.length) {
      setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, due_date: prev.due_date } : r)) ?? rs)
      toast(error ? 'Datum konnte nicht geändert werden' : 'Keine Bearbeitungsrechte in diesem Planner')
    }
  }

  // Abhaken: nur in Plannern mit Bearbeitungsrecht (RLS liefert sonst keine Zeile zurück).
  // Erledigte Tasks erscheinen hier nicht, die Zeile verschwindet sofort.
  async function toggleDone(id: string) {
    const prev = rows?.find((r) => r.id === id)
    if (!prev) return
    localVersion.current++
    const status = toggledStatus(prev.status)
    setRows((rs) => (status === 'done' ? rs?.filter((r) => r.id !== id) : rs?.map((r) => (r.id === id ? { ...r, status } : r))) ?? rs)
    const { data, error } = await db.from('tasks').update({ status }).eq('id', id).select('id')
    if (error || !data?.length) {
      setRows((rs) => (rs ? [...rs.filter((r) => r.id !== id), prev] : rs))
      toast(error ? 'Aufgabe konnte nicht geändert werden' : 'Keine Bearbeitungsrechte in diesem Planner')
    }
  }

  const active = activeFilterCount(filters)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Alle Tasks</h1>
          <p className="text-sm text-text-2">
            {rows === null ? 'Offene Tasks aus allen Plannern' : `${filtered.length} von ${rows.length} offenen Tasks aus allen Plannern`}
          </p>
        </div>
        <Segmented label="Ansicht" value={view} onChange={setView} options={[{ value: 'list', label: 'Liste' }, { value: 'schedule', label: 'Zeitplan' }]} />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input className="input h-8 w-48 pl-8" placeholder="Titel suchen" aria-label="Titel suchen" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <MultiFilter title="Planner" options={options.planners} value={filters.planners} onChange={(v) => set('planners', v)} />
        <MultiFilter title="Status" value={filters.statuses} onChange={(v) => set('statuses', v as TaskStatus[])}
          options={(Object.keys(STATUS_LABEL) as TaskStatus[]).filter((s) => s !== 'done').map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <MultiFilter title="Priorität" value={filters.priorities} onChange={(v) => set('priorities', v as TaskPriority[])}
          options={(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <MultiFilter title="Zugewiesen" options={options.assignees} value={filters.assignees} onChange={(v) => set('assignees', v)} />
        <MultiFilter title="Labels" options={options.labels} value={filters.labels} onChange={(v) => set('labels', v)} />
        <MultiFilter title="Fälligkeit" value={filters.due} onChange={(v) => set('due', v as DueBucket[])}
          options={(Object.keys(DUE_BUCKET_LABEL) as DueBucket[]).map((d) => ({ value: d, label: DUE_BUCKET_LABEL[d] }))} />
        {active > 0 && (
          <button type="button" className="btn-text h-8" onClick={() => setFilters(NO_FILTERS)}>
            <X size={14} /> Filter zurücksetzen
          </button>
        )}
      </div>

      {rows === null && <p className="p-5 text-sm text-text-2">Lädt …</p>}
      {view === 'schedule' && rows !== null && (
        <div className="flex min-h-0 flex-1 flex-col"><MySchedule rows={filtered} onMove={(id, d) => void move(id, d)} /></div>
      )}
      {view === 'list' && rows !== null && (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-text-2">Sortieren nach</span>
              <select className="input h-8 w-auto" value={sort} onChange={(e) => setSort(e.target.value as MyTasksSort)}>
                {(Object.keys(MY_TASKS_SORT_LABEL) as MyTasksSort[]).map((k) => <option key={k} value={k}>{MY_TASKS_SORT_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-text-2">Gruppieren nach</span>
              <select className="input h-8 w-auto" value={grouping} onChange={(e) => setGrouping(e.target.value as AllTaskGrouping)}>
                {(Object.keys(GROUPING_LABEL) as AllTaskGrouping[]).map((k) => <option key={k} value={k}>{GROUPING_LABEL[k]}</option>)}
              </select>
            </label>
          </div>
          {groups.length === 0 && (
            <p className="text-sm text-text-2">{rows.length ? 'Keine Tasks für diese Filter.' : 'Noch keine Tasks vorhanden.'}</p>
          )}
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label || 'Tasks'}>
              {g.label && (
                <h2 className={`mb-2 text-sm font-semibold ${g.key === 'overdue' ? 'text-danger' : ''}`}>
                  {g.label} <span className="font-normal text-text-2">· {g.rows.length}</span>
                </h2>
              )}
              <ul className="card divide-y divide-line">
                {g.rows.map((r) => <TaskRow key={r.id} row={r} users={users} onToggle={() => void toggleDone(r.id)} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({ row, users, onToggle }: { row: AllTaskRow; users: Map<string, User>; onToggle: () => void }) {
  const labels = row.task_labels.flatMap((l) => (l.labels ? [l.labels] : []))
  return (
    <li>
      <Link href={`/p/${row.planner_id}?task=${row.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-bg">
        <TaskCheck title={row.title} done={row.status === 'done'} onToggle={onToggle} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${row.status === 'done' ? 'text-text-2 line-through' : ''}`}>{row.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
            {row.planners && <PlannerIcon name={row.planners.name} color={row.planners.color} size={14} />}
            {row.planners?.name} · {STATUS_LABEL[row.status]}
            {labels.map((l) => <LabelPill key={l.id} name={l.name} color={l.color} />)}
          </span>
        </span>
        <span className="flex -space-x-1.5">
          {row.task_assignees.map((a) => {
            const user = users.get(a.user_id)
            return user ? <UserAvatar key={a.user_id} user={user} size={22} className="ring-2 ring-surface" /> : null
          })}
        </span>
        <PriorityBadge priority={row.priority} />
        <span className={`inline-flex w-20 items-center gap-1 text-xs ${row.due_date ? dueTextClass(row.due_date, row.status === 'done') : ''}`}>
          {row.due_date && <><Calendar size={13} /> {formatShort(row.due_date)}</>}
        </span>
      </Link>
    </li>
  )
}

function MultiFilter({ title, options, value, onChange }: {
  title: string
  options: { value: string; label: React.ReactNode }[]
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <Popover
      width={240}
      trigger={({ toggle }) => (
        <button type="button" className={`btn-secondary h-8 ${value.length ? 'border-accent text-accent' : ''}`} onClick={toggle}>
          {title}{value.length > 0 && ` · ${value.length}`} <ChevronDown size={14} />
        </button>
      )}
    >
      <div className="max-h-64 overflow-y-auto">
        {options.length === 0 && <p className="p-2 text-sm text-text-2">Keine Einträge</p>}
        {options.map((o) => (
          <Checkbox
            key={o.value}
            checked={value.includes(o.value)}
            onChange={(on) => onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))}
            label={o.label}
          />
        ))}
      </div>
    </Popover>
  )
}
