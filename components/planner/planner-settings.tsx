'use client'
import { useEffect, useState } from 'react'
import { usePlanner } from '@/lib/store/planner-store'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'

const PRIORITY_WORDS = ['dringend', 'wichtig', 'mittel', 'niedrig']

function tagError(tag: string) {
  if (!tag) return null
  if (!/^[a-z0-9-]{1,40}$/.test(tag)) return 'Nur Kleinbuchstaben, Ziffern und Bindestrich (max. 40 Zeichen).'
  if (PRIORITY_WORDS.includes(tag)) return 'Prioritäts-Wörter sind als Mail-Tag nicht erlaubt.'
  return null
}

/** Planner-Einstellungen (nur Owner): Mail-Tag für «Mail an Planner» */
export function PlannerSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, db } = usePlanner()
  const planner = state.planner!
  const [tag, setTag] = useState(planner.mail_tag ?? '')
  const [collisions, setCollisions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const value = tag.trim().toLowerCase()
  const error = tagError(value)

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
    if (error) return
    setBusy(true)
    const { data, error: dbError } = await db
      .from('planners')
      .update({ mail_tag: value || null })
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
          <label htmlFor="planner-mail-tag" className="field-label">Mail-Tag</label>
          <div className="flex items-center gap-1">
            <span className="text-text-2">#</span>
            <input id="planner-mail-tag" className="input font-mono" value={tag} placeholder="z. B. website" maxLength={40}
              onChange={(e) => setTag(e.target.value.toLowerCase())} autoFocus />
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
          <button type="submit" className="btn-primary" disabled={busy || !!error}>Speichern</button>
        </div>
      </form>
    </Modal>
  )
}
