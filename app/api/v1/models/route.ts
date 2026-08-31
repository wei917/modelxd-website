// GET /api/v1/models — what this key can actually call.
//
// OpenAI-shaped (`{object:"list", data:[{id, object:"model", ...}]}`) because
// clients call this endpoint on connect and expect that shape. ModelXD facts
// ride alongside in extra fields; an OpenAI SDK ignores them, a curious
// developer reads them.
//
// The list is derived from the SAME rules /v1/chat/completions enforces —
// enabled, text-capable, not blocked for the API surface — so anything listed
// here is callable and anything callable is listed. A discovery endpoint that
// disagrees with the endpoint it describes is worse than none.

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

  const rows = (data ?? [])
    .filter(m => (m.output_modalities ?? []).includes('text'))
    .filter(m => !((m.blocked_features ?? []) as string[]).includes(API_FEATURE))
    .sort((a, b) => `${a.provider}/${a.model_name}`.localeCompare(`${b.provider}/${b.model_name}`))

  const models = rows.map(m => {
    const caps = (m.output_config as any)?.text?.capabilities ?? []
    return {
      id: `${m.provider}/${m.model_name}`,
      object: 'model' as const,
      created: m.released_at ? Math.floor(new Date(m.released_at).getTime() / 1000) : 0,
      owned_by: m.provider,
      // ── ModelXD extensions ───────────────────────────────────────────────
      display_name: m.display_name,
      pricing_usd_per_1m: { input: price(m.model_pricing, 'text_input'), output: price(m.model_pricing, 'text_output') },
      capabilities: {
        web_search: (caps as string[]).includes('web_search'),
        // Structured output is the API's headline feature and every text model
        // supports it (tiered per provider — see docs/API-V1.md).
        structured_output: true,
        vision: (m.modes ?? []).some((x: string) => x.startsWith('image_to')) || (m.modes ?? []).includes('pdf_to_text'),
      },
      tags: m.tags ?? [],
    }
  })

  // Routers are callable model ids too — a developer who only reads this
  // endpoint would otherwise never learn they exist.
  const routers = ROUTES.map(id => ({
    id,
    object: 'model' as const,
    created: 0,
    owned_by: 'modelxd',
    display_name: id === 'xd/auto' ? 'ModelXD Auto (highest XD Score)' : 'ModelXD Cheap (best value at quality bar)',
    pricing_usd_per_1m: { input: null, output: null },   // billed at whatever model it picks
    capabilities: { web_search: false, structured_output: true, vision: false },
    tags: ['router'],
    note: 'Resolves to a catalog model per request; billed at that model\'s list price. The chosen model is returned in the response.',
  }))

  return Response.json({ object: 'list', data: [...routers, ...models] })
}
