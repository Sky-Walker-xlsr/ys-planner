import { redirect } from 'next/navigation'
import { requireUser, signValue } from '@/lib/auth/session'
import { findClient, mcpServerUrl } from '@/lib/mcp/oauth'
import { isValidCodeChallenge, isValidResource, redirectHost } from '@/lib/mcp/oauth-core'
import type { ConsentRequest } from '@/app/api/oauth/authorize/route'

export const metadata = { title: 'Zugriff erlauben', robots: { index: false } }

const CONSENT_SECONDS = 600

function Notice({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-bg p-4"><p className="card max-w-md p-5 text-sm">{text}</p></main>
}

// Einwilligung für den MCP-Zugang. Erst nach Klick auf «Erlauben» gibt es einen Code.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const param = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : null)

  // Unbekannter Client oder fremde redirect_uri: Hier darf nie umgeleitet werden
  const client = await findClient(param('client_id'))
  const redirectUri = param('redirect_uri')
  if (!client || !redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return <Notice text="Diese Verbindungsanfrage ist ungültig: Der Client ist unbekannt oder die Rücksprung-Adresse passt nicht." />
  }

  const state = param('state')
  const challenge = param('code_challenge')
  const valid =
    param('response_type') === 'code' &&
    param('code_challenge_method') === 'S256' &&
    isValidCodeChallenge(challenge) &&
    isValidResource(param('resource'), mcpServerUrl())
  if (!valid) {
    const target = new URL(redirectUri)
    target.searchParams.set('error', 'invalid_request')
    if (state) target.searchParams.set('state', state)
    redirect(target.toString())
  }

  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') query.set(k, v)
  const user = await requireUser(`/oauth/authorize?${query}`)

  const consent: ConsentRequest = { uid: user.uid, clientId: client.client_id, redirectUri, state, codeChallenge: challenge! }
  const signed = await signValue(consent, CONSENT_SECONDS)

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form method="post" action="/api/oauth/authorize" className="card w-full max-w-md p-6">
        <input type="hidden" name="request" value={signed} />
        <h1 className="text-lg font-semibold">Zugriff auf ys-planner erlauben?</h1>
        <p className="mt-3 text-sm">
          <strong>{client.client_name}</strong> möchte sich als <strong>{user.email || user.name}</strong> mit deinem Planner verbinden.
        </p>
        <dl className="mt-3 rounded-md border border-line p-3 text-sm">
          <dt className="text-xs text-text-2">Rücksprung-Adresse</dt>
          <dd className="break-all font-mono">{redirectHost(redirectUri)}</dd>
        </dl>
        <p className="mt-3 text-xs text-text-2">
          Prüfe die Adresse: Der Name oben ist frei wählbar. Für Claude im Browser und in der Desktop-App ist sie <span className="font-mono">claude.ai</span>, für Claude Code <span className="font-mono">localhost</span>.
        </p>
        <div className="mt-4 text-sm">
          <p className="font-medium">Der Client kann in deinem Namen:</p>
          <ul className="mt-1 list-disc pl-5 text-text-2">
            <li>alle Planner, Tasks, Kommentare und die Knowledge Base lesen, auf die du Zugriff hast</li>
            <li>Tasks, Abschnitte, Labels, Buckets, Planner und Ordner erstellen und ändern</li>
            <li>Tasks und Abschnitte löschen, Dateien überschreiben</li>
            <li>Kommentare schreiben und Personen zuweisen (diese bekommen Mails)</li>
          </ul>
          <p className="mt-2 text-text-2">Freigaben ändern und Planner oder Ordner löschen kann er nicht. Trennen kannst du jederzeit in den Einstellungen.</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="submit" name="decision" value="deny" className="btn-secondary">Ablehnen</button>
          <button type="submit" name="decision" value="approve" className="btn-primary">Erlauben</button>
        </div>
      </form>
    </main>
  )
}
