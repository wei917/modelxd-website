// scripts/tripo-smoke.ts — one cheap end-to-end Tripo task through the LIVE
// Tripo API (not through our routes — this validates the upstream contract:
// endpoint shapes, task_id location, consumed_credit field).
//
//   npx tsx scripts/tripo-smoke.ts "a simple wooden cube"
//
// Uses the cheapest documented configuration (H-tier, texture:false — 10
// credits = $0.10). Prints the task id, polls to terminal, prints
// consumed_credit so the billing reconciliation has a verified field name.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv() {
  const p = join(process.cwd(), '.env.local'); if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

const KEY = process.env.TRIPO_API_KEY
if (!KEY) { console.error('TRIPO_API_KEY not set — add it to .env.local first.'); process.exit(1) }
const BASE = 'https://openapi.tripo3d.ai/v3'
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function main() {
  const prompt = process.argv[2] ?? 'a simple wooden cube'
  const create = await fetch(`${BASE}/generation/text-to-model`, {
    method: 'POST', headers: H, // model is REQUIRED (live API, Aug 30 — the docs implied a default). v2.5
    // is the cheapest documented tier: 10 credits without texture.
    body: JSON.stringify({ prompt, model: 'v2.5-20250123', texture: false }),
  }).then(r => r.json())
  console.log('create:', JSON.stringify(create))
  const id = create?.data?.task_id
  if (!id) process.exit(1)
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const t = await fetch(`${BASE}/tasks/${id}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(r => r.json())
    const d = t?.data ?? {}
    process.stdout.write(`\r${d.status} ${d.progress ?? ''}%   `)
    if (['success', 'failed', 'cancelled', 'banned', 'expired'].includes(d.status)) {
      console.log('\nterminal:', JSON.stringify({ status: d.status, credits_consumed: d.credits_consumed, model_url: d.output?.model_url?.slice(0, 80) }))
      break
    }
  }
}
main()
