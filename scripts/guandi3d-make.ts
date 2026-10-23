// scripts/guandi3d-make.ts — the 3D pieces of X先知's 關帝廟 prototype: the
// hall as a World Labs Marble world, the statue and the ritual props as Tripo
// P2 meshes. House-paid, made once, served to everyone (owner, Oct 22: "you
// can spend up to $30 for this. please make good 3d models").
//
//   npx tsx --env-file=.env.local scripts/guandi3d-make.ts <outDir> tripo <image> <name> [texture_quality] [face_limit]
//   npx tsx --env-file=.env.local scripts/guandi3d-make.ts <outDir> world <image> [marble-1.1|marble-1.1-plus] [hall|hill|plaza|hilltop|hatview]
//   npx tsx --env-file=.env.local scripts/guandi3d-make.ts <outDir> tripo-views <name> front=<img> back=<img> [left=<img>] [right=<img>]
//   npx tsx --env-file=.env.local scripts/guandi3d-make.ts <outDir> poll-world <operation_id>
//
// The picture goes up to a private bucket (temple3d/, outside the sweep's
// originals/) and reaches the provider as a one-hour signed link. Each run
// prints the provider's own reported cost (Tripo credits_consumed, 1 credit =
// 1¢; World Labs cost.total_credits, $1 = 1,250 credits) and saves the raw
// result next to the files it downloads.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { creditsToCents } from '../lib/xworld-models'

const [out, mode, ...rest] = process.argv.slice(2)
// lib/tripo.ts and lib/worldlabs.ts hold the same bases; not imported, they pull server-only modules.
const TRIPO_BASE = 'https://openapi.tripo3d.ai/v3'
const WL_BASE = 'https://api.worldlabs.ai/marble/v1'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function signedUrl(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase()
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  const key = `temple3d/${Date.now()}-${path.basename(file)}`
  // Storage uploads failed now and then with "fetch failed" (Oct 22): retry.
  let up: any = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { up = await sb.storage.from('xcreate-user-images').upload(key, fs.readFileSync(file), { contentType: type, upsert: true }) }
    catch (e: any) { up = { error: { message: e?.message ?? String(e) } } }
    if (!up.error) break
    console.log(`  upload attempt ${attempt} failed: ${up.error.message}`)
    await sleep(3000 * attempt)
  }
  if (up.error) throw new Error(`upload: ${up.error.message}`)
  const { data, error } = await sb.storage.from('xcreate-user-images').createSignedUrl(key, 3600)
  if (error || !data) throw new Error(`sign: ${error?.message}`)
  return data.signedUrl
}

async function download(url: string, file: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 80)}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log(`  saved ${path.basename(file)} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`)
}

async function tripo(image: string, name: string, quality = 'detailed', faces?: number) {
  const key = process.env.TRIPO_API_KEY
  if (!key) throw new Error('TRIPO_API_KEY missing')
  const url = await signedUrl(image)
  const body: Record<string, unknown> = {
    model: 'P2-20260801', input: url, texture: true, pbr: true, texture_quality: quality,
    orientation: 'align_image', ...(faces ? { face_limit: faces } : {}),
  }
  const post = async (b: unknown) => {
    const r = await fetch(`${TRIPO_BASE}/generation/image-to-model`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  let res = await post(body)
  if (res.status >= 300 || res.json?.code) {
    // The Aug 30 proxy's shape: a file object instead of an input string.
    console.log(`  input string refused (${res.status} ${JSON.stringify(res.json).slice(0, 200)}); trying file object`)
    const { input, ...restBody } = body
    res = await post({ ...restBody, file: { type: path.extname(image).slice(1).replace('jpg', 'jpeg'), url: input } })
  }
  const taskId = res.json?.data?.task_id
  if (!taskId) throw new Error(`tripo create ${res.status}: ${JSON.stringify(res.json).slice(0, 400)}`)
  console.log(`${name}: task ${taskId}`)
  await pollTripo(taskId, name)
}

async function pollTripo(taskId: string, name: string) {
  const key = process.env.TRIPO_API_KEY
  for (;;) {
    await sleep(8000)
    const r = await fetch(`${TRIPO_BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } })
    const j: any = await r.json().catch(() => ({}))
    const d = j?.data ?? {}
    if (['success', 'failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(d.status)) {
      fs.writeFileSync(path.join(out, `${name}.tripo.json`), JSON.stringify(j, null, 1))
      const credits = Number(d.credits_consumed ?? d.consumed_credit ?? NaN)
      console.log(`${name}: ${d.status}, ${credits} credits = $${(credits / 100).toFixed(2)}; output keys ${Object.keys(d.output ?? {}).join(',')}`)
      if (d.status !== 'success') return
      const o = d.output ?? {}
      const model = o.pbr_model_url ?? o.pbr_model ?? o.model_url ?? o.model ?? o.base_model
      if (model) await download(model, path.join(out, `${name}.glb`))
      const img = o.rendered_image_url ?? o.rendered_image
      if (img) await download(img, path.join(out, `${name}.render.webp`))
      return
    }
    process.stdout.write(`  ${d.status ?? r.status} ${d.progress ?? ''}%\r`)
  }
}

// Several views of one design → one model (Tripo's multiview-to-model; front
// and at least one more view; P2 takes view-keyed inputs).
async function tripoViews(views: Record<string, string>, name: string, quality = 'detailed', faces?: number) {
  const key = process.env.TRIPO_API_KEY
  if (!key) throw new Error('TRIPO_API_KEY missing')
  const inputs: Record<string, string>[] = []
  for (const [view, file] of Object.entries(views)) inputs.push({ [view]: await signedUrl(file) })
  const r = await fetch(`${TRIPO_BASE}/generation/multiview-to-model`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'P2-20260801', inputs, texture: true, pbr: true, texture_quality: quality, ...(faces ? { face_limit: faces } : {}) }),
  })
  const j: any = await r.json().catch(() => ({}))
  const taskId = j?.data?.task_id
  if (!taskId) throw new Error(`tripo multiview create ${r.status}: ${JSON.stringify(j).slice(0, 400)}`)
  console.log(`${name}: task ${taskId} (views ${Object.keys(views).join(', ')})`)
  await pollTripo(taskId, name)
}

async function wl(p: string, init?: RequestInit) {
  const res = await fetch(`${WL_BASE}${p}`, {
    ...init, headers: { 'WLT-Api-Key': process.env.WORLDLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
  })
  return { status: res.status, json: await res.json().catch(() => ({})) as any }
}

async function pollWorld(opId: string) {
  for (;;) {
    const { status, json: op } = await wl(`/operations/${encodeURIComponent(opId)}`)
    if (status === 200 && op?.done) {
      fs.writeFileSync(path.join(out, `world-${opId}.json`), JSON.stringify(op, null, 1))
      const credits = Number(op?.cost?.total_credits ?? NaN)
      console.log(`world ${opId}: ${op.error ? 'FAILED ' + JSON.stringify(op.error) : 'done'}, ${credits} credits = $${(creditsToCents(credits) / 100).toFixed(2)}`)
      const a = op.response?.assets
      if (a) {
        console.log(JSON.stringify({ spz: a.splats?.spz_urls, collider: a.mesh?.collider_mesh_url, pano: a.imagery?.pano_url, thumb: a.thumbnail_url }, null, 1))
        const spz = a.splats?.spz_urls ?? {}
        for (const k of ['100k', '500k'] as const) if (spz[k]) await download(spz[k], path.join(out, `world-${k}.spz`))
        if (a.mesh?.collider_mesh_url) await download(a.mesh.collider_mesh_url, path.join(out, 'world-collider.glb'))
        if (a.imagery?.pano_url) await download(a.imagery.pano_url, path.join(out, 'world-pano' + path.extname(new URL(a.imagery.pano_url).pathname)))
      }
      return
    }
    const pct = op?.metadata?.progress?.percentage ?? op?.metadata?.progress?.percent
    process.stdout.write(`  ${status} ${pct ?? ''} ${op?.metadata?.progress?.description ?? ''}      \r`)
    await sleep(15000)
  }
}

const WORLD_TEXT: Record<string, string> = {
  hall: 'The main hall of a traditional Taiwanese Guan Di temple, seen from inside: carved stone dragon pillars, a gilded shrine niche with an empty throne and red drapes, a carved red altar table with an incense burner and offerings, red lanterns, painted beams, side altars and lattice windows, a polished grey stone floor with red kneeling cushions. The entrance doors are behind the viewer.',
  hilltop: 'A very long, empty granite-paved plaza on the top of a green mountain in Taiwan, with nothing standing on it; low clipped hedges and big old camphor, banyan and Taiwan red pine trees along both sides; beyond the far end and all around, the hilltop drops to deep green valleys and layers of forested mountains in soft blue mist; behind the viewer the plaza continues to more trees and the top of a stone stair coming up the mountain. Bright blue sky, soft white clouds, warm afternoon sun.',
  // No "statue" here: told the view is from a statue's top, Marble put two giant bronze hands behind the viewer (Oct 23).
  hatview: 'An aerial view from a small high lookout 36 metres above a mountaintop, with nothing near the viewer and nothing behind them but sky and land: far below, an orange tiled pavilion roof and a long granite plaza between hedges and big old trees; all the way round, in every direction, deep green valleys and layers of forested mountains in soft blue mist under a bright sky with soft clouds. No statues, no sculptures, no hands, no rocks, no people.',
  plaza: 'A wide granite plaza on a green hilltop in daylight: at its far end a broad stone staircase rises to a large empty stone terrace edged with carved balustrades, with nothing standing on it; a bronze incense burner and a red offering table in the plaza, two stone guardian lions, strings of red lanterns, tall trees, green hills and blue sky all around, the plaza continuing behind the viewer to the top of the steps that come up the hill.',
  hill: 'The wide stone front plaza of a traditional Taiwanese Guan Di temple on a green hilltop, in daylight: the red-and-gold temple with a giant seated statue of Guan Yu on its roof, a bronze incense burner and a red offering table in the plaza, stone lions, balustrades, strings of red lanterns, trees and green hills all around, the plaza continuing behind the viewer to the top of the steps that come up the hill.',
}

async function world(image: string, model = 'marble-1.1-plus', scene = 'hall') {
  if (!process.env.WORLDLABS_API_KEY) throw new Error('WORLDLABS_API_KEY missing')
  const url = await signedUrl(image)
  const { status, json } = await wl('/worlds:generate', {
    method: 'POST',
    body: JSON.stringify({
      display_name: `X先知 關帝廟 prototype (${scene})`,
      model,
      world_prompt: {
        type: 'image', image_prompt: { source: 'uri', uri: url }, is_pano: false,
        text_prompt: WORLD_TEXT[scene],
      },
      tags: ['modelxd', 'xoracle-temple3d'],
    }),
  })
  const opId = json?.operation_id
  if (status >= 300 || !opId) throw new Error(`world create ${status}: ${JSON.stringify(json).slice(0, 400)}`)
  console.log(`world: operation ${opId} (${model})`)
  fs.writeFileSync(path.join(out, `world-op.txt`), opId)
  await pollWorld(opId)
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  if (mode === 'tripo') await tripo(rest[0], rest[1], rest[2], rest[3] ? Number(rest[3]) : undefined)
  else if (mode === 'tripo-views') await tripoViews(Object.fromEntries(rest.slice(1).filter(a => a.includes('=')).map(a => a.split('=') as [string, string])), rest[0], 'detailed', 50000)
  else if (mode === 'world') await world(rest[0], rest[1], rest[2])
  else if (mode === 'poll-world') await pollWorld(rest[0])
  else throw new Error(`unknown mode ${mode}`)
}

main().catch(e => { console.error(e); process.exit(1) })
