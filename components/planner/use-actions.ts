'use client'
import { useMemo } from 'react'
import { usePlanner, positionBetween, sortByPosition } from '@/lib/store/planner-store'
import { toast } from '@/components/ui/toast'
import { ImageConversionError, isImage, toWebp } from '@/lib/image'
import type { Label, SectionItem, Task, TaskFile, TaskPriority, TaskSection, TaskStatus } from '@/lib/types'

export const TASK_FILES_BUCKET = 'task-files'
const MAX_TASK_FILE_BYTES = 10 * 1024 * 1024

export function useActions() {
  const { db, state, apply, mutate, viewer } = usePlanner()
  const plannerId = state.planner?.id ?? ''
  const link = viewer.kind === 'guest' ? viewer.linkId : null

  return useMemo(() => {
    const now = () => new Date().toISOString()

    async function post(url: string, body: Record<string, unknown>) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, link }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Fehler')
      return res.json()
    }

    const actions = {
      // ---------------- Tasks ----------------
      async createTask(input: {
        bucketId: string
        title: string
        status?: TaskStatus
        priority?: TaskPriority
        dueDate?: string | null
        assignee?: string | null
        labelId?: string | null
        position?: number
      }) {
        const siblings = Object.values(state.data.tasks).filter((t) => t.bucket_id === input.bucketId)
        const position = input.position ?? positionBetween(undefined, sortByPosition(siblings)[0]?.position)
        const task: Task = {
          id: crypto.randomUUID(),
          planner_id: plannerId,
          bucket_id: input.bucketId,
          title: input.title,
          description: '',
          status: input.status ?? 'not_started',
          priority: input.priority ?? 'medium',
          start_date: null,
          due_date: input.dueDate ?? null,
          position,
          created_by: viewer.kind === 'user' ? viewer.id : null,
          created_by_guest: viewer.kind === 'guest' ? viewer.name : null,
          completed_at: null,
          created_at: now(),
          updated_at: now(),
        }
        const ok = await mutate(
          () => apply('upsert', 'tasks', [task]),
          () =>
            db.from('tasks').insert({
              id: task.id, planner_id: plannerId, bucket_id: task.bucket_id, title: task.title,
              status: task.status, priority: task.priority, due_date: task.due_date, position,
            }),
          'Aufgabe konnte nicht erstellt werden',
        )
        if (!ok) return null
        if (input.assignee) await actions.assign(task.id, input.assignee)
        if (input.labelId) await actions.addLabel(task.id, input.labelId)
        return task.id
      },

      updateTask(id: string, patch: Partial<Task>) {
        const prev = state.data.tasks[id]
        if (!prev) return Promise.resolve(false)
        return mutate(
          () => apply('upsert', 'tasks', [{ ...prev, ...patch, updated_at: now() }]),
          () => db.from('tasks').update(patch).eq('id', id),
        )
      },

      async deleteTask(id: string) {
        const prev = state.data.tasks[id]
        const files = Object.values(state.data.task_files).filter((f) => f.task_id === id)
        const ok = await mutate(
          () => apply('delete', 'tasks', [prev]),
          () => db.from('tasks').delete().eq('id', id),
          'Aufgabe konnte nicht gelöscht werden',
        )
        if (ok && files.length) await db.storage.from(TASK_FILES_BUCKET).remove(files.map((f) => f.storage_path))
        return ok
      },

      async assign(taskId: string, userId: string) {
        apply('upsert', 'task_assignees', [{ task_id: taskId, user_id: userId, planner_id: plannerId }])
        try {
          await post(`/api/tasks/${taskId}/assignees`, { userId })
        } catch {
          apply('delete', 'task_assignees', [{ task_id: taskId, user_id: userId }])
          toast('Zuweisen fehlgeschlagen')
        }
      },

      unassign(taskId: string, userId: string) {
        return mutate(
          () => apply('delete', 'task_assignees', [{ task_id: taskId, user_id: userId }]),
          () => db.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId),
        )
      },

      addLabel(taskId: string, labelId: string) {
        return mutate(
          () => apply('upsert', 'task_labels', [{ task_id: taskId, label_id: labelId, planner_id: plannerId }]),
          () => db.from('task_labels').upsert({ task_id: taskId, label_id: labelId, planner_id: plannerId }),
        )
      },

      removeLabel(taskId: string, labelId: string) {
        return mutate(
          () => apply('delete', 'task_labels', [{ task_id: taskId, label_id: labelId }]),
          () => db.from('task_labels').delete().eq('task_id', taskId).eq('label_id', labelId),
        )
      },

      // ---------------- Buckets ----------------
      createBucket(name: string) {
        const last = sortByPosition(Object.values(state.data.buckets)).at(-1)
        const bucket = { id: crypto.randomUUID(), planner_id: plannerId, name, position: positionBetween(last?.position, undefined) }
        return mutate(
          () => apply('upsert', 'buckets', [bucket]),
          () => db.from('buckets').insert(bucket),
          'Bucket konnte nicht erstellt werden',
        )
      },

      updateBucket(id: string, patch: { name?: string; position?: number }) {
        const prev = state.data.buckets[id]
        return mutate(
          () => apply('upsert', 'buckets', [{ ...prev, ...patch }]),
          () => db.from('buckets').update(patch).eq('id', id),
        )
      },

      deleteBucket(id: string) {
        const prev = state.data.buckets[id]
        const tasks = Object.values(state.data.tasks).filter((t) => t.bucket_id === id)
        return mutate(
          () => {
            apply('delete', 'tasks', tasks)
            apply('delete', 'buckets', [prev])
          },
          () => db.from('buckets').delete().eq('id', id),
          'Bucket konnte nicht gelöscht werden',
        )
      },

      // ---------------- Labels ----------------
      async createLabel(name: string, color: string): Promise<Label | null> {
        const label: Label = { id: crypto.randomUUID(), planner_id: plannerId, name, color }
        const ok = await mutate(
          () => apply('upsert', 'labels', [label]),
          () => db.from('labels').insert(label),
          'Label konnte nicht erstellt werden',
        )
        return ok ? label : null
      },

      deleteLabel(id: string) {
        const prev = state.data.labels[id]
        return mutate(
          () => apply('delete', 'labels', [prev]),
          () => db.from('labels').delete().eq('id', id),
        )
      },

      // ---------------- Abschnitte ----------------
      createSection(taskId: string, title: string) {
        const last = sortByPosition(Object.values(state.data.task_sections).filter((s) => s.task_id === taskId)).at(-1)
        const section: TaskSection = {
          id: crypto.randomUUID(), task_id: taskId, planner_id: plannerId, title, due_date: null,
          position: positionBetween(last?.position, undefined),
        }
        return mutate(
          () => apply('upsert', 'task_sections', [section]),
          () => db.from('task_sections').insert(section),
        )
      },

      updateSection(id: string, patch: Partial<TaskSection>) {
        const prev = state.data.task_sections[id]
        return mutate(
          () => apply('upsert', 'task_sections', [{ ...prev, ...patch }]),
          () => db.from('task_sections').update(patch).eq('id', id),
        )
      },

      deleteSection(id: string) {
        const prev = state.data.task_sections[id]
        const items = Object.values(state.data.section_items).filter((i) => i.section_id === id)
        return mutate(
          () => {
            apply('delete', 'section_items', items)
            apply('delete', 'task_sections', [prev])
          },
          () => db.from('task_sections').delete().eq('id', id),
        )
      },

      createItem(sectionId: string, title: string) {
        const last = sortByPosition(Object.values(state.data.section_items).filter((i) => i.section_id === sectionId)).at(-1)
        const item: SectionItem = {
          id: crypto.randomUUID(), section_id: sectionId, planner_id: plannerId, title, done: false,
          position: positionBetween(last?.position, undefined),
        }
        return mutate(
          () => apply('upsert', 'section_items', [item]),
          () => db.from('section_items').insert(item),
        )
      },

      updateItem(id: string, patch: Partial<SectionItem>) {
        const prev = state.data.section_items[id]
        return mutate(
          () => apply('upsert', 'section_items', [{ ...prev, ...patch }]),
          () => db.from('section_items').update(patch).eq('id', id),
        )
      },

      deleteItem(id: string) {
        const prev = state.data.section_items[id]
        return mutate(
          () => apply('delete', 'section_items', [prev]),
          () => db.from('section_items').delete().eq('id', id),
        )
      },

      // ---------------- Anhänge / Kommentare ----------------
      attach(taskId: string, kbFileId: string) {
        return mutate(
          () => apply('upsert', 'task_attachments', [{ task_id: taskId, kb_file_id: kbFileId, planner_id: plannerId }]),
          () => db.from('task_attachments').upsert({ task_id: taskId, kb_file_id: kbFileId, planner_id: plannerId }),
        )
      },

      detach(taskId: string, kbFileId: string) {
        return mutate(
          () => apply('delete', 'task_attachments', [{ task_id: taskId, kb_file_id: kbFileId }]),
          () => db.from('task_attachments').delete().eq('task_id', taskId).eq('kb_file_id', kbFileId),
        )
      },

      /** Lädt eine Datei hoch; Bilder werden vorher auf Full HD verkleinert und in WebP umgewandelt. */
      async uploadTaskFile(taskId: string, original: File) {
        let file = original
        if (isImage(original)) {
          try {
            file = await toWebp(original)
          } catch (e) {
            toast(`${original.name}: ${e instanceof ImageConversionError ? e.message : 'Bild konnte nicht verarbeitet werden'}`)
            return false
          }
        }
        if (file.size > MAX_TASK_FILE_BYTES) {
          toast(`${file.name}: grösser als 10 MB`)
          return false
        }
        const id = crypto.randomUUID()
        const row: TaskFile = {
          id, task_id: taskId, planner_id: plannerId, name: file.name.replace(/[/\\]/g, '-').slice(-200),
          mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
          storage_path: `${plannerId}/${taskId}/${id}`,
          uploaded_by: viewer.kind === 'user' ? viewer.id : null,
          uploaded_by_guest: viewer.kind === 'guest' ? viewer.name : null,
          created_at: now(),
        }
        // Zeile zuerst: die Storage-Policy verlangt eine passende task_files-Zeile
        const { error } = await db.from('task_files').insert({
          id, task_id: taskId, planner_id: plannerId, name: row.name,
          mime_type: row.mime_type, size_bytes: row.size_bytes, storage_path: row.storage_path,
        })
        if (error) {
          toast(`${file.name} konnte nicht hochgeladen werden`)
          return false
        }
        const up = await db.storage.from(TASK_FILES_BUCKET).upload(row.storage_path, file, { contentType: row.mime_type })
        if (up.error) {
          await db.from('task_files').delete().eq('id', id)
          toast(`${file.name} konnte nicht hochgeladen werden`)
          return false
        }
        apply('upsert', 'task_files', [row])
        return true
      },

      async deleteTaskFile(file: TaskFile) {
        const ok = await mutate(
          () => apply('delete', 'task_files', [file]),
          () => db.from('task_files').delete().eq('id', file.id),
          'Datei konnte nicht gelöscht werden',
        )
        if (ok) await db.storage.from(TASK_FILES_BUCKET).remove([file.storage_path])
        return ok
      },

      async postComment(taskId: string, body: string, mentions: string[]) {
        try {
          await post(`/api/tasks/${taskId}/comments`, { body, mentions })
          return true
        } catch {
          toast('Kommentar konnte nicht gesendet werden')
          return false
        }
      },

      deleteComment(id: string) {
        const prev = state.data.comments[id]
        return mutate(
          () => apply('delete', 'comments', [prev]),
          () => db.from('comments').delete().eq('id', id),
        )
      },
    }
    return actions
  }, [db, state.data, apply, mutate, plannerId, viewer, link])
}
