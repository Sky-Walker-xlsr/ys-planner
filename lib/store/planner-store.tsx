'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { getBrowserClient, realtimeReady } from '@/lib/supabase/browser'
import { toast } from '@/components/ui/toast'
import type {
  Bucket, Comment, Folder, FolderMember, KbFile, Label, Planner, PlannerMember, Role,
  SectionItem, Task, TaskAssignee, TaskAttachment, TaskFile, TaskLabel, TaskSection, User, UserTag,
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
  task_files: TaskFile
  user_tags: UserTag
  planner_members: PlannerMember
  folder_members: FolderMember
}
export type TableName = keyof Rows

/** Primärschlüssel je Tabelle: für den Store-Schlüssel und um einzelne Zeilen nachzuladen */
const PKS: { [T in TableName]: (keyof Rows[T] & string)[] } = {
  buckets: ['id'],
  labels: ['id'],
  tasks: ['id'],
  task_assignees: ['task_id', 'user_id'],
  task_labels: ['task_id', 'label_id'],
  task_sections: ['id'],
  section_items: ['id'],
  comments: ['id'],
  kb_files: ['id'],
  task_attachments: ['task_id', 'kb_file_id'],
  task_files: ['id'],
  user_tags: ['task_id', 'name'],
  planner_members: ['planner_id', 'user_id'],
  folder_members: ['folder_id', 'user_id'],
}

const KEYS = Object.fromEntries(
  Object.entries(PKS).map(([t, cols]) => [t, (r: Record<string, unknown>) => cols.map((c) => String(r[c])).join(':')]),
) as unknown as { [T in TableName]: (r: Rows[T]) => string }

/** Wie lange nach einer eigenen Änderung fremde Events für dieselbe Zeile zurückgehalten werden */
const ECHO_WINDOW_MS = 1500

const PLANNER_TABLES: TableName[] = [
  'buckets', 'labels', 'tasks', 'task_assignees', 'task_labels', 'task_sections',
  'section_items', 'comments', 'kb_files', 'task_attachments', 'task_files', 'planner_members',
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
  /** Frisch geladene Zeilen: ersetzt alle Zeilen im Bereich inScope, geschützte Schlüssel bleiben lokal */
  | { type: 'replace'; table: TableName; rows: unknown[]; inScope: (row: unknown) => boolean; protect: (key: string) => boolean }

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
    case 'replace': {
      const key = KEYS[action.table] as (r: unknown) => string
      const old = state.data[action.table] as Record<string, unknown>
      const next: Record<string, unknown> = {}
      let changed = false
      for (const [k, row] of Object.entries(old)) {
        if (!action.inScope(row) || action.protect(k)) next[k] = row
        else changed = true // fällt weg, falls nicht neu geladen
      }
      for (const row of action.rows) {
        const k = key(row)
        if (action.protect(k) && k in old) continue
        const prev = old[k]
        // Unveränderte Zeilen behalten ihr Objekt, damit nichts unnötig neu rendert
        if (prev !== undefined && JSON.stringify(prev) === JSON.stringify({ ...(prev as object), ...(row as object) })) {
          next[k] = prev
        } else {
          next[k] = row
          changed = true
        }
      }
      if (!changed && Object.keys(next).length === Object.keys(old).length) return state
      return { ...state, data: { ...state.data, [action.table]: next } }
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
  /** Gespeicherte Planner-Zeile sofort übernehmen (nicht erst, wenn das Realtime-Event ankommt) */
  setPlanner: (planner: Planner) => void
  /** Führt eine Mutation optimistisch aus: lokal anwenden, dann DB; bei Fehler neu laden. */
  mutate: (local: () => void, remote: () => PromiseLike<{ error: unknown }>, message?: string) => Promise<boolean>
  reload: () => Promise<void>
  /** Sichtbare Daten im Hintergrund neu laden (ohne Ladezustand) */
  refresh: () => Promise<void>
  /** Eine Task mit allem, was dazugehört, frisch laden */
  refreshTask: (taskId: string) => Promise<void>
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

/**
 * plannerId = null: Eingang des eingeloggten Users (Tasks ohne Planner, nur eigene). Gleiche API,
 * damit Task-Popup und Aktionen wiederverwendet werden können.
 */
export function PlannerProvider({
  plannerId,
  viewer,
  children,
}: {
  plannerId: string | null
  viewer: Viewer
  children: React.ReactNode
}) {
  const inbox = plannerId === null
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

  const reloadInbox = useCallback(async () => {
    const { data: tasks } = await db.from('tasks').select('*').is('planner_id', null).eq('owner_id', viewer.id)
    const ids = (tasks ?? []).map((t) => t.id as string)
    const [{ data: files }, { data: tags }, { data: me }] = await Promise.all([
      ids.length ? db.from('task_files').select('*').in('task_id', ids) : Promise.resolve({ data: [] }),
      db.from('user_tags').select('*').eq('user_id', viewer.id),
      db.from('users').select('id, email, display_name, avatar_color').eq('id', viewer.id),
    ])
    const data = emptyCollections()
    for (const t of (tasks ?? []) as Task[]) data.tasks[t.id] = t
    for (const f of (files ?? []) as TaskFile[]) data.task_files[f.id] = f
    for (const t of (tags ?? []) as UserTag[]) data.user_tags[KEYS.user_tags(t)] = t
    const users: Record<string, User> = {}
    for (const u of (me ?? []) as User[]) users[u.id] = u
    setRole('owner')
    dispatch({ type: 'load', planner: null, folder: null, users, data })
  }, [db, viewer.id])

  const reload = useCallback(async () => {
    if (plannerId === null) return reloadInbox()
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
      // Mitglieder auch aus den Elternordnern: Ihre Freigaben gelten für diesen Planner
      const [{ data: f }, { data: chain }] = await Promise.all([
        db.from('folders').select('*').eq('id', planner.folder_id).maybeSingle<Folder>(),
        db.rpc('folder_chain', { f: planner.folder_id }),
      ])
      const { data: fm } = await db.from('folder_members').select('*').in('folder_id', (chain ?? []) as string[])
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
  }, [db, plannerId, reloadInbox])

  useEffect(() => {
    void reload()
  }, [reload])

  // -------------------------------------------------------------------------
  // Eigene Änderungen gegen verspätete Echos schützen
  //
  // Solange eine eigene Änderung an einer Zeile läuft und kurz danach, werden Events für diese
  // Zeile nicht angewendet: Sonst überschreibt das Echo einer älteren Änderung eine neuere lokale.
  // Kam in dieser Zeit ein Event, wird die Zeile danach frisch aus der Datenbank geladen.
  // -------------------------------------------------------------------------
  type Guard = { pending: number; until: number; stale: boolean; table: TableName; row: unknown }
  const guards = useRef(new Map<string, Guard>())
  const recording = useRef<{ table: TableName; row: unknown }[] | null>(null)
  /** Zeitpunkt der letzten eigenen Änderung je Zeile: Ältere Ladevorgänge dürfen sie nicht überschreiben */
  const touchedAt = useRef(new Map<string, number>())

  const refetchRow = useCallback(
    async (table: TableName, row: unknown) => {
      const match = Object.fromEntries(PKS[table].map((c) => [c, (row as Record<string, unknown>)[c]]))
      const { data, error } = await db.from(table).select('*').match(match).maybeSingle()
      if (error) return
      if (data) dispatch({ type: 'upsert', table, rows: [data] })
      else dispatch({ type: 'delete', table, rows: [row] })
    },
    [db],
  )

  const releaseGuard = useCallback(
    (k: string) => {
      const g = guards.current.get(k)
      if (!g) return
      g.pending = Math.max(0, g.pending - 1)
      if (g.pending > 0) return
      g.until = Date.now() + ECHO_WINDOW_MS
      setTimeout(() => {
        const cur = guards.current.get(k)
        if (!cur || cur.pending > 0 || Date.now() < cur.until) return
        guards.current.delete(k)
        if (cur.stale) void refetchRow(cur.table, cur.row)
      }, ECHO_WINDOW_MS + 20)
    },
    [refetchRow],
  )

  /** Event von aussen (Broadcast oder Postgres Changes) für eine Zeile anwenden */
  const applyRemote = useCallback((op: 'upsert' | 'delete', table: TableName, row: unknown) => {
    const k = `${table}|${(KEYS[table] as (r: unknown) => string)(row)}`
    const g = guards.current.get(k)
    if (g && (g.pending > 0 || Date.now() < g.until)) {
      g.stale = true
      g.row = row
      return
    }
    if (op === 'delete' && !(stateRef.current.data[table] as Record<string, unknown>)[k.slice(table.length + 1)]) return
    dispatch({ type: op, table, rows: [row] })
  }, [])

  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  /** Schlüssel mit laufender oder gerade gespeicherter eigener Änderung nicht überschreiben */
  const isProtected = useCallback(
    (table: TableName, since: number) => (key: string) => {
      const k = `${table}|${key}`
      const g = guards.current.get(k)
      if (g && (g.pending > 0 || Date.now() < g.until)) return true
      return (touchedAt.current.get(k) ?? 0) >= since
    },
    [],
  )

  /** since: Start des Ladevorgangs. Danach lokal geänderte Zeilen bleiben unangetastet. */
  const replace = useCallback(
    (table: TableName, rows: unknown[] | null, since: number, inScope: (row: unknown) => boolean = () => true) => {
      if (!rows) return // Fehler beim Laden: lieber nichts löschen
      dispatch({ type: 'replace', table, rows, inScope, protect: isProtected(table, since) })
    },
    [isProtected],
  )

  const refreshing = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshing.current || !stateRef.current.loaded) return
    refreshing.current = true
    const since = Date.now()
    try {
      if (plannerId === null) {
        const { data: tasks } = await db.from('tasks').select('*').is('planner_id', null).eq('owner_id', viewer.id)
        const ids = (tasks ?? []).map((t) => t.id as string)
        const [{ data: files }, { data: tags }] = await Promise.all([
          ids.length ? db.from('task_files').select('*').in('task_id', ids) : Promise.resolve({ data: [] }),
          db.from('user_tags').select('*').eq('user_id', viewer.id),
        ])
        replace('tasks', tasks, since)
        replace('task_files', files, since)
        replace('user_tags', tags, since)
        return
      }
      const [{ data: planner }, ...results] = await Promise.all([
        db.from('planners').select('*').eq('id', plannerId).maybeSingle<Planner>(),
        ...PLANNER_TABLES.map((t) => db.from(t).select('*').eq('planner_id', plannerId)),
      ])
      if (!planner) return void reloadRef.current()
      const prev = stateRef.current.planner
      if (JSON.stringify(prev) !== JSON.stringify(planner)) dispatch({ type: 'planner', planner })
      if (prev && prev.folder_id !== planner.folder_id) return void reloadRef.current()
      PLANNER_TABLES.forEach((t, i) => replace(t, results[i].error ? null : results[i].data, since))
    } finally {
      refreshing.current = false
    }
  }, [db, plannerId, viewer.id, replace])

  const refreshTask = useCallback(
    async (taskId: string) => {
      const since = Date.now()
      const byTask = (r: unknown) => (r as { task_id: string }).task_id === taskId
      const [task, assignees, labels, sections, comments, attachments, files, tags] = await Promise.all([
        db.from('tasks').select('*').eq('id', taskId),
        db.from('task_assignees').select('*').eq('task_id', taskId),
        db.from('task_labels').select('*').eq('task_id', taskId),
        db.from('task_sections').select('*').eq('task_id', taskId),
        db.from('comments').select('*').eq('task_id', taskId),
        db.from('task_attachments').select('*').eq('task_id', taskId),
        db.from('task_files').select('*').eq('task_id', taskId),
        plannerId === null ? db.from('user_tags').select('*').eq('task_id', taskId) : Promise.resolve({ data: null, error: null }),
      ])
      const sectionIds = new Set<string>([
        ...((sections.data ?? []) as TaskSection[]).map((s) => s.id),
        ...Object.values(stateRef.current.data.task_sections).filter((s) => s.task_id === taskId).map((s) => s.id),
      ])
      const items = sectionIds.size
        ? await db.from('section_items').select('*').in('section_id', [...sectionIds])
        : { data: [], error: null }
      const ok = <T,>(r: { data: T[] | null; error: unknown }) => (r.error ? null : r.data)
      replace('tasks', ok(task), since, (r) => (r as Task).id === taskId)
      replace('task_assignees', ok(assignees), since, byTask)
      replace('task_labels', ok(labels), since, byTask)
      replace('task_sections', ok(sections), since, byTask)
      replace('section_items', ok(items), since, (r) => sectionIds.has((r as SectionItem).section_id))
      replace('comments', ok(comments), since, byTask)
      replace('task_attachments', ok(attachments), since, byTask)
      replace('task_files', ok(files), since, byTask)
      if (plannerId === null) replace('user_tags', ok(tags), since, byTask)
    },
    [db, plannerId, replace],
  )

  // Alle 5 Sekunden und beim Zurückkehren in den Tab: sichtbare Daten aktualisieren
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const id = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [refresh])

  // Postgres Changes im Eingang: eigene Tasks und Tags; verschobene Tasks verschwinden
  useEffect(() => {
    if (!inbox) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = db.channel(`db:inbox:${viewer.id}`)
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `owner_id=eq.${viewer.id}` }, (p) => {
      const row = p.new as Task
      if (p.eventType === 'DELETE') {
        applyRemote('delete', 'tasks', p.old)
      } else if (row.planner_id) {
        applyRemote('delete', 'tasks', row)
      } else {
        applyRemote('upsert', 'tasks', row)
        // Mail-Tasks: Anhänge und Tags werden kurz nach dem Task gespeichert
        if (p.eventType === 'INSERT') {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => void reloadInbox(), 2000)
        }
      }
    })
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'user_tags', filter: `user_id=eq.${viewer.id}` }, (p) => {
      applyRemote(p.eventType === 'DELETE' ? 'delete' : 'upsert', 'user_tags', p.eventType === 'DELETE' ? p.old : p.new)
    })
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_files' }, (p) => {
      applyRemote('delete', 'task_files', p.old)
    })
    channel.subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, inbox, viewer.id, reloadInbox, applyRemote])

  // Postgres Changes nur noch für Ordnerrechte; alles im Planner kommt per Broadcast
  useEffect(() => {
    if (plannerId === null) return
    const channel = db.channel(`db:planner:${plannerId}`)
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'folder_members' }, () => {
      if (stateRef.current.planner?.folder_id) void reload()
    })
    // Ordner verschoben: Die geerbten Rechte können sich ändern
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'folders' }, () => {
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
    if (!state.loaded || plannerId === null) return
    void db.rpc('planner_role', { p: plannerId }).then(({ data }) => setRole((data as Role | null) ?? null))
  }, [db, plannerId, state.loaded, state.data.planner_members, state.data.folder_members])

  // Presence + Broadcast (privater Channel, RLS auf realtime.messages)
  useEffect(() => {
    if (plannerId === null) return
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
    // Änderungen aus der Datenbank (Trigger app.tg_broadcast_planner)
    channel.on('broadcast', { event: 'db' }, ({ payload }) => {
      const { op, table, row } = payload as { op: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; row: Record<string, unknown> }
      if (table === 'planners') {
        if (op === 'DELETE') return void reloadRef.current()
        const prev = stateRef.current.planner
        dispatch({ type: 'planner', planner: row as unknown as Planner })
        if (prev && prev.folder_id !== row.folder_id) void reloadRef.current()
        return
      }
      if (!(PLANNER_TABLES as string[]).includes(table)) return
      applyRemote(op === 'DELETE' ? 'delete' : 'upsert', table as TableName, row)
    })
    channel.on('broadcast', { event: '*' }, ({ event, payload }) => {
      if (event === 'db') return
      broadcastHandlers.current.get(event)?.forEach((fn) => fn(payload as Record<string, unknown>))
    })
    let joined = false
    let closed = false
    // Privater Channel: erst mit User-Token beitreten
    void realtimeReady(db).then(() => {
      if (!closed) channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Nach einem Verbindungsabbruch fehlen Events: einmal alles neu laden
        if (joined) void reloadRef.current()
        joined = true
        void channel.track({
          name: viewer.name,
          color: viewer.kind === 'user' ? viewer.color : '#5F6670',
          ...presenceState.current,
        })
      }
      })
    })
    presenceChannel.current = channel
    return () => {
      closed = true
      presenceChannel.current = null
      void db.removeChannel(channel)
    }
  }, [db, plannerId, viewer, applyRemote])

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
    const key = KEYS[table] as (r: unknown) => string
    for (const row of rows) {
      recording.current?.push({ table, row })
      touchedAt.current.set(`${table}|${key(row)}`, Date.now())
    }
    dispatch({ type, table, rows })
  }, [])

  const setPlanner = useCallback((planner: Planner) => dispatch({ type: 'planner', planner }), [])

  const mutate = useCallback(
    async (local: () => void, remote: () => PromiseLike<{ error: unknown }>, message = 'Änderung konnte nicht gespeichert werden') => {
      // Welche Zeilen ändert local()? Diese bis kurz nach dem Speichern vor Echos schützen
      const touched: { table: TableName; row: unknown }[] = []
      recording.current = touched
      try {
        local()
      } finally {
        recording.current = null
      }
      const keys: string[] = []
      for (const { table, row } of touched) {
        const k = `${table}|${(KEYS[table] as (r: unknown) => string)(row)}`
        const g = guards.current.get(k) ?? { pending: 0, until: 0, stale: false, table, row }
        g.pending++
        guards.current.set(k, g)
        touchedAt.current.set(k, Date.now())
        keys.push(k)
      }
      let error: unknown
      try {
        ;({ error } = await remote())
      } catch (e) {
        error = e
      }
      keys.forEach(releaseGuard)
      if (error) {
        console.error(error)
        toast(message)
        await reload()
        return false
      }
      return true
    },
    [reload, releaseGuard],
  )

  const members = useMemo<Member[]>(() => {
    const byUser = new Map<string, Member>()
    const planner = state.planner
    for (const fm of Object.values(state.data.folder_members)) {
      const user = state.users[fm.user_id]
      if (!user) continue
      const existing = byUser.get(fm.user_id)
      if (existing && ROLE_RANK[existing.role] >= ROLE_RANK[fm.role]) continue
      byUser.set(fm.user_id, { user, role: fm.role, origin: 'folder', folderName: fm.folder_id === state.folder?.id ? state.folder.name : undefined })
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
    setPlanner,
    mutate,
    reload,
    refresh,
    refreshTask,
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
  attachments: (KbFile | TaskFile)[]
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
    for (const f of Object.values(d.task_files)) byTask.get(f.task_id)?.attachments.push(f)
    for (const t of byTask.values()) t.sections = sortByPosition(t.sections)
    return byTask
  }, [state.data])
}
