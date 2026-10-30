import { describe, expect, it } from 'vitest'
import { activeFilterCount, filterTasks, groupTasks, NO_FILTERS, NOBODY, type AllTaskRow } from './all-tasks'

const row = (id: string, patch: Partial<AllTaskRow> = {}): AllTaskRow => ({
  id,
  title: id,
  status: 'not_started',
  priority: 'medium',
  due_date: null,
  planner_id: 'p1',
  planners: { name: 'Eins', color: '#000000' },
  task_assignees: [],
  task_labels: [],
  ...patch,
})
const label = (name: string) => ({ labels: { id: name, name, color: '#111111' } })

const rows = [
  row('a', { title: 'Rechnung schreiben', planner_id: 'p2', planners: { name: 'Zwei', color: '#000000' }, status: 'done', task_assignees: [{ user_id: 'u1' }], task_labels: [label('Kunde')] }),
  row('b', { priority: 'urgent', task_assignees: [{ user_id: 'u1' }, { user_id: 'u2' }], task_labels: [label('kunde')] }),
  row('c'),
]
const ids = (f: Partial<typeof NO_FILTERS>) => filterTasks(rows, { ...NO_FILTERS, ...f }).map((r) => r.id)

describe('filterTasks', () => {
  it('zeigt ohne Filter alles, auch Erledigtes', () => {
    expect(ids({})).toEqual(['a', 'b', 'c'])
  })

  it('sucht im Titel ohne Gross-/Kleinschreibung', () => {
    expect(ids({ q: ' RECHNUNG ' })).toEqual(['a'])
  })

  it('filtert nach Planner, Status und Priorität', () => {
    expect(ids({ planners: ['p2'] })).toEqual(['a'])
    expect(ids({ statuses: ['done'] })).toEqual(['a'])
    expect(ids({ priorities: ['urgent', 'low'] })).toEqual(['b'])
  })

  it('findet Zugewiesene und Tasks ohne Zuweisung', () => {
    expect(ids({ assignees: ['u2'] })).toEqual(['b'])
    expect(ids({ assignees: [NOBODY] })).toEqual(['c'])
    expect(ids({ assignees: ['u2', NOBODY] })).toEqual(['b', 'c'])
  })

  it('behandelt gleiche Label-Namen aus verschiedenen Plannern als dasselbe', () => {
    expect(ids({ labels: ['kunde'] })).toEqual(['a', 'b'])
  })

  it('verknüpft verschiedene Filter mit und', () => {
    expect(ids({ labels: ['kunde'], statuses: ['done'] })).toEqual(['a'])
    expect(ids({ planners: ['p2'], priorities: ['urgent'] })).toEqual([])
  })

  it('filtert nach Fälligkeit', () => {
    expect(ids({ due: ['none'] })).toEqual(['a', 'b', 'c'])
    expect(ids({ due: ['overdue'] })).toEqual([])
  })
})

describe('groupTasks', () => {
  const name = (id: string) => (id === 'u1' ? 'Anna' : 'Ben')

  it('zeigt Tasks bei jeder zugewiesenen Person, Niemand zuletzt', () => {
    const groups = groupTasks(rows, 'assignee', name)
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Anna', ['a', 'b']],
      ['Ben', ['b']],
      ['Niemand zugewiesen', ['c']],
    ])
  })

  it('sortiert Planner alphabetisch', () => {
    expect(groupTasks(rows, 'planner', name).map((g) => g.label)).toEqual(['Eins', 'Zwei'])
  })

  it('hält die feste Reihenfolge der Prioritäten ein', () => {
    expect(groupTasks(rows, 'priority', name)[0].key).toBe('urgent')
  })

  it('liefert ohne Gruppierung eine Gruppe und ohne Tasks keine', () => {
    expect(groupTasks(rows, 'none', name)).toHaveLength(1)
    expect(groupTasks([], 'none', name)).toEqual([])
  })
})

describe('activeFilterCount', () => {
  it('zählt jede aktive Auswahl', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, q: 'x', planners: ['a', 'b'] })).toBe(3)
  })
})
