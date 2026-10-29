// Worker-Einstieg: OpenNext-Handler + Cron Trigger für die täglichen Fälligkeits-Mails.
// @ts-expect-error – wird von `opennextjs-cloudflare build` erzeugt
import handler from './.open-next/worker.js'

type Env = { APP_URL: string; CRON_SECRET: string }

export default {
  fetch: handler.fetch,

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const req = new Request(`${env.APP_URL}/api/cron/due`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
    ctx.waitUntil(
      handler.fetch(req, env, ctx).then(async (res: Response) => {
        console.log('cron/due', res.status, await res.text())
      }),
    )
  },
}
