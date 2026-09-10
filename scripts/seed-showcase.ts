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
// --video seeds the video wall instead of the image wall. Same table, same
// proxy, same tiles; the difference is what a clip costs and how long it takes.
const VIDEO = process.argv.includes('--video')
const BASE = process.env.SEED_BASE_URL ?? 'http://localhost:3000'
const ACCOUNT = 'founder@modelxd.com'
const SPEND_CAP_USD = VIDEO ? 20 : 4   // video runs ~$0.67 a clip vs $0.065 a picture
const CLIP_SECONDS = 5
const PER_PROMPT_TIMEOUT_MS = VIDEO ? 900_000 : 300_000   // video takes minutes

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

// The video wall. MOTION IS THE SUBJECT — a still-life brief wastes the medium
// and produces a photograph that happens to drift. Every one of these has a
// thing that changes: something blooms, ignites, falls, curls, is erased. No
// brand marks, no named people, no robots.
const VIDEO_PROMPTS: { room: string; title: string; aspect: string; prompt: string }[] = [
  { room: 'water',    title: 'Ink, blooming', aspect: '1:1',
    prompt: 'A single drop of black ink falling into still water and blooming outward in slow motion, backlit against white, tendrils unfurling. Macro, locked-off camera.' },
  { room: 'fire',     title: 'The match', aspect: '16:9',
    prompt: 'A match struck in darkness: the head catches, flares, and settles to a steady flame, smoke curling off. Extreme macro, shallow focus, everything else black.' },
  { room: 'food',     title: 'Steam off the bowl', aspect: '1:1',
    prompt: 'Steam curling up off a bowl of hot noodle soup in a dark room, one warm light behind it catching the vapour. Slow, macro, nothing else moves.' },
  { room: 'sea',      title: 'Footprints, erased', aspect: '16:9',
    prompt: 'A thin wave slides up wet sand and erases a line of footprints, then withdraws. Late afternoon light, low camera almost at sand level.' },
  { room: 'quiet',    title: 'Blown out', aspect: '9:16',
    prompt: 'A candle blown out: the flame gutters, dies, and a ribbon of smoke rises and curls in the still air. Dark background, single warm rim light.' },
  { room: 'season',   title: 'Petals, stone path', aspect: '16:9',
    prompt: 'Cherry blossom petals drifting down onto a wet stone path in a temple garden, a few settling on moss. Overcast light, gentle breeze, no people.' },
  { room: 'hands',    title: 'Paper crane', aspect: '1:1',
    prompt: 'Hands folding a sheet of paper into a crane, seen from directly above on a wooden table. Unhurried, real folds, natural window light.' },
  { room: 'workshop', title: 'Sparks', aspect: '16:9',
    prompt: 'An angle grinder meeting steel in a dark workshop, sparks arcing away and dying on the floor. Handheld, high contrast, the only light is the sparks.' },
  { room: 'sky',      title: 'The kite lifts', aspect: '16:9',
    prompt: 'A kite catching wind and climbing away over a dusk beach, string tightening, the horizon low. Camera tilts up to follow it.' },
  { room: 'city',     title: 'Puddle, passing bus', aspect: '9:16',
    prompt: 'A still puddle holding a perfect neon reflection at night; a bus passes and the reflection shatters into ripples, then reassembles. Locked-off, close to the ground.' },
  { room: 'water',    title: 'Pour', aspect: '1:1',
    prompt: 'Espresso poured into a white cup from above, crema swirling into a spiral. Top-down, macro, soft daylight.' },
  { room: 'field',    title: 'The gust', aspect: '16:9',
    prompt: 'A wheat field bending in a single travelling gust of wind, the wave moving away from camera toward a far treeline. Low drone, golden hour.' },
  { room: 'season',   title: 'Snow on a lantern', aspect: '9:16',
    prompt: 'Snow settling slowly onto a stone lantern in a garden at dusk, flakes drifting through the warm light inside it. Very slow, almost still.' },
  { room: 'city',     title: 'The train passes', aspect: '16:9',
    prompt: 'A train passing a station platform at speed, camera locked off at the platform edge, everything blurring except the far wall between carriages.' },
  { room: 'workshop', title: 'Centering clay', aspect: '1:1',
    prompt: 'Two hands centering wet clay on a spinning potter wheel, the lump wobbling then settling true. Close, top-down, water glistening.' },
  { room: 'quiet',    title: 'Shadows cross', aspect: '16:9',
    prompt: 'Time-lapse of shadows travelling across an empty stone courtyard through an afternoon, the light warming as they move. Static wide shot.' },
  { room: 'creature', title: 'Hummingbird', aspect: '1:1',
    prompt: 'A hummingbird hovering at a red flower in extreme slow motion, wings resolving into individual beats. Bright, shallow depth of field.' },
  { room: 'water',    title: 'Paper boat', aspect: '9:16',
    prompt: 'A folded paper boat riding a fast gutter stream after rain, spinning once as it passes a drain. Camera tracks alongside, low.' },
  { room: 'creature', title: 'Rooftop leap', aspect: '16:9',
    prompt: 'A cat leaping between two low rooftops in slow motion, body stretching, landing and continuing out of frame. Warm evening light.' },
  { room: 'city',     title: 'Night market, wide', aspect: '16:9',
    prompt: 'A Taiwanese night market alley at full swing: steam, lanterns swinging slightly, people moving through frame in both directions. Handheld, available light.' },
]

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

/**
 * Family = the model name with version tokens AND release-stage words removed.
 *
 * The stage words matter as much as the numbers. Without them
 * `gemini-omni-flash-preview` (Jun 30) and `gemini-omni-1.1-flash` (Aug 20)
 * computed as two different families, so the preview survived beside the
 * release that replaced it and BOTH went on the wall — which is exactly the
 * "newest per family" rule failing at the one job it has.
 */
const STAGE = /^(preview|generate|exp|experimental|latest|beta)$/i
const familyOf = (provider: string, name: string) =>
  provider + '/' + name
    .split(/[-_.]/)
    .filter(t => !/^v?\d+(\.\d+)*$/.test(t) && !STAGE.test(t))
    .join('-')

async function qualifyingModels(sb: ReturnType<typeof service>) {
  const { data, error } = await sb.from('ai_models')
    .select('id, provider, model_name, display_name, released_at, blocked_features, output_config, modes, model_pricing')
    .eq('enabled', true).contains('output_modalities', [VIDEO ? 'video' : 'image'])
  if (error) throw new Error(`model read failed: ${error.message}`)
  const usable = (data ?? [])
    .filter(m => !((m.blocked_features ?? []) as string[]).includes('xcreate'))
    // A video model that only does image_to_video cannot take a written brief.
    .filter(m => !VIDEO || ((m.modes ?? []) as string[]).includes('text_to_video'))
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
  const PROMPT_SET = VIDEO ? VIDEO_PROMPTS : PROMPTS

  // Skip briefs already HUNG — not briefs already attempted. The xcreates row
  // is born at run start, so keying the skip off it marked a failed brief as
  // done and made the failure permanent: a rerun could never retry it.
  const { data: hungRows } = await sb.from('showcase').select('xcreate_id')
  const { data: hungRuns } = await sb.from('xcreates')
    .select('prompt').in('id', [...new Set((hungRows ?? []).map((r: any) => r.xcreate_id))])
  const already = new Set((hungRuns ?? []).map((r: any) => String(r.prompt)))
  const todo = PROMPT_SET.filter(p => !already.has(p.prompt))

  console.log(`wall    : ${VIDEO ? 'VIDEO' : 'IMAGE'}`)
  console.log(`prompts : ${PROMPT_SET.length} (${todo.length} new, ${PROMPT_SET.length - todo.length} already hung)`)
  console.log(`pictures: ${todo.length} — one model per brief, round-robin`)

  // Cheapest declared tier per model: the wall is about range, and paying for
  // 1080p on a 300px tile buys nothing a viewer can see.
  const tierOf = (m: any): { res: string; rate: number; secs: number } | null => {
    const pv = m.model_pricing?.per_video_second ?? {}
    const tiers = Object.entries(pv).filter(([k]) => k !== 'default') as [string, number][]
    if (!tiers.length) return null
    const [res, rate] = tiers.sort((a, b) => a[1] - b[1])[0]

    // A model may only accept certain clip lengths at a given resolution, and
    // asking for one it does not take is a hard, silent failure: CLIP_SECONDS
    // was 5 for everyone and Veo 3.1 — which takes 4, 6 or 8 at 720p — refused
    // BOTH its clips with "the model failed to generate a response". Nothing in
    // that message says "5 is not on the list". Use the nearest length the
    // model actually declares, preferring the shorter one on a tie so a
    // rounding decision never costs more.
    // Two shapes in the catalog, both real: Veo lists exact lengths
    // ([4, 6, 8]), Seedance gives a range ({ min: 5, max: 30 }). Handling only
    // the list meant the range fell through to CLIP_SECONDS, which happens to
    // be legal today and would silently ask for 5s of a model whose minimum
    // was 8 the moment one existed.
    const allowed = m.output_config?.video?.durations_by_resolution?.[res]
    let secs = CLIP_SECONDS
    if (Array.isArray(allowed) && allowed.length) {
      secs = [...allowed].sort((a, b) =>
        Math.abs(a - CLIP_SECONDS) - Math.abs(b - CLIP_SECONDS) || a - b)[0]
    } else if (allowed && typeof allowed === 'object') {
      const min = Number(allowed.min), max = Number(allowed.max)
      if (Number.isFinite(min)) secs = Math.max(secs, min)
      if (Number.isFinite(max)) secs = Math.min(secs, max)
    }
    return { res, rate, secs }
  }

  if (VIDEO) {
    let quote = 0
    console.log('\nassignment (round-robin, cheapest tier each):')
    todo.forEach(p => {
      const m = models[PROMPT_SET.indexOf(p) % models.length]
      const t = tierOf(m)
      const cost = (t?.rate ?? 0) * (t?.secs ?? CLIP_SECONDS)
      quote += cost
      console.log(`  ${String(PROMPT_SET.indexOf(p) + 1).padStart(2)}. ${p.title.padEnd(22)} ${(m.provider + '/' + m.model_name).padEnd(34)} ${(t?.res ?? '?').padEnd(6)} ${t?.secs ?? CLIP_SECONDS}s  $${cost.toFixed(2)}`)
    })
    // The quote is a FLOOR, not a promise: it prices the cheapest declared
    // tier, and the first run came in 14% over it because three models billed
    // above that (wan3.0 $0.25 -> $0.50, seedance $1.00 -> $1.50).
    console.log(`\nQUOTE (cheapest declared tier; actuals have run ~15% higher): $${quote.toFixed(2)}   cap $${SPEND_CAP_USD}`)
  }

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
    for (const p of todo) {
      // The brief's place in the FULL set decides its model, NOT its place in
      // `todo`. Indexing into todo meant a retry reassigned every brief: the
      // three clips Veo and Seedance failed came back pointing at happyhorse
      // and wan, so the models that actually failed stayed missing from the
      // wall and the ones that worked got a third clip.
      const i = PROMPT_SET.indexOf(p)
      // Round-robin so no model dominates the wall — but only among models
      // that can actually shoot this brief's shape. grok and qwen do not take
      // 2:3 / 3:2 / 4:5, and gpt-image-2 has no aspect_ratio at all (it takes
      // `sizes`), so a blind rotation hands a model a ratio it cannot honour
      // and the picture fails for a reason that has nothing to do with the
      // prompt. Capability comes from the catalog, not from a list here.
      // A DECLARED list is a real constraint and is honoured. No list means
      // the model does not take aspect_ratio at all (gpt-image-2 works in
      // `sizes`) and the provider maps the shape itself — measured: it shot
      // 2:3 and 4:3 in this run. Treating "no list" as "square only" would
      // bench the model that actually handles every shape.
      const canShoot = (m: any) => {
        if (VIDEO) return true   // video rows declare resolutions, not aspect lists
        const ars: string[] | null = m.output_config?.image?.aspect_ratios ?? null
        return ars === null || ars.includes(p.aspect)
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
            prompt: p.prompt, mode: VIDEO ? 'video' : 'image',
            modelIds: [model.id],
            modelOptions: [VIDEO
              ? { aspect_ratio: p.aspect, duration: tierOf(model)?.secs ?? CLIP_SECONDS, resolution: tierOf(model)?.res }
              : { aspect_ratio: p.aspect }],
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

  // A new clip needs a poster, and often a fast-start copy, or the wall it
  // was hung on goes slow again (scripts/showcase-video-assets.ts). Free:
  // ffmpeg runs locally and only derived files are written.
  if (VIDEO && hung > 0) {
    const { buildVideoAssets } = await import('./showcase-video-assets')
    const a = await buildVideoAssets(service(), { apply: APPLY })
    console.log(`video assets: ${a.posters} poster(s), ${a.fastStart} fast-start copy(ies), ${a.failed} failed`)
  }
  console.log('Hung and published. Take one down with:  update showcase set published = false where id = …;')
}

main().catch(e => { console.error(e); process.exit(1) })
