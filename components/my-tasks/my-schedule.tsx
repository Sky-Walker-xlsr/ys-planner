'use client'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { PrioritySquare } from '@/components/ui/controls'
import { CalendarGrid, CalendarHeader, useCalendar } from '@/components/ui/calendar'
import { dueChipClass } from '@/lib/dates'
import type { MyTaskRow } from './my-tasks'

/** Zeitplan von Aufgaben nach Fälligkeitsdatum (Meine Aufgaben, Alle Tasks). */
export function MySchedule({ rows, onMove }: { rows: MyTaskRow[]; onMove: (id: string, dueDate: string) => void }) {
  const cal = useCalendar()
  const router = useRouter()
  const byDay = useMemo(() => {
    const map = new Map<string, MyTaskRow[]>()
    for (const r of rows) {
      if (!r.due_date) continue
      if (!map.has(r.due_date)) map.set(r.due_date, [])
      map.get(r.due_date)!.push(r)
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'de'))
    return map
  }, [rows])
  const undated = rows.filter((r) => !r.due_date).length

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor))

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return
    const date = String(e.over.id).slice(4)
    const id = String(e.active.id)
    if (rows.find((r) => r.id === id)?.due_date !== date) onMove(id, date)
  }

  return (
    <div className="flex h-full flex-col p-5">
      <CalendarHeader cal={cal} />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <CalendarGrid
          cal={cal}
          renderDay={(d) =>
            (byDay.get(d) ?? []).map((r) => (
              <Chip key={r.id} row={r} onOpen={() => router.push(`/p/${r.planner_id}?task=${r.id}`)} />
            ))
          }
        />
      </DndContext>
      {undated > 0 && (
        <p className="mt-2 text-xs text-text-2">
          {undated === 1 ? '1 Aufgabe ohne Fälligkeitsdatum wird' : `${undated} Aufgaben ohne Fälligkeitsdatum werden`} nur in der Liste angezeigt.
        </p>
      )}
    </div>
  )
}

function Chip({ row, onOpen }: { row: MyTaskRow; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id })
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: 'relative' as const } : undefined
  const dueClass = dueChipClass(row.due_date, row.status === 'done')
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={isDragging ? 'opacity-70' : ''}>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-1 text-left text-xs font-medium shadow-card cursor-pointer ${
          dueClass
        }`}
        title={`${row.title} · ${row.planners?.name ?? ''}`}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: row.planners?.color }} aria-hidden />
        <PrioritySquare priority={row.priority} />
        <span className="truncate">{row.title}</span>
      </button>
    </div>
  )
}
