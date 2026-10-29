import { describe, expect, it } from 'vitest'
import { processInbound, type InboundDeps, type NewTask, type PlannerCandidate } from './process'
import { parseSubject } from './subject'
import { senderAuthenticated } from './auth'

const USER = { id: 'u1', email: 'anna@example.com', display_name: 'Anna' }
const OPTS = { inboxDomain: 'salm.li', appUrl: 'https://planner.salm.li' }
const TO = 'k8f2qz7m@salm.li'

type Att = { name: string; type: string; size: number; inline?: boolean }

function mime(opts: { from?: string; subject?: string; auth?: string; text?: string; html?: string; attachments?: Att[] }) {
  const from = opts.from ?? 'Anna Meier <anna@example.com>'
  const auth = opts.auth ?? 'mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1; spf=pass smtp.mailfrom=anna@example.com'
  const head = [
    `Authentication-Results: ${auth}`,
    `From: ${from}`,
    `To: ${TO}`,
    `Subject: ${opts.subject ?? 'Angebot prüfen'}`,
    'MIME-Version: 1.0',
  ]
  const atts = opts.attachments ?? []
  const body = opts.html
    ? `Content-Type: text/html; charset=utf-8\r\n\r\n${opts.html}`
    : `Content-Type: text/plain; charset=utf-8\r\n\r\n${opts.text ?? 'Hallo\r\n\r\n---------- Forwarded message ---------\r\nVon: Kunde <k@kunde.ch>'}`
  if (!atts.length) return [...head, body].join('\r\n')
  const parts = [body]
  for (const a of atts) {
    const data = Buffer.alloc(a.size, 'a').toString('base64').replace(/.{76}/g, '$&\r\n')
    parts.push(
      [
        `Content-Type: ${a.type}; name="${a.name}"`,
        `Content-Disposition: ${a.inline ? 'inline' : 'attachment'}; filename="${a.name}"`,
        ...(a.inline ? [`Content-ID: <${a.name}>`] : []),
        'Content-Transfer-Encoding: base64',
        '',
        data,
      ].join('\r\n'),
    )
  }
  return [...head, 'Content-Type: multipart/mixed; boundary="b1"', '', ...parts.map((p) => `--b1\r\n${p}`), '--b1--'].join('\r\n')
}

function fakeDeps(over: Partial<{ senders: string[]; candidates: PlannerCandidate[]; bucket: string | null }> = {}) {
  const calls = {
    tasks: [] as NewTask[],
    labels: [] as { taskId: string; plannerId: string; names: string[] }[],
    userTags: [] as string[][],
    files: [] as { name: string; size: number }[],
    mails: [] as { to: string; subject: string; paragraphs: string[] }[],
  }
  const deps: InboundDeps = {
    findRecipient: async (local) => (local === 'k8f2qz7m' ? USER : null),
    confirmedSenders: async () => over.senders ?? [],
    plannerCandidates: async (_u, tags) => (over.candidates ?? []).filter((c) => tags.includes(c.mail_tag)),
    firstBucket: async () => (over.bucket === undefined ? 'b1' : over.bucket),
    createTask: async (t) => {
      calls.tasks.push(t)
      return 't1'
    },
    attachLabels: async (taskId, plannerId, names) => void calls.labels.push({ taskId, plannerId, names }),
    addUserTags: async (_t, _u, names) => void calls.userTags.push(names),
    saveFile: async (_t, f) => void calls.files.push({ name: f.name, size: f.content.byteLength }),
    sendConfirmation: async (to, c) => void calls.mails.push({ to, subject: c.subject, paragraphs: c.paragraphs }),
  }
  return { deps, calls }
}

const run = (raw: string, deps: InboundDeps, to = TO) => processInbound({ raw, envelopeTo: to }, deps, OPTS)

const OWN: PlannerCandidate = { planner_id: 'p-own', name: 'Website', mail_tag: 'web', owner_id: 'u1', role: 'owner' }
const SHARED: PlannerCandidate = { planner_id: 'p-shared', name: 'Website (Team)', mail_tag: 'web', owner_id: 'u2', role: 'editor' }
const OTHER: PlannerCandidate = { planner_id: 'p-x', name: 'Marketing', mail_tag: 'mkt', owner_id: 'u2', role: 'editor' }
const OTHER2: PlannerCandidate = { planner_id: 'p-y', name: 'Marketing alt', mail_tag: 'mkt', owner_id: 'u3', role: 'editor' }

describe('Mail an Planner', () => {
  it('gültiger Absender → Task im Eingang mit Bestätigung', async () => {
    const { deps, calls } = fakeDeps()
    const r = await run(mime({}), deps)
    expect(r.accept).toBe(true)
    expect(calls.tasks[0]).toMatchObject({ title: 'Angebot prüfen', planner_id: null, owner_id: 'u1', priority: 'medium', mail_sender: 'Anna Meier <anna@example.com>' })
    expect(calls.tasks[0].description).toContain('Forwarded message')
    expect(calls.mails[0]).toMatchObject({ to: 'anna@example.com', subject: 'Task «Angebot prüfen» erstellt in Eingang' })
  })

  it('fremder Absender → abgelehnt, kein Task', async () => {
    const { deps, calls } = fakeDeps()
    const r = await run(mime({ from: 'boss@evil.com', auth: 'mx.cloudflare.net; dkim=pass header.d=evil.com' }), deps)
    expect(r).toEqual({ accept: false, reason: expect.stringContaining('nicht berechtigt') })
    expect(calls.tasks).toHaveLength(0)
    expect(calls.mails).toHaveLength(0)
  })

  it('unbestätigte Absender-Adresse → abgelehnt; bestätigte → akzeptiert', async () => {
    const raw = mime({ from: 'anna@firma.ch', auth: 'mx.cloudflare.net; dkim=pass header.d=firma.ch' })
    expect((await run(raw, fakeDeps({ senders: [] }).deps)).accept).toBe(false)
    expect((await run(raw, fakeDeps({ senders: ['anna@firma.ch'] }).deps)).accept).toBe(true)
  })

  it('SPF/DKIM nicht bestanden → abgelehnt', async () => {
    const { deps } = fakeDeps()
    const r = await run(mime({ auth: 'mx.cloudflare.net; dkim=fail header.d=example.com; spf=softfail smtp.mailfrom=anna@example.com' }), deps)
    expect(r).toEqual({ accept: false, reason: expect.stringContaining('SPF/DKIM') })
  })

  it('unbekannte Empfängeradresse und Plus-Adressen → abgelehnt', async () => {
    const { deps } = fakeDeps()
    expect((await run(mime({}), deps, 'unbekannt1@salm.li')).accept).toBe(false)
    expect((await run(mime({}), deps, 'k8f2qz7m+web@salm.li')).accept).toBe(false)
    expect((await run(mime({}), deps, 'k8f2qz7m@andere.ch')).accept).toBe(false)
  })

  it('Planner-Tag → Task im Planner (erster Bucket), übrige Tags als Labels', async () => {
    const { deps, calls } = fakeDeps({ candidates: [OTHER] })
    const r = await run(mime({ subject: 'WG: #mkt Flyer drucken #wichtig #druckerei' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: 'p-x' })
    expect(calls.tasks[0]).toMatchObject({ title: 'Flyer drucken', planner_id: 'p-x', bucket_id: 'b1', owner_id: null, priority: 'important' })
    expect(calls.labels[0]).toEqual({ taskId: 't1', plannerId: 'p-x', names: ['druckerei'] })
    expect(calls.mails[0].subject).toBe('Task «Flyer drucken» erstellt in Marketing')
  })

  it('nur Prioritäts-Tag → Eingang mit Priorität', async () => {
    const { deps, calls } = fakeDeps({ candidates: [OTHER] })
    const r = await run(mime({ subject: 'Rechnung zahlen #dringend' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: null })
    expect(calls.tasks[0]).toMatchObject({ title: 'Rechnung zahlen', priority: 'urgent', planner_id: null })
    expect(calls.userTags).toHaveLength(0)
  })

  it('unbekanntes Tag → persönliches Tag im Eingang', async () => {
    const { deps, calls } = fakeDeps({ candidates: [OTHER] })
    const r = await run(mime({ subject: 'Idee #irgendwas' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: null })
    expect(calls.userTags[0]).toEqual(['irgendwas'])
    expect(calls.mails[0].paragraphs.join(' ')).toContain('Kein passendes Planner-Tag')
  })

  it('mehrdeutiges Tag: eigener Planner gewinnt', async () => {
    const { deps, calls } = fakeDeps({ candidates: [OWN, SHARED] })
    const r = await run(mime({ subject: 'Bug fixen #web' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: 'p-own' })
    expect(calls.tasks[0].planner_id).toBe('p-own')
  })

  it('mehrdeutiges Tag ohne eigenen Planner → Eingang mit Hinweis', async () => {
    const { deps, calls } = fakeDeps({ candidates: [OTHER, OTHER2] })
    const r = await run(mime({ subject: 'Flyer #mkt' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: null })
    expect(calls.userTags[0]).toEqual(['mkt'])
    expect(calls.mails[0].paragraphs.join(' ')).toContain('passt zu mehreren Plannern')
  })

  it('Planner-Tag nur mit Leserechten → Eingang mit Hinweis', async () => {
    const { deps, calls } = fakeDeps({ candidates: [{ ...OTHER, role: 'viewer' }] })
    const r = await run(mime({ subject: 'Flyer #mkt' }), deps)
    expect(r).toMatchObject({ accept: true, plannerId: null })
    expect(calls.mails[0].paragraphs.join(' ')).toContain('nur Leserechte')
  })

  it('Anhänge über 25 MB werden übersprungen, Signatur-Bilder ignoriert', async () => {
    const { deps, calls } = fakeDeps()
    const MB = 1024 * 1024
    const r = await run(
      mime({
        attachments: [
          { name: 'logo.png', type: 'image/png', size: 2000, inline: true },
          { name: 'a.pdf', type: 'application/pdf', size: 15 * MB },
          { name: 'b.pdf', type: 'application/pdf', size: 12 * MB },
          { name: 'c.txt', type: 'text/plain', size: 1000 },
        ],
      }),
      deps,
    )
    expect(r).toMatchObject({ accept: true, skipped: ['b.pdf'] })
    expect(calls.files.map((f) => f.name)).toEqual(['a.pdf', 'c.txt'])
    expect(calls.mails[0].paragraphs.join(' ')).toContain('b.pdf')
  })

  it('leerer Betreff → «(Ohne Betreff)»', async () => {
    const { deps, calls } = fakeDeps()
    await run(mime({ subject: 'Fwd: #wichtig' }), deps)
    expect(calls.tasks[0]).toMatchObject({ title: '(Ohne Betreff)', priority: 'important' })
  })

  it('HTML-Mail ohne Text-Teil → Markdown-Beschreibung', async () => {
    const { deps, calls } = fakeDeps()
    await run(mime({ html: '<p>Hallo <b>Team</b></p><ul><li>Eins</li></ul><a href="https://x.ch">Link</a>' }), deps)
    expect(calls.tasks[0].description).toContain('Hallo **Team**')
    expect(calls.tasks[0].description).toContain('- Eins')
    expect(calls.tasks[0].description).toContain('[Link](https://x.ch)')
  })
})

describe('Betreff', () => {
  it('entfernt Präfixe und Tags, erkennt Priorität', () => {
    expect(parseSubject('AW: Re: FW: Termin #Mittel #Kunde-A')).toEqual({ title: 'Termin', priority: 'medium', tags: ['kunde-a'] })
    expect(parseSubject('Preis #1 ist #web')).toEqual({ title: 'Preis ist', priority: null, tags: ['1', 'web'] })
  })
})

describe('Authentication-Results', () => {
  it('nur der oberste Header zählt', () => {
    const headers = [
      { key: 'authentication-results', value: 'mx.cloudflare.net; dkim=fail header.d=example.com' },
      { key: 'authentication-results', value: 'evil; dkim=pass header.d=example.com' },
    ]
    expect(senderAuthenticated(headers, 'anna@example.com')).toBe(false)
  })
  it('DKIM einer fremden Domain reicht nicht', () => {
    const headers = [{ key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=mailer.com; spf=fail smtp.mailfrom=x@mailer.com' }]
    expect(senderAuthenticated(headers, 'anna@example.com')).toBe(false)
  })
})
