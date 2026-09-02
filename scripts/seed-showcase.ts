// scripts/seed-showcase.ts — hang the museum wall.
//
//   npx tsx --env-file=.env.local scripts/seed-showcase.ts          # dry run
//   npx tsx --env-file=.env.local scripts/seed-showcase.ts --apply  # spends money
//
// Generates the house prompts through the NORMAL /api/xcreate pipeline as
// founder@modelxd.com, so billing, job rows, provider_calls logging and
// storage behave exactly as they do for a user. Nothing here reaches a
// provider directly: a museum whose pictures were made by a side channel
// would not be showing what the product actually does.
//
// ONE RUN PER PROMPT, all qualifying models as slots. That is what xcreates
// is built for, and it is what showcase's (xcreate_id, slot_index) points
// into: same brief, N pictures, one name card each.
//
// WHICH MODELS: the newest in each family, derived from ai_models.released_at.
// A family is the model name with version tokens stripped, so
// grok-imagine-image-2.0 retires grok-imagine-image while flash / flash-lite /
// pro stay separate families and the price spread survives. Nothing is stored
// anywhere — when a new model lands it joins the wall and its predecessor
// leaves, with no SQL and no deploy.
//
// SPEND: a disposable API key is minted with a hard cap and revoked in a
// finally block. The cap is the point — a bug in the loop below cannot spend
// past it, which is the guard that was missing the day a retry loop burned
// $368 on Terminal-Bench.

import { createClient } from '@supabase/supabase-js'
import { mintApiToken } from '../lib/api-token'

const APPLY = process.argv.includes('--apply')
const BASE = process.env.SEED_BASE_URL ?? 'http://localhost:3000'
const ACCOUNT = 'founder@modelxd.com'
const SPEND_CAP_USD = 4          // estimate is $2.40; the rest is headroom, not budget
const PER_PROMPT_TIMEOUT_MS = 300_000

// The museum. 1-3 and 5 are what people actually open XCreate for; 4 and 6 are
// where the wall earns its keep — CJK calligraphy and poster typography are
// where image models fail most visibly, and #4 matters because Taiwan and
// Japan are the target markets. No brand marks, no robots.
const PROMPTS: { room: string; title: string; prompt: string }[] = [
  { room: 'product', title: 'Pour-over, morning light',
    prompt: 'A ceramic pour-over coffee dripper in matte sand glaze, centred on pale travertine, soft morning window light from the left, shallow depth of field, one dry eucalyptus sprig out of focus behind. Square product shot, no text, no brand marks.' },
  { room: 'portrait', title: 'Mid-sentence',
    prompt: 'A woman in her sixties, silver hair pinned up, laughing mid-sentence at a kitchen table, late afternoon sun through a slatted blind striping the wall behind her. 50mm, natural skin texture, no retouching.' },
  { room: 'place', title: 'Night market, dusk',
    prompt: 'Dusk in a Taiwanese night market alley: wet asphalt reflecting red lantern light, steam rising from a noodle stall, scooters along one wall, people out of focus mid-stride. Handheld 35mm, available light only.' },
  { room: 'lettering', title: '春日書店',
    prompt: 'A hand-painted wooden shop sign above a doorway reading 「春日書店」 in black brush calligraphy on cream lacquer, weathered edges, shot straight on in overcast light.' },
  { room: 'illustration', title: 'Sleep debt',
    prompt: 'Flat editorial illustration about sleep debt: a person asleep at a desk while an oversized moon rises out of an open laptop. Ink blue, bone, one warm ochre, subtle paper grain, no outlines.' },
  { room: 'poster', title: 'Night Sessions',
    prompt: "Minimal concert poster, portrait orientation: large sans-serif type reading 'NIGHT SESSIONS' across the upper third, a duotone saxophone photograph below, ample white space, small print date line at the bottom." },
]

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

/** Family = the model name with every version token removed. */
const familyOf = (provider: string, name: string) =>
  provider + '/' + name.split(/[-_.]/).filter(t => !/^v?\d+(\.\d+)*$/.test(t)).join('-')

async function qualifyingModels(sb: ReturnType<typeof service>) {
  const { data, error } = await sb.from('ai_models')
    .select('id, provider, model_name, display_name, released_at, blocked_features')
    .eq('enabled', true).contains('output_modalities', ['image'])
  if (error) throw new Error(`model read failed: ${error.message}`)
  const usable = (data ?? []).filter(m => !((m.blocked_features ?? []) as string[]).includes('xcreate'))
  const groups = new Map<string, any[]>()
  for (const m of usable) {
    const k = familyOf(m.provider, m.model_name)
    groups.set(k, [...(groups.get(k) ?? []), m])
  }
  return [...groups.values()]
    .map(g => g.sort((a, b) => String(b.released_at ?? '').localeCompare(String(a.released_at ?? '')))[0])
    .sort((a, b) => (a.provider + a.model_name).localeCompare(b.provider + b.model_name))
}

async function main() {
  const sb = service()

  const { data: userList, error: uErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (uErr) throw new Error(`user lookup failed: ${uErr.message}`)
  const owner = (userList?.users ?? []).find(u => u.email === ACCOUNT)
  if (!owner) throw new Error(`no account ${ACCOUNT}`)

  const models = await qualifyingModels(sb)
  console.log(`account : ${ACCOUNT} (${owner.id.slice(0, 8)}…)`)
  console.log(`models  : ${models.length} (newest in each family)`)
  for (const m of models) console.log(`          ${m.provider}/${m.model_name}  ${String(m.released_at ?? '').slice(0, 10)}`)
  console.log(`prompts : ${PROMPTS.length}`)
  console.log(`pictures: ${models.length * PROMPTS.length}`)

  const { data: bal } = await sb.from('user_credits').select('balance_cents').eq('user_id', owner.id).maybeSingle()
  console.log(`balance : $${((bal?.balance_cents ?? 0) / 100).toFixed(2)}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing generated, nothing spent. Re-run with --apply.')
    return
  }

  const key = await mintApiToken(owner.id, 'showcase seed (disposable)', SPEND_CAP_USD)
  console.log(`\nminted disposable key ${key.prefix} capped at $${SPEND_CAP_USD}`)
  let hung = 0

  try {
    for (const p of PROMPTS) {
      process.stdout.write(`\n[${p.room}] ${p.title} … `)
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), PER_PROMPT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`${BASE}/api/xcreate`, {
          method: 'POST', signal: ctl.signal, redirect: 'manual',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.plaintext}` },
          body: JSON.stringify({
            prompt: p.prompt, mode: 'image',
            modelIds: models.map(m => m.id),
            modelOptions: models.map(() => ({})),
          }),
        })
      } catch (e: any) {
        console.log(`FAILED (${e?.name === 'AbortError' ? 'timeout' : e?.message})`)
        continue
      } finally { clearTimeout(timer) }

      const body: any = await res.json().catch(() => ({}))
      if (!res.ok || !body?.jobId) {
        console.log(`FAILED ${res.status} ${body?.message ?? body?.error ?? ''}`)
        continue
      }

      // Read the slots back off the job to learn which models actually
      // produced a picture. A model that errored is simply not hung; the wall
      // shows work, not apologies.
      const { data: slots } = await sb.from('xcreate_job_slots')
        .select('slot_index, provider, model_name, text, error')
        .eq('job_id', body.jobId).order('slot_index', { ascending: true })
      const ok = (slots ?? []).filter(s => s.text && !s.error)
      const failed = (slots ?? []).filter(s => s.error)
      console.log(`${ok.length}/${(slots ?? []).length} ok${failed.length ? `, failed: ${failed.map(f => f.model_name).join(', ')}` : ''}`)

      if (!body.xcreateId) { console.log('  (no xcreates row returned — nothing to hang)'); continue }
      const rows = ok.map((s, i) => ({
        xcreate_id: body.xcreateId,
        slot_index: s.slot_index,
        room: p.room,
        title: p.title,
        sort_order: i,
        published: false,       // curate first, then publish
      }))
      if (rows.length) {
        const { error: insErr } = await sb.from('showcase').upsert(rows, { onConflict: 'xcreate_id,slot_index' })
        if (insErr) console.log(`  showcase insert failed: ${insErr.message}`)
        else { hung += rows.length; console.log(`  hung ${rows.length}`) }
      }
    }
  } finally {
    await service().from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', key.id)
    console.log(`\nrevoked the disposable key ${key.prefix}`)
  }

  const { data: spent } = await service().from('api_tokens').select('spent_usd').eq('id', key.id).maybeSingle()
  console.log(`hung ${hung} pieces; key spent $${Number(spent?.spent_usd ?? 0).toFixed(4)}`)
  console.log('All unpublished. Publish with:  update showcase set published = true;')
}

main().catch(e => { console.error(e); process.exit(1) })
