// Eingehende Mail → Task. Reine Logik mit austauschbaren Abhängigkeiten (Tests: lib/inbound/process.test.ts).
import PostalMime from 'postal-mime'
import type { MailContent } from '@/lib/mail'
import type { Role, TaskPriority } from '@/lib/types'
import { senderAuthenticated, topAuthServId } from './auth'
import { htmlToMarkdown } from './html'
import { parseSubject } from './subject'

export const MAX_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_INLINE_SIGNATURE_BYTES = 10 * 1024

export type InboundUser = { id: string; email: string; display_name: string }
export type PlannerCandidate = { planner_id: string; name: string; mail_tag: string; owner_id: string; role: Role }
export type NewTask = {
  title: string
  description: string
  priority: TaskPriority
  planner_id: string | null
  bucket_id: string | null
  owner_id: string | null
  created_by: string
  mail_sender: string
}
export type InboundFile = { name: string; mime: string; content: Uint8Array }

export type InboundDeps = {
  /** User zur zufälligen Adresse ({local}@domain) */
  findRecipient(local: string): Promise<InboundUser | null>
  /** bestätigte zusätzliche Absender-Adressen (kleingeschrieben) */
  confirmedSenders(userId: string): Promise<string[]>
  /** Planner mit passendem Mail-Tag, auf die der User Zugriff hat (inkl. effektiver Rolle) */
  plannerCandidates(userId: string, tags: string[]): Promise<PlannerCandidate[]>
  firstBucket(plannerId: string): Promise<string | null>
  createTask(task: NewTask): Promise<string>
  attachLabels(taskId: string, plannerId: string, names: string[]): Promise<void>
  addUserTags(taskId: string, userId: string, names: string[]): Promise<void>
  saveFile(taskId: string, file: InboundFile): Promise<void>
  sendConfirmation(to: string, content: MailContent): Promise<void>
}

export type InboundInput = { raw: ArrayBuffer | Uint8Array | string; envelopeTo: string }
export type InboundOptions = { inboxDomain: string; appUrl: string }
export type InboundResult =
  | { accept: false; reason: string }
  | { accept: true; taskId: string; plannerId: string | null; hints: string[]; skipped: string[] }

const reject = (reason: string): InboundResult => ({ accept: false, reason })

function byteLength(c: ArrayBuffer | Uint8Array | string) {
  return typeof c === 'string' ? new TextEncoder().encode(c).byteLength : c.byteLength
}

function toBytes(c: ArrayBuffer | Uint8Array | string) {
  return typeof c === 'string' ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c)
}

export async function processInbound(input: InboundInput, deps: InboundDeps, opts: InboundOptions): Promise<InboundResult> {
  // Empfänger: genau {local}@{inboxDomain}, keine Plus-Adressen
  const [local, domain] = input.envelopeTo.trim().toLowerCase().split('@')
  if (!local || domain !== opts.inboxDomain.toLowerCase() || !/^[a-z0-9]{8,32}$/.test(local)) {
    return reject('Unbekannte Empfängeradresse')
  }
  const user = await deps.findRecipient(local)
  if (!user) return reject('Unbekannte Empfängeradresse')

  const mail = await PostalMime.parse(input.raw)
  const from = mail.from?.address?.trim().toLowerCase()
  if (!from) return reject('Absender fehlt')

  // Absender: Zitadel-Mail oder bestätigte eigene Adresse, und SPF/DKIM bestanden
  const allowed = from === user.email.trim().toLowerCase() || (await deps.confirmedSenders(user.id)).includes(from)
  if (!allowed) return reject('Absender ist für diese Adresse nicht berechtigt')
  if (!senderAuthenticated(mail.headers, from)) {
    console.log('Mail: SPF/DKIM nicht bestätigt, authserv-id:', topAuthServId(mail.headers))
    return reject('Absender konnte nicht verifiziert werden (SPF/DKIM)')
  }

  const subject = parseSubject(mail.subject)
  const hints: string[] = []

  // Planner-Tag: erstes Tag, das zu einem zugänglichen Planner passt
  let planner: PlannerCandidate | null = null
  let plannerTag: string | null = null
  const candidates = subject.tags.length ? await deps.plannerCandidates(user.id, subject.tags) : []
  for (const tag of subject.tags) {
    const matches = candidates.filter((c) => c.mail_tag === tag)
    if (!matches.length) continue
    const own = matches.filter((c) => c.owner_id === user.id)
    const chosen = own.length === 1 ? own[0] : matches.length === 1 ? matches[0] : null
    if (!chosen) {
      hints.push(`#${tag} passt zu mehreren Plannern (${matches.map((m) => `«${m.name}»`).join(', ')}). Die Aufgabe liegt deshalb im Eingang.`)
    } else if (chosen.role !== 'owner' && chosen.role !== 'editor') {
      hints.push(`#${tag}: Im Planner «${chosen.name}» hast du nur Leserechte. Die Aufgabe liegt deshalb im Eingang.`)
    } else {
      planner = chosen
      plannerTag = tag
    }
    break
  }
  let bucketId: string | null = null
  if (planner) {
    bucketId = await deps.firstBucket(planner.planner_id)
    if (!bucketId) {
      hints.push(`Der Planner «${planner.name}» hat keinen Bucket. Die Aufgabe liegt deshalb im Eingang.`)
      planner = null
      plannerTag = null
    }
  }
  if (!planner && !hints.length) hints.push('Kein passendes Planner-Tag im Betreff. Die Aufgabe liegt im Eingang.')
  const otherTags = subject.tags.filter((t) => t !== plannerTag)

  const description = (mail.text?.trim() || (mail.html ? htmlToMarkdown(mail.html) : '')).slice(0, 200_000)
  const senderName = mail.from?.name?.trim()
  const taskId = await deps.createTask({
    title: subject.title,
    description,
    priority: subject.priority ?? 'medium',
    planner_id: planner?.planner_id ?? null,
    bucket_id: bucketId,
    owner_id: planner ? null : user.id,
    created_by: user.id,
    mail_sender: senderName ? `${senderName} <${from}>` : from,
  })

  if (otherTags.length) {
    if (planner) await deps.attachLabels(taskId, planner.planner_id, otherTags)
    else await deps.addUserTags(taskId, user.id, otherTags)
  }

  // Anhänge: Signatur-Bilder ignorieren, Rest bis 25 MB insgesamt
  const skipped: string[] = []
  let total = 0
  for (const a of mail.attachments) {
    const size = byteLength(a.content)
    const inlineImage = a.mimeType.startsWith('image/') && (a.disposition === 'inline' || !!a.contentId)
    if (inlineImage && size < MAX_INLINE_SIGNATURE_BYTES) continue
    const name = (a.filename || 'Anhang').replace(/[/\\\u0000-\u001f\u007f]/g, '-').trim().slice(-200) || 'Anhang'
    if (total + size > MAX_MAIL_ATTACHMENT_BYTES) {
      skipped.push(name)
      continue
    }
    total += size
    await deps.saveFile(taskId, { name, mime: a.mimeType || 'application/octet-stream', content: toBytes(a.content) })
  }
  if (skipped.length) hints.push(`Übersprungene Anhänge (Limit 25 MB pro Mail): ${skipped.join(', ')}`)

  const where = planner ? `«${planner.name}»` : 'Eingang'
  const href = planner ? `${opts.appUrl}/p/${planner.planner_id}?task=${taskId}` : `${opts.appUrl}/eingang?task=${taskId}`
  await deps.sendConfirmation(from, {
    subject: `Task «${subject.title}» erstellt in ${planner ? planner.name : 'Eingang'}`,
    heading: 'Aufgabe erstellt',
    paragraphs: [`Deine Mail wurde als Aufgabe «${subject.title}» in ${where} angelegt.`, ...hints],
    cta: { label: 'Aufgabe öffnen', href },
    footer: 'Du erhältst diese Mail, weil du eine Mail an deine ys-planner-Adresse geschickt hast.',
  })

  return { accept: true, taskId, plannerId: planner?.planner_id ?? null, hints, skipped }
}
