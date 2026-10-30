'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCurrentUser } from '@/components/app/current-user'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { Folder } from '@/lib/types'

/** Eigene Benachrichtigungs-Adresse für diesen Ordner; gilt nur für den aktuellen User */
export function FolderNotifyDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const [addresses, setAddresses] = useState<string[] | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([
      db.from('user_sender_emails').select('email').eq('user_id', me.id).not('confirmed_at', 'is', null),
      db.from('folder_notify_emails').select('notify_email').eq('user_id', me.id).eq('folder_id', folder.id).maybeSingle(),
    ]).then(([senders, current]) => {
      const list = [me.email.toLowerCase(), ...(senders.data ?? []).map((s) => s.email as string)].filter(Boolean)
      setAddresses([...new Set(list)])
      setValue((current.data?.notify_email as string | undefined) ?? '')
    })
  }, [db, me, folder.id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = value
      ? await db.from('folder_notify_emails').upsert({ user_id: me.id, folder_id: folder.id, notify_email: value }, { onConflict: 'user_id,folder_id' })
      : await db.from('folder_notify_emails').delete().eq('user_id', me.id).eq('folder_id', folder.id)
    setBusy(false)
    if (error) return toast('Adresse konnte nicht gespeichert werden')
    toast('Gespeichert')
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Benachrichtigungs-Mail" subtitle={`Ordner «${folder.name}» · gilt nur für dich`} maxWidth={440}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="folder-notify" className="field-label">Benachrichtigungen aus diesem Ordner gehen an</label>
          <select id="folder-notify" className="input" value={value} disabled={addresses === null} onChange={(e) => setValue(e.target.value)}>
            <option value="">Standard</option>
            {value && addresses && !addresses.includes(value) && <option value={value}>{value}</option>}
            {addresses?.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <p className="mt-1 text-xs text-text-2">
            Gilt auch für Unterordner, ausser sie haben eine eigene Adresse. «Standard» nimmt die Adresse des übergeordneten Ordners oder sonst die aus den Einstellungen.
          </p>
          <p className="mt-1 text-xs text-text-2">
            Weitere Adressen bestätigst du in den <Link href="/einstellungen" className="underline">Einstellungen</Link> unter «Mail an Planner».
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy || addresses === null}>Speichern</button>
        </div>
      </form>
    </Modal>
  )
}
