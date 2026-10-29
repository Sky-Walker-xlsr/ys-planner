// Einmalige Storage-Migration: Supabase Storage (knowledge-base, task-files) → Cloudflare R2 (planner-files).
//
//   node --env-file=.env.local scripts/migrate-storage-to-r2.mjs [--dry-run]
//
// Kopiert jedes Objekt per Wrangler nach R2, prüft die Kopie per SHA-256 und aktualisiert erst dann
// storage_path in der DB. Idempotent: Zeilen mit R2-Pfad werden übersprungen. Siehe README › Storage-Migration.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const R2_BUCKET = 'planner-files'
const dryRun = process.argv.includes('--dry-run')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY werden benötigt (--env-file=.env.local).')
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const tmp = mkdtempSync(join(tmpdir(), 'r2-migration-'))
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function wrangler(args) {
  // shell nötig für npx unter Windows; Argumente enthalten nur UUIDs, Bucket- und Dateinamen in Anführungszeichen
  return execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
}

async function copy({ bucket, oldPath, newKey, contentType }) {
  const { data, error } = await db.storage.from(bucket).download(oldPath)
  if (error || !data) return { status: 'missing' }
  const buf = Buffer.from(await data.arrayBuffer())
  if (dryRun) return { status: 'dry-run', bytes: buf.length }

  const src = join(tmp, 'src')
  const back = join(tmp, 'back')
  writeFileSync(src, buf)
  wrangler(['r2', 'object', 'put', `"${R2_BUCKET}/${newKey}"`, '--file', `"${src}"`, '--content-type', `"${contentType}"`, '--remote'])
  wrangler(['r2', 'object', 'get', `"${R2_BUCKET}/${newKey}"`, '--file', `"${back}"`, '--remote'])
  if (sha(readFileSync(back)) !== sha(buf)) throw new Error(`Prüfsumme stimmt nicht: ${newKey}`)
  return { status: 'copied', bytes: buf.length }
}

async function migrate({ table, bucket, select, isMigrated, oldPath, newKey, contentType }) {
  const { data: rows, error } = await db.from(table).select(select)
  if (error) throw error
  const todo = rows.filter((r) => !isMigrated(r))
  console.log(`\n${table}: ${rows.length} Zeilen, ${todo.length} zu migrieren`)
  let failed = 0
  for (const r of todo) {
    const target = newKey(r)
    try {
      const res = await copy({ bucket, oldPath: oldPath(r), newKey: target, contentType: contentType(r) })
      // Fehlendes Objekt (Datei ohne Inhalt): nur den Pfad umstellen
      if (!dryRun) {
        const { error: upd } = await db.from(table).update({ storage_path: target }).eq('id', r.id)
        if (upd) throw upd
      }
      console.log(`  ${res.status.padEnd(8)} ${oldPath(r)} → ${target}${res.bytes != null ? ` (${res.bytes} B)` : ''}`)
    } catch (e) {
      failed++
      console.error(`  FEHLER   ${oldPath(r)}: ${e.message ?? e}`)
    }
  }
  return failed
}

let failed = 0
try {
  failed += await migrate({
    table: 'kb_files',
    bucket: 'knowledge-base',
    select: 'id, planner_id, storage_path',
    isMigrated: (r) => r.storage_path.startsWith('kb/'),
    oldPath: (r) => `${r.planner_id}/${r.id}.md`,
    newKey: (r) => `kb/${r.planner_id}/${r.id}.md`,
    contentType: () => 'text/markdown',
  })
  failed += await migrate({
    table: 'task_files',
    bucket: 'task-files',
    select: 'id, task_id, planner_id, name, mime_type, storage_path',
    isMigrated: (r) => /^(tasks|inbox)\//.test(r.storage_path),
    oldPath: (r) => `${r.planner_id}/${r.task_id}/${r.id}`,
    newKey: (r) => `tasks/${r.task_id}/${r.id}-${r.name}`,
    contentType: (r) => r.mime_type,
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (failed) {
  console.error(`\n${failed} Datei(en) fehlgeschlagen – Migration 20261029000007 NICHT anwenden. Skript erneut ausführen.`)
  process.exit(1)
}
console.log(dryRun ? '\nTrockenlauf ok.' : '\nAlle Dateien kopiert und verifiziert. Jetzt Migration 20261029000007 anwenden.')
