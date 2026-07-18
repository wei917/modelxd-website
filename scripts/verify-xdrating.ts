// scripts/verify-xdrating.ts
//
// Verifies the XDRating pipeline end-to-end against the REAL database:
// compares the model_ratings snapshot (trigger aggregates + refit) with the
// legacy full-scan computation for every mode. Run after the migration +
// bootstrap, and any time you suspect drift:
//
//   npx tsx scripts/verify-xdrating.ts
//
// Exit 0 = snapshot ≡ legacy for xd_score + totalVotes on every model/mode.

import { createClient } from '@supabase/supabase-js'
import { computeLiveLeaderboard } from '../lib/xdrating'
import * as fs from 'fs'
import * as path from 'path'

// Minimal .env.local loader (no dotenv dependency).
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
)

async function main() {
  let failures = 0
  for (const mode of ['all', 'text', 'image', 'video']) {
    const [{ data: snapshot }, legacy] = await Promise.all([
      sb.from('model_ratings').select('model_id, xd_score, total_votes').eq('mode', mode),
      computeLiveLeaderboard(sb, mode),
    ])
    const snapById = new Map((snapshot ?? []).map(r => [r.model_id, r]))

    if ((snapshot ?? []).length !== legacy.length) {
      console.error(`✗ mode=${mode}: snapshot has ${(snapshot ?? []).length} models, legacy has ${legacy.length}`)
      failures++
    }
    for (const row of legacy) {
      const snap = snapById.get(row.modelId)
      if (!snap) {
        console.error(`✗ mode=${mode}: ${row.name} missing from snapshot`)
        failures++
        continue
      }
      if (snap.xd_score !== row.xdScore || Number(snap.total_votes) !== row.totalVotes) {
        console.error(`✗ mode=${mode}: ${row.name} snapshot xd=${snap.xd_score}/votes=${snap.total_votes} vs legacy xd=${row.xdScore}/votes=${row.totalVotes}`)
        failures++
      }
    }
    if (failures === 0) console.log(`✓ mode=${mode}: ${legacy.length} models match exactly`)
  }
  if (failures > 0) {
    console.error(`\n${failures} mismatch(es). Run: select xd_rebuild_aggregates(); then /api/xdrating/refit?force=1 and re-verify.`)
    process.exit(1)
  }
  console.log('\nSnapshot ≡ legacy. Pipeline verified.')
}

main().catch(err => { console.error(err); process.exit(1) })
