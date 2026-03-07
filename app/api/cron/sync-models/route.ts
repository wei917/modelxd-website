// app/api/cron/sync-models/route.ts
// Runs daily via Vercel Cron
// Fetches ALL language/image/video models from Vercel AI Gateway
// Upserts into Supabase ai_models — control visibility via enabled column in dashboard

import { createClient } from '@supabase/supabase-js'

const GATEWAY_MODELS = 'https://ai-gateway.vercel.sh/v1/models'
const LOG = '[sync-models]'

// Only sync these types — skip embedding, moderation, etc.
const SUPPORTED_MODES = new Set(['language', 'image', 'video'])

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

  // Verify Vercel Cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error(`${LOG} Unauthorized request`)
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  // Step 1: Fetch all models from gateway
  console.log(`${LOG} Fetching model catalog from gateway...`)
  let allModels: any[]
  try {
    const res = await fetch(GATEWAY_MODELS)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    allModels = data.data
    console.log(`${LOG} Fetched ${allModels.length} total models from gateway`)
  } catch (err) {
    console.error(`${LOG} Failed to fetch gateway models:`, err)
    return Response.json({ error: 'Failed to fetch gateway models' }, { status: 502 })
  }

  // Step 2: Filter to supported types only
  const toSync = allModels.filter(m => SUPPORTED_MODES.has(m.type))
  console.log(`${LOG} Filtered to ${toSync.length} language/image/video models`)

  // Step 3: Map to ai_models schema
  // Note: enabled is NOT set here — we never overwrite it on update
  // New models are inserted with enabled=false so you can review before enabling
  const rows = toSync.map(m => ({
    id:             m.id,
    name:           m.name,
    provider:       m.owned_by,
    mode:           m.type,
    input_price:    m.pricing?.input
                      ? parseFloat(m.pricing.input) * 1_000_000
                      : null,
    output_price:   m.pricing?.output
                      ? parseFloat(m.pricing.output) * 1_000_000
                      : null,
    image_pricing:  parseImagePricing(m),
    video_pricing:  parseVideoPricing(m),
    context_window: m.context_window ?? null,
    max_tokens:     m.max_tokens ?? null,
    tags:           m.tags ?? [],
    raw:            m,
    synced_at:      new Date().toISOString(),
  }))

  // Step 4: Upsert — update pricing/metadata for existing models
  // New models default to enabled=false (set in schema default)
  // Existing models keep their enabled value unchanged (not in upsert payload)
  const { error } = await supabase
    .from('ai_models')
    .upsert(rows, {
      onConflict: 'id',
      ignoreDuplicates: false,  // always update pricing on existing rows
    })

  if (error) {
    console.error(`${LOG} Supabase upsert failed:`, error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const duration = Date.now() - start
  console.log(`${LOG} Sync complete — ${rows.length} models upserted in ${duration}ms`)
  console.log(`${LOG} Tip: go to Supabase Table Editor to enable/disable models`)

  return Response.json({
    ok:       true,
    synced:   rows.length,
    duration: `${duration}ms`,
    breakdown: {
      language: rows.filter(r => r.mode === 'language').length,
      image:    rows.filter(r => r.mode === 'image').length,
      video:    rows.filter(r => r.mode === 'video').length,
    }
  })
}
