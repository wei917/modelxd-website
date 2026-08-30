// scripts/typescale-ab.ts — Claude's items, forced-choice response format.
//
// The Likert version of this instrument collapsed to the midpoint for every
// model. This asks whether the ITEMS were the problem or the RESPONSE FORMAT,
// by leaving the 60 statements exactly as written and changing only how the
// model answers:
//
//   A) That's me.   B) That's not me.
//
// Scored like the Likert version's extremes: on a forward item "that's me"
// pushes toward the second letter (E/N/T/P), on a reverse item toward the
// first (I/S/F/J).
//
// Prediction worth recording before the run: this may STILL collapse. Qwen's
// set works because two competing descriptions sit side by side and one must
// lose. A yes/no is still an absolute judgment about a single sentence, and
// nothing stops a model saying "that's me" to a claim and to its opposite.

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
const ITEMS = bank.items as Item[]
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

async function ask(model: any, it: Item, thinking?: string) {
  let out = ''
  const prompt = `${it.text}\n\nA) That's me.\nB) That's not me.\n\n${FORMAT}`
  await new Promise<void>((res, rej) => {
    providers.streamText(model as any, [{ role: 'user', content: prompt }],
      { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
      [], undefined, { system: SYSTEM, ...(thinking ? { thinking } : {}) } as any).catch(rej)
  })
  const m = out.trim().match(/\b([AB])\b/i)
  return m ? (m[1].toUpperCase() as 'A' | 'B') : null
}

async function main() {
  const modelName = process.argv[2] ?? 'gpt-5.6-sol'
  const ti = process.argv.indexOf('--thinking')
  const thinking = ti > -1 ? process.argv[ti + 1] : undefined
  const runs = Number(process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : 2)
  const { data: model } = await sb.from('ai_models').select('*').eq('model_name', modelName).maybeSingle()
  if (!model) throw new Error(`${modelName} not found`)
  console.log(`${(model as any).display_name} — Claude's 60 items, forced choice, ${runs} run(s)`)

  for (let r = 0; r < runs; r++) {
    const tally: Record<string, number> = {}
    let yes = 0, answered = 0
    for (const it of ITEMS) {
      const letter = await ask(model, it, thinking)
      if (!letter) continue
      answered++
      if (letter === 'A') yes++
      // "That's me" on a forward item -> high letter; on a reverse item -> low.
      const L = letter === 'A' ? (it.reverse ? it.lowLetter : it.highLetter)
                               : (it.reverse ? it.highLetter : it.lowLetter)
      tally[L] = (tally[L] ?? 0) + 1
    }
    const pick = (x: string, y: string) => ((tally[x] ?? 0) >= (tally[y] ?? 0) ? x : y)
    const type = pick('E', 'I') + pick('S', 'N') + pick('T', 'F') + pick('J', 'P')
    console.log(`  run ${r + 1}: ${type}   E${tally.E ?? 0}/I${tally.I ?? 0} S${tally.S ?? 0}/N${tally.N ?? 0} T${tally.T ?? 0}/F${tally.F ?? 0} J${tally.J ?? 0}/P${tally.P ?? 0}   "that's me" on ${Math.round(100 * yes / answered)}% of items`)
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
