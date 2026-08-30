// scripts/mbti-shuffle.ts — does the forced-choice result survive a reshuffle?
//
// The published A/B runs always asked the 60 questions in the same order, so
// "3/3 identical types" only proves the instrument is deterministic GIVEN that
// order. This asks the same questions in three different shuffles. If the type
// holds, the instrument measures something about the model; if it scatters, it
// was measuring question order all along.
//
//   npx tsx scripts/mbti-shuffle.ts gpt-5.6-sol --thinking max

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as providers from '../lib/providers'
import bank from '../content/mbti-60.json'

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
type Q = { n: number; q: string; a: string; b: string; aLetter: string; bLetter: string }
const QUESTIONS = bank.questions as Q[]
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

/** Deterministic shuffle so a surprising run can be reproduced exactly. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function ask(model: any, q: Q, thinking?: string) {
  let out = ''
  await new Promise<void>((res, rej) => {
    providers.streamText(model as any, [{ role: 'user', content: `${q.q}\n\nA) ${q.a}\nB) ${q.b}\n\n${FORMAT}` }],
      { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
      [], undefined, { system: SYSTEM, ...(thinking ? { thinking } : {}) } as any).catch(rej)
  })
  const m = out.trim().match(/\b([AB])\b/i)
  return m ? (m[1].toUpperCase() as 'A' | 'B') : null
}

async function main() {
  const modelName = process.argv[2]
  const ti = process.argv.indexOf('--thinking')
  const thinking = ti > -1 ? process.argv[ti + 1] : undefined
  const { data: model } = await sb.from('ai_models').select('*').eq('model_name', modelName).maybeSingle()
  if (!model) throw new Error(`${modelName} not found`)
  console.log(`${(model as any).display_name} — same 60 questions, three different orders`)

  for (const seed of [1, 2, 3]) {
    const order = seed === 1 ? QUESTIONS : shuffled(QUESTIONS, seed * 7919)
    const tally: Record<string, number> = {}
    for (const q of order) {
      const letter = await ask(model, q, thinking)
      if (!letter) continue
      const L = letter === 'A' ? q.aLetter : q.bLetter
      tally[L] = (tally[L] ?? 0) + 1
    }
    const pick = (x: string, y: string) => ((tally[x] ?? 0) >= (tally[y] ?? 0) ? x : y)
    const type = pick('E', 'I') + pick('S', 'N') + pick('T', 'F') + pick('J', 'P')
    console.log(`  ${seed === 1 ? 'original order' : `shuffle ${seed}     `} -> ${type}   E${tally.E ?? 0}/I${tally.I ?? 0} S${tally.S ?? 0}/N${tally.N ?? 0} T${tally.T ?? 0}/F${tally.F ?? 0} J${tally.J ?? 0}/P${tally.P ?? 0}`)
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
