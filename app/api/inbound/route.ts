import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { serverEnv } from '@/lib/env'
import { sendMail } from '@/lib/mail'
import { filesBucket } from '@/lib/r2'
import { normalizeMime } from '@/lib/file-access'
import { processInbound, type InboundDeps, type PlannerCandidate } from '@/lib/inbound/process'

// Interner Endpunkt für den Email Worker (worker.ts › email()). Body: Roh-Mail (RFC 822).
// Antwort { accept, reason } – bei accept=false lehnt der Worker die Mail per setReject ab.
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const envelopeTo = req.headers.get('x-envelope-to') ?? ''
  const raw = await req.arrayBuffer()
  const db = createServiceClient()

  const deps: InboundDeps = {
    async findRecipient(local) {
      const { data } = await db
        .from('user_settings')
        .select('users!inner(id, email, display_name)')
        .eq('inbox_local', local)
        .maybeSingle()
      return (data?.users as unknown as { id: string; email: string; display_name: string } | undefined) ?? null
    },
    async confirmedSenders(userId) {
      const { data } = await db.from('user_sender_emails').select('email').eq('user_id', userId).not('confirmed_at', 'is', null)
      return (data ?? []).map((r) => r.email as string)
    },
    async plannerCandidates(userId, tags) {
      const { data, error } = await db.rpc('mail_planner_candidates', { u: userId, tags })
      if (error) throw error
      return (data ?? []) as PlannerCandidate[]
    },
    async firstBucket(plannerId) {
      const { data } = await db.from('buckets').select('id').eq('planner_id', plannerId).order('position').limit(1).maybeSingle()
      return data?.id ?? null
    },
    async createTask(task) {
      const { data, error } = await db.from('tasks').insert(task).select('id').single()
      if (error || !data) throw error ?? new Error('Task nicht angelegt')
      return data.id as string
    },
    async attachLabels(taskId, plannerId, names) {
      const { error } = await db.rpc('mail_attach_labels', { t: taskId, p: plannerId, names })
      if (error) throw error
    },
    async addUserTags(taskId, userId, names) {
      const { error } = await db.from('user_tags').insert(names.map((name) => ({ task_id: taskId, user_id: userId, name: name.slice(0, 60) })))
      if (error) throw error
    },
    async saveFile(taskId, file) {
      const mime = normalizeMime(file.mime)
      // storage_path (tasks/… bzw. inbox/…) setzt der Trigger
      const { data: row, error } = await db
        .from('task_files')
        .insert({ task_id: taskId, name: file.name, mime_type: mime, size_bytes: file.content.byteLength, storage_path: '' })
        .select('id, storage_path')
        .single()
      if (error || !row) throw error ?? new Error('Datei nicht angelegt')
      try {
        await filesBucket().put(row.storage_path, file.content, { httpMetadata: { contentType: mime } })
      } catch (e) {
        await db.from('task_files').delete().eq('id', row.id)
        throw e
      }
    },
    sendConfirmation: (to, content) => sendMail(to, content),
  }

  try {
    const result = await processInbound({ raw, envelopeTo }, deps, { inboxDomain: serverEnv.inboxDomain, appUrl: serverEnv.appUrl })
    if (!result.accept) console.log('Mail abgelehnt', envelopeTo, result.reason)
    return NextResponse.json(result)
  } catch (e) {
    console.error('Mail-Verarbeitung fehlgeschlagen', envelopeTo, e)
    return NextResponse.json({ accept: false, reason: 'Mail konnte nicht verarbeitet werden' }, { status: 500 })
  }
}
