'use client'
import { useMemo } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { usePlanner, type TaskDerived } from '@/lib/store/planner-store'
import { PrioritySquare } from '@/components/ui/controls'
import { CalendarGrid, CalendarHeader, useCalendar } from '@/components/ui/calendar'
import { isOverdue } from '@/lib/dates'
import { useActions } from './use-actions'

type Entry =
  | { kind: 'task'; id: string; date: string; t: TaskDerived }
  | { kind: 'section'; id: string; date: string; title: string; t: TaskDerived; done: boolean }

export function Schedule({ tasks, onOpenTask }: { tasks: TaskDerived[]; onOpenTask: (id: string) => void }) {
  const { state, canEdit } = usePlanner()
  const actions = useActions()
  const cal = useCalendar()

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>()
    const push = (e: Entry) => {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    for (const t of tasks) {
      if (t.task.due_date) push({ kind: 'task', id: t.task.id, date: t.task.due_date, t })
      for (const s of t.sections) {
        if (!s.due_date) continue
        const items = Object.values(state.data.section_items).filter((i) => i.section_id === s.id)
        push({ kind: 'section', id: s.id, date: s.due_date, title: s.title, t, done: items.length > 0 && items.every((i) => i.done) })
      }
    }
    return map
  }, [tasks, state.data.section_items])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor))

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over) return
    const date = String(e.over.id).slice(4)
    const [kind, id] = String(e.active.id).split(':')
    if (kind === 'task') await actions.updateTask(id, { due_date: date })
    else await actions.updateSection(id, { due_date: date })
  }

  return (
    <div className="flex h-full flex-col p-5">
      <CalendarHeader cal={cal} />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <CalendarGrid
          cal={cal}
          renderDay={(d) =>
            (byDay.get(d) ?? []).map((e) => (
              <EntryChip key={`${e.kind}:${e.id}`} entry={e} canEdit={canEdit} onOpen={() => onOpenTask(e.t.task.id)} />
            ))
          }
        />
      </DndContext>
    </div>
  )
}

function EntryChip({ entry, canEdit, onOpen }: { entry: Entry; canEdit: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${entry.kind}:${entry.id}`, disabled: !canEdit })
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: 'relative' as const } : undefined
  const done = entry.kind === 'task' ? entry.t.task.status === 'done' : entry.done
  const overdue = isOverdue(entry.date, done)

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={isDragging ? 'opacity-70' : ''}>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border text-left cursor-pointer ${
          entry.kind === 'task'
            ? 'border-line bg-surface px-1.5 py-1 text-xs font-medium shadow-card'
            : 'border-dashed border-line bg-transparent px-1.5 py-0.5 text-[11px] text-text-2'
        } ${done ? 'line-through opacity-70' : ''} ${overdue ? 'border-danger/60 text-danger' : ''}`}
        title={entry.kind === 'section' ? `Abschnitt «${entry.title}» · ${entry.t.task.title}` : entry.t.task.title}
      >
        {entry.kind === 'task' && <PrioritySquare priority={entry.t.task.priority} />}
        <span className="truncate">{entry.kind === 'task' ? entry.t.task.title : `${entry.title} · ${entry.t.task.title}`}</span>
      </button>
    </div>
  )
}
