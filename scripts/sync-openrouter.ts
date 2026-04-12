// scripts/sync-openrouter.ts
//
// Thin CLI wrapper around lib/sync-openrouter.ts. Fetches the OpenRouter
// model catalog and upserts rows into the Supabase ai_models table. All
// rows are stored with provider='openrouter' and model_name=<openrouter_id>.
//
// The actual fetch/classify/upsert logic lives in lib/sync-openrouter.ts so
// it can also be invoked from app/api/dev/sync-openrouter (a Next.js route),
// which matters when the local dev box can't reach openrouter.ai /
// Supabase directly but the Next.js server can.
//
// Usage:
//   npx tsx scripts/sync-openrouter.ts           # sync everything
//   npx tsx scripts/sync-openrouter.ts --dry     # print what would happen
//   npx tsx scripts/sync-openrouter.ts --mode=image --dry
//
// Required env (reads .env.local if present):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SECRET_KEY

import * as fs from 'fs'
import * as path from 'path'
import { runSync, type ModelMode } from '../lib/sync-openrouter'

// ---------- env loading (very small .env.local reader) ----------

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    let v = trimmed.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

// ---------- CLI args ----------

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run')
const MODE_FILTER = (() => {
  const m = args.find(a => a.startsWith('--mode='))
  if (!m) return null
  const v = m.slice('--mode='.length)
  if (v === 'text' || v === 'image' || v === 'video') return v as ModelMode
  throw new Error(`invalid --mode=${v} (expected text|image|video)`)
})()

// ---------- main ----------

async function main() {
  console.log(`[sync-openrouter] ${DRY_RUN ? 'DRY RUN — ' : ''}starting${MODE_FILTER ? ` (mode=${MODE_FILTER})` : ''}`)

  const result = await runSync({ dryRun: DRY_RUN, mode: MODE_FILTER })

  console.log(`[sync-openrouter] fetched ${result.fetched.models} text/image candidates`)
  console.log(`[sync-openrouter] fetched ${result.fetched.video} video candidates`)
  console.log('[sync-openrouter] built rows by output modality:', result.builtByMode)
  console.log('[sync-openrouter] skipped:', result.skipped)

  if (result.dryRun) {
    console.log('[sync-openrouter] DRY RUN — sample row:')
    console.log(JSON.stringify(result.sampleRow, null, 2))
    return
  }

  console.log(`[sync-openrouter] done — wrote ${result.written} rows`)
}

main().catch(err => {
  console.error('[sync-openrouter] fatal:', err)
  process.exit(1)
})
