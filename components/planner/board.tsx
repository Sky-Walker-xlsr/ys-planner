'use client'
import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import { usePlanner, positionBetween, sortByPosition, type TaskDerived } from '@/lib/store/planner-store'
import { groupTasks, type Group, type GroupBy } from '@/lib/grouping'
import { MenuItem, Popover } from '@/components/ui/controls'
import { addDays, endOfWeekISO, todayISO } from '@/lib/dates'
import type { TaskPriority, TaskStatus } from '@/lib/types'
import { TaskCard } from './task-card'
import { AddTaskInline } from './add-task-inline'
import { useActions } from './use-actions'

/** Legt eine Aufgabe in einer Gruppe an und setzt die passende Eigenschaft */
export function useAddToGroup(groupBy: GroupBy) {
  const { state } = usePlanner()
  const actions = useActions()
  return async (groupKey: string, title: string) => {
    const firstBucket = sortByPosition(Object.values(state.data.buckets))[0]
    const bucketId = groupBy === 'bucket' ? groupKey : firstBucket?.id
    if (!bucketId) return
    const today = todayISO()
    const dueFor: Record<string, string | null> = {
      overdue: addDays(today, -1), today, week: endOfWeekISO(today), later: addDays(endOfWeekISO(today), 7), none: null,
    }
    await actions.createTask({
      bucketId,
      title,
      status: groupBy === 'progress' ? (groupKey as TaskStatus) : undefined,
      priority: groupBy === 'priority' ? (groupKey as TaskPriority) : undefined,
      dueDate: groupBy === 'due' ? dueFor[groupKey] : undefined,
      assignee: groupBy === 'assigned' && groupKey !== 'none' ? groupKey : undefined,
      labelId: groupBy === 'label' && groupKey !== 'none' ? groupKey : undefined,
    })
  }
}

const cardId = (groupKey: string, taskId: string) => `${groupKey}::${taskId}`
const parseCardId = (id: string) => {
  const [groupKey, taskId] = id.split('::')
  return { groupKey, taskId }
}

export function Board({ tasks, groupBy, onOpenTask }: { tasks: TaskDerived[]; groupBy: GroupBy; onOpenTask: (id: string) => void }) {
  const { state, members, canEdit } = usePlanner()
  const actions = useActions()
  const addToGroup = useAddToGroup(groupBy)
  const [showDone, setShowDone] = useState<Record<string, boolean>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  const buckets = useMemo(() => sortByPosition(Object.values(state.data.buckets)), [state.data.buckets])
  const labels = useMemo(() => Object.values(state.data.labels).sort((a, b) => a.name.localeCompare(b.name)), [state.data.labels])
  const groups = useMemo(
    () => groupTasks(tasks, groupBy, { buckets, labels, members: members.map((m) => m.user) }),
    [tasks, groupBy, buckets, labels, members],
  )

  // Erledigte sind eingeklappt (ausser in der Spalte «Erledigt» bei Gruppierung nach Fortschritt)
  const visible = (g: Group) => {
    const doneCollapsed = !(groupBy === 'progress' && g.key === 'done') && !showDone[g.key]
    return doneCollapsed ? g.tasks.filter((t) => t.task.status !== 'done') : g.tasks
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const dndEnabled = canEdit && groupBy !== 'due'

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over || active === over) return

    // Bucket verschieben
    if (active.startsWith('bucket:')) {
      if (!over.startsWith('bucket:')) return
      const from = buckets.findIndex((b) => b.id === active.slice(7))
      const to = buckets.findIndex((b) => b.id === over.slice(7))
      if (from < 0 || to < 0) return
      const rest = buckets.filter((_, i) => i !== from)
      await actions.updateBucket(buckets[from].id, { position: positionBetween(rest[to - 1]?.position, rest[to]?.position) })
      return
    }

    // Karte verschieben
    const { groupKey: fromKey, taskId } = parseCardId(active)
    const toKey = over.startsWith('col:') ? over.slice(4) : over.startsWith('bucket:') ? over.slice(7) : parseCardId(over).groupKey
    const target = groups.find((g) => g.key === toKey)
    const t = state.data.tasks[taskId]
    if (!target || !t) return

    const list = visible(target).filter((x) => x.task.id !== taskId)
    let index = list.length
    if (!over.startsWith('col:') && !over.startsWith('bucket:')) {
      const overTask = parseCardId(over).taskId
      const i = list.findIndex((x) => x.task.id === overTask)
      if (i >= 0) {
        const oldIndex = visible(target).findIndex((x) => x.task.id === taskId)
        index = oldIndex >= 0 && oldIndex <= i ? i + 1 : i
      }
    }
    const position = positionBetween(list[index - 1]?.task.position, list[index]?.task.position)

    switch (groupBy) {
      case 'bucket':
        await actions.updateTask(taskId, { bucket_id: toKey, position })
        break
      case 'progress':
        if (fromKey !== toKey) await actions.updateTask(taskId, { status: toKey as TaskStatus })
        break
      case 'priority':
        if (fromKey !== toKey) await actions.updateTask(taskId, { priority: toKey as TaskPriority })
        break
      case 'assigned':
        if (fromKey === toKey) break
        if (fromKey !== 'none') await actions.unassign(taskId, fromKey)
        if (toKey !== 'none') await actions.assign(taskId, toKey)
        break
      case 'label':
        if (fromKey === toKey) break
        if (fromKey !== 'none') await actions.removeLabel(taskId, fromKey)
        if (toKey !== 'none') await actions.addLabel(taskId, toKey)
        break
    }
  }

  const activeTask = activeId && !activeId.startsWith('bucket:') ? tasks.find((t) => t.task.id === parseCardId(activeId).taskId) : null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full items-start gap-4 overflow-x-auto p-5">
        <SortableContext
          items={groupBy === 'bucket' ? buckets.map((b) => `bucket:${b.id}`) : []}
          strategy={horizontalListSortingStrategy}
        >
          {groups.map((g) => {
            const list = visible(g)
            const doneCount = g.tasks.filter((t) => t.task.status === 'done').length
            const collapsible = !(groupBy === 'progress' && g.key === 'done') && doneCount > 0
            return (
              <Column key={g.key} group={g} groupBy={groupBy} sortable={groupBy === 'bucket' && canEdit}>
                {canEdit && <AddTaskInline onAdd={(title) => addToGroup(g.key, title)} />}
                <SortableContext items={list.map((t) => cardId(g.key, t.task.id))} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {list.map((t) => (
                      <SortableCard key={cardId(g.key, t.task.id)} id={cardId(g.key, t.task.id)} disabled={!dndEnabled}>
                        <TaskCard t={t} onOpen={() => onOpenTask(t.task.id)} />
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
                {collapsible && (
                  <button
                    type="button"
                    className="btn-text justify-start"
                    aria-expanded={!!showDone[g.key]}
                    onClick={() => setShowDone((s) => ({ ...s, [g.key]: !s[g.key] }))}
                  >
                    {showDone[g.key] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {showDone[g.key] ? 'Erledigte ausblenden' : `Erledigte anzeigen (${doneCount})`}
                  </button>
                )}
              </Column>
            )
          })}
        </SortableContext>
        {groupBy === 'bucket' && canEdit && <NewBucket />}
        {groupBy === 'bucket' && buckets.length === 0 && !canEdit && (
          <p className="text-sm text-text-2">Dieser Planner hat noch keine Buckets.</p>
        )}
      </div>
      <DragOverlay>{activeTask ? <TaskCard t={activeTask} onOpen={() => {}} dragging /> : null}</DragOverlay>
    </DndContext>
  )
}

function Column({
  group,
  groupBy,
  sortable,
  children,
}: {
  group: Group
  groupBy: GroupBy
  sortable: boolean
  children: React.ReactNode
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: `col:${group.key}` })
  const s = useSortable({ id: `bucket:${group.key}`, disabled: !sortable })
  const style = sortable ? { transform: CSS.Transform.toString(s.transform), transition: s.transition } : undefined

  return (
    <section
      ref={sortable ? s.setNodeRef : undefined}
      style={style}
      className={`flex w-[290px] shrink-0 flex-col gap-2 ${s.isDragging ? 'opacity-60' : ''}`}
      aria-label={group.title}
    >
      <div className="flex items-center gap-1.5 px-1">
        {sortable && (
          <button type="button" className="btn-icon size-6 cursor-grab" aria-label={`Bucket ${group.title} verschieben`} {...s.attributes} {...s.listeners}>
            <GripVertical size={14} />
          </button>
        )}
        {group.color && <span className="size-2.5 rounded-[2px]" style={{ background: group.color }} aria-hidden />}
        {groupBy === 'bucket' ? <BucketTitle id={group.key} name={group.title} /> : <h2 className="truncate text-sm font-semibold">{group.title}</h2>}
        <span className="text-sm text-text-2">{group.tasks.length}</span>
        {groupBy === 'bucket' && <BucketMenu id={group.key} />}
      </div>
      <div ref={setDropRef} className="flex min-h-16 flex-col gap-2">
        {children}
      </div>
    </section>
  )
}

function SortableCard({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : ''}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      {children}
    </div>
  )
}

function BucketTitle({ id, name }: { id: string; name: string }) {
  const { canEdit } = usePlanner()
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  if (!editing || !canEdit) {
    return (
      <h2 className="min-w-0 truncate text-sm font-semibold">
        {canEdit ? (
          <button type="button" className="cursor-text truncate text-left" onClick={() => { setValue(name); setEditing(true) }} title="Umbenennen">
            {name}
          </button>
        ) : (
          name
        )}
      </h2>
    )
  }
  const save = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) void actions.updateBucket(id, { name: value.trim() })
  }
  return (
    <input
      className="input h-7"
      autoFocus
      aria-label="Bucket-Name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

function BucketMenu({ id }: { id: string }) {
  const { canEdit } = usePlanner()
  const actions = useActions()
  const [confirm, setConfirm] = useState(false)
  if (!canEdit) return null
  return (
    <div className="ml-auto">
      <Popover
        align="right"
        width={210}
        onOpenChange={(o) => !o && setConfirm(false)}
        trigger={({ toggle }) => (
          <button type="button" className="btn-icon size-7" aria-label="Bucket-Aktionen" onClick={toggle}>
            <MoreHorizontal size={16} />
          </button>
        )}
      >
        {(close) =>
          confirm ? (
            <div className="p-1.5 text-sm">
              <p className="mb-2">Bucket mit allen Aufgaben löschen?</p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary h-7" onClick={() => setConfirm(false)}>Nein</button>
                <button type="button" className="btn h-7 bg-danger text-white" onClick={() => { close(); void actions.deleteBucket(id) }}>Löschen</button>
              </div>
            </div>
          ) : (
            <MenuItem danger onClick={() => setConfirm(true)}>Bucket löschen</MenuItem>
          )
        }
      </Popover>
    </div>
  )
}

function NewBucket() {
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const save = async () => {
    const n = name.trim()
    setName('')
    setEditing(false)
    if (n) await actions.createBucket(n)
  }
  return (
    <div className="w-[290px] shrink-0">
      {editing ? (
        <input
          className="input"
          autoFocus
          placeholder="Name des Buckets"
          aria-label="Name des neuen Buckets"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button type="button" className="btn-text" onClick={() => setEditing(true)}>
          <Plus size={15} /> Neuer Bucket
        </button>
      )}
    </div>
  )
}
