// scripts/typescale-pairs.ts — Claude's items, rebuilt as side-by-side choices.
//
// Two formats of Claude's instrument have now collapsed to the midpoint: the
// 1-5 agreement scale, and a yes/no on each statement (86% "that's me"). Both
// ask the model to judge ONE sentence in isolation. Qwen's set works because
// it puts two competing descriptions on screen and makes one lose.
//
// This isolates that last variable: Claude's own items, paired forward against
// reverse within a dimension, presented as A vs B. Same content, comparative
// format. If the margins go wide and stable, the items were never the problem.
//
// 7 pairs per dimension (one forward item per dimension has no partner).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as providers from '../lib/providers'
import bank from '../content/typescale-v5.json'

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

const SYSTEM = 'Pretend you are a real human and answer the following question'
const FORMAT = 'Answer with only the single letter A or B. No explanation.'
type Item = { pos: number; dim: string; lowLetter: string; highLetter: string; reverse: boolean; text: string }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

const byDim: Record<string, { f: Item[]; r: Item[] }> = {}
for (const it of bank.items as Item[]) {
  byDim[it.dim] ??= { f: [], r: [] }
  ;(it.reverse ? byDim[it.dim].r : byDim[it.dim].f).push(it)
}
type Pair = { dim: string; high: Item; low: Item }
const PAIRS: Pair[] = []
for (const [dim, g] of Object.entries(byDim)) {
  for (let i = 0; i < Math.min(g.f.length, g.r.length); i++) PAIRS.push({ dim, high: g.f[i], low: g.r[i] })
}

async function ask(model: any, p: Pair, flip: boolean, thinking?: string) {
  // Sides are swapped on alternate items so a model that simply prefers "A"
  // cannot manufacture a result.
  const first = flip ? p.low : p.high
  const second = flip ? p.high : p.low
  let out = ''
  await new Promise<void>((res, rej) => {
    providers.streamText(model as any, [{ role: 'user', content: `Which is more like you?\n\nA) ${first.text}\nB) ${second.text}\n\n${FORMAT}` }],
      { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
      [], undefined, { system: SYSTEM, ...(thinking ? { thinking } : {}) } as any).catch(rej)
  })
  const m = out.trim().match(/\b([AB])\b/i)
  if (!m) return null
  const chose = m[1].toUpperCase() === 'A' ? first : second
  return chose === p.high ? p.high.highLetter : p.low.lowLetter
}

async function main() {
  const modelName = process.argv[2] ?? 'gpt-5.6-sol'
  const ti = process.argv.indexOf('--thinking')
  const thinking = ti > -1 ? process.argv[ti + 1] : undefined
  const runs = Number(process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : 2)
  const { data: model } = await sb.from('ai_models').select('*').eq('model_name', modelName).maybeSingle()
  console.log(`${(model as any).display_name} — Claude's items as ${PAIRS.length} side-by-side pairs, ${runs} run(s)`)
  for (let r = 0; r < runs; r++) {
    const tally: Record<string, number> = {}
    for (let i = 0; i < PAIRS.length; i++) {
      const L = await ask(model, PAIRS[i], i % 2 === 1, thinking)
      if (L) tally[L] = (tally[L] ?? 0) + 1
    }
    const pick = (x: string, y: string) => ((tally[x] ?? 0) >= (tally[y] ?? 0) ? x : y)
    const type = pick('E', 'I') + pick('S', 'N') + pick('T', 'F') + pick('J', 'P')
    console.log(`  run ${r + 1}: ${type}   E${tally.E ?? 0}/I${tally.I ?? 0} S${tally.S ?? 0}/N${tally.N ?? 0} T${tally.T ?? 0}/F${tally.F ?? 0} J${tally.J ?? 0}/P${tally.P ?? 0}`)
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
