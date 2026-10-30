// Filter und Gruppierung für «Alle Tasks»: Tasks aller Planner, unabhängig von Buckets.
import { DUE_BUCKET_LABEL, dueBucket, type DueBucket } from '@/lib/dates'
import { PRIORITY_LABEL, STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/types'

export type AllTaskRow = {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  planner_id: string
  planners: { name: string; color: string } | null
  task_assignees: { user_id: string }[]
  task_labels: { labels: { id: string; name: string; color: string } | null }[]
}

export type AllTaskFilters = {
  q: string
  planners: string[]
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  /** User-IDs; NOBODY = Tasks ohne Zuweisung */
  assignees: string[]
  /** Label-Namen klein geschrieben: Jeder Planner hat eigene Labels, gleiche Namen zählen als dasselbe */
  labels: string[]
  due: DueBucket[]
}

export const NOBODY = '__nobody__'
export const NO_FILTERS: AllTaskFilters = { q: '', planners: [], statuses: [], priorities: [], assignees: [], labels: [], due: [] }

export const labelKey = (name: string) => name.trim().toLowerCase()

export function activeFilterCount(f: AllTaskFilters) {
  return (f.q.trim() ? 1 : 0) + f.planners.length + f.statuses.length + f.priorities.length + f.assignees.length + f.labels.length + f.due.length
}

/** Innerhalb eines Filters reicht ein Treffer, verschiedene Filter müssen alle passen */
export function filterTasks(rows: AllTaskRow[], f: AllTaskFilters) {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q)) return false
    if (f.planners.length && !f.planners.includes(r.planner_id)) return false
    if (f.statuses.length && !f.statuses.includes(r.status)) return false
    if (f.priorities.length && !f.priorities.includes(r.priority)) return false
    if (f.due.length && !f.due.includes(dueBucket(r.due_date))) return false
    if (f.assignees.length) {
      const hit = r.task_assignees.length
        ? r.task_assignees.some((a) => f.assignees.includes(a.user_id))
        : f.assignees.includes(NOBODY)
      if (!hit) return false
    }
    if (f.labels.length && !r.task_labels.some((l) => l.labels && f.labels.includes(labelKey(l.labels.name)))) return false
    return true
  })
}

export type AllTaskGrouping = 'none' | 'due' | 'planner' | 'status' | 'priority' | 'assignee'

export const GROUPING_LABEL: Record<AllTaskGrouping, string> = {
  none: 'Keine',
  due: 'Fälligkeit',
  planner: 'Planner',
  status: 'Status',
  priority: 'Priorität',
  assignee: 'Zugewiesen',
}

export type TaskGroup = { key: string; label: string; rows: AllTaskRow[] }

const DUE_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none']

/** Hält die Reihenfolge von rows ein. Tasks mit mehreren Zugewiesenen erscheinen bei jeder Person. */
export function groupTasks(rows: AllTaskRow[], mode: AllTaskGrouping, userName: (id: string) => string): TaskGroup[] {
  if (mode === 'none') return rows.length ? [{ key: 'all', label: '', rows }] : []
  const groups = new Map<string, TaskGroup>()
  const add = (key: string, label: string, row: AllTaskRow) => {
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] })
    groups.get(key)!.rows.push(row)
  }
  for (const r of rows) {
    if (mode === 'due') add(dueBucket(r.due_date), DUE_BUCKET_LABEL[dueBucket(r.due_date)], r)
    else if (mode === 'planner') add(r.planner_id, r.planners?.name ?? 'Unbekannt', r)
    else if (mode === 'status') add(r.status, STATUS_LABEL[r.status], r)
    else if (mode === 'priority') add(r.priority, PRIORITY_LABEL[r.priority], r)
    else if (r.task_assignees.length) for (const a of r.task_assignees) add(a.user_id, userName(a.user_id), r)
    else add(NOBODY, 'Niemand zugewiesen', r)
  }
  const list = [...groups.values()]
  const fixed: string[] | null =
    mode === 'due' ? DUE_ORDER
    : mode === 'status' ? Object.keys(STATUS_LABEL)
    : mode === 'priority' ? Object.keys(PRIORITY_LABEL)
    : null
  if (fixed) return list.sort((a, b) => fixed.indexOf(a.key) - fixed.indexOf(b.key))
  // Planner und Personen alphabetisch, «Niemand» zuletzt
  return list.sort((a, b) => (a.key === NOBODY ? 1 : b.key === NOBODY ? -1 : a.label.localeCompare(b.label, 'de')))
}
