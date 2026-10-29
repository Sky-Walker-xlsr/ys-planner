'use client'
import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2 } from 'lucide-react'
import { usePlanner } from '@/lib/store/planner-store'
import { Modal } from '@/components/ui/modal'
import { Segmented, Switch } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { MembersPanel } from '@/components/share/members-panel'
import { addDays, formatLong, todayISO, toISODate } from '@/lib/dates'
import type { Role } from '@/lib/types'

type LinkRow = {
  id: string
  url: string
  permission: 'read' | 'edit'
  require_name: boolean
  has_password: boolean
  expires_at: string | null
  created_at: string
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { state, db, members, isOwner, reload } = usePlanner()
  const planner = state.planner!

  async function invite(userId: string, role: Role) {
    const res = await fetch(`/api/planners/${planner.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (!res.ok) toast('Einladung fehlgeschlagen')
    await reload()
  }

  async function changeRole(userId: string, role: Role) {
    const { error } = await db.from('planner_members').update({ role }).eq('planner_id', planner.id).eq('user_id', userId)
    if (error) toast('Rolle konnte nicht geändert werden')
    await reload()
  }

  async function remove(userId: string) {
    const { error } = await db.from('planner_members').delete().eq('planner_id', planner.id).eq('user_id', userId)
    if (error) toast('Mitglied konnte nicht entfernt werden')
    await reload()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`«${planner.name}» teilen`}
      subtitle={state.folder ? `Liegt im Ordner «${state.folder.name}» – Ordner-Freigaben gelten zusätzlich.` : undefined}
      maxWidth={980}
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <MembersPanel db={db} members={members} canManage={isOwner} onInvite={invite} onRoleChange={changeRole} onRemove={remove} />
        {isOwner ? <LinksPanel plannerId={planner.id} /> : (
          <div className="text-sm text-text-2">Share-Links können nur Owner verwalten.</div>
        )}
      </div>
    </Modal>
  )
}

function LinksPanel({ plannerId }: { plannerId: string }) {
  const { db } = usePlanner()
  const [permission, setPermission] = useState<'read' | 'edit'>('read')
  const [requireName, setRequireName] = useState(false)
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [useExpiry, setUseExpiry] = useState(false)
  const [expiry, setExpiry] = useState(addDays(todayISO(), 7))
  const [links, setLinks] = useState<LinkRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/planners/${plannerId}/links`, { cache: 'no-store' })
    if (res.ok) setLinks(((await res.json()) as { links: LinkRow[] }).links)
  }, [plannerId])

  useEffect(() => {
    void load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch(`/api/planners/${plannerId}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permission,
        requireName,
        password: usePassword ? password : null,
        expiresAt: useExpiry ? expiry : null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      toast(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Link konnte nicht erstellt werden')
      return
    }
    const { url } = (await res.json()) as { url: string }
    await navigator.clipboard.writeText(url).then(() => toast('Link erstellt und kopiert'), () => toast('Link erstellt'))
    setPassword('')
    await load()
  }

  async function revoke(id: string) {
    const { error } = await db.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
    if (error) toast('Link konnte nicht widerrufen werden')
    await load()
  }

  const summary = (l: LinkRow) =>
    [
      l.permission === 'edit' ? 'Bearbeiten' : 'Nur lesen',
      l.require_name && 'Name verlangt',
      l.has_password && 'Passwort',
      l.expires_at ? `bis ${formatLong(toISODate(new Date(l.expires_at)))}` : 'unbefristet',
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="rounded-card border border-line p-4">
        <h3 className="mb-3 text-sm font-semibold">Neuer Share-Link</h3>
        <div className="flex flex-col gap-3">
          <Segmented label="Berechtigung" value={permission} onChange={setPermission}
            options={[{ value: 'read', label: 'Nur lesen' }, { value: 'edit', label: 'Bearbeiten' }]} />
          <Switch id="link-name" label="Name verlangen" checked={requireName} onChange={setRequireName} />
          <Switch id="link-pw" label="Passwortschutz" checked={usePassword} onChange={setUsePassword} />
          {usePassword && (
            <div>
              <label htmlFor="link-password" className="field-label">Passwort</label>
              <input id="link-password" type="password" className="input" autoComplete="new-password" minLength={4} required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <Switch id="link-exp" label="Ablaufdatum" checked={useExpiry} onChange={setUseExpiry} />
          {useExpiry && (
            <div>
              <label htmlFor="link-expiry" className="field-label">Gültig bis</label>
              <input id="link-expiry" type="date" className="input" min={addDays(todayISO(), 1)} required
                value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={busy}>
            <Link2 size={15} /> Link erstellen
          </button>
        </div>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Aktive Links</h3>
        {links.length === 0 && <p className="text-sm text-text-2">Keine aktiven Links.</p>}
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="rounded-card border border-line p-3">
              <div className="truncate font-mono text-xs" title={l.url}>{new URL(l.url).pathname}</div>
              <div className="mt-0.5 text-xs text-text-2">{summary(l)}</div>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-secondary h-7"
                  onClick={() => void navigator.clipboard.writeText(l.url).then(() => toast('Link kopiert'))}>
                  <Copy size={13} /> Kopieren
                </button>
                <button type="button" className="btn-secondary h-7 text-danger" onClick={() => void revoke(l.id)}>Widerrufen</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
