'use client'
import { Calendar, FileText, MessageSquare, Paperclip } from 'lucide-react'
import type { TaskDerived } from '@/lib/store/planner-store'
import { usePlanner } from '@/lib/store/planner-store'
import { UserAvatar } from '@/components/ui/avatar'
import { LabelPill, PrioritySquare, ProgressBar } from '@/components/ui/controls'
import { dueTextClass, formatShort } from '@/lib/dates'
import { PRIORITY_LABEL } from '@/lib/types'
import { progressOf } from '@/lib/grouping'

export function TaskCard({ t, onOpen, dragging = false }: { t: TaskDerived; onOpen: () => void; dragging?: boolean }) {
  const { state } = usePlanner()
  const task = t.task
  const done = task.status === 'done'
  const strongPrio = task.priority === 'urgent' || task.priority === 'important'
  const pct = Math.round(progressOf(t) * 100)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className={`card cursor-pointer p-3 text-left transition-shadow hover:shadow-md ${dragging ? 'shadow-lg ring-2 ring-accent' : ''}`}
    >
      {(t.labels.length > 0 || strongPrio) && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {strongPrio && (
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium">
              <PrioritySquare priority={task.priority} size={10} />
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {t.labels.map((l) => (
            <LabelPill key={l.id} name={l.name} color={l.color} />
          ))}
        </div>
      )}
      <div className={`text-sm font-medium leading-snug ${done ? 'text-text-2 line-through' : ''}`}>{task.title}</div>

      {t.sections.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-xs text-text-2">
            <span>
              {t.sections.length} {t.sections.length === 1 ? 'Abschnitt' : 'Abschnitte'} · {t.itemsDone}/{t.itemsTotal}
            </span>
            <span>{pct}%</span>
          </div>
          <ProgressBar value={progressOf(t)} />
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-3 text-xs text-text-2">
        {task.due_date && (
          <span className={`inline-flex items-center gap-1 ${dueTextClass(task.due_date, done)}`}>
            <Calendar size={13} />
            {formatShort(task.due_date)}
          </span>
        )}
        {t.attachments.length === 1 && (
          <span className="inline-flex min-w-0 items-center gap-1" title={t.attachments[0].name}>
            <FileText size={13} className="shrink-0" />
            <span className="max-w-[110px] truncate">{t.attachments[0].name}</span>
          </span>
        )}
        {t.attachments.length > 1 && (
          <span className="inline-flex items-center gap-1" title="Anhänge">
            <Paperclip size={13} />
            {t.attachments.length}
          </span>
        )}
        {t.commentCount > 0 && (
          <span className="inline-flex items-center gap-1" title="Kommentare">
            <MessageSquare size={13} />
            {t.commentCount}
          </span>
        )}
        <span className="ml-auto flex -space-x-1.5">
          {t.assignees.slice(0, 3).map((id) => (
            <UserAvatar key={id} user={state.users[id]} size={22} className="ring-2 ring-surface" />
          ))}
        </span>
      </div>
    </div>
  )
}
