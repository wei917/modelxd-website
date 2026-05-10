// scripts/survey-columns.ts
//
// Per-column audit of ai_models. For each column, reports:
//   - non-null count (out of total rows)
//   - distinct value count (or sample value for jsonb / arrays)
//   - quick sniff for "looks empty" (e.g. {} jsonb, [] array, "" string)

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function isEmpty(v: any): boolean {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  if (typeof v === 'string') return v.trim() === ''
  return false
}

function sample(v: any): string {
  if (v == null) return 'null'
  if (Array.isArray(v)) return JSON.stringify(v).slice(0, 50)
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 50)
  return String(v).slice(0, 50)
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await sb.from('ai_models').select('*')
  if (error) throw error
  const rows = (data ?? []) as Record<string, any>[]
  if (rows.length === 0) { console.log('Table empty.'); return }

  // Discover columns from first row (use union across all rows in case
  // some columns happen to be undefined on row 0).
  const cols = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k)
  const colList = Array.from(cols).sort()

  console.log(`=== ai_models columns (${rows.length} total rows) ===\n`)
  console.log(`${pad('column', 24)} ${pad('non-null', 9)} ${pad('non-empty', 10)} ${pad('distinct', 9)} sample`)
  console.log('─'.repeat(110))

  for (const col of colList) {
    const values = rows.map(r => r[col])
    const nonNull   = values.filter(v => v != null).length
    const nonEmpty  = values.filter(v => !isEmpty(v)).length
    // Distinct count — JSON-encode complex types so they hash properly.
    const seen = new Set<string>()
    for (const v of values) {
      if (v == null) continue
      seen.add(typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    const distinct = seen.size
    // Pick a non-null sample
    const sampleVal = values.find(v => !isEmpty(v))
    const samp = sampleVal === undefined ? '—' : sample(sampleVal)
    console.log(`${pad(col, 24)} ${pad(`${nonNull}/${rows.length}`, 9)} ${pad(`${nonEmpty}/${rows.length}`, 10)} ${pad(String(distinct), 9)} ${samp}`)
  }

  // Highlight columns that look unused (everywhere null or empty) or fully redundant
  console.log('\n=== Columns that look unused/redundant ===')
  for (const col of colList) {
    const values = rows.map(r => r[col])
    const nonEmpty = values.filter(v => !isEmpty(v)).length
    if (nonEmpty === 0) console.log(`  ${col} — fully null/empty in every row`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
