'use client'
import { useEffect, useState } from 'react'
import { usePlanner } from '@/lib/store/planner-store'
import { ColorPicker } from '@/components/ui/color-picker'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { effectiveFolderRoles, folderOptions } from '@/lib/folders'
import type { Folder, Role } from '@/lib/types'

const PRIORITY_WORDS = ['dringend', 'wichtig', 'mittel', 'niedrig']

function tagError(tag: string) {
  if (!tag) return null
  if (!/^[a-z0-9-]{1,40}$/.test(tag)) return 'Nur Kleinbuchstaben, Ziffern und Bindestrich (max. 40 Zeichen).'
  if (PRIORITY_WORDS.includes(tag)) return 'Prioritäts-Wörter sind als Mail-Tag nicht erlaubt.'
  return null
}

/** Planner-Einstellungen (nur Owner): Name, Farbe, Ordner und Mail-Tag für «Mail an Planner» */
export function PlannerSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, db, viewer } = usePlanner()
  const planner = state.planner!
  const startFolder = planner.folder_id ?? ''
  const [name, setName] = useState(planner.name)
  const [color, setColor] = useState(planner.color)
  const [folderId, setFolderId] = useState(startFolder)
  const [folders, setFolders] = useState<{ id: string; label: string }[]>([])
  const [tag, setTag] = useState(planner.mail_tag ?? '')
  const [collisions, setCollisions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const value = tag.trim().toLowerCase()
  const error = tagError(value)

  // Ziele: nur Ordner, deren Owner du bist
  useEffect(() => {
    if (!open) return
    void Promise.all([
      db.from('folders').select('*').order('position'),
      db.from('folder_members').select('folder_id, role').eq('user_id', viewer.id),
    ]).then(([{ data: fs }, { data: fm }]) => {
      const all = (fs ?? []) as Folder[]
      const roles = effectiveFolderRoles(all, (fm ?? []) as { folder_id: string; role: Role }[])
      setFolders(folderOptions(all).filter((o) => roles.get(o.id) === 'owner'))
    })
  }, [db, open, viewer.id])

  // Kollisionen mit anderen Plannern, auf die du Zugriff hast (sichtbar per RLS)
  useEffect(() => {
    if (!open || !value || error) return
    const t = setTimeout(() => {
      void db
        .from('planners')
        .select('name')
        .eq('mail_tag', value)
        .neq('id', planner.id)
        .then(({ data }) => setCollisions((data ?? []).map((p) => p.name as string)))
    }, 250)
    return () => clearTimeout(t)
  }, [db, open, value, error, planner.id])
  const shownCollisions = value && !error ? collisions : []

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (error || !name.trim()) return
    setBusy(true)
    const { data, error: dbError } = await db
      .from('planners')
      .update({
        name: name.trim(),
        color,
        mail_tag: value || null,
        // Nur wenn geändert: Der aktuelle Ordner ist evtl. nicht in der Auswahl
        ...(folderId !== startFolder ? { folder_id: folderId || null } : {}),
      })
      .eq('id', planner.id)
      .select('*')
      .maybeSingle()
    setBusy(false)
    if (dbError?.code === '23505') return toast('Du hast bereits einen Planner mit diesem Mail-Tag')
    if (dbError || !data) return toast('Einstellungen konnten nicht gespeichert werden')
    toast('Gespeichert')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Planner-Einstellungen" maxWidth={460}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label htmlFor="planner-name" className="field-label">Name</label>
          <input id="planner-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} required />
        </div>
        <div>
          <label htmlFor="planner-color" className="field-label">Farbe</label>
          <ColorPicker id="planner-color" value={color} onChange={setColor} />
        </div>
        <div>
          <label htmlFor="planner-folder" className="field-label">Ordner</label>
          <select id="planner-folder" className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Ohne Ordner</option>
            {startFolder && !folders.some((f) => f.id === startFolder) && <option value={startFolder}>Aktueller Ordner</option>}
            {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-text-2">Nur in Ordner, deren Owner du bist.</p>
        </div>
        <div>
          <label htmlFor="planner-mail-tag" className="field-label">Mail-Tag</label>
          <div className="flex items-center gap-1">
            <span className="text-text-2">#</span>
            <input id="planner-mail-tag" className="input font-mono" value={tag} placeholder="z. B. website" maxLength={40}
              onChange={(e) => setTag(e.target.value.toLowerCase())} />
          </div>
          <p className="mt-1 text-xs text-text-2">
            Optional. Mails an deine Mail-an-Planner-Adresse mit <code>#{value || 'tag'}</code> im Betreff landen direkt in diesem Planner.
          </p>
          {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
          {shownCollisions.length > 0 && (
            <p className="mt-1 text-xs text-prio-important" role="status">
              Achtung: Auch {shownCollisions.map((n) => `«${n}»`).join(', ')} {shownCollisions.length === 1 ? 'nutzt' : 'nutzen'} dieses Tag.
              Bei Mehrdeutigkeit gewinnt dein eigener Planner, sonst landet die Mail im Eingang.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy || !!error || !name.trim()}>Speichern</button>
        </div>
      </form>
    </Modal>
  )
}
