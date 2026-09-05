// GET /api/v1/models — what this key can actually call.
//
// OpenAI-shaped (`{object:"list", data:[{id, object:"model", ...}]}`) because
// clients call this endpoint on connect and expect that shape. ModelXD facts
// ride alongside in extra fields; an OpenAI SDK ignores them, a curious
// developer reads them.
//
// The list covers EVERY modality the API can generate — text (chat), image and
// video (the /v1/*/generations endpoints) — because a developer must be able
// to discover `openai/gpt-image-2` here. Shipping text-only while documenting
// image endpoints broke this file's own rule, and a customer caught it on
// Aug 30: "an endpoint that disagrees with the endpoint it describes."
//
// Filter with ?type=text|image|video. Each row carries `modalities` so a
// client can filter locally too.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { resolveApiToken } from '@/lib/api-token'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ROUTES, API_FEATURE } from '@/lib/inference'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

/** Same two doors as the rest of /api/v1: an API key, or a signed-in session. */
async function caller(req: Request): Promise<string | null> {
  const tok = await resolveApiToken(req.headers.get('authorization'))
  if (tok) return tok.userId
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user?.id ?? null
}

const price = (p: any, key: 'text_input' | 'text_output'): number | null => {
  const v = p?.tokens?.[key]
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && typeof v.default === 'number') return v.default   // {default, by_level}
  return null
}

export async function GET(req: Request) {
  if (!(await caller(req))) {
    return Response.json({ error: { message: 'Unauthorized', type: 'invalid_request_error' } }, { status: 401 })
  }

  const { data, error } = await service()
    .from('ai_models')
    .select('provider, model_name, display_name, output_modalities, modes, model_pricing, output_config, blocked_features, released_at, tags')
    .eq('enabled', true)
  if (error) return Response.json({ error: { message: error.message, type: 'server_error' } }, { status: 503 })

  const url = new URL(req.url)
  const want = url.searchParams.get('type')   // text | image | video
  const GENERATED = ['text', 'image', 'video']

  const rows = (data ?? [])
    .filter(m => (m.output_modalities ?? []).some((x: string) => GENERATED.includes(x)))
    .filter(m => !((m.blocked_features ?? []) as string[]).includes(API_FEATURE))
    .filter(m => !want || (m.output_modalities ?? []).includes(want))
    .sort((a, b) => `${a.provider}/${a.model_name}`.localeCompare(`${b.provider}/${b.model_name}`))

  const models = rows.map(m => {
    const caps = (m.output_config as any)?.text?.capabilities ?? []
    const mods = (m.output_modalities ?? []) as string[]
    const isText = mods.includes('text')
    return {
      id: `${m.provider}/${m.model_name}`,
      object: 'model' as const,
      created: m.released_at ? Math.floor(new Date(m.released_at).getTime() / 1000) : 0,
      owned_by: m.provider,
      // ── ModelXD extensions ───────────────────────────────────────────────
      display_name: m.display_name,
      // What this model GENERATES, and therefore which endpoint takes it:
      //   text  → POST /v1/chat/completions
      //   image → POST /v1/images/generations
      //   video → POST /v1/videos/generations
      modalities: mods,
      endpoint: isText ? '/api/v1/chat/completions'
        : mods.includes('image') ? '/api/v1/images/generations'
        : '/api/v1/videos/generations',
      // Per-1M-token rates are a TEXT concept; image and video are priced per
      // output (see model_pricing on the catalog / XBoard price labels), so
      // nulls here are honest rather than missing.
      pricing_usd_per_1m: isText
        ? { input: price(m.model_pricing, 'text_input'), output: price(m.model_pricing, 'text_output') }
        : { input: null, output: null },
      capabilities: {
        web_search: (caps as string[]).includes('web_search'),
        // Structured output is the API's headline feature and every text model
        // supports it (tiered per provider — see docs/API-V1.md).
        structured_output: isText,
        vision: (m.modes ?? []).some((x: string) => x.startsWith('image_to')) || (m.modes ?? []).includes('pdf_to_text'),
      },
      modes: m.modes ?? [],
      tags: m.tags ?? [],
    }
  })

  // Routers are callable model ids too — a developer who only reads this
  // endpoint would otherwise never learn they exist. A table, not a ternary:
  // the ternary here predated xd/fast and xd/max and would have labelled both
  // of them "Cheap".
  const ROUTE_LABELS: Record<string, string> = {
    'xd/auto':   'ModelXD Auto (highest XD Score)',
    'xd/fast':   'ModelXD Fast (lowest measured time to first token)',
    'xd/budget': 'ModelXD Budget (cheapest above the quality bar)',
    'xd/max':    'ModelXD Max (highest blind-vote quality, price ignored)',
  }
  const routers = (want && want !== 'text' ? [] : ROUTES).map(id => ({
    id,
    object: 'model' as const,
    created: 0,
    owned_by: 'modelxd',
    display_name: ROUTE_LABELS[id],
    modalities: ['text'],
    endpoint: '/api/v1/chat/completions',
    pricing_usd_per_1m: { input: null, output: null },   // billed at whatever model it picks
    capabilities: { web_search: false, structured_output: true, vision: false },
    modes: [],
    tags: ['router'],
    note: 'Resolves to a catalog model per request; billed at that model\'s list price. The chosen model is returned in the response.',
  }))

  return Response.json({ object: 'list', data: [...routers, ...models] })
}
