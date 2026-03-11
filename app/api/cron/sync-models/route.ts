// app/api/cron/sync-models/route.ts
// Runs daily via Vercel Cron
// Each model gets one row with modes[] array — e.g. ['text','image']

import { createClient } from '@supabase/supabase-js'

const GATEWAY_MODELS = 'https://ai-gateway.vercel.sh/v1/models'
const LOG = '[sync-models]'

// Gateway type → our mode name
const TYPE_MAP: Record<string, string> = {
  language: 'text',
  image:    'image',
  video:    'video',
}
const SUPPORTED_TYPES = new Set(Object.keys(TYPE_MAP))

function parseReleasedAt(m: any): string | null {
  if (!m.released || m.released === 0) return null
  try {
    return new Date(m.released * 1000).toISOString().split('T')[0]
  } catch { return null }
}

function parseImagePricing(m: any): object | null {
  const raw = m.pricing?.image_gen_pricing
  if (!raw || !Array.isArray(raw)) return null
  return Object.fromEntries(raw.map((r: any) => [r.resolution, parseFloat(r.cost)]))
}

function parseVideoPricing(m: any): object | null {
  const raw = m.pricing?.video_duration_pricing
  if (!raw || !Array.isArray(raw)) return null
  return Object.fromEntries(raw.map((r: any) => [r.resolution, parseFloat(r.cost_per_second)]))
}

export async function GET(req: Request) {
  const start = Date.now()
  console.log(`${LOG} Starting sync...`)

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error(`${LOG} Unauthorized`)
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  // Fetch all models from gateway
  console.log(`${LOG} Fetching model catalog...`)
  let allModels: any[]
  try {
    const res = await fetch(GATEWAY_MODELS)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    allModels = data.data
    console.log(`${LOG} Fetched ${allModels.length} total models`)
  } catch (err) {
    console.error(`${LOG} Failed to fetch:`, err)
    return Response.json({ error: 'Failed to fetch gateway models' }, { status: 502 })
  }

  // Group by model id — one model may appear multiple times with different types
  const modelMap = new Map<string, any>()
  for (const m of allModels) {
    if (!SUPPORTED_TYPES.has(m.type)) continue
    const mode = TYPE_MAP[m.type]

    if (modelMap.has(m.id)) {
      // Already seen this model — just add the new mode
      modelMap.get(m.id).modes.push(mode)
    } else {
      modelMap.set(m.id, {
        id:             m.id,
        name:           m.name,
        provider:       m.owned_by,
        modes:          [mode],
        input_price:    m.pricing?.input  ? parseFloat(m.pricing.input)  * 1_000_000 : null,
        output_price:   m.pricing?.output ? parseFloat(m.pricing.output) * 1_000_000
                      : m.pricing?.image  ? parseFloat(m.pricing.image)               // image models: flat per-image price, no * 1M
                      : null,
        image_pricing:  parseImagePricing(m),
        video_pricing:  parseVideoPricing(m),
        context_window: m.context_window ?? null,
        max_tokens:     m.max_tokens ?? null,
        tags:           m.tags ?? [],
        released_at:    parseReleasedAt(m),
        raw:            m,
        synced_at:      new Date().toISOString(),
      })
    }
  }

  const rows = Array.from(modelMap.values())
  console.log(`${LOG} ${rows.length} unique models (${allModels.filter(m => SUPPORTED_TYPES.has(m.type)).length} entries merged)`)

  // For new models: insert with enabled=true. For existing: update everything except enabled.
  const { data: existing } = await supabase.from('ai_models').select('id')
  const existingIds = new Set((existing ?? []).map((r: any) => r.id))
  const newRows     = rows.filter(r => !existingIds.has(r.id)).map(r => ({ ...r, enabled: true }))
  const updateRows  = rows.filter(r =>  existingIds.has(r.id))

  const inserts = newRows.length > 0
    ? supabase.from('ai_models').insert(newRows)
    : Promise.resolve({ error: null })
  const updates = updateRows.length > 0
    ? supabase.from('ai_models').upsert(updateRows, { onConflict: 'id', ignoreDuplicates: false })
    : Promise.resolve({ error: null })

  const [{ error: insertErr }, { error: updateErr }] = await Promise.all([inserts, updates])
  const error = insertErr ?? updateErr

  if (error) {
    console.error(`${LOG} Upsert failed:`, error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const duration = Date.now() - start
  console.log(`${LOG} Sync complete — ${rows.length} models upserted in ${duration}ms`)

  return Response.json({
    ok:       true,
    synced:   rows.length,
    duration: `${duration}ms`,
    breakdown: {
      text:       rows.filter(r => r.modes.includes('text')).length,
      image:      rows.filter(r => r.modes.includes('image')).length,
      video:      rows.filter(r => r.modes.includes('video')).length,
      multimodal: rows.filter(r => r.modes.length > 1).length,
    }
  })
}
