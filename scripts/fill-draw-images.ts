// scripts/fill-draw-images.ts
//
// Draw & Guess cache filler (owner design, Aug 6): the game has NO live
// generation path — it only serves (term, model, variant) drawings that
// already exist. This tool fills the gaps, offline, with the cost printed
// per image so generation spend is visible and deliberate.
//
// Run it whenever terms or models are added:
//   npx tsx scripts/fill-draw-images.ts --model <model_name> [--lang zh-Hant]
//       [--tier easy] [--variants 2] [--limit 20] [--dry]
//
// --dry lists the gaps and estimated count without generating anything.
// Re-runs are incremental: existing (term, model, variant) rows are skipped.

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { drawPrompt } from '../lib/drawsomething-engine'

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const modelName = arg('model')
  if (!modelName) {
    console.error('Usage: npx tsx scripts/fill-draw-images.ts --model <model_name> [--lang xx] [--tier easy] [--variants 2] [--limit N] [--dry]')
    process.exit(1)
  }
  const lang = arg('lang')
  const tier = arg('tier')
  const variants = Math.max(1, Math.min(4, Number(arg('variants') ?? 2)))
  const limit = arg('limit') ? Number(arg('limit')) : null
  const dry = has('dry')

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

  const { data: model, error: mErr } = await sb.from('ai_models')
    .select('*').eq('model_name', modelName).maybeSingle()
  if (mErr || !model) { console.error(`Model not found: ${modelName}`); process.exit(1) }
  if (!(model.output_modalities ?? []).includes('image')) {
    console.error(`${model.display_name} is not an image model (output_modalities: ${model.output_modalities})`)
    process.exit(1)
  }

  // Ensure the model's secret URL token exists.
  let { data: key } = await sb.from('draw_model_keys').select('secret').eq('model_id', model.id).maybeSingle()
  if (!key) {
    const secret = randomBytes(12).toString('hex')
    const { error } = await sb.from('draw_model_keys').insert({ model_id: model.id, secret })
    if (error) { console.error('could not create model key:', error.message); process.exit(1) }
    key = { secret }
    console.log(`minted secret for ${model.display_name}`)
  }

  let q = sb.from('draw_terms').select('id, lang, term, tier').eq('enabled', true)
  if (lang) q = q.eq('lang', lang)
  if (tier) q = q.eq('tier', tier)
  const { data: terms } = await q.order('lang').order('tier')
  if (!terms?.length) { console.log('No matching terms.'); return }

  const { data: existing } = await sb.from('draw_images')
    .select('term_id, variant').eq('model_id', model.id)
  const havePairs = new Set((existing ?? []).map(r => `${r.term_id}:${r.variant}`))

  const gaps: Array<{ term: any; variant: number }> = []
  for (const t of terms) {
    for (let v = 1; v <= variants; v++) {
      if (!havePairs.has(`${t.id}:${v}`)) gaps.push({ term: t, variant: v })
    }
  }
  const todo = limit ? gaps.slice(0, limit) : gaps
  console.log(`${model.display_name}: ${terms.length} terms, ${gaps.length} gaps${limit ? `, doing ${todo.length}` : ''}`)
  if (dry) {
    for (const g of todo) console.log(`  would draw: [${g.term.lang}/${g.term.tier}] ${g.term.term} #${g.variant}`)
    return
  }

  const providers = await import('../lib/providers')
  let done = 0, failed = 0, cost = 0
  for (const g of todo) {
    const label = `[${g.term.lang}/${g.term.tier}] ${g.term.term} #${g.variant}`
    try {
      const result = await providers.generateImage(
        model, drawPrompt(g.term.term), 'low', '1024x1024', [], null, null,
        { userId: null, surface: 'xgame-draw-fill' } as any, {},
      )
      const ext = (result.mediaType?.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
      const path = `draw/${key.secret}/${g.term.id}_${String(g.variant).padStart(2, '0')}.${ext}`
      const { error: upErr } = await sb.storage.from('xgame-draw')
        .upload(path, result.buffer, { contentType: result.mediaType, upsert: true })
      if (upErr) throw new Error(`upload: ${upErr.message}`)
      const { error: insErr } = await sb.from('draw_images').upsert({
        term_id: g.term.id, model_id: model.id, variant: g.variant,
        storage_path: path, cost_usd: result.cost ?? 0,
      }, { onConflict: 'term_id,model_id,variant' })
      if (insErr) throw new Error(`index: ${insErr.message}`)
      done++; cost += result.cost ?? 0
      console.log(`  ✓ ${label}  $${(result.cost ?? 0).toFixed(4)}  (total $${cost.toFixed(3)})`)
    } catch (e: any) {
      failed++
      console.warn(`  ✗ ${label}  ${String(e?.message ?? e).slice(0, 140)}`)
    }
  }
  console.log(`\ndone: ${done} drawn, ${failed} failed, $${cost.toFixed(3)} total`)
  console.log('Coverage check: a model pair can host a game when they share ≥5 covered terms in one language.')
}

main().catch(e => { console.error(e); process.exit(1) })
