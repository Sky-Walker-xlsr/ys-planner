'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, FileText, MoreHorizontal, Plus, Upload } from 'lucide-react'
import { usePlanner } from '@/lib/store/planner-store'
import { MenuItem, Popover, Segmented } from '@/components/ui/controls'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { shortName } from '@/components/ui/avatar'
import { formatDateTime } from '@/lib/dates'
import type { KbFile } from '@/lib/types'

const BUCKET = 'knowledge-base'
const MAX_BYTES = 2 * 1024 * 1024
type Mode = 'edit' | 'split' | 'preview'

function normalizeName(name: string) {
  const base = name.trim().replace(/[/\\]/g, '-').replace(/\.md$/i, '')
  return `${base || 'Unbenannt'}.md`
}

export function KnowledgeBase({
  fileId,
  onSelectFile,
  onOpenTask,
}: {
  fileId: string | null
  onSelectFile: (id: string | null) => void
  onOpenTask: (id: string) => void
}) {
  const { state, db, canEdit, apply, mutate } = usePlanner()
  const plannerId = state.planner!.id
  const files = useMemo(
    () => Object.values(state.data.kb_files).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [state.data.kb_files],
  )
  const attachCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of Object.values(state.data.task_attachments)) m.set(a.kb_file_id, (m.get(a.kb_file_id) ?? 0) + 1)
    return m
  }, [state.data.task_attachments])
  const selected = fileId ? state.data.kb_files[fileId] : files[0]
  const [dragOver, setDragOver] = useState(false)
  const [renaming, setRenaming] = useState<KbFile | null>(null)
  const [deleting, setDeleting] = useState<KbFile | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const uniqueName = useCallback(
    (wanted: string) => {
      const names = new Set(files.map((f) => f.name.toLowerCase()))
      let name = normalizeName(wanted)
      for (let i = 2; names.has(name.toLowerCase()); i++) name = normalizeName(`${wanted.replace(/\.md$/i, '')} ${i}`)
      return name
    },
    [files],
  )

  async function createFile(name: string, content: string) {
    const id = crypto.randomUUID()
    const storage_path = `${plannerId}/${id}.md`
    const row: KbFile = {
      id, planner_id: plannerId, name: uniqueName(name), storage_path,
      updated_by: null, updated_by_guest: null, updated_at: new Date().toISOString(),
    }
    const ok = await mutate(
      () => apply('upsert', 'kb_files', [row]),
      () => db.from('kb_files').insert({ id, planner_id: plannerId, name: row.name, storage_path }),
      'Datei konnte nicht angelegt werden',
    )
    if (!ok) return
    const { error } = await db.storage.from(BUCKET).upload(storage_path, new Blob([content], { type: 'text/markdown' }), {
      contentType: 'text/markdown',
      upsert: true,
    })
    if (error) toast('Inhalt konnte nicht gespeichert werden')
    onSelectFile(id)
  }

  async function uploadFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      if (!/\.md$/i.test(file.name)) {
        toast(`${file.name}: nur .md-Dateien erlaubt`)
        continue
      }
      if (file.size > MAX_BYTES) {
        toast(`${file.name}: grösser als 2 MB`)
        continue
      }
      await createFile(file.name, await file.text())
    }
  }

  async function rename(file: KbFile, name: string) {
    const next = uniqueName(name)
    await mutate(
      () => apply('upsert', 'kb_files', [{ ...file, name: next }]),
      () => db.from('kb_files').update({ name: next }).eq('id', file.id),
    )
  }

  async function remove(file: KbFile) {
    const links = Object.values(state.data.task_attachments).filter((a) => a.kb_file_id === file.id)
    const ok = await mutate(
      () => {
        apply('delete', 'task_attachments', links)
        apply('delete', 'kb_files', [file])
      },
      () => db.from('kb_files').delete().eq('id', file.id),
      'Datei konnte nicht gelöscht werden',
    )
    if (ok) await db.storage.from(BUCKET).remove([file.storage_path])
    if (selected?.id === file.id) onSelectFile(null)
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-line bg-surface p-4 md:w-[280px] md:border-b-0 md:border-r">
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(e.dataTransfer.files) }}
              className={`flex flex-col items-center gap-1 rounded-card border-2 border-dashed px-3 py-4 text-sm font-medium text-accent-soft-text cursor-pointer ${
                dragOver ? 'border-accent bg-accent-soft' : 'border-accent/40 bg-accent-soft/70'
              }`}
            >
              <Upload size={18} />
              .md hochladen
              <span className="text-xs font-normal">oder hierher ziehen</span>
            </button>
            <input ref={inputRef} type="file" accept=".md,text/markdown" multiple hidden
              onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.target.value = '' }} />
            <button type="button" className="btn-secondary" onClick={() => void createFile('Neue Seite', '# Neue Seite\n')}>
              <Plus size={15} /> Neue Seite
            </button>
          </>
        )}
        <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Dateien">
          {files.length === 0 && <li className="px-2 py-1 text-sm text-text-2">Noch keine Dateien.</li>}
          {files.map((f) => (
            <li key={f.id} className={`group flex items-start gap-1 rounded-md ${selected?.id === f.id ? 'bg-accent-soft text-accent-soft-text' : 'hover:bg-bg'}`}>
              <button type="button" className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left cursor-pointer" onClick={() => onSelectFile(f.id)}
                aria-current={selected?.id === f.id ? 'true' : undefined}>
                <FileText size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="block truncate text-xs opacity-80">
                    An {attachCount.get(f.id) ?? 0} Tasks angehängt · {formatDateTime(f.updated_at)}
                  </span>
                </span>
              </button>
              {canEdit && (
                <Popover
                  align="right"
                  width={170}
                  trigger={({ toggle }) => (
                    <button type="button" className="btn-icon mt-1 size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`${f.name}: Aktionen`} onClick={toggle}>
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem onClick={() => { close(); setRenaming(f) }}>Umbenennen</MenuItem>
                      <MenuItem danger onClick={() => { close(); setDeleting(f) }}>Löschen</MenuItem>
                    </>
                  )}
                </Popover>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-2">Rechte wie im Planner</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <Editor key={selected.id} file={selected} onOpenTask={onOpenTask} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-text-2">Wähle eine Datei oder lege eine neue Seite an.</div>
        )}
      </div>

      {renaming && <RenameDialog file={renaming} onClose={() => setRenaming(null)} onSave={(n) => { void rename(renaming, n); setRenaming(null) }} />}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Datei löschen?" maxWidth={420}>
        <p className="text-sm text-text-2">
          «{deleting?.name}» wird gelöscht und von {attachCount.get(deleting?.id ?? '') ?? 0} Tasks entfernt.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>Abbrechen</button>
          <button type="button" className="btn bg-danger text-white" onClick={() => { if (deleting) void remove(deleting); setDeleting(null) }}>Löschen</button>
        </div>
      </Modal>
    </div>
  )
}

function RenameDialog({ file, onClose, onSave }: { file: KbFile; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(file.name.replace(/\.md$/i, ''))
  return (
    <Modal open onClose={onClose} title="Datei umbenennen" maxWidth={420}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name) }} className="flex flex-col gap-4">
        <div>
          <label htmlFor="kb-rename" className="field-label">Name</label>
          <div className="flex items-center gap-2">
            <input id="kb-rename" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={190} />
            <span className="text-sm text-text-2">.md</span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary">Speichern</button>
        </div>
      </form>
    </Modal>
  )
}

type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error'

function Editor({ file, onOpenTask }: { file: KbFile; onOpenTask: (id: string) => void }) {
  const { db, canEdit, state, setPresence, presence, broadcast, onBroadcast } = usePlanner()
  const [mode, setMode] = useState<Mode>(canEdit ? 'split' : 'preview')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<SaveState>('loading')
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef('')

  const load = useCallback(async () => {
    const { data, error } = await db.storage.from(BUCKET).download(file.storage_path)
    // Fehlt das Objekt noch (z. B. Seed-Daten), gilt die Datei als leer
    const text = error || !data ? '' : await data.text()
    if (!dirty.current) {
      setContent(text)
      latest.current = text
      setStatus('saved')
    }
  }, [db, file.storage_path])

  useEffect(() => {
    void load()
  }, [load])

  // Andere haben gespeichert → neu laden, solange lokal nichts ungespeichert ist
  useEffect(() => onBroadcast('kb:saved', (p) => { if (p.fileId === file.id) void load() }), [onBroadcast, file.id, load])

  useEffect(() => {
    setPresence({ kbFileId: canEdit && mode !== 'preview' ? file.id : null })
    return () => setPresence({ kbFileId: null })
  }, [file.id, mode, canEdit, setPresence])

  const save = useCallback(async () => {
    timer.current = null
    const text = latest.current
    if (new Blob([text]).size > MAX_BYTES) {
      setStatus('error')
      toast('Datei ist grösser als 2 MB')
      return
    }
    setStatus('saving')
    const { error } = await db.storage.from(BUCKET).upload(file.storage_path, new Blob([text], { type: 'text/markdown' }), {
      contentType: 'text/markdown',
      upsert: true,
    })
    if (error) {
      setStatus('error')
      return
    }
    // updated_at/updated_by setzt der Trigger
    await db.from('kb_files').update({ name: file.name }).eq('id', file.id)
    if (latest.current === text) {
      dirty.current = false
      setStatus('saved')
    }
    broadcast('kb:saved', { fileId: file.id })
  }, [db, file, broadcast])

  // Beim Verlassen ungespeicherte Änderungen sofort schreiben
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void save() } }, [save])

  function onChange(text: string) {
    setContent(text)
    latest.current = text
    dirty.current = true
    setStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), 800)
  }

  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  }

  const editors = presence.filter((p) => p.kbFileId === file.id)
  const attachedTasks = Object.values(state.data.task_attachments)
    .filter((a) => a.kb_file_id === file.id)
    .map((a) => state.data.tasks[a.task_id])
    .filter(Boolean)
  const statusText: Record<SaveState, string> = {
    loading: 'Lädt …', saved: 'Gespeichert', dirty: 'Ungespeicherte Änderungen', saving: 'Speichert …', error: 'Speichern fehlgeschlagen',
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{file.name}</h2>
          <p className="text-xs text-text-2" aria-live="polite">
            <span className={status === 'error' ? 'text-danger' : ''}>{statusText[status]}</span>
            {editors.length > 0 && ` · ${editors.map((e) => shortName(e.name)).join(', ')} ${editors.length === 1 ? 'bearbeitet' : 'bearbeiten'} gerade`}
          </p>
        </div>
        {canEdit && (
          <Segmented label="Ansicht" value={mode} onChange={setMode}
            options={[{ value: 'edit', label: 'Bearbeiten' }, { value: 'split', label: 'Geteilt' }, { value: 'preview', label: 'Vorschau' }]} />
        )}
        <button type="button" className="btn-secondary" onClick={download}><Download size={14} /> Download</button>
      </div>

      <div className={`grid min-h-0 flex-1 ${mode === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
        {mode !== 'preview' && canEdit && (
          <textarea
            aria-label="Markdown-Quelltext"
            spellCheck={false}
            className="min-h-[360px] w-full resize-none border-line bg-bg p-4 font-mono text-[13px] leading-relaxed text-text outline-none md:border-r"
            value={content}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {(mode !== 'edit' || !canEdit) && (
          <div className="md-preview min-h-[360px] overflow-y-auto bg-surface p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-2.5 text-sm">
        <span className="text-text-2">Angehängt an:</span>
        {attachedTasks.length === 0 && <span className="text-text-2">keine Tasks</span>}
        {attachedTasks.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpenTask(t.id)}
            className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-xs font-medium hover:border-accent hover:text-accent cursor-pointer">
            {t.title}
          </button>
        ))}
      </div>
    </>
  )
}
