'use client'
import { useCallback, useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatDateTime, relativeTime } from '@/lib/dates'

type Connection = { id: string; client_name: string; created_at: string; last_used_at: string | null }

/** Karte «Claude verbinden»: Adresse des MCP-Servers und bestehende Verbindungen */
export function McpCard() {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [url, setUrl] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/mcp-connections')
    setConnections(res.ok ? ((await res.json()) as Connection[]) : [])
  }, [])

  useEffect(() => {
    setUrl(`${window.location.origin}/mcp`)
    void load()
  }, [load])

  async function disconnect(c: Connection) {
    const res = await fetch(`/api/mcp-connections?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    if (!res.ok) toast('Verbindung konnte nicht getrennt werden')
    await load()
  }

  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast('Kopiert'))
  const cli = `claude mcp add --transport http ys-planner ${url}`

  return (
    <section className="card p-5" aria-labelledby="mcp-title">
      <h2 id="mcp-title" className="mb-1 text-sm font-semibold">Claude verbinden (MCP)</h2>
      <p className="mb-4 text-xs text-text-2">Claude kann dann in deinem Namen lesen und ändern, mit deinen Rechten. Die Anmeldung läuft über dein Konto.</p>

      <span className="field-label">Server-Adresse</span>
      <div className="flex items-center gap-1">
        <code className="input flex items-center overflow-x-auto whitespace-nowrap font-mono text-xs">{url}</code>
        <button type="button" className="btn-icon" aria-label="Adresse kopieren" onClick={() => copy(url)}><Copy size={15} /></button>
      </div>
      <p className="mt-2 text-xs text-text-2">
        <strong>Claude im Browser und Desktop:</strong> Einstellungen → Connectors → eigenen Connector hinzufügen, Adresse einfügen.
      </p>
      <p className="mt-2 text-xs text-text-2"><strong>Claude Code:</strong></p>
      <div className="mt-1 flex items-center gap-1">
        <code className="input flex items-center overflow-x-auto whitespace-nowrap font-mono text-xs">{cli}</code>
        <button type="button" className="btn-icon" aria-label="Befehl kopieren" onClick={() => copy(cli)}><Copy size={15} /></button>
      </div>

      <h3 className="mb-1 mt-4 text-xs font-medium text-text-2">Verbundene Clients</h3>
      {connections === null && <p className="text-sm text-text-2">Lädt …</p>}
      {connections?.length === 0 && <p className="text-sm text-text-2">Noch keine Verbindung.</p>}
      {!!connections?.length && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.client_name}</span>
                <span className="block text-xs text-text-2">
                  Verbunden {formatDateTime(c.created_at)}{c.last_used_at ? ` · zuletzt aktiv ${relativeTime(c.last_used_at)}` : ''}
                </span>
              </span>
              <button type="button" className="btn-text" onClick={() => void disconnect(c)}><Trash2 size={14} /> Trennen</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
