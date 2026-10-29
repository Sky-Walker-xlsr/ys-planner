'use client'
import { useMemo } from 'react'
import { Calendar } from 'lucide-react'
import { usePlanner, sortByPosition, type TaskDerived } from '@/lib/store/planner-store'
import { UserAvatar } from '@/components/ui/avatar'
import { PriorityBadge } from '@/components/ui/controls'
import { formatShort, isOverdue } from '@/lib/dates'
import { STATUS_LABEL, type TaskStatus } from '@/lib/types'

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done']
const STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: 'var(--prio-low)',
  in_progress: 'var(--prio-medium)',
  done: 'var(--accent)',
}

type Counts = Record<TaskStatus, number>
const emptyCounts = (): Counts => ({ not_started: 0, in_progress: 0, done: 0 })
const total = (c: Counts) => c.not_started + c.in_progress + c.done

export function Charts({ tasks, onOpenTask }: { tasks: TaskDerived[]; onOpenTask: (id: string) => void }) {
  const { state, members } = usePlanner()

  const status = useMemo(() => {
    const c = emptyCounts()
    for (const t of tasks) c[t.task.status]++
    return c
  }, [tasks])

  const perBucket = useMemo(
    () =>
      sortByPosition(Object.values(state.data.buckets)).map((b) => {
        const c = emptyCounts()
        for (const t of tasks) if (t.task.bucket_id === b.id) c[t.task.status]++
        return { label: b.name, counts: c }
      }),
    [tasks, state.data.buckets],
  )

  const perPerson = useMemo(() => {
    const rows = members.map((m) => {
      const c = emptyCounts()
      for (const t of tasks) if (t.assignees.includes(m.user.id)) c[t.task.status]++
      return { user: m.user, label: m.user.display_name, counts: c }
    })
    const none = emptyCounts()
    for (const t of tasks) if (!t.assignees.length) none[t.task.status]++
    return [...rows.filter((r) => total(r.counts) > 0), { user: null, label: 'Nicht zugewiesen', counts: none }]
  }, [tasks, members])

  const overdue = useMemo(
    () =>
      tasks
        .filter((t) => isOverdue(t.task.due_date, t.task.status === 'done'))
        .sort((a, b) => (a.task.due_date! < b.task.due_date! ? -1 : 1)),
    [tasks],
  )

  const max = (rows: { counts: Counts }[]) => Math.max(1, ...rows.map((r) => total(r.counts)))

  return (
    <div className="grid gap-4 p-5 lg:grid-cols-2">
      <Panel title="Status">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold">{total(status)}</span>
          <span className="text-sm text-text-2">Aufgaben</span>
        </div>
        <StackedBar counts={status} max={total(status)} height={14} />
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {STATUSES.map((s) => (
            <li key={s} className="rounded-md border border-line px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-text-2">
                <span className="size-2.5 rounded-[2px]" style={{ background: STATUS_COLOR[s] }} aria-hidden />
                {STATUS_LABEL[s]}
              </div>
              <div className="text-lg font-semibold">{status[s]}</div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Überfällige Aufgaben">
        {overdue.length === 0 ? (
          <p className="text-sm text-text-2">Keine überfälligen Aufgaben.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {overdue.map((t) => (
              <li key={t.task.id}>
                <button type="button" onClick={() => onOpenTask(t.task.id)} className="flex w-full items-center gap-3 py-2 text-left cursor-pointer hover:bg-bg">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.task.title}</span>
                  <PriorityBadge priority={t.task.priority} />
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                    <Calendar size={13} /> {formatShort(t.task.due_date)}
                  </span>
                  <span className="flex -space-x-1.5">
                    {t.assignees.slice(0, 3).map((id) => <UserAvatar key={id} user={state.users[id]} size={22} className="ring-2 ring-surface" />)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Aufgaben pro Bucket">
        <BarRows rows={perBucket} max={max(perBucket)} />
      </Panel>

      <Panel title="Aufgaben pro Person">
        <BarRows rows={perPerson} max={max(perPerson)} />
      </Panel>

      <div className="flex flex-wrap gap-4 text-xs text-text-2 lg:col-span-2">
        {STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: STATUS_COLOR[s] }} aria-hidden />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function StackedBar({ counts, max, height = 10 }: { counts: Counts; max: number; height?: number }) {
  const t = total(counts)
  return (
    <div
      className="mt-2 flex w-full overflow-hidden rounded-full bg-bg"
      style={{ height }}
      role="img"
      aria-label={STATUSES.map((s) => `${STATUS_LABEL[s]}: ${counts[s]}`).join(', ')}
    >
      <div className="flex h-full" style={{ width: `${max ? (t / max) * 100 : 0}%` }}>
        {STATUSES.map((s) =>
          counts[s] ? (
            <div key={s} className="h-full" style={{ width: `${(counts[s] / t) * 100}%`, background: STATUS_COLOR[s] }} title={`${STATUS_LABEL[s]}: ${counts[s]}`} />
          ) : null,
        )}
      </div>
    </div>
  )
}

function BarRows({ rows, max }: { rows: { label: string; counts: Counts; user?: { id: string } | null }[]; max: number }) {
  if (!rows.length) return <p className="text-sm text-text-2">Keine Daten.</p>
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3">
          <span className="truncate text-sm">{r.label}</span>
          <StackedBar counts={r.counts} max={max} />
          <span className="w-6 text-right text-sm tabular-nums text-text-2">{total(r.counts)}</span>
        </li>
      ))}
    </ul>
  )
}
