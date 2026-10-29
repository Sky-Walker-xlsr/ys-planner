'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  CheckSquare, ChevronDown, ChevronRight, Folder as FolderIcon, Inbox, LayoutGrid, MoreHorizontal, Plus, Search, Settings, Star,
} from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { Avatar, PlannerIcon } from '@/components/ui/avatar'
import { MenuItem, Popover } from '@/components/ui/controls'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { FolderShareDialog } from '@/components/share/folder-share-dialog'
import { PLANNER_COLORS } from '@/lib/design'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { Folder, Planner } from '@/lib/types'
import { useSidebarData } from './use-sidebar-data'

const NO_FOLDER = '__none__'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useCurrentUser()
  const router = useRouter()
  const { data, roles, db, reload } = useSidebarData(me.id)
  const params = useParams<{ plannerId?: string }>()
  const pathname = usePathname()
  const activeId = params.plannerId
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newPlannerOpen, setNewPlannerOpen] = useState(false)
  const [folderDialog, setFolderDialog] = useState<{ mode: 'new' } | { mode: 'rename'; folder: Folder } | null>(null)
  const [shareFolder, setShareFolder] = useState<Folder | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const plannersByFolder = useMemo(() => {
    const map = new Map<string, Planner[]>()
    for (const p of data.planners) {
      const key = p.folder_id && data.folders.some((f) => f.id === p.folder_id) ? p.folder_id : NO_FOLDER
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return map
  }, [data.planners, data.folders])

  const memberCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const fm of data.folderMembers) m.set(fm.folder_id, (m.get(fm.folder_id) ?? 0) + 1)
    return m
  }, [data.folderMembers])

  const plannerById = useMemo(() => new Map(data.planners.map((p) => [p.id, p])), [data.planners])
  const favorites = data.favorites.map((f) => plannerById.get(f.planner_id)).filter(Boolean) as Planner[]

  // Eingang-Einträge per Drag & Drop auf einen Planner (Rolle ≥ editor) → erster Bucket
  async function moveInboxTask(taskId: string, planner: Planner) {
    const res = await fetch(`/api/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plannerId: planner.id }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    toast(res.ok ? `In «${planner.name}» verschoben` : body.error ?? 'Verschieben fehlgeschlagen')
  }
  const inboxDrop = (p: Planner) => {
    const role = roles.plannerRole.get(p.id)
    return role === 'owner' || role === 'editor' ? (taskId: string) => void moveInboxTask(taskId, p) : undefined
  }

  async function onDragEnd(e: DragEndEvent) {
    const plannerId = String(e.active.id)
    const target = e.over ? String(e.over.id) : null
    if (!target) return
    const planner = plannerById.get(plannerId)
    if (!planner) return
    const folderId = target === NO_FOLDER ? null : target
    if ((planner.folder_id ?? null) === folderId) return
    if (folderId && roles.folderRole.get(folderId) !== 'owner') {
      toast('Nur Owner des Zielordners können Planner hineinverschieben')
      return
    }
    const { error } = await db.from('planners').update({ folder_id: folderId }).eq('id', plannerId)
    if (error) toast('Planner konnte nicht verschoben werden')
    await reload()
  }

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-on-accent">
          <LayoutGrid size={16} />
        </span>
        <span className="text-[15px] font-semibold">ys-planner</span>
      </div>

      <div className="flex flex-col gap-2 px-3">
        <button type="button" className="btn-primary w-full" onClick={() => setNewPlannerOpen(true)}>
          <Plus size={16} /> Neuer Planner
        </button>
        <SidebarSearch planners={data.planners} onNavigate={onNavigate} />
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-3" aria-label="Planner">
          <Link
            href="/meine-aufgaben"
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === '/meine-aufgaben' ? 'bg-accent-soft text-accent-soft-text font-medium' : 'hover:bg-bg'
            }`}
          >
            <CheckSquare size={16} className="shrink-0" />
            <span className="flex-1">Meine Aufgaben</span>
            {data.myTaskCount > 0 && (
              <span className="rounded-full bg-bg px-1.5 text-xs font-medium text-text-2 border border-line">{data.myTaskCount}</span>
            )}
          </Link>
          <Link
            href="/eingang"
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === '/eingang' ? 'bg-accent-soft text-accent-soft-text font-medium' : 'hover:bg-bg'
            }`}
          >
            <Inbox size={16} className="shrink-0" />
            <span className="flex-1">Eingang</span>
            {data.inboxCount > 0 && (
              <span className="rounded-full bg-bg px-1.5 text-xs font-medium text-text-2 border border-line">{data.inboxCount}</span>
            )}
          </Link>

          {favorites.length > 0 && (
            <Section title="Favoriten" icon={<Star size={12} />}>
              {favorites.map((p) => (
                <PlannerRow key={`fav-${p.id}`} planner={p} active={p.id === activeId} onNavigate={onNavigate} onInboxDrop={inboxDrop(p)} />
              ))}
            </Section>
          )}

          <Section
            title="Ordner"
            action={
              <button type="button" className="btn-icon size-6" aria-label="Neuer Ordner" onClick={() => setFolderDialog({ mode: 'new' })}>
                <Plus size={14} />
              </button>
            }
          >
            {data.folders.map((f) => {
              const open = !collapsed[f.id]
              const list = plannersByFolder.get(f.id) ?? []
              const count = memberCount.get(f.id) ?? 0
              const isOwner = roles.folderRole.get(f.id) === 'owner'
              return (
                <FolderDrop key={f.id} id={f.id}>
                  <div className="group flex items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-bg">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
                      aria-expanded={open}
                      onClick={() => setCollapsed((c) => ({ ...c, [f.id]: open }))}
                    >
                      {open ? <ChevronDown size={14} className="text-text-2" /> : <ChevronRight size={14} className="text-text-2" />}
                      <FolderIcon size={15} className="shrink-0 text-text-2" />
                      <span className="truncate font-medium">{f.name}</span>
                      {count > 1 && <span className="shrink-0 text-xs text-text-2">geteilt · {count}</span>}
                    </button>
                    <Popover
                      align="right"
                      width={180}
                      trigger={({ toggle }) => (
                        <button type="button" className="btn-icon size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Ordner ${f.name}: Aktionen`} onClick={toggle}>
                          <MoreHorizontal size={14} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem onClick={() => { close(); setShareFolder(f) }}>
                            {isOwner ? 'Teilen' : 'Mitglieder anzeigen'}
                          </MenuItem>
                          {isOwner && (
                            <MenuItem onClick={() => { close(); setFolderDialog({ mode: 'rename', folder: f }) }}>Umbenennen</MenuItem>
                          )}
                        </>
                      )}
                    </Popover>
                  </div>
                  {open && (
                    <div className="ml-4">
                      {list.length === 0 && <p className="px-2 py-1 text-xs text-text-2">Leer</p>}
                      {list.map((p) => (
                        <DraggablePlanner key={p.id} planner={p} enabled={roles.plannerRole.get(p.id) === 'owner'}>
                          <PlannerRow planner={p} active={p.id === activeId} onNavigate={onNavigate} onInboxDrop={inboxDrop(p)} />
                        </DraggablePlanner>
                      ))}
                    </div>
                  )}
                </FolderDrop>
              )
            })}
            {data.loaded && data.folders.length === 0 && <p className="px-2 py-1 text-xs text-text-2">Noch keine Ordner</p>}
          </Section>

          <FolderDrop id={NO_FOLDER}>
            <Section title="Ohne Ordner">
              {(plannersByFolder.get(NO_FOLDER) ?? []).map((p) => (
                <DraggablePlanner key={p.id} planner={p} enabled={roles.plannerRole.get(p.id) === 'owner'}>
                  <PlannerRow planner={p} active={p.id === activeId} onNavigate={onNavigate} onInboxDrop={inboxDrop(p)} />
                </DraggablePlanner>
              ))}
              {data.loaded && !(plannersByFolder.get(NO_FOLDER) ?? []).length && (
                <p className="px-2 py-1 text-xs text-text-2">Keine Planner</p>
              )}
            </Section>
          </FolderDrop>
        </nav>
      </DndContext>

      <div className="flex items-center gap-2 border-t border-line px-3 py-3">
        <Avatar name={me.display_name} color={me.avatar_color} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{me.display_name}</div>
          <div className="truncate text-xs text-text-2">via Zitadel</div>
        </div>
        <Link href="/einstellungen" onClick={onNavigate} className="btn-icon" aria-label="Einstellungen">
          <Settings size={17} />
        </Link>
      </div>

      {newPlannerOpen && (
        <NewPlannerDialog
          folders={data.folders.filter((f) => roles.folderRole.get(f.id) === 'owner')}
          onClose={() => setNewPlannerOpen(false)}
          onCreated={async (id) => {
            setNewPlannerOpen(false)
            await reload()
            onNavigate?.()
            router.push(`/p/${id}`)
          }}
        />
      )}
      {folderDialog && (
        <FolderNameDialog
          folder={folderDialog.mode === 'rename' ? folderDialog.folder : null}
          onClose={() => setFolderDialog(null)}
          onDone={async () => {
            setFolderDialog(null)
            await reload()
          }}
        />
      )}
      {shareFolder && (
        <FolderShareDialog
          folder={shareFolder}
          canManage={roles.folderRole.get(shareFolder.id) === 'owner'}
          onClose={() => {
            setShareFolder(null)
            void reload()
          }}
        />
      )}
    </aside>
  )
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-2">
          {icon}
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

export const INBOX_DRAG_TYPE = 'application/x-ys-inbox-task'

function PlannerRow({
  planner,
  active,
  onNavigate,
  onInboxDrop,
}: {
  planner: Planner
  active: boolean
  onNavigate?: () => void
  /** Ablegen eines Eingang-Eintrags (natives Drag & Drop von der Eingang-Seite) */
  onInboxDrop?: (taskId: string) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <Link
      href={`/p/${planner.id}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      onDragOver={onInboxDrop ? (e) => { if (e.dataTransfer.types.includes(INBOX_DRAG_TYPE)) { e.preventDefault(); setOver(true) } } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onInboxDrop ? (e) => {
        const id = e.dataTransfer.getData(INBOX_DRAG_TYPE)
        setOver(false)
        if (id) { e.preventDefault(); onInboxDrop(id) }
      } : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        active ? 'bg-accent-soft text-accent-soft-text font-medium' : 'hover:bg-bg'
      } ${over ? 'ring-2 ring-accent' : ''}`}
    >
      <PlannerIcon name={planner.name} color={planner.color} />
      <span className="truncate">{planner.name}</span>
    </Link>
  )
}

function DraggablePlanner({ planner, enabled, children }: { planner: Planner; enabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: planner.id, disabled: !enabled })
  return (
    <div
      ref={setNodeRef}
      {...(enabled ? listeners : {})}
      {...(enabled ? attributes : {})}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: 'relative' } : undefined}
      className={isDragging ? 'opacity-70' : ''}
    >
      {children}
    </div>
  )
}

function FolderDrop({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`rounded-md ${isOver ? 'ring-2 ring-accent' : ''}`}>
      {children}
    </div>
  )
}

function SidebarSearch({ planners, onNavigate }: { planners: Planner[]; onNavigate?: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState<{ id: string; title: string; planner_id: string | null }[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const plannerMatches = q.trim() ? planners.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5) : []
  const plannerName = new Map(planners.map((p) => [p.id, p.name]))

  function onChange(value: string) {
    setQ(value)
    setOpen(true)
    if (timer.current) clearTimeout(timer.current)
    const term = value.trim().replace(/[%_\\]/g, '')
    if (term.length < 2) {
      setTasks([])
      return
    }
    timer.current = setTimeout(async () => {
      const { data } = await getBrowserClient()
        .from('tasks')
        .select('id, title, planner_id')
        .ilike('title', `%${term}%`)
        .limit(8)
      setTasks(data ?? [])
    }, 200)
  }

  function go(href: string) {
    setOpen(false)
    setQ('')
    onNavigate?.()
    router.push(href)
  }

  return (
    <div className="relative">
      <label htmlFor="sidebar-search" className="sr-only">Suche</label>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
      <input
        id="sidebar-search"
        className="input pl-8"
        placeholder="Suchen"
        value={q}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (plannerMatches.length > 0 || tasks.length > 0) && (
        <div className="card absolute z-30 mt-1 w-full p-1 shadow-lg">
          {plannerMatches.map((p) => (
            <button key={p.id} type="button" onMouseDown={() => go(`/p/${p.id}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg cursor-pointer">
              <PlannerIcon name={p.name} color={p.color} size={16} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {tasks.length > 0 && <div className="px-2 pt-2 pb-1 text-xs font-semibold text-text-2">Aufgaben</div>}
          {tasks.map((t) => (
            <button key={t.id} type="button" onMouseDown={() => go(t.planner_id ? `/p/${t.planner_id}?task=${t.id}` : `/eingang?task=${t.id}`)} className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-bg cursor-pointer">
              <span className="truncate text-sm">{t.title}</span>
              <span className="truncate text-xs text-text-2">{t.planner_id ? plannerName.get(t.planner_id) : 'Eingang'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NewPlannerDialog({
  folders,
  onClose,
  onCreated,
}: {
  folders: Folder[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const me = useCurrentUser()
  const [name, setName] = useState('')
  const [color, setColor] = useState(PLANNER_COLORS[0])
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { data, error } = await getBrowserClient()
      .from('planners')
      .insert({ owner_id: me.id, name: name.trim(), color, folder_id: folderId || null })
      .select('id')
      .single()
    setBusy(false)
    if (error || !data) {
      toast('Planner konnte nicht erstellt werden')
      return
    }
    onCreated(data.id)
  }

  return (
    <Modal open onClose={onClose} title="Neuer Planner" maxWidth={440}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="planner-name" className="field-label">Name</label>
          <input id="planner-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <fieldset>
          <legend className="field-label">Farbe</legend>
          <div className="flex flex-wrap gap-2">
            {PLANNER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Farbe ${c}`}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={`size-7 rounded-md cursor-pointer ${c === color ? 'ring-2 ring-offset-2 ring-accent ring-offset-surface' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="planner-folder" className="field-label">Ordner</label>
          <select id="planner-folder" className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Ohne Ordner</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>Erstellen</button>
        </div>
      </form>
    </Modal>
  )
}

function FolderNameDialog({ folder, onClose, onDone }: { folder: Folder | null; onClose: () => void; onDone: () => void }) {
  const me = useCurrentUser()
  const [name, setName] = useState(folder?.name ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const db = getBrowserClient()
    const { error } = folder
      ? await db.from('folders').update({ name: name.trim() }).eq('id', folder.id)
      : await db.from('folders').insert({ owner_id: me.id, name: name.trim() })
    setBusy(false)
    if (error) {
      toast('Ordner konnte nicht gespeichert werden')
      return
    }
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={folder ? 'Ordner umbenennen' : 'Neuer Ordner'} maxWidth={400}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="folder-name" className="field-label">Name</label>
          <input id="folder-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>{folder ? 'Speichern' : 'Erstellen'}</button>
        </div>
      </form>
    </Modal>
  )
}
