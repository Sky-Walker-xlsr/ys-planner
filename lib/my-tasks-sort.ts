// Sortierung für «Meine Aufgaben». Tasks ohne Fälligkeitsdatum stehen immer am Ende.
import type { TaskPriority } from '@/lib/types'

export type MyTasksSort = 'due' | 'priority' | 'priority_due' | 'due_priority'

export const MY_TASKS_SORT_LABEL: Record<MyTasksSort, string> = {
  due: 'Fälligkeit',
  priority: 'Priorität',
  priority_due: 'Priorität, dann Fälligkeit',
  due_priority: 'Fälligkeit, dann Priorität',
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, important: 1, medium: 2, low: 3 }

type Sortable = { title: string; priority: TaskPriority; due_date: string | null }

const byDue = (a: Sortable, b: Sortable) => (a.due_date ?? '').localeCompare(b.due_date ?? '')
const byPriority = (a: Sortable, b: Sortable) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]

export function compareMyTasks(mode: MyTasksSort) {
  return (a: Sortable, b: Sortable) => {
    // ohne Datum immer ans Ende
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1
    const primary =
      mode === 'due' ? byDue(a, b)
      : mode === 'priority' ? byPriority(a, b)
      : mode === 'priority_due' ? byPriority(a, b) || byDue(a, b)
      : byDue(a, b) || byPriority(a, b)
    return primary || a.title.localeCompare(b.title, 'de')
  }
}
