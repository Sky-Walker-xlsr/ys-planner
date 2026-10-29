'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Copy, RefreshCw, Trash2 } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { toast } from '@/components/ui/toast'
import { getBrowserClient } from '@/lib/supabase/browser'

type Sender = { id: string; email: string; confirmed_at: string | null }

const SENDER_STATE: Record<string, string> = {
  confirmed: 'Absender-Adresse bestätigt',
  invalid: 'Bestätigungslink ungültig oder abgelaufen',
  taken: 'Diese Adresse ist bereits einem anderen Konto zugeordnet',
}

/** Karte «Mail an Planner»: eigene Adresse und zusätzliche Absender-Adressen */
export function MailInboxCard() {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const params = useSearchParams()
  const [address, setAddress] = useState<string | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [senders, setSenders] = useState<Sender[]>([])
  const [newSender, setNewSender] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSenders = useCallback(async () => {
    const { data } = await db.from('user_sender_emails').select('id, email, confirmed_at').eq('user_id', me.id).order('created_at')
    setSenders((data ?? []) as Sender[])
  }, [db, me.id])

  useEffect(() => {
    void fetch('/api/inbox/address').then(async (r) => setAddress(((await r.json()) as { address: string | null }).address))
    void loadSenders()
  }, [loadSenders])

  // Rückmeldung vom Bestätigungslink
  const senderState = params.get('sender')
  useEffect(() => {
    if (senderState && SENDER_STATE[senderState]) toast(SENDER_STATE[senderState])
  }, [senderState])

  async function regenerate() {
    setConfirmRegen(false)
    const res = await fetch('/api/inbox/address', { method: 'POST' })
    if (!res.ok) return toast('Adresse konnte nicht erzeugt werden')
    setAddress(((await res.json()) as { address: string }).address)
    toast('Neue Adresse erzeugt – die alte ist ab sofort ungültig')
  }

  async function addSender(e: React.FormEvent) {
    e.preventDefault()
    if (!newSender.trim()) return
    setBusy(true)
    const res = await fetch('/api/inbox/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newSender }),
    })
    setBusy(false)
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return toast(body.error ?? 'Adresse konnte nicht gespeichert werden')
    toast(`Bestätigungslink an ${newSender.trim()} gesendet`)
    setNewSender('')
    void loadSenders()
  }

  async function removeSender(s: Sender) {
    setSenders((list) => list.filter((x) => x.id !== s.id))
    const { error } = await db.from('user_sender_emails').delete().eq('id', s.id)
    if (error) {
      toast('Adresse konnte nicht entfernt werden')
      void loadSenders()
    }
  }

  return (
    <section className="card p-5" aria-labelledby="mail-inbox-title">
      <h2 id="mail-inbox-title" className="mb-1 text-sm font-semibold">Mail an Planner</h2>
      <p className="mb-4 text-sm text-text-2">
        Leite Mails an diese Adresse weiter, um daraus Aufgaben zu erstellen. Tags im Betreff: <code>#planner-tag</code> legt die
        Aufgabe direkt in den Planner, <code>#dringend</code> · <code>#wichtig</code> · <code>#mittel</code> · <code>#niedrig</code> setzen die
        Priorität. Ohne Planner-Tag landet sie im Eingang.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-3 py-1.5 font-mono text-sm">{address ?? '…'}</code>
        <button type="button" className="btn-secondary" disabled={!address}
          onClick={() => address && void navigator.clipboard.writeText(address).then(() => toast('Adresse kopiert'))}>
          <Copy size={15} /> Kopieren
        </button>
        {confirmRegen ? (
          <span className="flex items-center gap-1 text-sm">
            Alte Adresse wird ungültig.
            <button type="button" className="btn-text text-danger" onClick={() => void regenerate()}>Neu generieren</button>
            <button type="button" className="btn-text" onClick={() => setConfirmRegen(false)}>Abbrechen</button>
          </span>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setConfirmRegen(true)}>
            <RefreshCw size={15} /> Neu generieren
          </button>
        )}
      </div>

      <h3 className="mb-1 mt-5 text-sm font-semibold">Erlaubte Absender</h3>
      <p className="mb-2 text-sm text-text-2">
        Angenommen werden Mails von {me.email || 'deiner Login-Adresse'} und von bestätigten Adressen.
      </p>
      {senders.length > 0 && (
        <ul className="mb-2 divide-y divide-line rounded-card border border-line">
          {senders.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{s.email}</span>
              <span className={`text-xs ${s.confirmed_at ? 'text-accent' : 'text-text-2'}`}>{s.confirmed_at ? 'Bestätigt' : 'Wartet auf Bestätigung'}</span>
              <button type="button" className="btn-icon size-7" aria-label={`${s.email} entfernen`} onClick={() => void removeSender(s)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addSender} className="flex gap-2">
        <input type="email" className="input" placeholder="weitere@adresse.ch" aria-label="Absender-Adresse hinzufügen"
          value={newSender} onChange={(e) => setNewSender(e.target.value)} />
        <button type="submit" className="btn-secondary shrink-0" disabled={busy || !newSender.trim()}>Hinzufügen</button>
      </form>
    </section>
  )
}
