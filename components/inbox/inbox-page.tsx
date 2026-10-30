'use client'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRightToLine, Inbox, Paperclip } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { PriorityBadge } from '@/components/ui/controls'
import { Modal } from '@/components/ui/modal'
import { PlannerIcon } from '@/components/ui/avatar'
import { toast } from '@/components/ui/toast'
import { INBOX_DRAG_TYPE } from '@/components/sidebar/sidebar'
import { TaskModal } from '@/components/planner/task-modal'
import { PlannerProvider, sortByPosition, usePlanner, type Viewer } from '@/lib/store/planner-store'
import { formatDateTime } from '@/lib/dates'
import { ROLE_RANK, type Bucket, type Planner, type Role, type Task } from '@/lib/types'
import { effectiveFolderRoles } from '@/lib/folders'

export function InboxPage() {
  const me = useCurrentUser()
  const viewer = useMemo<Viewer>(() => ({ kind: 'user', id: me.id, name: me.display_name, color: me.avatar_color }), [me])
  return (
    <PlannerProvider plannerId={null} viewer={viewer}>
      <InboxView />
    </PlannerProvider>
  )
}

function InboxView() {
  const { state, viewer } = usePlanner()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const openId = params.get('task')
  const [moving, setMoving] = useState<Task | null>(null)

  const tasks = useMemo(
    () =>
      Object.values(state.data.tasks).sort(
        (a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.created_at.localeCompare(a.created_at),
      ),
    [state.data.tasks],
  )
  const tagsByTask = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const t of Object.values(state.data.user_tags)) m.set(t.task_id, [...(m.get(t.task_id) ?? []), t.name])
    return m
  }, [state.data.user_tags])
  const filesByTask = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of Object.values(state.data.task_files)) m.set(f.task_id, (m.get(f.task_id) ?? 0) + 1)
    return m
  }, [state.data.task_files])

  const open = (id: string | null) => router.replace(id ? `${pathname}?task=${id}` : pathname, { scroll: false })

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-line bg-surface px-5 py-4">
        <h1 className="text-lg font-semibold">Eingang</h1>
        <p className="text-sm text-text-2">
          Per Mail erstellte Aufgaben ohne Planner. Verschiebe sie per Dialog oder ziehe sie auf einen Planner in der Seitenleiste.
        </p>
      </header>
      <div className="mx-auto w-full max-w-5xl p-5">
        {!state.loaded && <p className="text-sm text-text-2">Lädt …</p>}
        {state.loaded && tasks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-text-2">
            <Inbox size={28} />
            <p>Der Eingang ist leer. Deine Mail-Adresse findest du in den Einstellungen unter «Mail an Planner».</p>
          </div>
        )}
        {tasks.length > 0 && (
          <ul className="card divide-y divide-line">
            {tasks.map((t) => {
              const tags = tagsByTask.get(t.id) ?? []
              const files = filesByTask.get(t.id) ?? 0
              return (
                <li
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(INBOX_DRAG_TYPE, t.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  className={`flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-bg ${t.status === 'done' ? 'opacity-60' : ''}`}
                >
                  <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => open(t.id)}>
                    <span className={`block truncate text-sm font-medium ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
                      <span className="max-w-[260px] truncate">{t.mail_sender ?? (t.created_by === viewer.id ? 'Von dir' : '—')}</span>
                      <span>· {formatDateTime(t.created_at)}</span>
                      {tags.map((n) => (
                        <span key={n} className="rounded-full bg-bg px-1.5 font-medium text-text">#{n}</span>
                      ))}
                      {files > 0 && (
                        <span className="inline-flex items-center gap-0.5" title={`${files} Anhänge`}>
                          <Paperclip size={12} /> {files}
                        </span>
                      )}
                    </span>
                  </button>
                  <PriorityBadge priority={t.priority} />
                  <button type="button" className="btn-secondary h-7" onClick={() => setMoving(t)}>
                    <ArrowRightToLine size={14} /> In Planner verschieben
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {openId && state.data.tasks[openId] && <TaskModal taskId={openId} onClose={() => open(null)} onOpenFile={() => {}} />}
      {moving && <MoveDialog task={moving} onClose={() => setMoving(null)} onMoved={() => { if (openId === moving.id) open(null) }} />}
    </div>
  )
}

/** Planner (Rolle ≥ editor) und Bucket wählen */
function MoveDialog({ task, onClose, onMoved }: { task: Task; onClose: () => void; onMoved: () => void }) {
  const { db, viewer } = usePlanner()
  const [planners, setPlanners] = useState<Planner[] | null>(null)
  const [plannerId, setPlannerId] = useState('')
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [bucketId, setBucketId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [{ data: ps }, { data: pm }, { data: fm }, { data: fs }] = await Promise.all([
        db.from('planners').select('*').order('name'),
        db.from('planner_members').select('planner_id, role').eq('user_id', viewer.id),
        db.from('folder_members').select('folder_id, role').eq('user_id', viewer.id),
        db.from('folders').select('id, parent_id, name'),
      ])
      // Effektive Rolle wie planner_role(): höchste aus Planner- und Ordner-Mitgliedschaft
      const direct = new Map((pm ?? []).map((m) => [m.planner_id as string, m.role as Role]))
      const viaFolder = effectiveFolderRoles(fs ?? [], (fm ?? []) as { folder_id: string; role: Role }[])
      const editable = ((ps ?? []) as Planner[]).filter((p) => {
        const roles = [direct.get(p.id), p.folder_id ? viaFolder.get(p.folder_id) : undefined].filter(Boolean) as Role[]
        return roles.some((r) => ROLE_RANK[r] >= ROLE_RANK.editor)
      })
      setPlanners(editable)
      if (editable[0]) setPlannerId(editable[0].id)
    })()
  }, [db, viewer.id])

  useEffect(() => {
    if (!plannerId) return
    void db
      .from('buckets')
      .select('*')
      .eq('planner_id', plannerId)
      .then(({ data }) => {
        const list = sortByPosition((data ?? []) as Bucket[])
        setBuckets(list)
        setBucketId(list[0]?.id ?? '')
      })
  }, [db, plannerId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch(`/api/tasks/${task.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plannerId, bucketId }),
    })
    setBusy(false)
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return toast(body.error ?? 'Verschieben fehlgeschlagen')
    const p = planners?.find((x) => x.id === plannerId)
    toast(`In «${p?.name ?? 'Planner'}» verschoben`)
    onMoved()
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="In Planner verschieben" maxWidth={440}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="truncate text-sm text-text-2">«{task.title}»</p>
        {planners === null ? (
          <p className="text-sm text-text-2">Lädt …</p>
        ) : planners.length === 0 ? (
          <p className="text-sm text-text-2">Du hast in keinem Planner Bearbeitungsrechte.</p>
        ) : (
          <>
            <div>
              <label htmlFor="move-planner" className="field-label">Planner</label>
              <div className="flex items-center gap-2">
                {planners.find((p) => p.id === plannerId) && (
                  <PlannerIcon name={planners.find((p) => p.id === plannerId)!.name} color={planners.find((p) => p.id === plannerId)!.color} />
                )}
                <select id="move-planner" className="input" value={plannerId} onChange={(e) => setPlannerId(e.target.value)}>
                  {planners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="move-bucket" className="field-label">Bucket</label>
              <select id="move-bucket" className="input" value={bucketId} onChange={(e) => setBucketId(e.target.value)} disabled={!buckets.length}>
                {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {!buckets.length && <p className="mt-1 text-xs text-danger">Dieser Planner hat noch keinen Bucket.</p>}
            </div>
            <p className="text-xs text-text-2">Tags werden zu Labels im Planner, Anhänge werden mitverschoben.</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy || !plannerId || !bucketId}>Verschieben</button>
        </div>
      </form>
    </Modal>
  )
}
