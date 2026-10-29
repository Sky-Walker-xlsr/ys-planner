// Führt supabase/tests/*.test.sql gegen DATABASE_URL aus und wertet rls_results aus.
// Jede Testdatei endet mit ROLLBACK – es bleiben keine Daten zurück.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL fehlt (Supabase → Project Settings → Database → Connection string, Rolle postgres).')
  process.exit(2)
}

const dir = join(import.meta.dirname, '..', 'supabase', 'tests')
const files = readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort()
const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } })
await client.connect()

let failed = 0
let total = 0
try {
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8')
    const results = await client.query(sql)
    const last = [].concat(results).reverse().find((r) => r.command === 'SELECT' && r.fields.some((f) => f.name === 'passed'))
    if (!last) throw new Error(`${file}: keine Resultate gefunden`)
    console.log(`\n${file}`)
    for (const row of last.rows) {
      total++
      if (!row.passed) failed++
      console.log(`  ${row.passed ? 'ok  ' : 'FAIL'}  [${row.actor}] ${row.label}${row.passed ? '' : `  (${row.detail})`}`)
    }
  }
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
}

console.log(`\n${total - failed}/${total} bestanden`)
process.exit(failed ? 1 : 0)
