// Werkzeuge des MCP-Servers. Alles läuft über ctx.db mit dem JWT des Users: RLS prüft jede Aktion genau
// wie in der App. Freigaben und das Löschen von Plannern/Ordnern gibt es hier bewusst nicht.
import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_KB_BYTES } from '@/lib/file-access'
import { ToolError, type JsonSchema, type PropSchema, type Tool } from './protocol'

export type ToolContext = {
  db: SupabaseClient
  user: { id: string; name: string; email: string }
  moveTask: (taskId: string, plannerId: string, bucketId: string | null) => Promise<unknown>
  deleteFiles: (keys: string[]) => Promise<void>
  readObject: (key: string) => Promise<string | null>
  writeObject: (key: string, content: string) => Promise<void>
  notifyAssigned: (taskId: string, userId: string) => void
  notifyMentioned: (commentId: string) => void
}

type Args = Record<string, unknown>

const STATUS = ['not_started', 'in_progress', 'done'] as const
const PRIORITY = ['urgent', 'important', 'medium', 'low'] as const
const HEX = '^#[0-9a-fA-F]{6}$'
const COLOR_HINT = 'Hex-Farbe, z. B. #2563EB'

const id = (description: string): PropSchema => ({ type: 'string', format: 'uuid', description })
const text = (description: string, maxLength: number): PropSchema => ({ type: 'string', description, maxLength })
const schema = (properties: Record<string, PropSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const nullableDate = (description: string): PropSchema => ({ type: ['string', 'null'], format: 'date', description })

/** Fehler der Datenbank in eine verständliche Meldung übersetzen; RLS-Details bleiben draussen */
function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new ToolError(`${action}: keine Berechtigung`)
  if (error.code === '23505') throw new ToolError(`${action}: existiert bereits`)
  if (error.code === '23514' || error.code === '22P02') throw new ToolError(`${action}: ungültige Eingabe (${error.message})`)
  if (error.code === '23503') throw new ToolError(`${action}: Bezug nicht gefunden`)
  throw new Error(`${action}: ${error.code} ${error.message}`)
}

type Query<T> = PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>

async function rows<T>(query: Query<T>, action: string): Promise<T> {
  const { data, error } = await query
  if (error) fail(error, action)
  return data as T
}

/** Für Änderungen: Ohne Zeile im Ergebnis gibt es das Objekt nicht oder die Rechte fehlen (RLS) */
async function single<T>(query: Query<T[]>, action: string): Promise<T> {
  const list = await rows(query, action)
  if (!list?.length) throw new ToolError(`${action}: nicht gefunden oder keine Berechtigung`)
  return list[0]
}

/** Übernimmt nur die angegebenen Felder; ohne Änderung ein Fehler statt eines leeren Updates */
function patchOf(args: Args, fields: string[]) {
  const patch: Args = {}
  for (const f of fields) if (args[f] !== undefined) patch[f] = args[f]
  if (!Object.keys(patch).length) throw new ToolError('Keine Änderung angegeben')
  return patch
}

const TASK_LIST_FIELDS = 'id, title, status, priority, start_date, due_date, remind_at, planner_id, bucket_id, updated_at, planners(name), buckets(name), task_assignees(user_id), task_labels(labels(id, name))'

export const TOOLS: Tool<ToolContext>[] = [
  // -------------------------------------------------------------------------
  // Lesen
  // -------------------------------------------------------------------------
  {
    name: 'whoami',
    title: 'Angemeldeter User',
    description: 'Zeigt, in wessen Namen die Werkzeuge laufen.',
    inputSchema: schema({}),
    readOnly: true,
    run: async (_, ctx) => ctx.user,
  },
  {
    name: 'list_folders',
    title: 'Ordner auflisten',
    description: 'Alle sichtbaren Ordner. parent_id zeigt die Verschachtelung (null oder unsichtbar = oberste Ebene).',
    inputSchema: schema({}),
    readOnly: true,
    run: (_, ctx) => rows(ctx.db.from('folders').select('id, name, parent_id').order('position'), 'Ordner laden'),
  },
  {
    name: 'list_planners',
    title: 'Planner auflisten',
    description: 'Alle sichtbaren Planner mit deiner Rolle (owner, editor, viewer).',
    inputSchema: schema({}),
    readOnly: true,
    run: async (_, ctx) => {
      const list = await rows(ctx.db.from('planners').select('id, name, color, folder_id').order('position'), 'Planner laden')
      return Promise.all((list as { id: string }[]).map(async (p) => {
        const { data } = await ctx.db.rpc('planner_role', { p: p.id })
        return { ...p, role: data }
      }))
    },
  },
  {
    name: 'get_planner',
    title: 'Planner lesen',
    description: 'Buckets, Labels und Mitglieder eines Planners. Liefert die IDs, die zum Anlegen und Zuweisen nötig sind.',
    inputSchema: schema({ planner_id: id('Planner') }, ['planner_id']),
    readOnly: true,
    run: async (args, ctx) => {
      const pid = args.planner_id as string
      const planner = await single(ctx.db.from('planners').select('id, name, color, folder_id').eq('id', pid), 'Planner laden') as { folder_id: string | null }
      const [buckets, labels, direct, chain, role] = await Promise.all([
        rows(ctx.db.from('buckets').select('id, name').eq('planner_id', pid).order('position'), 'Buckets laden'),
        rows(ctx.db.from('labels').select('id, name, color').eq('planner_id', pid).order('name'), 'Labels laden'),
        rows(ctx.db.from('planner_members').select('user_id, role').eq('planner_id', pid), 'Mitglieder laden'),
        planner.folder_id ? rows(ctx.db.rpc('folder_chain', { f: planner.folder_id }) as unknown as Query<string[]>, 'Ordner laden') : Promise.resolve([] as string[]),
        ctx.db.rpc('planner_role', { p: pid }),
      ])
      const viaFolder = chain?.length
        ? await rows(ctx.db.from('folder_members').select('user_id, role').in('folder_id', chain), 'Ordner-Mitglieder laden')
        : []
      const ids = [...new Set([...(direct as { user_id: string }[]), ...(viaFolder as { user_id: string }[])].map((m) => m.user_id))]
      const members = ids.length ? await rows(ctx.db.from('users').select('id, display_name').in('id', ids), 'User laden') : []
      return { ...planner, role: role.data, buckets, labels, members }
    },
  },
  {
    name: 'list_tasks',
    title: 'Tasks suchen',
    description: 'Tasks über alle sichtbaren Planner, optional gefiltert. Ohne planner_id auch aus deinem Eingang. Beschreibung und Abschnitte liefert get_task.',
    inputSchema: schema({
      planner_id: id('Nur dieser Planner'),
      inbox: { type: 'boolean', description: 'Nur dein Eingang (Tasks ohne Planner)' },
      status: { type: 'array', items: { type: 'string', enum: STATUS }, description: 'Nur diese Status' },
      priority: { type: 'array', items: { type: 'string', enum: PRIORITY }, description: 'Nur diese Prioritäten' },
      assigned_to_me: { type: 'boolean', description: 'Nur dir zugewiesene Tasks' },
      assignee_id: id('Nur dieser Person zugewiesene Tasks'),
      due_from: { type: 'string', format: 'date', description: 'Fällig ab diesem Datum' },
      due_to: { type: 'string', format: 'date', description: 'Fällig bis zu diesem Datum' },
      query: text('Text im Titel', 200),
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Standard 100' },
    }),
    readOnly: true,
    run: async (args, ctx) => {
      let q = ctx.db.from('tasks').select(TASK_LIST_FIELDS)
      const assignee = args.assigned_to_me ? ctx.user.id : (args.assignee_id as string | undefined)
      if (assignee) {
        const links = await rows(ctx.db.from('task_assignees').select('task_id').eq('user_id', assignee), 'Zuweisungen laden')
        q = q.in('id', (links as { task_id: string }[]).map((l) => l.task_id))
      }
      if (args.planner_id) q = q.eq('planner_id', args.planner_id as string)
      if (args.inbox) q = q.is('planner_id', null)
      if (args.status) q = q.in('status', args.status as string[])
      if (args.priority) q = q.in('priority', args.priority as string[])
      if (args.due_from) q = q.gte('due_date', args.due_from as string)
      if (args.due_to) q = q.lte('due_date', args.due_to as string)
      if (args.query) q = q.ilike('title', `%${(args.query as string).replace(/[%_\\]/g, '\\$&')}%`)
      return rows(q.order('due_date', { nullsFirst: false }).limit((args.limit as number | undefined) ?? 100), 'Tasks laden')
    },
  },
  {
    name: 'get_task',
    title: 'Task lesen',
    description: 'Ein Task komplett: Beschreibung, Erinnerung, Zuweisungen, Labels, Abschnitte mit Punkten, Kommentare und Dateien.',
    inputSchema: schema({ task_id: id('Task') }, ['task_id']),
    readOnly: true,
    run: async (args, ctx) => {
      const tid = args.task_id as string
      const task = await single(ctx.db.from('tasks').select('*, planners(name), buckets(name)').eq('id', tid), 'Task laden')
      const [assignees, labels, sections, comments, files, kb] = await Promise.all([
        rows(ctx.db.from('task_assignees').select('user_id').eq('task_id', tid), 'Zuweisungen laden'),
        rows(ctx.db.from('task_labels').select('labels(id, name, color)').eq('task_id', tid), 'Labels laden'),
        rows(ctx.db.from('task_sections').select('id, title, description, due_date, section_items(id, parent_id, title, done, position)').eq('task_id', tid).order('position'), 'Abschnitte laden'),
        rows(ctx.db.from('comments').select('id, body, author_user_id, guest_name, created_at').eq('task_id', tid).order('created_at'), 'Kommentare laden'),
        rows(ctx.db.from('task_files').select('id, name, mime_type, size_bytes').eq('task_id', tid), 'Dateien laden'),
        rows(ctx.db.from('task_attachments').select('kb_files(id, name)').eq('task_id', tid), 'Anhänge laden'),
      ])
      const ids = [...new Set([
        ...(assignees as { user_id: string }[]).map((a) => a.user_id),
        ...(comments as { author_user_id: string | null }[]).flatMap((c) => (c.author_user_id ? [c.author_user_id] : [])),
      ])]
      const users = ids.length ? await rows(ctx.db.from('users').select('id, display_name').in('id', ids), 'User laden') : []
      return { ...task, assignees, labels, sections, comments, files, kb_files: kb, users }
    },
  },
  {
    name: 'list_kb_files',
    title: 'Knowledge Base auflisten',
    description: 'Markdown-Dateien in der Knowledge Base eines Planners.',
    inputSchema: schema({ planner_id: id('Planner') }, ['planner_id']),
    readOnly: true,
    run: (args, ctx) => rows(ctx.db.from('kb_files').select('id, name, updated_at').eq('planner_id', args.planner_id as string).order('name'), 'Dateien laden'),
  },
  {
    name: 'read_kb_file',
    title: 'Knowledge-Base-Datei lesen',
    description: 'Inhalt einer Markdown-Datei.',
    inputSchema: schema({ file_id: id('Datei') }, ['file_id']),
    readOnly: true,
    run: async (args, ctx) => {
      const file = await single(ctx.db.from('kb_files').select('id, name, storage_path').eq('id', args.file_id as string), 'Datei laden') as { id: string; name: string; storage_path: string }
      return { id: file.id, name: file.name, content: (await ctx.readObject(file.storage_path)) ?? '' }
    },
  },

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  {
    name: 'create_task',
    title: 'Task erstellen',
    description: 'Erstellt einen Task im Planner (ohne bucket_id im ersten Bucket) oder ohne planner_id in deinem Eingang.',
    inputSchema: schema({
      title: text('Titel', 300),
      planner_id: id('Planner; leer = dein Eingang'),
      bucket_id: id('Bucket im Planner'),
      description: text('Beschreibung als Markdown', 50000),
      status: { type: 'string', enum: STATUS },
      priority: { type: 'string', enum: PRIORITY },
      start_date: { type: 'string', format: 'date' },
      due_date: { type: 'string', format: 'date' },
      remind_at: { type: 'string', format: 'date-time', description: 'Mail-Erinnerung an alle Zugewiesenen' },
    }, ['title']),
    run: async (args, ctx) => {
      const fields = { ...patchOf(args, ['title', 'description', 'status', 'priority', 'start_date', 'due_date', 'remind_at']) }
      if (!args.planner_id) return single(ctx.db.from('tasks').insert({ ...fields, owner_id: ctx.user.id }).select('*'), 'Task erstellen')
      let bucket = args.bucket_id as string | undefined
      if (!bucket) {
        const first = await rows(ctx.db.from('buckets').select('id').eq('planner_id', args.planner_id as string).order('position').limit(1), 'Bucket laden') as { id: string }[]
        if (!first.length) throw new ToolError('Der Planner hat keinen Bucket oder ist nicht sichtbar')
        bucket = first[0].id
      }
      return single(ctx.db.from('tasks').insert({ ...fields, planner_id: args.planner_id, bucket_id: bucket }).select('*'), 'Task erstellen')
    },
  },
  {
    name: 'update_task',
    title: 'Task ändern',
    description: 'Ändert die angegebenen Felder. Datumsfelder und remind_at lassen sich mit null leeren. bucket_id nur innerhalb desselben Planners (sonst move_task).',
    inputSchema: schema({
      task_id: id('Task'),
      title: text('Titel', 300),
      description: text('Beschreibung als Markdown', 50000),
      status: { type: 'string', enum: STATUS },
      priority: { type: 'string', enum: PRIORITY },
      start_date: nullableDate('Startdatum'),
      due_date: nullableDate('Fälligkeit'),
      remind_at: { type: ['string', 'null'], format: 'date-time', description: 'Mail-Erinnerung an alle Zugewiesenen' },
      bucket_id: id('Bucket im selben Planner'),
    }, ['task_id']),
    run: (args, ctx) => single(
      ctx.db.from('tasks').update(patchOf(args, ['title', 'description', 'status', 'priority', 'start_date', 'due_date', 'remind_at', 'bucket_id'])).eq('id', args.task_id as string).select('*'),
      'Task ändern',
    ),
  },
  {
    name: 'move_task',
    title: 'Task verschieben',
    description: 'Verschiebt einen Task in einen anderen Planner (auch aus dem Eingang). Abschnitte, Kommentare, Dateien und Labels ziehen mit. Personen ohne Zugriff im Ziel verlieren die Zuweisung, Knowledge-Base-Anhänge fallen weg.',
    inputSchema: schema({ task_id: id('Task'), planner_id: id('Ziel-Planner'), bucket_id: id('Bucket im Ziel; leer = erster Bucket') }, ['task_id', 'planner_id']),
    destructive: true,
    run: (args, ctx) => ctx.moveTask(args.task_id as string, args.planner_id as string, (args.bucket_id as string | undefined) ?? null),
  },
  {
    name: 'delete_task',
    title: 'Task löschen',
    description: 'Löscht einen Task endgültig mit Abschnitten, Kommentaren und Dateien. Vorher bestätigen lassen.',
    inputSchema: schema({ task_id: id('Task') }, ['task_id']),
    destructive: true,
    run: async (args, ctx) => {
      const tid = args.task_id as string
      const files = await rows(ctx.db.from('task_files').select('storage_path').eq('task_id', tid), 'Dateien laden') as { storage_path: string }[]
      await single(ctx.db.from('tasks').delete().eq('id', tid).select('id'), 'Task löschen')
      await ctx.deleteFiles(files.map((f) => f.storage_path))
      return { ok: true }
    },
  },
  {
    name: 'set_task_assignee',
    title: 'Zuweisung setzen',
    description: 'Weist einen Task einem Mitglied des Planners zu (assigned=true, die Person bekommt eine Mail) oder entfernt die Zuweisung.',
    inputSchema: schema({ task_id: id('Task'), user_id: id('Person, siehe get_planner'), assigned: { type: 'boolean' } }, ['task_id', 'user_id', 'assigned']),
    run: async (args, ctx) => {
      const [tid, uid] = [args.task_id as string, args.user_id as string]
      if (!args.assigned) {
        await single(ctx.db.from('task_assignees').delete().eq('task_id', tid).eq('user_id', uid).select('task_id'), 'Zuweisung entfernen')
        return { ok: true }
      }
      const { error } = await ctx.db.from('task_assignees').insert({ task_id: tid, user_id: uid })
      if (error?.code === '23505') return { ok: true, already: true }
      if (error) fail(error, 'Zuweisen')
      ctx.notifyAssigned(tid, uid)
      return { ok: true }
    },
  },
  {
    name: 'set_task_label',
    title: 'Label setzen',
    description: 'Hängt ein Label des Planners an einen Task oder entfernt es.',
    inputSchema: schema({ task_id: id('Task'), label_id: id('Label, siehe get_planner'), attached: { type: 'boolean' } }, ['task_id', 'label_id', 'attached']),
    run: async (args, ctx) => {
      const [tid, lid] = [args.task_id as string, args.label_id as string]
      if (!args.attached) {
        await single(ctx.db.from('task_labels').delete().eq('task_id', tid).eq('label_id', lid).select('task_id'), 'Label entfernen')
        return { ok: true }
      }
      const { error } = await ctx.db.from('task_labels').insert({ task_id: tid, label_id: lid })
      if (error && error.code !== '23505') fail(error, 'Label setzen')
      return { ok: true }
    },
  },
  {
    name: 'add_comment',
    title: 'Kommentar schreiben',
    description: 'Schreibt einen Kommentar in deinem Namen. Erwähnte Personen bekommen eine Mail.',
    inputSchema: schema({
      task_id: id('Task'),
      body: text('Text als Markdown', 10000),
      mentions: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'User-IDs der Erwähnten' },
    }, ['task_id', 'body']),
    run: async (args, ctx) => {
      const body = (args.body as string).trim()
      if (!body) throw new ToolError('Kommentar ist leer')
      const row = await single(
        ctx.db.from('comments').insert({ task_id: args.task_id, body, mentions: args.mentions ?? [] }).select('id, mentions'),
        'Kommentieren',
      ) as { id: string; mentions: string[] }
      if (row.mentions.length) ctx.notifyMentioned(row.id)
      return { ok: true, id: row.id }
    },
  },

  // -------------------------------------------------------------------------
  // Abschnitte und Punkte
  // -------------------------------------------------------------------------
  {
    name: 'create_section',
    title: 'Abschnitt erstellen',
    description: 'Fügt einem Task einen Abschnitt hinzu.',
    inputSchema: schema({ task_id: id('Task'), title: text('Titel', 200), description: text('Beschreibung als Markdown', 20000), due_date: { type: 'string', format: 'date' } }, ['task_id', 'title']),
    run: (args, ctx) => single(ctx.db.from('task_sections').insert(patchOf(args, ['task_id', 'title', 'description', 'due_date'])).select('*'), 'Abschnitt erstellen'),
  },
  {
    name: 'update_section',
    title: 'Abschnitt ändern',
    description: 'Ändert Titel, Beschreibung oder Fälligkeit eines Abschnitts.',
    inputSchema: schema({ section_id: id('Abschnitt'), title: text('Titel', 200), description: text('Beschreibung als Markdown', 20000), due_date: nullableDate('Fälligkeit') }, ['section_id']),
    run: (args, ctx) => single(ctx.db.from('task_sections').update(patchOf(args, ['title', 'description', 'due_date'])).eq('id', args.section_id as string).select('*'), 'Abschnitt ändern'),
  },
  {
    name: 'delete_section',
    title: 'Abschnitt löschen',
    description: 'Löscht einen Abschnitt mit allen Punkten.',
    inputSchema: schema({ section_id: id('Abschnitt') }, ['section_id']),
    destructive: true,
    run: async (args, ctx) => {
      await single(ctx.db.from('task_sections').delete().eq('id', args.section_id as string).select('id'), 'Abschnitt löschen')
      return { ok: true }
    },
  },
  {
    name: 'create_section_item',
    title: 'Punkt erstellen',
    description: 'Fügt einem Abschnitt einen Punkt oder Unterpunkt hinzu.',
    inputSchema: schema({ section_id: id('Abschnitt'), title: text('Text', 300), parent_id: id('Übergeordneter Punkt: macht daraus einen Unterpunkt (nur eine Ebene)') }, ['section_id', 'title']),
    run: (args, ctx) => single(ctx.db.from('section_items').insert(patchOf(args, ['section_id', 'title', 'parent_id'])).select('*'), 'Punkt erstellen'),
  },
  {
    name: 'update_section_item',
    title: 'Punkt ändern',
    description: 'Ändert den Text eines Punkts, hakt ihn ab oder macht ihn zum Unterpunkt (parent_id, null = eigene Ebene).',
    inputSchema: schema({ item_id: id('Punkt'), title: text('Text', 300), done: { type: 'boolean' }, parent_id: { type: ['string', 'null'], format: 'uuid', description: 'Übergeordneter Punkt' } }, ['item_id']),
    run: (args, ctx) => single(ctx.db.from('section_items').update(patchOf(args, ['title', 'done', 'parent_id'])).eq('id', args.item_id as string).select('*'), 'Punkt ändern'),
  },
  {
    name: 'delete_section_item',
    title: 'Punkt löschen',
    description: 'Löscht einen Punkt.',
    inputSchema: schema({ item_id: id('Punkt') }, ['item_id']),
    destructive: true,
    run: async (args, ctx) => {
      await single(ctx.db.from('section_items').delete().eq('id', args.item_id as string).select('id'), 'Punkt löschen')
      return { ok: true }
    },
  },

  // -------------------------------------------------------------------------
  // Struktur
  // -------------------------------------------------------------------------
  {
    name: 'create_label',
    title: 'Label erstellen',
    description: 'Erstellt ein Label in einem Planner.',
    inputSchema: schema({ planner_id: id('Planner'), name: text('Name', 60), color: { type: 'string', pattern: HEX, description: COLOR_HINT } }, ['planner_id', 'name', 'color']),
    run: (args, ctx) => single(ctx.db.from('labels').insert({ planner_id: args.planner_id, name: args.name, color: args.color }).select('*'), 'Label erstellen'),
  },
  {
    name: 'create_bucket',
    title: 'Bucket erstellen',
    description: 'Erstellt einen Bucket (Spalte) in einem Planner.',
    inputSchema: schema({ planner_id: id('Planner'), name: text('Name', 120) }, ['planner_id', 'name']),
    run: (args, ctx) => single(ctx.db.from('buckets').insert({ planner_id: args.planner_id, name: args.name }).select('*'), 'Bucket erstellen'),
  },
  {
    name: 'update_bucket',
    title: 'Bucket umbenennen',
    description: 'Benennt einen Bucket um.',
    inputSchema: schema({ bucket_id: id('Bucket'), name: text('Name', 120) }, ['bucket_id', 'name']),
    run: (args, ctx) => single(ctx.db.from('buckets').update({ name: args.name }).eq('id', args.bucket_id as string).select('*'), 'Bucket umbenennen'),
  },
  {
    name: 'create_planner',
    title: 'Planner erstellen',
    description: 'Erstellt einen Planner, optional in einem Ordner, dessen Owner du bist.',
    inputSchema: schema({ name: text('Name', 120), color: { type: 'string', pattern: HEX, description: COLOR_HINT }, folder_id: id('Ordner') }, ['name']),
    run: (args, ctx) => single(ctx.db.from('planners').insert({ ...patchOf(args, ['name', 'color', 'folder_id']), owner_id: ctx.user.id }).select('*'), 'Planner erstellen'),
  },
  {
    name: 'update_planner',
    title: 'Planner ändern',
    description: 'Ändert Name, Farbe oder Ordner (null = ohne Ordner). Nur als Owner des Planners.',
    inputSchema: schema({
      planner_id: id('Planner'),
      name: text('Name', 120),
      color: { type: 'string', pattern: HEX, description: COLOR_HINT },
      folder_id: { type: ['string', 'null'], format: 'uuid', description: 'Ordner, dessen Owner du bist' },
    }, ['planner_id']),
    run: (args, ctx) => single(ctx.db.from('planners').update(patchOf(args, ['name', 'color', 'folder_id'])).eq('id', args.planner_id as string).select('*'), 'Planner ändern'),
  },
  {
    name: 'create_folder',
    title: 'Ordner erstellen',
    description: 'Erstellt einen Ordner, optional in einem Ordner, dessen Owner du bist.',
    inputSchema: schema({ name: text('Name', 120), parent_id: id('Übergeordneter Ordner') }, ['name']),
    run: (args, ctx) => single(ctx.db.from('folders').insert({ ...patchOf(args, ['name', 'parent_id']), owner_id: ctx.user.id }).select('*'), 'Ordner erstellen'),
  },
  {
    name: 'update_folder',
    title: 'Ordner ändern',
    description: 'Benennt einen Ordner um oder verschiebt ihn (parent_id null = oberste Ebene). Achtung: In einem geteilten Zielordner erhalten dessen Mitglieder Zugriff.',
    inputSchema: schema({
      folder_id: id('Ordner'),
      name: text('Name', 120),
      parent_id: { type: ['string', 'null'], format: 'uuid', description: 'Übergeordneter Ordner' },
    }, ['folder_id']),
    run: (args, ctx) => single(ctx.db.from('folders').update(patchOf(args, ['name', 'parent_id'])).eq('id', args.folder_id as string).select('*'), 'Ordner ändern'),
  },

  // -------------------------------------------------------------------------
  // Knowledge Base
  // -------------------------------------------------------------------------
  {
    name: 'create_kb_file',
    title: 'Knowledge-Base-Datei erstellen',
    description: 'Erstellt eine Markdown-Datei in der Knowledge Base eines Planners.',
    inputSchema: schema({ planner_id: id('Planner'), name: { type: 'string', pattern: '^[^/\\\\]{1,200}\\.md$', description: 'Dateiname, endet auf .md' }, content: text('Markdown', MAX_KB_BYTES) }, ['planner_id', 'name']),
    run: async (args, ctx) => {
      const content = (args.content as string | undefined) ?? ''
      checkKbSize(content)
      const file = await single(
        ctx.db.from('kb_files').insert({ planner_id: args.planner_id, name: args.name, storage_path: '' }).select('id, name, storage_path'),
        'Datei erstellen',
      ) as { id: string; name: string; storage_path: string }
      await ctx.writeObject(file.storage_path, content)
      return { id: file.id, name: file.name }
    },
  },
  {
    name: 'write_kb_file',
    title: 'Knowledge-Base-Datei überschreiben',
    description: 'Ersetzt den gesamten Inhalt einer Markdown-Datei. Vorher mit read_kb_file lesen.',
    inputSchema: schema({ file_id: id('Datei'), content: text('Neuer Inhalt als Markdown', MAX_KB_BYTES) }, ['file_id', 'content']),
    destructive: true,
    run: async (args, ctx) => {
      const content = args.content as string
      checkKbSize(content)
      // Die Änderung an der Zeile prüft die Rechte (ab editor) und setzt updated_at/updated_by
      const { data: current } = await ctx.db.from('kb_files').select('name').eq('id', args.file_id as string).maybeSingle()
      if (!current) throw new ToolError('Datei nicht gefunden oder keine Berechtigung')
      const file = await single(
        ctx.db.from('kb_files').update({ name: current.name }).eq('id', args.file_id as string).select('id, storage_path, updated_at'),
        'Datei speichern',
      ) as { id: string; storage_path: string; updated_at: string }
      await ctx.writeObject(file.storage_path, content)
      return { id: file.id, updated_at: file.updated_at }
    },
  },
]

function checkKbSize(content: string) {
  if (new TextEncoder().encode(content).byteLength > MAX_KB_BYTES) throw new ToolError('Datei ist grösser als 2 MB')
}
