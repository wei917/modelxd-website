// scripts/probe-latency.ts — the TTFT benchmark behind xd/fast.
//
//   npx tsx --env-file=.env.local scripts/probe-latency.ts          # dry run
//   npx tsx --env-file=.env.local scripts/probe-latency.ts --apply  # spends money
//   … --apply --only gpt-5.6-sol,gemini-3.6-flash                   # a subset
//
// Measures TIME TO FIRST VISIBLE TOKEN for every API-eligible text model and
// writes medians to model_latency (migration 95). "Fast" on ModelXD means near
// realtime — how long before the reader sees anything — not how long the whole
// answer takes. A model can start instantly and grind, or think for 40s and
// then pour; only the first number tells a chat UI what it will feel like.
//
// WHY A STANDING PROBE, not a read of live traffic: provider_calls holds four
// text models with >= 3 samples over seven days and 894 of its 1000 rows are
// one model (the site agent). Live traffic measures what the SITE calls, so a
// model nobody happens to use reads as unmeasured rather than slow. It also
// only records whole-call latency — it cannot see the first token at all.
//
// TWO DOTS PER MODEL: lowest and highest thinking setting, the same convention
// the XEval ladders use, because effort changes this answer completely. The
// provider's own level names are recorded, never "default".
//
// THINKING DELTAS DO NOT COUNT, and this comes for free: the provider router's
// onDelta carries visible text only — anthropic.ts filters to `text_delta`,
// dropping thinking_delta — so the first delta IS the first token a reader
// sees. Measuring through the same callback the site streams from is also the
// point: this reports what a user experiences, not a synthetic number.

import { createClient } from '@supabase/supabase-js'
import { streamText } from '../lib/providers'
import { getModelById } from '../lib/models'

const APPLY = process.argv.includes('--apply')
const ONLY = (() => {
  const i = process.argv.indexOf('--only')
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].split(',').map(s => s.trim()) : null
})()

const REPEATS = 5
const PER_CALL_TIMEOUT_MS = 120_000

// Throughput needs a generation window worth dividing by. On the first run the
// prompt asked for three words, every model answered in one or two deltas, and
// tok/s came out at 3375 and 5000 — an artefact of dividing by milliseconds,
// not a measurement. out_tps is only recorded when the answer actually
// streamed: several deltas across a real interval.
const TPS_MIN_DELTAS  = 5
const TPS_MIN_SECONDS = 0.75

// Short, dull, and identical for everyone. A prompt with any reasoning in it
// would measure the thinking, not the pipe; a prompt with a fixed answer would
// let a cache win. Output is capped so a chatty model cannot skew tok/s.
const PROMPT = 'Name three colours of the sea, one per line. No preamble.'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

/** Lowest and highest thinking level a model declares, or [null] if it has none. */
function effortDots(model: any): (string | null)[] {
  const cfg = model.output_config?.text ?? {}
  const levels: string[] | undefined = cfg.thinking_levels ?? cfg.effort_levels
  if (Array.isArray(levels) && levels.length >= 2) return [levels[0], levels[levels.length - 1]]
  if (Array.isArray(levels) && levels.length === 1) return [levels[0]]
  return [null]
}

type Sample = { ttft: number; tps: number | null }

async function probeOnce(model: any, effort: string | null): Promise<Sample | null> {
  const t0 = Date.now()
  let firstVisible = 0
  let visibleChars = 0
  let deltas = 0

  const timeout = new Promise<null>(r => setTimeout(() => r(null), PER_CALL_TIMEOUT_MS))
  const run = (async () => {
    await streamText(
      model,
      [{ role: 'user', content: PROMPT }],
      {
        onDelta: (text: string) => {
          if (!text) return
          if (!firstVisible) firstVisible = Date.now()
          deltas++
          visibleChars += text.length
        },
        onDone: () => {},
        onError: () => {},
      },
      [],
      undefined,
      { thinking: effort ?? null, maxTokens: 120 },
    )
    return true
  })().catch(() => null)

  const ok = await Promise.race([run, timeout])
  if (!ok || !firstVisible) return null

  const ttft = (firstVisible - t0) / 1000
  const genSeconds = (Date.now() - firstVisible) / 1000
  // ~4 chars per token is the usual rough conversion; this is a comparison
  // between models measured identically, not an absolute token count. NULL
  // when the answer did not really stream — a number computed over a few
  // milliseconds is noise wearing a unit.
  const tps = (deltas >= TPS_MIN_DELTAS && genSeconds >= TPS_MIN_SECONDS)
    ? (visibleChars / 4) / genSeconds
    : null
  return { ttft, tps }
}

async function main() {
  const sb = service()
  const { data } = await sb.from('ai_models')
    .select('id, provider, model_name, display_name, blocked_features, modes')
    .eq('enabled', true).contains('output_modalities', ['text'])
  // Speech-to-text rows declare text OUTPUT but generate nothing from a
  // prompt — fun-asr and whisper-1 would each burn five failed calls and
  // report "no measurement". They are transcribers, not models xd/fast could
  // ever route to.
  const TRANSCRIBERS = /asr|whisper|transcri/i
  let models = (data ?? [])
    .filter(m => !((m.blocked_features ?? []) as string[]).includes('api'))
    .filter(m => !TRANSCRIBERS.test(m.model_name))
  if (ONLY) models = models.filter(m => ONLY.includes(m.model_name))

  const plan: { model: any; effort: string | null }[] = []
  for (const row of models) {
    const model = await getModelById(row.id)
    if (!model) continue
    for (const e of effortDots(model)) plan.push({ model, effort: e })
  }

  console.log(`models: ${models.length}   entries: ${plan.length}   calls: ${plan.length * REPEATS}`)
  if (!APPLY) {
    for (const p of plan) console.log(`  ${p.model.provider}/${p.model.model_name}${p.effort ? '@' + p.effort : ''}`)
    console.log('\nDRY RUN — nothing called, nothing spent. Re-run with --apply.')
    return
  }

  const results: any[] = []
  for (const { model, effort } of plan) {
    const label = `${model.provider}/${model.model_name}${effort ? '@' + effort : ''}`
    process.stdout.write(`\n${label.padEnd(42)} `)
    const samples: Sample[] = []
    let failures = 0
    for (let i = 0; i < REPEATS; i++) {
      const s = await probeOnce(model, effort)
      if (s) { samples.push(s); process.stdout.write('.') } else { failures++; process.stdout.write('x') }
    }
    const ttft = median(samples.map(s => s.ttft))
    const tps = median(samples.map(s => s.tps).filter((x): x is number => x != null))
    process.stdout.write(
      ttft ? `  ttft ${ttft.toFixed(2)}s${tps ? `  ~${tps.toFixed(0)} tok/s` : '  (tps not measurable)'}`
           : '  no measurement')

    results.push({
      model_id: model.id, effort: effort ?? '',
      ttft_s: ttft, out_tps: tps,
      samples: samples.length, failures,
      measured_at: new Date().toISOString(),
    })
  }

  const { error } = await sb.from('model_latency').upsert(results, { onConflict: 'model_id,effort' })
  console.log(error ? `\n\nwrite failed: ${error.message}` : `\n\nwrote ${results.length} rows to model_latency`)

  const ranked = results.filter(r => r.ttft_s).sort((a, b) => a.ttft_s - b.ttft_s)
  console.log(`\nfastest to first visible token (what xd/fast will pick from):`)
  for (const r of ranked.slice(0, 10)) {
    const m = await getModelById(r.model_id)
    console.log(`  ${((m?.model_name ?? '?') + (r.effort ? '@' + r.effort : '')).padEnd(34)} ${r.ttft_s.toFixed(2)}s   n=${r.samples}`)
  }
  const missing = results.filter(r => !r.ttft_s)
  if (missing.length) console.log(`\n${missing.length} entries produced no measurement — xd/fast will not offer them.`)
}

main().catch(e => { console.error(e); process.exit(1) })
