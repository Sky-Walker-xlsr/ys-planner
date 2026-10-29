'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/browser'
import { toast } from '@/components/ui/toast'
import type {
  Bucket, Comment, Folder, FolderMember, KbFile, Label, Planner, PlannerMember, Role,
  SectionItem, Task, TaskAssignee, TaskAttachment, TaskLabel, TaskSection, User,
} from '@/lib/types'
import { ROLE_RANK } from '@/lib/types'

// ---------------------------------------------------------------------------
// Tabellen und ihre Schlüssel
// ---------------------------------------------------------------------------
type Rows = {
  buckets: Bucket
  labels: Label
  tasks: Task
  task_assignees: TaskAssignee
  task_labels: TaskLabel
  task_sections: TaskSection
  section_items: SectionItem
  comments: Comment
  kb_files: KbFile
  task_attachments: TaskAttachment
  planner_members: PlannerMember
  folder_members: FolderMember
}
export type TableName = keyof Rows

const KEYS: { [T in TableName]: (r: Rows[T]) => string } = {
  buckets: (r) => r.id,
  labels: (r) => r.id,
  tasks: (r) => r.id,
  task_assignees: (r) => `${r.task_id}:${r.user_id}`,
  task_labels: (r) => `${r.task_id}:${r.label_id}`,
  task_sections: (r) => r.id,
  section_items: (r) => r.id,
  comments: (r) => r.id,
  kb_files: (r) => r.id,
  task_attachments: (r) => `${r.task_id}:${r.kb_file_id}`,
  planner_members: (r) => `${r.planner_id}:${r.user_id}`,
  folder_members: (r) => `${r.folder_id}:${r.user_id}`,
}

const PLANNER_TABLES: TableName[] = [
  'buckets', 'labels', 'tasks', 'task_assignees', 'task_labels', 'task_sections',
  'section_items', 'comments', 'kb_files', 'task_attachments', 'planner_members',
]

type Collections = { [T in TableName]: Record<string, Rows[T]> }

type State = {
  loaded: boolean
  planner: Planner | null
  folder: Folder | null
  users: Record<string, User>
  data: Collections
}

type Action =
  | { type: 'load'; planner: Planner | null; folder: Folder | null; users: Record<string, User>; data: Collections }
  | { type: 'planner'; planner: Planner }
  | { type: 'folder'; folder: Folder | null }
  | { type: 'users'; users: User[] }
  | { type: 'upsert'; table: TableName; rows: unknown[] }
  | { type: 'delete'; table: TableName; rows: unknown[] }

function emptyCollections(): Collections {
  return Object.fromEntries(Object.keys(KEYS).map((t) => [t, {}])) as Collections
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return { loaded: true, planner: action.planner, folder: action.folder, users: action.users, data: action.data }
    case 'planner':
      return { ...state, planner: action.planner }
    case 'folder':
      return { ...state, folder: action.folder }
    case 'users': {
      const users = { ...state.users }
      for (const u of action.users) users[u.id] = u
      return { ...state, users }
    }
    case 'upsert':
    case 'delete': {
      const key = KEYS[action.table] as (r: unknown) => string
      const coll = { ...state.data[action.table] } as Record<string, unknown>
      for (const row of action.rows) {
        const k = key(row)
        if (action.type === 'delete') delete coll[k]
        else coll[k] = { ...(coll[k] as object), ...(row as object) }
      }
      return { ...state, data: { ...state.data, [action.table]: coll } }
    }
  }
}

// ---------------------------------------------------------------------------
// Kontext
// ---------------------------------------------------------------------------
export type Viewer =
  | { kind: 'user'; id: string; name: string; color: string }
  | { kind: 'guest'; id: string; name: string; linkId: string; perm: 'read' | 'edit' }

export type Member = { user: User; role: Role; origin: 'creator' | 'direct' | 'folder'; folderName?: string }

export type PresenceEntry = { key: string; name: string; color: string; taskId?: string | null; kbFileId?: string | null }

type Ctx = {
  state: State
  db: SupabaseClient
  viewer: Viewer
  role: Role | null
  canEdit: boolean
  isOwner: boolean
  members: Member[]
  apply: (type: 'upsert' | 'delete', table: TableName, rows: unknown[]) => void
  /** Führt eine Mutation optimistisch aus: lokal anwenden, dann DB; bei Fehler neu laden. */
  mutate: (local: () => void, remote: () => PromiseLike<{ error: unknown }>, message?: string) => Promise<boolean>
  reload: () => Promise<void>
  presence: PresenceEntry[]
  setPresence: (p: { taskId?: string | null; kbFileId?: string | null }) => void
  broadcast: (event: string, payload: Record<string, unknown>) => void
  onBroadcast: (event: string, fn: (payload: Record<string, unknown>) => void) => () => void
}

const PlannerContext = createContext<Ctx | null>(null)

export function usePlanner() {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner außerhalb von PlannerProvider')
  return ctx
}

export function PlannerProvider({
  plannerId,
  viewer,
  children,
}: {
  plannerId: string
  viewer: Viewer
  children: React.ReactNode
}) {
  const db = useMemo(() => getBrowserClient(viewer.kind === 'guest' ? viewer.linkId : 'user'), [viewer])
  const [state, dispatch] = useReducer(reducer, {
    loaded: false,
    planner: null,
    folder: null,
    users: {},
    data: emptyCollections(),
  })
  const [role, setRole] = useState<Role | null>(null)
  const [presence, setPresenceState] = useState<PresenceEntry[]>([])
  const presenceChannel = useRef<RealtimeChannel | null>(null)
  const presenceState = useRef<{ taskId?: string | null; kbFileId?: string | null }>({})
  const broadcastHandlers = useRef(new Map<string, Set<(p: Record<string, unknown>) => void>>())
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const fetchUsers = useCallback(
    async (ids: string[]) => {
      const missing = ids.filter((id) => !stateRef.current.users[id])
      if (!missing.length) return
      const { data } = await db.from('users').select('id, email, display_name, avatar_color').in('id', missing)
      if (data) dispatch({ type: 'users', users: data as User[] })
    },
    [db],
  )

  const reload = useCallback(async () => {
    const { data: planner, error } = await db.from('planners').select('*').eq('id', plannerId).maybeSingle<Planner>()
    if (error || !planner) {
      dispatch({ type: 'load', planner: null, folder: null, users: {}, data: emptyCollections() })
      return
    }
    const results = await Promise.all(
      PLANNER_TABLES.map((t) => db.from(t).select('*').eq('planner_id', plannerId)),
    )
    const data = emptyCollections()
    PLANNER_TABLES.forEach((t, i) => {
      const key = KEYS[t] as (r: unknown) => string
      const coll: Record<string, unknown> = {}
      for (const row of results[i].data ?? []) coll[key(row)] = row
      ;(data as Record<string, unknown>)[t] = coll
    })

    let folder: Folder | null = null
    if (planner.folder_id) {
      const [{ data: f }, { data: fm }] = await Promise.all([
        db.from('folders').select('*').eq('id', planner.folder_id).maybeSingle<Folder>(),
        db.from('folder_members').select('*').eq('folder_id', planner.folder_id),
      ])
      folder = f ?? null
      for (const row of (fm ?? []) as FolderMember[]) data.folder_members[KEYS.folder_members(row)] = row
    }

    const userIds = new Set<string>()
    for (const m of Object.values(data.planner_members)) userIds.add(m.user_id)
    for (const m of Object.values(data.folder_members)) userIds.add(m.user_id)
    for (const c of Object.values(data.comments)) if (c.author_user_id) userIds.add(c.author_user_id)
    for (const t of Object.values(data.tasks)) if (t.created_by) userIds.add(t.created_by)
    const users: Record<string, User> = {}
    if (userIds.size) {
      const { data: us } = await db.from('users').select('id, email, display_name, avatar_color').in('id', [...userIds])
      for (const u of (us ?? []) as User[]) users[u.id] = u
    }

    const { data: r } = await db.rpc('planner_role', { p: plannerId })
    setRole((r as Role | null) ?? null)
    dispatch({ type: 'load', planner, folder, users, data })
  }, [db, plannerId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Postgres Changes
  useEffect(() => {
    const channel = db.channel(`db:planner:${plannerId}`)
    for (const table of PLANNER_TABLES) {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, filter: `planner_id=eq.${plannerId}` },
        (p) => dispatch({ type: 'upsert', table, rows: [p.new] }),
      )
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `planner_id=eq.${plannerId}` },
        (p) => dispatch({ type: 'upsert', table, rows: [p.new] }),
      )
      // DELETE-Events lassen sich nicht filtern; es kommt nur der Primärschlüssel
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) => {
        const key = KEYS[table] as (r: unknown) => string
        if (stateRef.current.data[table][key(p.old)]) dispatch({ type: 'delete', table, rows: [p.old] })
      })
    }
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'planners', filter: `id=eq.${plannerId}` },
      (p) => {
        const prev = stateRef.current.planner
        dispatch({ type: 'planner', planner: p.new as Planner })
        if (prev && prev.folder_id !== (p.new as Planner).folder_id) void reload()
      },
    )
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planners' }, (p) => {
      if ((p.old as { id: string }).id === plannerId) void reload()
    })
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'folder_members' }, () => {
      if (stateRef.current.planner?.folder_id) void reload()
    })
    channel.subscribe()
    return () => {
      void db.removeChannel(channel)
    }
  }, [db, plannerId, reload])

  // Neue Mitglieder/Kommentar-Autoren nachladen; Rolle neu bestimmen, wenn sich Mitglieder ändern
  useEffect(() => {
    const ids = new Set<string>()
    for (const m of Object.values(state.data.planner_members)) ids.add(m.user_id)
    for (const m of Object.values(state.data.folder_members)) ids.add(m.user_id)
    for (const c of Object.values(state.data.comments)) if (c.author_user_id) ids.add(c.author_user_id)
    void fetchUsers([...ids])
  }, [state.data.planner_members, state.data.folder_members, state.data.comments, fetchUsers])

  useEffect(() => {
    if (!state.loaded) return
    void db.rpc('planner_role', { p: plannerId }).then(({ data }) => setRole((data as Role | null) ?? null))
  }, [db, plannerId, state.loaded, state.data.planner_members, state.data.folder_members])

  // Presence + Broadcast (privater Channel, RLS auf realtime.messages)
  useEffect(() => {
    const channel = db.channel(`planner:${plannerId}`, {
      config: { private: true, presence: { key: `${viewer.kind}:${viewer.id}` } },
    })
    channel.on('presence', { event: 'sync' }, () => {
      const s = channel.presenceState<PresenceEntry>()
      const list: PresenceEntry[] = []
      for (const [key, metas] of Object.entries(s)) {
        if (key === `${viewer.kind}:${viewer.id}`) continue
        const m = metas[metas.length - 1]
        if (m) list.push({ ...m, key })
      }
      setPresenceState(list)
    })
    channel.on('broadcast', { event: '*' }, ({ event, payload }) => {
      broadcastHandlers.current.get(event)?.forEach((fn) => fn(payload as Record<string, unknown>))
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({
          name: viewer.name,
          color: viewer.kind === 'user' ? viewer.color : '#5F6670',
          ...presenceState.current,
        })
      }
    })
    presenceChannel.current = channel
    return () => {
      presenceChannel.current = null
      void db.removeChannel(channel)
    }
  }, [db, plannerId, viewer])

  const setPresence = useCallback(
    (p: { taskId?: string | null; kbFileId?: string | null }) => {
      presenceState.current = { ...presenceState.current, ...p }
      void presenceChannel.current?.track({
        name: viewer.name,
        color: viewer.kind === 'user' ? viewer.color : '#5F6670',
        ...presenceState.current,
      })
    },
    [viewer],
  )

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    void presenceChannel.current?.send({ type: 'broadcast', event, payload })
  }, [])

  const onBroadcast = useCallback((event: string, fn: (payload: Record<string, unknown>) => void) => {
    const map = broadcastHandlers.current
    if (!map.has(event)) map.set(event, new Set())
    map.get(event)!.add(fn)
    return () => {
      map.get(event)?.delete(fn)
    }
  }, [])

  const apply = useCallback((type: 'upsert' | 'delete', table: TableName, rows: unknown[]) => {
    dispatch({ type, table, rows })
  }, [])

  const mutate = useCallback(
    async (local: () => void, remote: () => PromiseLike<{ error: unknown }>, message = 'Änderung konnte nicht gespeichert werden') => {
      local()
      const { error } = await remote()
      if (error) {
        console.error(error)
        toast(message)
        await reload()
        return false
      }
      return true
    },
    [reload],
  )

  const members = useMemo<Member[]>(() => {
    const byUser = new Map<string, Member>()
    const planner = state.planner
    for (const fm of Object.values(state.data.folder_members)) {
      const user = state.users[fm.user_id]
      if (!user) continue
      byUser.set(fm.user_id, { user, role: fm.role, origin: 'folder', folderName: state.folder?.name })
    }
    for (const pm of Object.values(state.data.planner_members)) {
      const user = state.users[pm.user_id]
      if (!user) continue
      const existing = byUser.get(pm.user_id)
      const origin = planner?.owner_id === pm.user_id ? 'creator' : 'direct'
      if (!existing || ROLE_RANK[pm.role] >= ROLE_RANK[existing.role] || origin === 'creator') {
        byUser.set(pm.user_id, { user, role: pm.role, origin })
      }
    }
    return [...byUser.values()].sort((a, b) =>
      a.origin === 'creator' ? -1 : b.origin === 'creator' ? 1 : a.user.display_name.localeCompare(b.user.display_name),
    )
  }, [state.data.folder_members, state.data.planner_members, state.users, state.planner, state.folder])

  const value: Ctx = {
    state,
    db,
    viewer,
    role,
    canEdit: role === 'owner' || role === 'editor',
    isOwner: role === 'owner' && viewer.kind === 'user',
    members,
    apply,
    mutate,
    reload,
    presence,
    setPresence,
    broadcast,
    onBroadcast,
  }

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}

// ---------------------------------------------------------------------------
// Abgeleitete Daten
// ---------------------------------------------------------------------------
export function sortByPosition<T extends { position: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position)
}

/** Position zwischen zwei Nachbarn (Fractional Indexing) */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1024
  if (before === undefined) return after! - 1024
  if (after === undefined) return before + 1024
  return (before + after) / 2
}

export type TaskDerived = {
  task: Task
  assignees: string[]
  labels: Label[]
  sections: TaskSection[]
  itemsTotal: number
  itemsDone: number
  commentCount: number
  attachments: KbFile[]
}

export function useTaskIndex() {
  const { state } = usePlanner()
  return useMemo(() => {
    const d = state.data
    const byTask = new Map<string, TaskDerived>()
    for (const task of Object.values(d.tasks)) {
      byTask.set(task.id, {
        task, assignees: [], labels: [], sections: [], itemsTotal: 0, itemsDone: 0, commentCount: 0, attachments: [],
      })
    }
    for (const a of Object.values(d.task_assignees)) byTask.get(a.task_id)?.assignees.push(a.user_id)
    for (const tl of Object.values(d.task_labels)) {
      const label = d.labels[tl.label_id]
      if (label) byTask.get(tl.task_id)?.labels.push(label)
    }
    const sectionTask = new Map<string, string>()
    for (const s of Object.values(d.task_sections)) {
      sectionTask.set(s.id, s.task_id)
      byTask.get(s.task_id)?.sections.push(s)
    }
    for (const it of Object.values(d.section_items)) {
      const t = byTask.get(sectionTask.get(it.section_id) ?? '')
      if (!t) continue
      t.itemsTotal++
      if (it.done) t.itemsDone++
    }
    for (const c of Object.values(d.comments)) {
      const t = byTask.get(c.task_id)
      if (t) t.commentCount++
    }
    for (const at of Object.values(d.task_attachments)) {
      const f = d.kb_files[at.kb_file_id]
      if (f) byTask.get(at.task_id)?.attachments.push(f)
    }
    for (const t of byTask.values()) t.sections = sortByPosition(t.sections)
    return byTask
  }, [state.data])
}
