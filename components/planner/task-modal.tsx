'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar, Check, ChevronDown, ChevronRight, FileText, GripVertical, ImageIcon, Link2, Paperclip, Plus, Trash2, Upload, X } from 'lucide-react'
import { usePlanner, positionBetween, sortByPosition, useTaskIndex } from '@/lib/store/planner-store'
import { Modal } from '@/components/ui/modal'
import { UserAvatar, shortName } from '@/components/ui/avatar'
import { Checkbox, LabelPill, Popover } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { LABEL_COLORS, LABEL_COLOR_NAMES, labelStyle } from '@/lib/design'
import { dueChipClass, dueTextClass, formatDateTime, relativeTime } from '@/lib/dates'
import { formatBytes } from '@/lib/image'
import { PRIORITY_LABEL, STATUS_LABEL, type KbFile, type SectionItem, type TaskFile, type TaskPriority, type TaskSection, type TaskStatus } from '@/lib/types'
import { taskFileUrl } from '@/lib/file-urls'
import { highlight, normalize, searchTerms } from '@/lib/search'
import { Marked } from './kb-search'
import { useActions } from './use-actions'

export function TaskModal({ taskId, onClose, onOpenFile }: { taskId: string; onClose: () => void; onOpenFile: (id: string) => void }) {
  const { state, canEdit, setPresence, presence } = usePlanner()
  const index = useTaskIndex()
  const t = index.get(taskId)!
  const task = t.task
  const actions = useActions()
  const bucket = task.bucket_id ? state.data.buckets[task.bucket_id] : undefined
  // Eingang: nur Kernfelder (kein Bucket, keine Zuweisungen/Labels/Abschnitte/Kommentare/KB)
  const inbox = task.planner_id === null
  const editingHere = presence.filter((p) => p.taskId === taskId)

  useEffect(() => {
    setPresence({ taskId })
    return () => setPresence({ taskId: null })
  }, [taskId, setPresence])

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href).then(() => toast('Link kopiert'))
  }

  const header = (
    <div className="flex items-center gap-3 border-b border-line px-5 py-3">
      <nav className="min-w-0 flex-1 truncate text-sm text-text-2" aria-label="Pfad">
        {inbox ? 'Eingang' : <>{state.planner?.name} / {bucket?.name}</>}
      </nav>
      {editingHere.length > 0 && (
        <span className="hidden text-xs text-text-2 sm:inline">
          {editingHere.map((p) => shortName(p.name)).join(', ')} {editingHere.length === 1 ? 'bearbeitet' : 'bearbeiten'} gerade
        </span>
      )}
      <button type="button" className="btn-icon" aria-label="Link kopieren" title="Link kopieren" onClick={copyLink}>
        <Link2 size={17} />
      </button>
      <button type="button" className="btn-icon" aria-label="Schliessen" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
  )

  return (
    <Modal open onClose={onClose} maxWidth={1080} header={header} bodyClassName="">
      <div className="flex flex-col md:flex-row">
        <div className="min-w-0 flex-1 p-5">
          <TitleField taskId={task.id} value={task.title} disabled={!canEdit} />

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {!inbox && (
              <Field label="Bucket" id="task-bucket">
                <select id="task-bucket" className="input" disabled={!canEdit} value={task.bucket_id ?? ''}
                  onChange={(e) => void actions.updateTask(task.id, { bucket_id: e.target.value })}>
                  {sortByPosition(Object.values(state.data.buckets)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Status" id="task-status">
              <select id="task-status" className="input" disabled={!canEdit} value={task.status}
                onChange={(e) => void actions.updateTask(task.id, { status: e.target.value as TaskStatus })}>
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Priorität" id="task-priority">
              <select id="task-priority" className="input" disabled={!canEdit} value={task.priority}
                onChange={(e) => void actions.updateTask(task.id, { priority: e.target.value as TaskPriority })}>
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="Startdatum" id="task-start">
              <input id="task-start" type="date" className="input" disabled={!canEdit} value={task.start_date ?? ''}
                onChange={(e) => void actions.updateTask(task.id, { start_date: e.target.value || null })} />
            </Field>
            <Field label="Fälligkeitsdatum" id="task-due">
              <input id="task-due" type="date" disabled={!canEdit} value={task.due_date ?? ''}
                className={`input ${dueChipClass(task.due_date, task.status === 'done')}`}
                onChange={(e) => void actions.updateTask(task.id, { due_date: e.target.value || null })} />
            </Field>
            {!inbox && (
              <div>
                <span className="field-label">Zugewiesen</span>
                <Assignees taskId={task.id} assignees={t.assignees} />
              </div>
            )}
          </div>

          <div className="mt-4">
            <span className="field-label">{inbox ? 'Tags' : 'Labels'}</span>
            {inbox ? <UserTags taskId={task.id} /> : <Labels taskId={task.id} selected={t.labels.map((l) => l.id)} />}
          </div>

          <div className="mt-4">
            <label htmlFor="task-desc" className="field-label">Beschreibung</label>
            <DescriptionField taskId={task.id} value={task.description} disabled={!canEdit} />
          </div>

          {!inbox && <Sections taskId={task.id} sections={t.sections} itemsDone={t.itemsDone} itemsTotal={t.itemsTotal} />}

          <Attachments taskId={task.id} onOpenFile={onOpenFile} withKnowledgeBase={!inbox} />

          {canEdit && <DeleteTask taskId={task.id} onDeleted={onClose} />}
        </div>

        <aside className="flex w-full shrink-0 flex-col border-t border-line bg-bg md:w-[300px] md:rounded-br-dialog md:border-l md:border-t-0">
          {inbox ? (
            <div className="flex-1 p-4 text-sm">
              <span className="field-label">Absender</span>
              <p className="break-words">{task.mail_sender ?? '—'}</p>
              <p className="mt-3 text-xs text-text-2">Kommentare, Zuweisungen und Abschnitte gibt es, sobald die Aufgabe in einem Planner liegt.</p>
            </div>
          ) : (
            <Comments taskId={task.id} />
          )}
          <div className="border-t border-line px-4 py-3 text-xs text-text-2">
            <div>
              Erstellt von {task.created_by ? state.users[task.created_by]?.display_name ?? 'Unbekannt' : task.created_by_guest ?? 'Gast'} ·{' '}
              {formatDateTime(task.created_at)}
            </div>
            <div>Zuletzt geändert {relativeTime(task.updated_at)}</div>
          </div>
        </aside>
      </div>
    </Modal>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
    </div>
  )
}

/** Entwurf nur während der Bearbeitung; sonst wird der aktuelle (auch remote geänderte) Wert angezeigt */
function useDraft(value: string) {
  const [draft, setDraft] = useState<string | null>(null)
  return { text: draft ?? value, draft, setDraft, start: () => setDraft(value), end: () => setDraft(null) }
}

function TitleField({ taskId, value, disabled }: { taskId: string; value: string; disabled: boolean }) {
  const actions = useActions()
  const d = useDraft(value)
  return (
    <textarea
      aria-label="Titel"
      rows={1}
      disabled={disabled}
      value={d.text}
      onFocus={d.start}
      onChange={(e) => d.setDraft(e.target.value.replace(/\n/g, ''))}
      onBlur={() => {
        const v = d.text.trim()
        if (v && v !== value) void actions.updateTask(taskId, { title: v })
        d.end()
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLTextAreaElement).blur()}
      className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold outline-none hover:border-line focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:hover:border-transparent"
    />
  )
}

function DescriptionField({ taskId, value, disabled }: { taskId: string; value: string; disabled: boolean }) {
  const actions = useActions()
  const d = useDraft(value)
  return (
    <textarea
      id="task-desc"
      className="input min-h-24"
      rows={4}
      disabled={disabled}
      placeholder={disabled ? '' : 'Beschreibung hinzufügen'}
      value={d.text}
      onFocus={d.start}
      onChange={(e) => d.setDraft(e.target.value)}
      onBlur={() => {
        if (d.text !== value) void actions.updateTask(taskId, { description: d.text })
        d.end()
      }}
    />
  )
}

function Assignees({ taskId, assignees }: { taskId: string; assignees: string[] }) {
  const { state, members, canEdit } = usePlanner()
  const actions = useActions()
  return (
    <div className="flex min-h-8 items-center gap-1">
      <div className="flex -space-x-1.5">
        {assignees.map((id) => <UserAvatar key={id} user={state.users[id]} size={28} className="ring-2 ring-surface" />)}
      </div>
      {canEdit && (
        <Popover
          width={250}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="btn-icon size-7 rounded-full border border-dashed border-line" aria-label="Zuweisung bearbeiten">
              <Plus size={14} />
            </button>
          )}
        >
          {members.map((m) => (
            <Checkbox
              key={m.user.id}
              checked={assignees.includes(m.user.id)}
              onChange={(v) => void (v ? actions.assign(taskId, m.user.id) : actions.unassign(taskId, m.user.id))}
              label={<span className="flex items-center gap-2"><UserAvatar user={m.user} size={20} />{m.user.display_name}</span>}
            />
          ))}
        </Popover>
      )}
      {!canEdit && assignees.length === 0 && <span className="text-sm text-text-2">Niemand</span>}
    </div>
  )
}

function Labels({ taskId, selected }: { taskId: string; selected: string[] }) {
  const { state, canEdit } = usePlanner()
  const actions = useActions()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(LABEL_COLORS[0])
  const all = Object.values(state.data.labels).sort((a, b) => a.name.localeCompare(b.name))

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const label = await actions.createLabel(name.trim(), color)
    if (label) await actions.addLabel(taskId, label.id)
    setName('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.filter((l) => selected.includes(l.id)).map((l) => (
        <LabelPill key={l.id} name={l.name} color={l.color} onRemove={canEdit ? () => void actions.removeLabel(taskId, l.id) : undefined} />
      ))}
      {canEdit && (
        <Popover
          width={260}
          trigger={({ toggle }) => (
            <button type="button" className="btn-text h-7" onClick={toggle}><Plus size={14} /> Label</button>
          )}
        >
          <div className="max-h-56 overflow-y-auto">
            {all.map((l) => (
              <Checkbox
                key={l.id}
                checked={selected.includes(l.id)}
                onChange={(v) => void (v ? actions.addLabel(taskId, l.id) : actions.removeLabel(taskId, l.id))}
                label={<LabelPill name={l.name} color={l.color} />}
              />
            ))}
          </div>
          <form onSubmit={create} className="mt-1 border-t border-line p-1.5 pt-2">
            <label htmlFor="new-label" className="field-label">Neues Label</label>
            <input id="new-label" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Farbe">
              {LABEL_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={LABEL_COLOR_NAMES[c]}
                  onClick={() => setColor(c)}
                  className={`size-6 rounded-md cursor-pointer ${color === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}`}
                  style={labelStyle(c)} />
              ))}
            </div>
            <button type="submit" className="btn-primary mt-2 w-full" disabled={!name.trim()}>Erstellen</button>
          </form>
        </Popover>
      )}
      {!canEdit && selected.length === 0 && <span className="text-sm text-text-2">Keine</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Abschnitte
// ---------------------------------------------------------------------------
function Sections({ taskId, sections, itemsDone, itemsTotal }: { taskId: string; sections: TaskSection[]; itemsDone: number; itemsTotal: number }) {
  const { canEdit } = usePlanner()
  const actions = useActions()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = sections.findIndex((s) => s.id === e.active.id)
    const to = sections.findIndex((s) => s.id === e.over!.id)
    const rest = sections.filter((_, i) => i !== from)
    await actions.updateSection(String(e.active.id), { position: positionBetween(rest[to - 1]?.position, rest[to]?.position) })
  }

  async function add() {
    const v = title.trim()
    setTitle('')
    setAdding(false)
    if (v) await actions.createSection(taskId, v)
  }

  return (
    <section className="mt-6" aria-label="Abschnitte">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Abschnitte</h3>
        {itemsTotal > 0 && <span className="text-sm text-text-2">{itemsDone} von {itemsTotal} erledigt</span>}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {sections.map((s) => <SectionBox key={s.id} section={s} />)}
          </div>
        </SortableContext>
      </DndContext>
      {canEdit &&
        (adding ? (
          <input className="input mt-2" autoFocus placeholder="Titel des Abschnitts" aria-label="Titel des neuen Abschnitts"
            value={title} onChange={(e) => setTitle(e.target.value)} onBlur={add}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') setAdding(false) }} />
        ) : (
          <button type="button" className="btn-text mt-1" onClick={() => setAdding(true)}><Plus size={15} /> Abschnitt hinzufügen</button>
        ))}
    </section>
  )
}

function SectionBox({ section }: { section: TaskSection }) {
  const { state, canEdit } = usePlanner()
  const actions = useActions()
  const [open, setOpen] = useState(true)
  const titleDraft = useDraft(section.title)
  const [newItem, setNewItem] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const items = useMemo(
    () => sortByPosition(Object.values(state.data.section_items).filter((i) => i.section_id === section.id)),
    [state.data.section_items, section.id],
  )
  const done = items.filter((i) => i.done).length
  const allDone = items.length > 0 && done === items.length
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: section.id, disabled: !canEdit })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onItemDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = items.findIndex((i) => i.id === e.active.id)
    const to = items.findIndex((i) => i.id === e.over!.id)
    const rest = items.filter((_, i) => i !== from)
    await actions.updateItem(String(e.active.id), { position: positionBetween(rest[to - 1]?.position, rest[to]?.position) })
  }

  async function addItem() {
    const v = newItem.trim()
    setNewItem('')
    if (v) await actions.createItem(section.id, v)
    else setAddingItem(false)
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-card border border-line bg-surface ${isDragging ? 'opacity-60 shadow-lg' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-2">
        {canEdit && (
          <button type="button" className="btn-icon size-6 cursor-grab" aria-label="Abschnitt verschieben" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </button>
        )}
        <button type="button" className="btn-icon size-6" aria-expanded={open} aria-label={open ? 'Einklappen' : 'Aufklappen'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <input
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-line focus:border-accent disabled:hover:border-transparent"
          aria-label="Titel des Abschnitts"
          disabled={!canEdit}
          value={titleDraft.text}
          onFocus={titleDraft.start}
          onChange={(e) => titleDraft.setDraft(e.target.value)}
          onBlur={() => {
            const v = titleDraft.text.trim()
            if (v && v !== section.title) void actions.updateSection(section.id, { title: v })
            titleDraft.end()
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {allDone && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-soft-text">Erledigt</span>}
        <label className={`flex items-center gap-1 text-xs ${section.due_date ? dueTextClass(section.due_date, allDone) : 'text-text-2'}`}>
          <Calendar size={13} aria-hidden />
          <span className="sr-only">Fälligkeit des Abschnitts</span>
          <input type="date" className="w-[118px] bg-transparent text-xs outline-none disabled:opacity-100" disabled={!canEdit}
            value={section.due_date ?? ''} onChange={(e) => void actions.updateSection(section.id, { due_date: e.target.value || null })} />
        </label>
        <span className="text-xs tabular-nums text-text-2">{done}/{items.length}</span>
        {canEdit && (
          <button type="button" className="btn-icon size-6" aria-label="Abschnitt löschen" onClick={() => void actions.deleteSection(section.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-line px-3 py-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col">
                {items.map((i) => <ItemRow key={i.id} item={i} />)}
              </ul>
            </SortableContext>
          </DndContext>
          {canEdit &&
            (addingItem ? (
              <input className="input mt-1 h-7" autoFocus placeholder="Neuer Punkt" aria-label="Neuer Punkt"
                value={newItem} onChange={(e) => setNewItem(e.target.value)}
                onBlur={() => { void addItem(); setAddingItem(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); if (e.key === 'Escape') setAddingItem(false) }} />
            ) : (
              <button type="button" className="btn-text h-7" onClick={() => setAddingItem(true)}><Plus size={14} /> Punkt hinzufügen</button>
            ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item }: { item: SectionItem }) {
  const { canEdit } = usePlanner()
  const actions = useActions()
  const titleDraft = useDraft(item.title)
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: item.id, disabled: !canEdit })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-2 rounded-md py-0.5 ${isDragging ? 'bg-bg opacity-70' : ''}`}>
      {canEdit && (
        <button type="button" className="cursor-grab text-text-2 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Punkt verschieben" {...attributes} {...listeners}>
          <GripVertical size={13} />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={`${item.title} erledigt`}
        disabled={!canEdit}
        onClick={() => void actions.updateItem(item.id, { done: !item.done })}
        className={`flex size-4 shrink-0 items-center justify-center rounded border cursor-pointer disabled:cursor-default ${item.done ? 'border-accent bg-accent text-on-accent' : 'border-text-2'}`}
      >
        {item.done && <Check size={12} strokeWidth={3} />}
      </button>
      <input
        aria-label="Punkt"
        disabled={!canEdit}
        className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm outline-none hover:border-line focus:border-accent disabled:hover:border-transparent ${item.done ? 'text-text-2 line-through' : ''}`}
        value={titleDraft.text}
        onFocus={titleDraft.start}
        onChange={(e) => titleDraft.setDraft(e.target.value)}
        onBlur={() => {
          const v = titleDraft.text.trim()
          if (v && v !== item.title) void actions.updateItem(item.id, { title: v })
          titleDraft.end()
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {canEdit && (
        <button type="button" className="btn-icon size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Punkt löschen" onClick={() => void actions.deleteItem(item.id)}>
          <X size={13} />
        </button>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Anhänge
// ---------------------------------------------------------------------------
function Attachments({ taskId, onOpenFile, withKnowledgeBase }: { taskId: string; onOpenFile: (id: string) => void; withKnowledgeBase: boolean }) {
  const { state, canEdit, viewer } = usePlanner()
  const actions = useActions()
  const attached = Object.values(state.data.task_attachments).filter((a) => a.task_id === taskId)
  const files = attached.map((a) => state.data.kb_files[a.kb_file_id]).filter(Boolean)
  const available = Object.values(state.data.kb_files)
    .filter((f) => !attached.some((a) => a.kb_file_id === f.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  const uploads = useMemo(
    () => Object.values(state.data.task_files).filter((f) => f.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [state.data.task_files, taskId],
  )
  const [busy, setBusy] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(list: FileList | File[]) {
    const all = Array.from(list)
    setBusy((n) => n + all.length)
    for (const f of all) {
      await actions.uploadTaskFile(taskId, f)
      setBusy((n) => n - 1)
    }
  }

  // Bilder im neuen Tab anzeigen, alles andere herunterladen (Auslieferung durch den Worker aus R2)
  function open(file: TaskFile) {
    window.open(taskFileUrl(file.id, viewer, { download: !file.mime_type.startsWith('image/') }), '_blank', 'noopener')
  }

  return (
    <section
      className={`mt-6 rounded-card ${dragOver ? 'outline-2 outline-dashed outline-accent outline-offset-4' : ''}`}
      aria-label="Anhänge"
      onDragOver={canEdit ? (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } } : undefined}
      onDragLeave={() => setDragOver(false)}
      onDrop={canEdit ? (e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files) } : undefined}
    >
      <h3 className="mb-2 text-sm font-semibold">Anhänge</h3>
      {uploads.length > 0 && (
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {uploads.map((f) => (
            <div key={f.id} className="group relative flex items-center gap-3 rounded-card border border-line bg-surface p-3 hover:border-accent">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" onClick={() => open(f)}>
                {f.mime_type.startsWith('image/') && f.mime_type !== 'image/svg+xml' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Datei-Route mit Rechteprüfung, kein next/image
                  <img src={taskFileUrl(f.id, viewer)} alt="" loading="lazy" className="size-9 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-bg text-text-2">
                    {f.mime_type.startsWith('image/') ? <ImageIcon size={18} /> : <Paperclip size={18} />}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="block text-xs text-text-2">{formatBytes(f.size_bytes)}</span>
                </span>
              </button>
              {canEdit && (
                <button type="button" className="btn-icon size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`${f.name} löschen`} onClick={() => void actions.deleteTaskFile(f)}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {files.map((f) => (
          <div key={f.id} className="group relative flex items-center gap-3 rounded-card border border-line bg-surface p-3 hover:border-accent">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" onClick={() => onOpenFile(f.id)}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-text"><FileText size={18} /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="block text-xs text-text-2">Knowledge Base</span>
              </span>
            </button>
            {canEdit && (
              <button type="button" className="btn-icon size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`${f.name} entfernen`} onClick={() => void actions.detach(taskId, f.id)}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = '' }}
        />
        <button type="button" className="btn-text" onClick={() => inputRef.current?.click()} disabled={busy > 0}>
          <Upload size={15} /> {busy > 0 ? `Lädt hoch … (${busy})` : 'Datei hochladen'}
        </button>
        {withKnowledgeBase && <Popover
          width={300}
          trigger={({ toggle }) => (
            <button type="button" className="btn-text" onClick={toggle}><Plus size={15} /> Aus Knowledge Base anhängen</button>
          )}
        >
          {(close) =>
            available.length === 0 ? (
              <p className="p-2 text-sm text-text-2">Keine weiteren Dateien in der Knowledge Base.</p>
            ) : (
              <KbPicker files={available} onPick={(id) => { close(); void actions.attach(taskId, id) }} />
            )
          }
        </Popover>}
        <span className="text-xs text-text-2">Bilder werden auf Full HD verkleinert und als WebP gespeichert · max. 10 MB</span>
        </div>
      )}
    </section>
  )
}

/** Auswahl einer KB-Datei mit Suche nach Namen */
function KbPicker({ files, onPick }: { files: KbFile[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const terms = searchTerms(q)
  const shown = terms.length ? files.filter((f) => terms.every((t) => normalize(f.name).includes(t))) : files
  return (
    <div>
      <input
        className="input mb-1 h-7"
        placeholder="Datei suchen …"
        aria-label="Knowledge-Base-Datei suchen"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0].id) } }}
      />
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg cursor-pointer"
              onClick={() => onPick(f.id)}>
              <FileText size={15} className="shrink-0 text-text-2" />
              <span className="truncate"><Marked segments={highlight(f.name, terms)} /></span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-1.5 text-sm text-text-2">Keine Treffer</li>}
      </ul>
    </div>
  )
}

/** Persönliche Tags eines Inbox-Tasks; werden beim Verschieben in einen Planner zu Labels */
function UserTags({ taskId }: { taskId: string }) {
  const { state, db, viewer, apply, mutate } = usePlanner()
  const tags = Object.values(state.data.user_tags).filter((t) => t.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const [draft, setDraft] = useState('')

  async function add() {
    const name = draft.trim().replace(/^#/, '').replace(/s+/g, '-').toLowerCase().slice(0, 60)
    setDraft('')
    if (!name || tags.some((t) => t.name === name)) return
    const row = { task_id: taskId, user_id: viewer.id, name, created_at: new Date().toISOString() }
    await mutate(() => apply('upsert', 'user_tags', [row]), () => db.from('user_tags').insert({ task_id: taskId, user_id: viewer.id, name }))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t.name} className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-xs font-medium">
          #{t.name}
          <button type="button" className="cursor-pointer text-text-2 hover:text-text" aria-label={`Tag ${t.name} entfernen`}
            onClick={() => void mutate(() => apply('delete', 'user_tags', [t]), () => db.from('user_tags').delete().eq('task_id', taskId).eq('name', t.name))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="input h-7 w-32"
        placeholder="+ Tag"
        aria-label="Tag hinzufügen"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
        onBlur={() => { if (draft.trim()) void add() }}
      />
    </div>
  )
}

function DeleteTask({ taskId, onDeleted }: { taskId: string; onDeleted: () => void }) {
  const actions = useActions()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="mt-8 border-t border-line pt-3">
      {confirm ? (
        <div className="flex items-center gap-2 text-sm">
          <span>Aufgabe endgültig löschen?</span>
          <button type="button" className="btn-secondary h-7" onClick={() => setConfirm(false)}>Abbrechen</button>
          <button type="button" className="btn h-7 bg-danger text-white" onClick={async () => { onDeleted(); await actions.deleteTask(taskId) }}>Löschen</button>
        </div>
      ) : (
        <button type="button" className="btn h-7 px-0 text-danger hover:underline" onClick={() => setConfirm(true)}>
          <Trash2 size={14} /> Aufgabe löschen
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kommentare
// ---------------------------------------------------------------------------
function Comments({ taskId }: { taskId: string }) {
  const { state, members, canEdit, viewer } = usePlanner()
  const actions = useActions()
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const comments = useMemo(
    () => Object.values(state.data.comments).filter((c) => c.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [state.data.comments, taskId],
  )

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [comments.length])

  const suggestions = query === null ? [] : members.filter((m) => m.user.display_name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

  function onInput(value: string) {
    setBody(value)
    const caret = ref.current?.selectionStart ?? value.length
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret))
    setQuery(m ? m[2] : null)
    setActive(0)
  }

  function pick(user: { id: string; display_name: string }) {
    const el = ref.current!
    const caret = el.selectionStart
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${user.display_name} `)
    const next = before + body.slice(caret)
    setBody(next)
    setMentions((ms) => (ms.some((m) => m.id === user.id) ? ms : [...ms, { id: user.id, name: user.display_name }]))
    setQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    const ids = mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id)
    const ok = await actions.postComment(taskId, text, ids)
    setSending(false)
    if (ok) {
      setBody('')
      setMentions([])
    }
  }

  return (
    <div className="flex min-h-[320px] flex-1 flex-col md:max-h-[calc(100vh-180px)]">
      <h3 className="px-4 pt-4 text-sm font-semibold">Kommentare</h3>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {comments.length === 0 && <p className="text-sm text-text-2">Noch keine Kommentare.</p>}
        <ul className="flex flex-col gap-3">
          {comments.map((c) => {
            const author = c.author_user_id ? state.users[c.author_user_id] : undefined
            const name = author?.display_name ?? c.guest_name ?? 'Gast'
            const own = (viewer.kind === 'user' && c.author_user_id === viewer.id) || (viewer.kind === 'guest' && c.guest_id === viewer.id)
            return (
              <li key={c.id} className="group flex gap-2">
                <UserAvatar user={author ?? { id: '', email: '', display_name: name, avatar_color: '#5F6670' }} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <time className="text-xs text-text-2" dateTime={c.created_at}>{relativeTime(c.created_at)}</time>
                    {own && canEdit && (
                      <button type="button" className="ml-auto text-xs text-text-2 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100 cursor-pointer" onClick={() => void actions.deleteComment(c.id)}>
                        Löschen
                      </button>
                    )}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words rounded-lg rounded-tl-sm border border-line bg-surface px-3 py-2 text-sm">
                    <CommentBody body={c.body} mentionNames={c.mentions.map((id) => state.users[id]?.display_name).filter(Boolean) as string[]} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      {canEdit ? (
        <div className="relative border-t border-line p-3">
          {suggestions.length > 0 && (
            <ul className="card absolute bottom-full left-3 right-3 mb-1 p-1 shadow-lg" role="listbox" aria-label="Erwähnen">
              {suggestions.map((m, i) => (
                <li key={m.user.id} role="option" aria-selected={i === active}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(m.user) }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer ${i === active ? 'bg-bg' : ''}`}>
                    <UserAvatar user={m.user} size={20} />
                    {m.user.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="comment-input" className="sr-only">Kommentar</label>
          <textarea
            id="comment-input"
            ref={ref}
            className="input min-h-[72px] resize-none bg-surface"
            placeholder="Kommentar schreiben – @ für Erwähnungen"
            value={body}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (suggestions.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length) }
                else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active].user) }
                else if (e.key === 'Escape') { e.stopPropagation(); setQuery(null) }
                return
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
            }}
          />
          <div className="mt-2 flex justify-end">
            <button type="button" className="btn-primary" disabled={!body.trim() || sending} onClick={send}>Senden</button>
          </div>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-xs text-text-2">Nur Bearbeiter können kommentieren.</p>
      )}
    </div>
  )
}

function CommentBody({ body, mentionNames }: { body: string; mentionNames: string[] }) {
  if (!mentionNames.length) return <>{body}</>
  const escaped = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'))
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('@') && mentionNames.includes(p.slice(1)) ? (
          <span key={i} className="rounded bg-accent-soft px-0.5 font-medium text-accent-soft-text">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}
