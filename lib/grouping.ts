import type { TaskDerived } from '@/lib/store/planner-store'
import type { Bucket, Label, TaskPriority, TaskStatus, User } from '@/lib/types'
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/types'
import { DUE_BUCKET_LABEL, dueBucket, type DueBucket } from '@/lib/dates'

export type GroupBy = 'bucket' | 'progress' | 'due' | 'priority' | 'assigned' | 'label'

export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  bucket: 'Bucket',
  progress: 'Fortschritt',
  due: 'Fälligkeit',
  priority: 'Priorität',
  assigned: 'Zuständig',
  label: 'Label',
}

export type Filters = {
  people: string[] // User-IDs, 'none' = nicht zugewiesen
  labels: string[]
  priorities: TaskPriority[]
  due: DueBucket[]
  status: TaskStatus[]
}

export const EMPTY_FILTERS: Filters = { people: [], labels: [], priorities: [], due: [], status: [] }

export function activeFilterCount(f: Filters) {
  return f.people.length + f.labels.length + f.priorities.length + f.due.length + f.status.length
}

export function matchesFilters(t: TaskDerived, f: Filters): boolean {
  if (f.people.length) {
    const ok = f.people.some((p) => (p === 'none' ? t.assignees.length === 0 : t.assignees.includes(p)))
    if (!ok) return false
  }
  if (f.labels.length && !t.labels.some((l) => f.labels.includes(l.id))) return false
  if (f.priorities.length && !f.priorities.includes(t.task.priority)) return false
  if (f.due.length && !f.due.includes(dueBucket(t.task.due_date))) return false
  if (f.status.length && !f.status.includes(t.task.status)) return false
  return true
}

export type Group = {
  key: string
  title: string
  color?: string
  tasks: TaskDerived[]
}

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done']
const PRIORITIES: TaskPriority[] = ['urgent', 'important', 'medium', 'low']
const DUES: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none']

export function groupTasks(
  tasks: TaskDerived[],
  groupBy: GroupBy,
  ctx: { buckets: Bucket[]; labels: Label[]; members: User[] },
): Group[] {
  const byPos = (a: TaskDerived, b: TaskDerived) => a.task.position - b.task.position
  const make = (key: string, title: string, list: TaskDerived[], color?: string): Group => ({
    key, title, color, tasks: [...list].sort(byPos),
  })

  switch (groupBy) {
    case 'bucket':
      return ctx.buckets.map((b) => make(b.id, b.name, tasks.filter((t) => t.task.bucket_id === b.id)))
    case 'progress':
      return STATUSES.map((s) => make(s, STATUS_LABEL[s], tasks.filter((t) => t.task.status === s)))
    case 'priority':
      return PRIORITIES.map((p) => make(p, PRIORITY_LABEL[p], tasks.filter((t) => t.task.priority === p), `var(--prio-${p})`))
    case 'due':
      return DUES.map((d) => make(d, DUE_BUCKET_LABEL[d], tasks.filter((t) => dueBucket(t.task.due_date) === d)))
    case 'assigned': {
      const groups = ctx.members.map((u) => make(u.id, u.display_name, tasks.filter((t) => t.assignees.includes(u.id))))
      groups.push(make('none', 'Nicht zugewiesen', tasks.filter((t) => t.assignees.length === 0)))
      return groups
    }
    case 'label': {
      const groups = ctx.labels.map((l) => make(l.id, l.name, tasks.filter((t) => t.labels.some((x) => x.id === l.id))))
      groups.push(make('none', 'Ohne Label', tasks.filter((t) => t.labels.length === 0)))
      return groups
    }
  }
}

export function progressOf(t: TaskDerived): number {
  return t.itemsTotal ? t.itemsDone / t.itemsTotal : 0
}
