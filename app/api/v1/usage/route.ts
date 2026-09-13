// GET /api/v1/usage — what your API keys spent, from code or the XDev page.
//
//   ?from=2026-09-01&to=2026-09-14   window (UTC dates or ISO times). Default:
//                                     the last 30 days. `to` is exclusive; a
//                                     bare date means the END of that day.
//   ?group_by=day|model|key|surface|none   default day. `none` = the request
//                                     log, newest first, paginated.
//   ?limit=50&cursor=…                 request-log paging (limit 1–500).
//   ?key=<key id>|self                 one key. `self` = the key making this
//                                     request (API-key callers only).
//   ?surface=chat|image|video|3d
//
// Same two doors as the rest of /api/v1: an API key (sees ALL of its owner's
// keys, like the XDev page — a key is a credential for the account, not a
// sandbox) or a signed-in session. Costs are list price in USD, the same
// numbers each response reported in usage.cost_usd.

export const runtime = 'nodejs'

import { resolveApiToken } from '@/lib/api-token'
import { createSupabaseServer } from '@/lib/supabase-server'
import { queryUsage, type UsageQuery, type UsageSurface } from '@/lib/api-usage'

const fail = (status: number, message: string, code: string) =>
  Response.json({ error: { message, type: 'invalid_request_error', code } }, { status })

function parseEdge(v: string | null, end: boolean): Date | null {
  if (!v) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v)
  const d = new Date(dateOnly ? `${v}T00:00:00Z` : v)
  if (Number.isNaN(d.getTime())) return null
  return dateOnly && end ? new Date(d.getTime() + 86_400_000) : d
}

export async function GET(req: Request) {
  const tok = await resolveApiToken(req.headers.get('authorization'))
  let userId = tok?.userId ?? null
  if (!userId) {
    const sb = await createSupabaseServer()
    const { data: { user } } = await sb.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return fail(401, 'Pass a ModelXD API key: Authorization: Bearer xd_… (or sign in).', 'invalid_api_key')

  const u = new URL(req.url)
  const to = parseEdge(u.searchParams.get('to'), true) ?? new Date()
  const from = parseEdge(u.searchParams.get('from'), false) ?? new Date(to.getTime() - 30 * 86_400_000)
  if (from >= to) return fail(400, '`from` must be before `to`.', 'invalid_range')
  if (to.getTime() - from.getTime() > 366 * 86_400_000) return fail(400, 'The window can be at most 366 days.', 'range_too_long')

  const groupBy = (u.searchParams.get('group_by') ?? 'day') as UsageQuery['groupBy']
  if (!['day', 'model', 'key', 'surface', 'none'].includes(groupBy)) return fail(400, '`group_by` must be day, model, key, surface or none.', 'invalid_group_by')
  const surface = u.searchParams.get('surface') as UsageSurface | null
  if (surface && !['chat', 'image', 'video', '3d'].includes(surface)) return fail(400, '`surface` must be chat, image, video or 3d.', 'invalid_surface')
  const limitRaw = Number(u.searchParams.get('limit') ?? 50)
  const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50))

  let tokenId = u.searchParams.get('key')
  if (tokenId === 'self') {
    if (!tok) return fail(400, '`key=self` needs an API key on the request.', 'key_self_needs_key')
    tokenId = tok.tokenId
  } else if (tokenId && !/^[0-9a-f-]{36}$/i.test(tokenId)) {
    return fail(400, '`key` must be a key id or `self`.', 'invalid_key')
  }

  try {
    const out = await queryUsage({ userId, from, to, groupBy, tokenId, surface, limit, cursor: u.searchParams.get('cursor') })
    return Response.json({
      object: 'usage', from: from.toISOString(), to: to.toISOString(), group_by: groupBy,
      currency: 'usd', ...out,
    })
  } catch (e) {
    const msg = (e as Error).message
    if (/api_usage/.test(msg)) return Response.json({ error: { message: 'Usage history is not set up yet.', type: 'server_error', code: 'usage_unavailable' } }, { status: 503 })
    console.error('[v1/usage]', msg)
    return Response.json({ error: { message: 'Internal error.', type: 'server_error', code: 'internal_error' } }, { status: 500 })
  }
}
