'use client'
import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePlanner, type TaskDerived } from '@/lib/store/planner-store'
import { Segmented, PrioritySquare } from '@/components/ui/controls'
import { addDays, isOverdue, parseISODate, startOfWeekISO, todayISO, toISODate } from '@/lib/dates'
import { useActions } from './use-actions'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const monthFmt = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })

type Entry =
  | { kind: 'task'; id: string; date: string; t: TaskDerived }
  | { kind: 'section'; id: string; date: string; title: string; t: TaskDerived; done: boolean }

export function Schedule({ tasks, onOpenTask }: { tasks: TaskDerived[]; onOpenTask: (id: string) => void }) {
  const { state, canEdit } = usePlanner()
  const actions = useActions()
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState(todayISO())
  const today = todayISO()

  const days = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeekISO(anchor)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    const a = parseISODate(anchor)
    const first = toISODate(new Date(a.getFullYear(), a.getMonth(), 1))
    const start = startOfWeekISO(first)
    const last = toISODate(new Date(a.getFullYear(), a.getMonth() + 1, 0))
    const out: string[] = []
    for (let d = start; d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d)
    return out
  }, [mode, anchor])

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

  function shift(dir: 1 | -1) {
    if (mode === 'week') setAnchor(addDays(anchor, 7 * dir))
    else {
      const a = parseISODate(anchor)
      setAnchor(toISODate(new Date(a.getFullYear(), a.getMonth() + dir, 1)))
    }
  }

  const title = mode === 'month' ? monthFmt.format(parseISODate(anchor)) : `${dayFmt.format(parseISODate(days[0]))} – ${dayFmt.format(parseISODate(days[6]))}`
  const currentMonth = parseISODate(anchor).getMonth()

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => setAnchor(today)}>Heute</button>
        <button type="button" className="btn-icon" aria-label="Zurück" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <button type="button" className="btn-icon" aria-label="Weiter" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <h2 className="text-base font-semibold capitalize">{title}</h2>
        <div className="ml-auto">
          <Segmented label="Zeitraum" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Monat' }, { value: 'week', label: 'Woche' }]} />
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="card grid flex-1 grid-cols-7 overflow-hidden" style={{ gridAutoRows: mode === 'week' ? '1fr' : 'minmax(110px, 1fr)' }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="border-b border-line bg-bg px-2 py-1 text-xs font-medium text-text-2">{d}</div>
          ))}
          {days.map((d) => (
            <Day
              key={d}
              date={d}
              isToday={d === today}
              muted={mode === 'month' && parseISODate(d).getMonth() !== currentMonth}
              entries={byDay.get(d) ?? []}
              canEdit={canEdit}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}

function Day({
  date,
  isToday,
  muted,
  entries,
  canEdit,
  onOpenTask,
}: {
  date: string
  isToday: boolean
  muted: boolean
  entries: Entry[]
  canEdit: boolean
  onOpenTask: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  return (
    <div ref={setNodeRef} className={`min-w-0 border-b border-r border-line p-1.5 ${isOver ? 'bg-accent-soft' : ''} ${muted ? 'bg-bg/50' : ''}`}>
      <div className={`mb-1 text-xs ${isToday ? 'inline-flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-on-accent' : muted ? 'text-text-2' : ''}`}>
        {parseISODate(date).getDate()}
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((e) => (
          <EntryChip key={`${e.kind}:${e.id}`} entry={e} canEdit={canEdit} onOpen={() => onOpenTask(e.t.task.id)} />
        ))}
      </div>
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
