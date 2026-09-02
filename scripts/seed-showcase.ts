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
// ONE PICTURE PER BRIEF, one model each, models assigned round-robin so the
// wall shows range without ever repeating a brief. The wall is a Pinterest
// board, not a comparison — the same prompt rendered by six models side by
// side is XDuel's job, and doing it here turned the gallery into a test (the
// first version of this script did exactly that; owner corrected it).
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
const SPEND_CAP_USD = 4          // ~$0.065 a picture; the rest is headroom, not budget
const PER_PROMPT_TIMEOUT_MS = 300_000

// The wall. Range is the job here, not coverage: food, faces, places, type,
// interiors, illustration, architecture — the things people actually open
// XCreate to make. Two CJK lettering briefs because Taiwan and Japan are the
// target markets and shop signage is the everyday case. No brand marks, no
// robots. Aspect ratios are mixed so the masonry does not read as a grid.
const PROMPTS: { room: string; title: string; aspect: string; prompt: string }[] = [
  // Portrait-tall, landscape and square are mixed on purpose: a masonry wall
  // is only interesting when the tiles are not all one shape.
  { room: 'product',      title: 'Pour-over, morning light', aspect: '1:1',
    prompt: 'A ceramic pour-over coffee dripper in matte sand glaze, centred on pale travertine, soft morning window light from the left, shallow depth of field, one dry eucalyptus sprig out of focus behind. No text, no brand marks.' },
  { room: 'portrait',     title: 'Mid-sentence', aspect: '3:4',
    prompt: 'A woman in her sixties, silver hair pinned up, laughing mid-sentence at a kitchen table, late afternoon sun through a slatted blind striping the wall behind her. 50mm, natural skin texture, no retouching.' },
  { room: 'place',        title: 'Night market, dusk', aspect: '3:2',
    prompt: 'Dusk in a Taiwanese night market alley: wet asphalt reflecting red lantern light, steam rising from a noodle stall, scooters along one wall, people out of focus mid-stride. Handheld 35mm, available light only.' },
  { room: 'lettering',    title: '春日書店', aspect: '4:3',
    prompt: 'A hand-painted wooden shop sign above a doorway reading 「春日書店」 in black brush calligraphy on cream lacquer, weathered edges, shot straight on in overcast light.' },
  { room: 'illustration', title: 'Sleep debt', aspect: '4:3',
    prompt: 'Flat editorial illustration about sleep debt: a person asleep at a desk while an oversized moon rises out of an open laptop. Ink blue, bone, one warm ochre, subtle paper grain, no outlines.' },
  { room: 'poster',       title: 'Night Sessions', aspect: '2:3',
    prompt: "Minimal concert poster, portrait orientation: large sans-serif type reading 'NIGHT SESSIONS' across the upper third, a duotone saxophone photograph below, ample white space, small print date line at the bottom." },

  { room: 'food',         title: 'Soup dumplings', aspect: '1:1',
    prompt: 'Eight soup dumplings in a bamboo steamer seen from just above, pleats crisp, one lifted on chopsticks with steam catching the light, dark slate beneath, black vinegar dish at the edge.' },
  { room: 'place',        title: 'Rain, Shinjuku', aspect: '2:3',
    prompt: 'A narrow Shinjuku side street in heavy rain at night, umbrellas as pools of colour, vertical signage stacked overhead, reflections doubling every light. Cinematic, slight telephoto compression.' },
  { room: 'portrait',     title: 'The welder', aspect: '3:4',
    prompt: 'A young welder lifting her mask, face lit by the last of the arc glow, sparks settling around her, workshop dark behind. Grain, high contrast, documentary.' },
  { room: 'interior',     title: 'Reading corner', aspect: '4:5',
    prompt: 'A reading corner in an old apartment: worn leather armchair, floor lamp, stacked books, tall window with sheer curtains diffusing grey afternoon light. Calm, lived-in, no people.' },
  { room: 'product',      title: 'Wool coat, folded', aspect: '1:1',
    prompt: 'A camel wool coat folded on unbleached linen, top-down, raking side light picking out the nap of the fabric and the horn buttons. Editorial catalogue shot, no text.' },
  { room: 'nature',       title: 'Cedar fog', aspect: '2:3',
    prompt: 'Cedar forest in dense morning fog, trunks receding into flat grey, one shaft of light on wet moss, no sky visible. Large-format stillness.' },
  { room: 'illustration', title: 'The commute', aspect: '3:2',
    prompt: 'Flat vector illustration of a crowded morning train carriage seen in cross-section, each passenger doing something different, muted palette of slate, mustard and dusty rose, no outlines.' },
  { room: 'lettering',    title: 'かき氷', aspect: '1:1',
    prompt: 'A vintage Japanese shop banner reading 「かき氷」 in bold red brush lettering on white cloth, hung outside a wooden storefront, gently lifted by wind, strong summer sun.' },
  { room: 'architecture', title: 'Stair, concrete', aspect: '4:5',
    prompt: 'A brutalist concrete spiral staircase photographed from directly below, board-formed texture visible, single skylight at the centre blowing out to white. Symmetrical, monochrome.' },
  { room: 'poster',       title: 'Botanic', aspect: '2:3',
    prompt: 'A museum exhibition poster: a single pressed fern specimen centred on warm paper, thin rule border, small serif caption block at the lower left, generous margins.' },
  { room: 'food',         title: 'Citrus, cut', aspect: '3:2',
    prompt: 'Blood oranges and one lemon cut open on a marble slab, juice pooling, hard midday light throwing sharp shadows, colours saturated but true. Overhead.' },
  { room: 'portrait',     title: 'Grandfather and dog', aspect: '3:4',
    prompt: 'An elderly man on a porch step with an old dog leaning against his knee, both looking out of frame, early evening light, quiet companionship. Documentary, 35mm.' },
  { room: 'nature',       title: 'Tide pool', aspect: '1:1',
    prompt: 'A tide pool at low tide seen from directly above: anemones, barnacles and green weed in clear water over dark rock, water surface almost invisible. Naturalist detail.' },
  { room: 'interior',     title: 'Noodle counter', aspect: '3:2',
    prompt: 'A six-seat noodle counter at closing time, stools tucked in, warm bulb over scrubbed wood, cloth hanging, steam gone. Empty but recently full.' },
  { room: 'architecture', title: 'Blue hour tower', aspect: '2:3',
    prompt: 'A single residential tower at blue hour, half the windows lit in warm yellow, sky graduating to deep indigo, long exposure so the clouds smear.' },
  { room: 'illustration', title: 'Deep work', aspect: '4:3',
    prompt: 'Editorial illustration about concentration: a figure at a desk inside a bubble of warm light while the room around them dissolves into cool abstract shapes. Limited palette, textured.' },
  { room: 'product',      title: 'Fountain pen', aspect: '3:2',
    prompt: 'A black resin fountain pen uncapped on a sheet of cream writing paper, nib catching a highlight, a few lines of indistinct handwriting beside it, soft window light.' },
  { room: 'place',        title: 'Temple steps', aspect: '4:5',
    prompt: 'Worn stone steps up to a temple gate in early morning, incense smoke drifting across, one sweeper at the top in silhouette, cool shadow and warm sun divided down the middle.' },
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
    .select('id, provider, model_name, display_name, released_at, blocked_features, output_config')
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
  // Skip briefs already on the wall: reruns should top the wall up, not pay
  // twice for pictures that are already hanging.
  const { data: existing } = await sb.from('xcreates')
    .select('prompt').eq('user_id', owner.id).eq('mode', 'image')
  const already = new Set((existing ?? []).map((r: any) => String(r.prompt)))
  const todo = PROMPTS.filter(p => !already.has(p.prompt))

  console.log(`prompts : ${PROMPTS.length} (${todo.length} new, ${PROMPTS.length - todo.length} already hung)`)
  console.log(`pictures: ${todo.length} — one model per brief, round-robin`)

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
    for (const [i, p] of todo.entries()) {
      // Round-robin so no model dominates the wall — but only among models
      // that can actually shoot this brief's shape. grok and qwen do not take
      // 2:3 / 3:2 / 4:5, and gpt-image-2 has no aspect_ratio at all (it takes
      // `sizes`), so a blind rotation hands a model a ratio it cannot honour
      // and the picture fails for a reason that has nothing to do with the
      // prompt. Capability comes from the catalog, not from a list here.
      const canShoot = (m: any) => {
        const ars: string[] | null = m.output_config?.image?.aspect_ratios ?? null
        return ars === null ? p.aspect === '1:1' : ars.includes(p.aspect)
      }
      const eligible = models.filter(canShoot)
      if (eligible.length === 0) {
        console.log(`\n[${p.room}] ${p.title} … SKIPPED (no enabled model shoots ${p.aspect})`)
        continue
      }
      const model = eligible[i % eligible.length]
      process.stdout.write(`\n[${p.room}] ${p.title} → ${model.model_name} … `)
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), PER_PROMPT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`${BASE}/api/xcreate`, {
          method: 'POST', signal: ctl.signal, redirect: 'manual',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.plaintext}` },
          body: JSON.stringify({
            prompt: p.prompt, mode: 'image',
            modelIds: [model.id],
            modelOptions: [{ aspect_ratio: p.aspect }],
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
      console.log(ok.length ? 'ok' : `FAILED (${failed.map(f => f.error).join('; ').slice(0, 90)})`)

      if (!body.xcreateId) { console.log('  (no xcreates row returned — nothing to hang)'); continue }
      const rows = ok.map(s => ({
        xcreate_id: body.xcreateId,
        slot_index: s.slot_index,
        room: p.room,
        title: p.title,
        sort_order: i,
        published: true,
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
  console.log('Hung and published. Take one down with:  update showcase set published = false where id = …;')
}

main().catch(e => { console.error(e); process.exit(1) })
