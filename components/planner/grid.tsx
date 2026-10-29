'use client'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { usePlanner, sortByPosition, type TaskDerived } from '@/lib/store/planner-store'
import { groupTasks, progressOf, type GroupBy } from '@/lib/grouping'
import { UserAvatar } from '@/components/ui/avatar'
import { Checkbox, LabelPill, Popover, PrioritySquare } from '@/components/ui/controls'
import { isOverdue } from '@/lib/dates'
import { PRIORITY_LABEL, STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/types'
import { useActions } from './use-actions'
import { useAddToGroup } from './board'
import { AddTaskInline } from './add-task-inline'

type SortKey = 'title' | 'progress' | 'priority' | 'assigned' | 'due' | 'labels'
const PRIO_ORDER: Record<TaskPriority, number> = { urgent: 0, important: 1, medium: 2, low: 3 }
const STATUS_ORDER: Record<TaskStatus, number> = { not_started: 0, in_progress: 1, done: 2 }

export function Grid({ tasks, groupBy, onOpenTask }: { tasks: TaskDerived[]; groupBy: GroupBy; onOpenTask: (id: string) => void }) {
  const { state, members, canEdit } = usePlanner()
  const addToGroup = useAddToGroup(groupBy)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const buckets = useMemo(() => sortByPosition(Object.values(state.data.buckets)), [state.data.buckets])
  const labels = useMemo(() => Object.values(state.data.labels).sort((a, b) => a.name.localeCompare(b.name)), [state.data.labels])
  const groups = useMemo(
    () => groupTasks(tasks, groupBy, { buckets, labels, members: members.map((m) => m.user) }),
    [tasks, groupBy, buckets, labels, members],
  )

  const sorted = (list: TaskDerived[]) => {
    if (!sort) return list
    const val = (t: TaskDerived): string | number => {
      switch (sort.key) {
        case 'title': return t.task.title.toLowerCase()
        case 'progress': return STATUS_ORDER[t.task.status] * 10 + progressOf(t)
        case 'priority': return PRIO_ORDER[t.task.priority]
        case 'assigned': return t.assignees.map((id) => state.users[id]?.display_name ?? '').sort()[0] ?? '￿'
        case 'due': return t.task.due_date ?? '9999-99-99'
        case 'labels': return t.labels.map((l) => l.name).sort()[0] ?? '￿'
      }
    }
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0))
  }

  const header = (key: SortKey, label: string, className = '') => (
    <th scope="col" className={`px-3 py-2 text-left font-medium ${className}`} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="inline-flex items-center gap-1 cursor-pointer hover:text-text"
        onClick={() => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }))}
      >
        {label}
        {sort?.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )

  return (
    <div className="p-5">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="border-b border-line text-xs text-text-2">
            <tr>
              {header('title', 'Aufgabe', 'w-[34%]')}
              {header('progress', 'Fortschritt')}
              {header('priority', 'Priorität')}
              {header('assigned', 'Zugewiesen')}
              {header('due', 'Fällig')}
              {header('labels', 'Labels')}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} className="border-b border-line last:border-0">
              <tr className="bg-bg">
                <th colSpan={6} scope="rowgroup" className="px-3 py-1.5 text-left">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold cursor-pointer"
                    aria-expanded={!collapsed[g.key]}
                    onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  >
                    {collapsed[g.key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    {g.title} <span className="font-normal text-text-2">· {g.tasks.length}</span>
                  </button>
                </th>
              </tr>
              {!collapsed[g.key] &&
                sorted(g.tasks).map((t) => <Row key={t.task.id} t={t} onOpen={() => onOpenTask(t.task.id)} />)}
              {!collapsed[g.key] && canEdit && (
                <tr>
                  <td colSpan={6} className="px-3 py-1.5">
                    <div className="max-w-xs">
                      <AddTaskInline compact onAdd={(title) => addToGroup(g.key, title)} />
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
        {groups.length === 0 && <p className="p-4 text-sm text-text-2">Noch keine Buckets – lege im Board einen an.</p>}
      </div>
    </div>
  )
}

function Row({ t, onOpen }: { t: TaskDerived; onOpen: () => void }) {
  const { state, members, canEdit } = usePlanner()
  const actions = useActions()
  const task = t.task
  const done = task.status === 'done'
  const [title, setTitle] = useState(task.title)
  const [editingTitle, setEditingTitle] = useState(false)

  const saveTitle = () => {
    setEditingTitle(false)
    if (title.trim() && title.trim() !== task.title) void actions.updateTask(task.id, { title: title.trim() })
  }

  return (
    <tr className="border-t border-line hover:bg-bg/60">
      <td className="px-3 py-1.5">
        {editingTitle ? (
          <input
            className="input h-7"
            autoFocus
            aria-label="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onOpen} className={`truncate text-left font-medium hover:underline cursor-pointer ${done ? 'text-text-2 line-through' : ''}`}>
              {task.title}
            </button>
            {canEdit && (
              <button type="button" className="text-xs text-text-2 hover:text-accent cursor-pointer" onClick={() => { setTitle(task.title); setEditingTitle(true) }}>
                Bearbeiten
              </button>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-1.5">
        <select
          className="input h-7 w-36"
          aria-label="Fortschritt"
          disabled={!canEdit}
          value={task.status}
          onChange={(e) => void actions.updateTask(task.id, { status: e.target.value as TaskStatus })}
        >
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <PrioritySquare priority={task.priority} />
          <select
            className="input h-7 w-28"
            aria-label="Priorität"
            disabled={!canEdit}
            value={task.priority}
            onChange={(e) => void actions.updateTask(task.id, { priority: e.target.value as TaskPriority })}
          >
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <Popover
          width={240}
          trigger={({ toggle }) => (
            <button type="button" disabled={!canEdit} onClick={toggle} className="flex min-h-7 items-center -space-x-1.5 cursor-pointer disabled:cursor-default" aria-label="Zugewiesen bearbeiten">
              {t.assignees.length === 0 && <span className="text-text-2">–</span>}
              {t.assignees.map((id) => <UserAvatar key={id} user={state.users[id]} size={24} className="ring-2 ring-surface" />)}
            </button>
          )}
        >
          {members.map((m) => (
            <Checkbox
              key={m.user.id}
              checked={t.assignees.includes(m.user.id)}
              onChange={(v) => void (v ? actions.assign(task.id, m.user.id) : actions.unassign(task.id, m.user.id))}
              label={m.user.display_name}
            />
          ))}
        </Popover>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="date"
          className={`input h-7 w-36 ${isOverdue(task.due_date, done) ? 'text-danger' : ''}`}
          aria-label="Fälligkeitsdatum"
          disabled={!canEdit}
          value={task.due_date ?? ''}
          onChange={(e) => void actions.updateTask(task.id, { due_date: e.target.value || null })}
        />
      </td>
      <td className="px-3 py-1.5">
        <Popover
          width={220}
          align="right"
          trigger={({ toggle }) => (
            <button type="button" disabled={!canEdit} onClick={toggle} className="flex min-h-7 flex-wrap items-center gap-1 text-left cursor-pointer disabled:cursor-default" aria-label="Labels bearbeiten">
              {t.labels.length === 0 && (canEdit ? <Plus size={14} className="text-text-2" /> : <span className="text-text-2">–</span>)}
              {t.labels.map((l) => <LabelPill key={l.id} name={l.name} color={l.color} />)}
            </button>
          )}
        >
          {Object.values(state.data.labels).length === 0 && <p className="p-2 text-xs text-text-2">Labels im Task-Popup anlegen.</p>}
          {Object.values(state.data.labels).map((l) => (
            <Checkbox
              key={l.id}
              checked={t.labels.some((x) => x.id === l.id)}
              onChange={(v) => void (v ? actions.addLabel(task.id, l.id) : actions.removeLabel(task.id, l.id))}
              label={<LabelPill name={l.name} color={l.color} />}
            />
          ))}
        </Popover>
      </td>
    </tr>
  )
}
