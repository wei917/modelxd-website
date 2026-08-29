// scripts/mbti-run.ts — put a model through the 60-question MBTI assessment.
//
//   npx tsx scripts/mbti-run.ts gpt-5.6-sol --thinking max
//   npx tsx scripts/mbti-run.ts gpt-5.6-sol --thinking max --runs 3 --publish
//
// One API call PER QUESTION, with no conversation carried between them: the
// answers must not anchor each other, or question 60 is really a summary of
// questions 1-59. The system prompt is the owner's, verbatim; the only thing
// added is a one-line output instruction, because a prose answer cannot be
// tallied. Both are recorded with the result so the run is reproducible.
//
// Models are not deterministic, so --runs N repeats the whole assessment and
// reports the majority type plus how often it came up. A dimension decided
// 8-7 is not the same claim as one decided 14-1, and the per-run splits are
// kept so the page can say so.

import { createClient } from '@supabase/supabase-js'
import * as providers from '../lib/providers'
import bank from '../content/mbti-60.json'
import scale from '../content/typescale-v5.json'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Same .env.local loader the other scripts use — no dotenv dependency. */
function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()


const SYSTEM = 'Pretend you are a real human and answer the following question'
const FORMAT_AB = 'Answer with only the single letter A or B. No explanation.'
const FORMAT_LIKERT = 'Answer with only a single number 1-5. No explanation.'
const SCALE = '1 = Strongly disagree, 2 = Disagree, 3 = Neutral, 4 = Agree, 5 = Strongly agree'

type Q = { n: number; q: string; a: string; b: string; aLetter: string; bLetter: string }
type Item = { pos: number; n: number; dim: string; lowLetter: string; highLetter: string; reverse: boolean; text: string; facet: string }

const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } })

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

async function loadModel(modelName: string) {
  const { data, error } = await sb().from('ai_models').select('*').eq('model_name', modelName).maybeSingle()
  if (error || !data) throw new Error(`model ${modelName} not found in ai_models`)
  return data as any
}

/** One item, one call. No history between items — see the header. */
async function askOne(model: any, prompt: string, thinking?: string): Promise<{ out: string; cost: number }> {
  let out = ''
  let cost = 0
  await new Promise<void>((resolve, reject) => {
    providers.streamText(
      model as providers.ModelInfo,
      [{ role: 'user', content: prompt }],
      {
        onDelta: (t: string) => { out += t },
        onDone:  (r: any) => { cost = r?.cost ?? 0; resolve() },
        onError: (m: string) => reject(new Error(m)),
      },
      // system goes in the provider's NATIVE system slot, not into messages —
      // lib/providers has no system role in the message list.
      [], undefined, { system: SYSTEM, ...(thinking ? { thinking } : {}) },
    ).catch(reject)
  })
  return { out: out.trim(), cost }
}

/** A/B instrument. Accepts "A", "A)", "**A**" — nothing looser; a model that
 *  argues instead of choosing is recorded as null, never guessed at. */
async function askAB(model: any, q: Q, thinking?: string) {
  const { out, cost } = await askOne(model, `${q.q}\n\nA) ${q.a}\nB) ${q.b}\n\n${FORMAT_AB}`, thinking)
  const m = out.match(/\b([AB])\b/i)
  return { letter: (m ? m[1].toUpperCase() : null) as 'A' | 'B' | null, raw: out.slice(0, 200), cost }
}

/** Likert instrument: a 1-5 agreement rating on a statement. */
async function askLikert(model: any, it: Item, thinking?: string) {
  const { out, cost } = await askOne(model, `${it.text}\n\n${SCALE}\n\n${FORMAT_LIKERT}`, thinking)
  const m = out.match(/\b([1-5])\b/)
  return { value: m ? Number(m[1]) : null, raw: out.slice(0, 200), cost }
}

/** A/B scoring: tally letters, higher count wins each dichotomy. */
function scoreAB(answers: Array<{ n: number; letter: 'A' | 'B' | null }>, questions: Q[]) {
  const tally: Record<string, number> = {}
  for (const a of answers) {
    if (!a.letter) continue
    const q = questions.find(x => x.n === a.n)!
    const letter = a.letter === 'A' ? q.aLetter : q.bLetter
    tally[letter] = (tally[letter] ?? 0) + 1
  }
  const pick = (x: string, y: string) => ((tally[x] ?? 0) >= (tally[y] ?? 0) ? x : y)
  return { type: pick('E', 'I') + pick('S', 'N') + pick('T', 'F') + pick('J', 'P'), tally }
}

/**
 * Likert scoring, per the instrument's own spec: reverse items contribute
 * 6 - value; each dimension sums 15 items to a raw 15-75 with midpoint 45.
 *   percent = (raw - 15) / 60 * 100   position along the dimension
 *   clarity = |raw - 45| / 30 * 100   distance from the midpoint
 * Clarity is the number that matters. A raw of 46 and a raw of 73 are both
 * "E"; only one of them means anything, and clarity under 12 is reported as
 * undetermined rather than emitted as a letter.
 */
function scoreLikert(answers: Array<{ pos: number; value: number | null }>, items: Item[]) {
  const tally: Record<string, any> = {}
  let type = ''
  for (const dim of ['IE', 'SN', 'FT', 'JP']) {
    const mine = items.filter(i => i.dim === dim)
    let raw = 0, answered = 0
    for (const it of mine) {
      const a = answers.find(x => x.pos === it.pos)
      if (!a || a.value == null) continue
      raw += it.reverse ? 6 - a.value : a.value
      answered++
    }
    // A skipped item would drag the sum toward the low letter; treat missing
    // as neutral (3) so an unparseable answer cannot fake a preference.
    raw += (mine.length - answered) * 3
    const letter = raw > 45 ? mine[0].highLetter : mine[0].lowLetter
    const clarity = Math.abs(raw - 45) / 30 * 100
    tally[dim] = {
      raw, letter,
      percent: Math.round((raw - 15) / 60 * 1000) / 10,
      clarity: Math.round(clarity * 10) / 10,
      band: clarity >= 55 ? 'clear' : clarity >= 25 ? 'moderate' : clarity >= 12 ? 'slight' : 'unresolved',
      answered,
    }
    type += letter
  }
  return { type, tally }
}

async function main() {
  const modelName = process.argv[2]
  if (!modelName) throw new Error('usage: mbti-run.ts <model_name> [--instrument mbti60|typescale-v5] [--thinking max] [--runs 1] [--publish]')
  const thinking = arg('thinking')
  const runs = Number(arg('runs', '1'))
  const instrument = arg('instrument', 'mbti60')!
  const publish = process.argv.includes('--publish')
  const likert = instrument === 'typescale-v5'
  const items = (scale as any).items as Item[]
  const questions = bank.questions as Q[]
  const setLabel = likert ? `${(scale as any).name} (${(scale as any).source})` : `${bank.name} (${bank.source})`

  const model = await loadModel(modelName)
  const count = likert ? items.length : questions.length
  console.log(`${model.display_name} (${modelName})${thinking ? ` @ ${thinking}` : ''} — ${setLabel} — ${count} items x ${runs} run(s)`)

  const results: Array<{ type: string; tally: any; answers: any[]; cost: number }> = []
  for (let r = 0; r < runs; r++) {
    const answers: any[] = []
    let cost = 0
    if (likert) {
      for (const it of items) {
        const { value, raw, cost: c } = await askLikert(model, it, thinking)
        cost += c
        answers.push({ pos: it.pos, dim: it.dim, value, raw })
        process.stdout.write(value == null ? '?' : String(value))
      }
    } else {
      for (const q of questions) {
        const { letter, raw, cost: c } = await askAB(model, q, thinking)
        cost += c
        answers.push({ n: q.n, letter, raw })
        process.stdout.write(letter ?? '?')
      }
    }
    const s = likert ? scoreLikert(answers, items) : scoreAB(answers, questions)
    results.push({ ...s, answers, cost })
    const detail = likert
      ? Object.entries(s.tally).map(([d, v]: any) => `${v.letter}${v.raw}(${v.band})`).join(' ')
      : `E${s.tally.E ?? 0}/I${s.tally.I ?? 0} S${s.tally.S ?? 0}/N${s.tally.N ?? 0} T${s.tally.T ?? 0}/F${s.tally.F ?? 0} J${s.tally.J ?? 0}/P${s.tally.P ?? 0}`
    console.log(`\n  run ${r + 1}: ${s.type}  ${detail}  $${cost.toFixed(4)}`)
  }

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.type] = (counts[r.type] ?? 0) + 1
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const total = results.reduce((s, r) => s + r.cost, 0)
  console.log(`\n${model.display_name}: ${majority[0]} (${majority[1]}/${runs} runs)   total $${total.toFixed(4)}`)

  if (publish) {
    const { error } = await sb().from('mbti_results').insert(results.map((r, i) => ({
      subject_kind: 'model',
      model_name:   modelName,
      display_name: model.display_name,
      provider:     model.provider,
      effort:       thinking ?? null,
      run_index:    i,
      mbti_type:    r.type,
      tally:        r.tally,
      answers:      r.answers,
      cost_usd:     r.cost,
      system_prompt: SYSTEM,
      format_prompt: likert ? FORMAT_LIKERT : FORMAT_AB,
      question_set: setLabel,
    })))
    if (error) throw new Error(`publish failed: ${error.message}`)
    console.log(`published ${results.length} run(s) to mbti_results`)
  } else {
    console.log('(not published — pass --publish to write to the database)')
  }
}

main().catch(e => { console.error(e.message ?? e); process.exit(1) })
