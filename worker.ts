// Worker-Einstieg: OpenNext-Handler + Cron Trigger (Fälligkeits-Mails, Erinnerungen) + Email Worker (Mail an Planner).
// @ts-expect-error – wird von `opennextjs-cloudflare build` erzeugt
import handler from './.open-next/worker.js'
import { jwtVerify } from 'jose'
import { DirectRelay, type RelayPeer } from './lib/direct-relay'

export { DirectRelay }

const REMINDER_CRON = '*/5 * * * *'

type DoNamespace = { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } }
type Env = { APP_URL: string; CRON_SECRET: string; SESSION_SECRET: string; DIRECT_RELAY: DoNamespace }
type Ctx = { waitUntil(p: Promise<unknown>): void }
type EmailMessage = { from: string; to: string; raw: ReadableStream; rawSize: number; setReject(reason: string): void }

const SESSION_COOKIE = 'ys_planner_session'
const SESSION_ID = /^[0-9a-f]{32}$/

function cookie(req: Request, name: string) {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/** Direkt teilen: WebSocket zum Relay des Raums. Nur eingeloggte User, nur von der eigenen Seite. */
async function directRelay(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade Required', { status: 426 })
  if (req.headers.get('origin') !== new URL(env.APP_URL).origin) return new Response('Forbidden', { status: 403 })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!SESSION_ID.test(id)) return new Response('Bad Request', { status: 400 })
  type Session = { kind?: string; uid?: string; name?: string }
  let session: Session | null = null
  try {
    const token = cookie(req, SESSION_COOKIE)
    if (token) session = (await jwtVerify(token, new TextEncoder().encode(env.SESSION_SECRET), { algorithms: ['HS256'] })).payload as Session
  } catch {
    session = null
  }
  if (session?.kind !== 'user' || !session.uid) return new Response('Unauthorized', { status: 401 })
  const peer: RelayPeer = { uid: session.uid, name: session.name ?? 'Unbekannt', joinedAt: Date.now() }
  const headers = new Headers(req.headers)
  headers.set('x-relay-peer', JSON.stringify(peer))
  const stub = env.DIRECT_RELAY.get(env.DIRECT_RELAY.idFromName(id))
  return stub.fetch(new Request(req.url, { method: 'GET', headers }))
}

export default {
  fetch(req: Request, env: Env, ctx: Ctx) {
    if (new URL(req.url).pathname === '/api/direkt/ws') return directRelay(req, env)
    return handler.fetch(req, env, ctx)
  },

  async scheduled(event: { cron: string }, env: Env, ctx: Ctx) {
    const path = event.cron === REMINDER_CRON ? 'reminders' : 'due'
    const req = new Request(`${env.APP_URL}/api/cron/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
    ctx.waitUntil(
      handler.fetch(req, env, ctx).then(async (res: Response) => {
        console.log(`cron/${path}`, res.status, await res.text())
      }),
    )
  },

  // Cloudflare Email Routing (Catch-all) → /api/inbound; die Route entscheidet über Annahme/Ablehnung
  async email(message: EmailMessage, env: Env, ctx: Ctx) {
    const req = new Request(`${env.APP_URL}/api/inbound`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        'content-type': 'message/rfc822',
        'x-envelope-to': message.to,
        'x-envelope-from': message.from,
      },
      body: await new Response(message.raw).arrayBuffer(),
    })
    const res: Response = await handler.fetch(req, env, ctx)
    const result = (await res.json().catch(() => null)) as { accept?: boolean; reason?: string } | null
    if (!result?.accept) message.setReject(result?.reason ?? 'Mail konnte nicht verarbeitet werden')
  },
}
