'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { PlannerIcon } from '@/components/ui/avatar'
import { toast } from '@/components/ui/toast'
import { sortByPosition, usePlanner } from '@/lib/store/planner-store'
import { effectiveFolderRoles } from '@/lib/folders'
import { ROLE_RANK, type Bucket, type Planner, type Role, type Task } from '@/lib/types'

/** Planner (Rolle ≥ editor) und Bucket wählen; für Tasks aus dem Eingang und aus anderen Plannern */
export function MoveTaskDialog({ task, onClose, onMoved }: { task: Task; onClose: () => void; onMoved: () => void }) {
  const { db, viewer } = usePlanner()
  const [planners, setPlanners] = useState<Planner[] | null>(null)
  const [plannerId, setPlannerId] = useState('')
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [bucketId, setBucketId] = useState('')
  const [busy, setBusy] = useState(false)
  const inbox = task.planner_id === null

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
        if (p.id === task.planner_id) return false
        const roles = [direct.get(p.id), p.folder_id ? viaFolder.get(p.folder_id) : undefined].filter(Boolean) as Role[]
        return roles.some((r) => ROLE_RANK[r] >= ROLE_RANK.editor)
      })
      setPlanners(editable)
      if (editable[0]) setPlannerId(editable[0].id)
    })()
  }, [db, viewer.id, task.planner_id])

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
    const body = (await res.json().catch(() => ({}))) as { error?: string; removedAssignees?: number; removedAttachments?: number }
    if (!res.ok) return toast(body.error ?? 'Verschieben fehlgeschlagen')
    const p = planners?.find((x) => x.id === plannerId)
    const removed = [
      body.removedAssignees ? `${body.removedAssignees} Zuweisung(en) entfernt` : '',
      body.removedAttachments ? `${body.removedAttachments} KB-Anhang/-Anhänge entfernt` : '',
    ].filter(Boolean)
    toast([`In «${p?.name ?? 'Planner'}» verschoben`, ...removed].join(' · '))
    onMoved()
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={inbox ? 'In Planner verschieben' : 'In anderen Planner verschieben'} maxWidth={440}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="truncate text-sm text-text-2">«{task.title}»</p>
        {planners === null ? (
          <p className="text-sm text-text-2">Lädt …</p>
        ) : planners.length === 0 ? (
          <p className="text-sm text-text-2">Du hast in keinem {inbox ? '' : 'anderen '}Planner Bearbeitungsrechte.</p>
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
            <p className="text-xs text-text-2">
              {inbox
                ? 'Tags werden zu Labels im Planner, Anhänge werden mitverschoben.'
                : 'Abschnitte, Kommentare, Dateien und Labels ziehen mit. Personen ohne Zugriff im Ziel verlieren die Zuweisung, Knowledge-Base-Anhänge bleiben im alten Planner.'}
            </p>
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
