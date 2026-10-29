'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Filter, MoreHorizontal, Star } from 'lucide-react'
import { usePlanner, useTaskIndex } from '@/lib/store/planner-store'
import { AvatarStack, PlannerIcon } from '@/components/ui/avatar'
import { Checkbox, MenuItem, Popover, PrioritySquare } from '@/components/ui/controls'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import {
  EMPTY_FILTERS, GROUP_BY_LABEL, activeFilterCount, matchesFilters, type Filters, type GroupBy,
} from '@/lib/grouping'
import { DUE_BUCKET_LABEL, type DueBucket } from '@/lib/dates'
import { PRIORITY_LABEL, STATUS_LABEL, type Folder, type TaskPriority, type TaskStatus } from '@/lib/types'
import { Board } from './board'
import { Grid } from './grid'
import { Schedule } from './schedule'
import { Charts } from './charts'
import { KnowledgeBase } from './knowledge-base'
import { TaskModal } from './task-modal'
import { request } from '@/lib/file-urls'
import { ShareDialog } from './share-dialog'

const TABS = [
  { key: 'board', label: 'Board' },
  { key: 'grid', label: 'Raster' },
  { key: 'schedule', label: 'Zeitplan' },
  { key: 'charts', label: 'Diagramme' },
  { key: 'kb', label: 'Knowledge Base' },
] as const
type View = (typeof TABS)[number]['key']

export function PlannerView({ guest = false }: { guest?: boolean }) {
  const { state, members, isOwner, viewer } = usePlanner()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const view = (TABS.some((t) => t.key === search.get('view')) ? search.get('view') : 'board') as View
  const taskId = search.get('task')
  const kbFileId = search.get('file')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [groupBy, setGroupBy] = useState<GroupBy>('bucket')
  const [shareOpen, setShareOpen] = useState(false)
  const index = useTaskIndex()

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, search],
  )

  const openTask = useCallback((id: string) => setParams({ task: id }), [setParams])
  const openFile = useCallback((id: string) => setParams({ view: 'kb', file: id, task: null }), [setParams])

  const filtered = useMemo(
    () => [...index.values()].filter((t) => matchesFilters(t, filters)),
    [index, filters],
  )

  if (!state.loaded) {
    return <div className="flex flex-1 items-center justify-center text-sm text-text-2">Planner wird geladen …</div>
  }
  if (!state.planner) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">Planner nicht gefunden</h1>
        <p className="text-sm text-text-2">Er wurde gelöscht oder du hast keinen Zugriff mehr.</p>
      </div>
    )
  }

  const planner = state.planner
  const showToolbar = view === 'board' || view === 'grid' || view === 'schedule' || view === 'charts'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {guest && (
        <div className="border-b border-line bg-accent-soft px-5 py-1.5 text-sm text-accent-soft-text">
          Gastzugang{viewer.kind === 'guest' ? ` · ${viewer.perm === 'edit' ? 'Bearbeiten' : 'Nur lesen'}` : ''}
          {viewer.kind === 'guest' && viewer.name !== 'Gast' ? ` · ${viewer.name}` : ''}
        </div>
      )}
      <header className="border-b border-line bg-surface px-5 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <PlannerIcon name={planner.name} color={planner.color} size={32} />
          <div className="min-w-0 flex-1">
            {state.folder && !guest && <div className="text-xs text-text-2">{state.folder.name} /</div>}
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-lg font-semibold">{planner.name}</h1>
              {viewer.kind === 'user' && <FavoriteStar plannerId={planner.id} userId={viewer.id} />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AvatarStack users={members.map((m) => m.user)} />
            {!guest && (
              <button type="button" className="btn-primary" onClick={() => setShareOpen(true)}>
                Teilen
              </button>
            )}
            {isOwner && <PlannerMenu />}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4">
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Ansichten">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setParams({ view: t.key === 'board' ? null : t.key, file: null })}
                aria-current={view === t.key ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium cursor-pointer ${
                  view === t.key ? 'border-accent text-text' : 'border-transparent text-text-2 hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {showToolbar && (
            <div className="flex items-center gap-2 py-1.5">
              <FilterMenu filters={filters} onChange={setFilters} />
              {(view === 'board' || view === 'grid') && (
                <label className="flex items-center gap-1.5 text-sm text-text-2">
                  Gruppieren nach:
                  <select className="input h-8 w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                    {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
                      <option key={g} value={g}>{GROUP_BY_LABEL[g]}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'board' && <Board tasks={filtered} groupBy={groupBy} onOpenTask={openTask} />}
        {view === 'grid' && <Grid tasks={filtered} groupBy={groupBy} onOpenTask={openTask} />}
        {view === 'schedule' && <Schedule tasks={filtered} onOpenTask={openTask} />}
        {view === 'charts' && <Charts tasks={filtered} onOpenTask={openTask} />}
        {view === 'kb' && <KnowledgeBase fileId={kbFileId} onSelectFile={(id) => setParams({ file: id })} onOpenTask={openTask} />}
      </div>

      {taskId && index.get(taskId) && (
        <TaskModal taskId={taskId} onClose={() => setParams({ task: null })} onOpenFile={openFile} />
      )}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </div>
  )
}

function FavoriteStar({ plannerId, userId }: { plannerId: string; userId: string }) {
  const { db } = usePlanner()
  const [fav, setFav] = useState(false)
  useEffect(() => {
    void db.from('favorites').select('planner_id').eq('planner_id', plannerId).eq('user_id', userId).maybeSingle()
      .then(({ data }) => setFav(!!data))
  }, [db, plannerId, userId])

  async function toggle() {
    const next = !fav
    setFav(next)
    const { error } = next
      ? await db.from('favorites').insert({ user_id: userId, planner_id: plannerId })
      : await db.from('favorites').delete().eq('user_id', userId).eq('planner_id', plannerId)
    if (error) {
      setFav(!next)
      toast('Favorit konnte nicht gespeichert werden')
    }
  }

  return (
    <button
      type="button"
      className="btn-icon size-7"
      aria-pressed={fav}
      aria-label={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
      onClick={toggle}
    >
      <Star size={17} className={fav ? 'fill-[var(--prio-important)] text-[var(--prio-important)]' : ''} />
    </button>
  )
}

function PlannerMenu() {
  const { state, db, viewer } = usePlanner()
  const router = useRouter()
  const planner = state.planner!
  const [dialog, setDialog] = useState<'rename' | 'move' | 'delete' | null>(null)
  const [name, setName] = useState(planner.name)
  const [folders, setFolders] = useState<Folder[]>([])
  const [target, setTarget] = useState(planner.folder_id ?? '')

  async function openMove() {
    setDialog('move')
    const { data } = await db
      .from('folder_members')
      .select('folders(*)')
      .eq('user_id', viewer.id)
      .eq('role', 'owner')
    setFolders(((data ?? []).map((r) => r.folders) as unknown as Folder[]).filter(Boolean))
  }

  async function save(patch: Record<string, unknown>) {
    const { error } = await db.from('planners').update(patch).eq('id', planner.id)
    if (error) toast('Änderung nicht möglich')
    else setDialog(null)
  }

  async function remove() {
    // Die Route löscht auch alle Dateien des Planners in R2
    const { error } = await request(`/api/planners/${planner.id}`, { method: 'DELETE' })
    if (error) return toast('Planner konnte nicht gelöscht werden')
    router.push('/meine-aufgaben')
  }

  return (
    <>
      <Popover
        align="right"
        width={200}
        trigger={({ toggle }) => (
          <button type="button" className="btn-icon" aria-label="Weitere Aktionen" onClick={toggle}>
            <MoreHorizontal size={18} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem onClick={() => { close(); setName(planner.name); setDialog('rename') }}>Umbenennen</MenuItem>
            <MenuItem onClick={() => { close(); void openMove() }}>Verschieben</MenuItem>
            <MenuItem danger onClick={() => { close(); setDialog('delete') }}>Planner löschen</MenuItem>
          </>
        )}
      </Popover>

      <Modal open={dialog === 'rename'} onClose={() => setDialog(null)} title="Planner umbenennen" maxWidth={420}>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save({ name: name.trim() }) }} className="flex flex-col gap-4">
          <div>
            <label htmlFor="rename-planner" className="field-label">Name</label>
            <input id="rename-planner" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Abbrechen</button>
            <button type="submit" className="btn-primary">Speichern</button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'move'} onClose={() => setDialog(null)} title="Planner verschieben" subtitle="Nur in Ordner, deren Owner du bist." maxWidth={420}>
        <form onSubmit={(e) => { e.preventDefault(); void save({ folder_id: target || null }) }} className="flex flex-col gap-4">
          <div>
            <label htmlFor="move-planner" className="field-label">Ordner</label>
            <select id="move-planner" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Ohne Ordner</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Abbrechen</button>
            <button type="submit" className="btn-primary">Verschieben</button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'delete'} onClose={() => setDialog(null)} title="Planner löschen?" maxWidth={420}>
        <p className="text-sm text-text-2">
          «{planner.name}» wird mit allen Aufgaben, Kommentaren und Knowledge-Base-Dateien endgültig gelöscht.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Abbrechen</button>
          <button type="button" className="btn bg-danger text-white hover:brightness-95" onClick={remove}>Endgültig löschen</button>
        </div>
      </Modal>
    </>
  )
}

function FilterMenu({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const { members, state } = usePlanner()
  const labels = Object.values(state.data.labels).sort((a, b) => a.name.localeCompare(b.name))
  const count = activeFilterCount(filters)

  function toggle<K extends keyof Filters>(key: K, value: Filters[K][number]) {
    const list = filters[key] as string[]
    const next = list.includes(value as string) ? list.filter((v) => v !== value) : [...list, value as string]
    onChange({ ...filters, [key]: next })
  }

  return (
    <Popover
      align="right"
      width={280}
      trigger={({ toggle: t }) => (
        <button type="button" className={count ? 'btn-secondary border-accent text-accent' : 'btn-secondary'} onClick={t}>
          <Filter size={14} /> Filter{count ? ` (${count})` : ''}
        </button>
      )}
    >
      <div className="max-h-[70vh] overflow-y-auto">
        <FilterGroup title="Person">
          {members.map((m) => (
            <Checkbox key={m.user.id} checked={filters.people.includes(m.user.id)} onChange={() => toggle('people', m.user.id)} label={m.user.display_name} />
          ))}
          <Checkbox checked={filters.people.includes('none')} onChange={() => toggle('people', 'none')} label="Nicht zugewiesen" />
        </FilterGroup>
        {labels.length > 0 && (
          <FilterGroup title="Label">
            {labels.map((l) => (
              <Checkbox key={l.id} checked={filters.labels.includes(l.id)} onChange={() => toggle('labels', l.id)} label={l.name} />
            ))}
          </FilterGroup>
        )}
        <FilterGroup title="Priorität">
          {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
            <Checkbox
              key={p}
              checked={filters.priorities.includes(p)}
              onChange={() => toggle('priorities', p)}
              label={<span className="inline-flex items-center gap-1.5"><PrioritySquare priority={p} />{PRIORITY_LABEL[p]}</span>}
            />
          ))}
        </FilterGroup>
        <FilterGroup title="Fälligkeit">
          {(Object.keys(DUE_BUCKET_LABEL) as DueBucket[]).map((d) => (
            <Checkbox key={d} checked={filters.due.includes(d)} onChange={() => toggle('due', d)} label={DUE_BUCKET_LABEL[d]} />
          ))}
        </FilterGroup>
        <FilterGroup title="Status">
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
            <Checkbox key={s} checked={filters.status.includes(s)} onChange={() => toggle('status', s)} label={STATUS_LABEL[s]} />
          ))}
        </FilterGroup>
      </div>
      {count > 0 && (
        <div className="border-t border-line pt-1.5">
          <button type="button" className="btn-text w-full" onClick={() => onChange(EMPTY_FILTERS)}>Filter zurücksetzen</button>
        </div>
      )}
    </Popover>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-2">
      <legend className="px-2 pb-0.5 pt-1 text-xs font-semibold text-text-2">{title}</legend>
      {children}
    </fieldset>
  )
}
