// Worker-Einstieg: OpenNext-Handler + Cron Trigger (Fälligkeits-Mails, Erinnerungen) + Email Worker (Mail an Planner).
// @ts-expect-error – wird von `opennextjs-cloudflare build` erzeugt
import handler from './.open-next/worker.js'

const REMINDER_CRON = '*/5 * * * *'

type Env = { APP_URL: string; CRON_SECRET: string }
type Ctx = { waitUntil(p: Promise<unknown>): void }
type EmailMessage = { from: string; to: string; raw: ReadableStream; rawSize: number; setReject(reason: string): void }

export default {
  fetch: handler.fetch,

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
