import { describe, expect, it } from 'vitest'
import { compareMyTasks } from './my-tasks-sort'
import type { TaskPriority } from '@/lib/types'

const t = (title: string, priority: TaskPriority, due_date: string | null) => ({ title, priority, due_date })
const rows = [
  t('A', 'low', '2026-11-01'),
  t('B', 'urgent', null),
  t('C', 'urgent', '2026-11-05'),
  t('D', 'medium', '2026-11-01'),
  t('E', 'important', '2026-10-30'),
]
const order = (mode: Parameters<typeof compareMyTasks>[0]) => [...rows].sort(compareMyTasks(mode)).map((r) => r.title).join('')

describe('Meine Aufgaben sortieren', () => {
  it('Fälligkeit', () => expect(order('due')).toBe('EADCB'))
  it('Priorität (ohne Datum am Ende)', () => expect(order('priority')).toBe('CEDAB'))
  it('Priorität, dann Fälligkeit', () => expect(order('priority_due')).toBe('CEDAB'))
  it('Fälligkeit, dann Priorität', () => expect(order('due_priority')).toBe('EDACB'))
})
