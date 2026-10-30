'use client'
import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRightToLine, Inbox, Paperclip } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { PriorityBadge } from '@/components/ui/controls'
import { INBOX_DRAG_TYPE } from '@/components/sidebar/sidebar'
import { TaskModal } from '@/components/planner/task-modal'
import { MoveTaskDialog } from '@/components/planner/move-task-dialog'
import { PlannerProvider, usePlanner, type Viewer } from '@/lib/store/planner-store'
import { formatDateTime } from '@/lib/dates'
import type { Task } from '@/lib/types'

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
      {moving && <MoveTaskDialog task={moving} onClose={() => setMoving(null)} onMoved={() => { if (openId === moving.id) open(null) }} />}
    </div>
  )
}
