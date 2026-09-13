// lib/api-usage.ts — per-call usage for API keys (supabase/101_api_usage.sql).
// SERVER-ONLY. Writes are fire-and-forget: the wallet already holds the
// authoritative record of the money, and a usage row that fails to land must
// never fail the developer's response.

import { createClient } from '@supabase/supabase-js'

const LOG = '[api-usage]'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
}

export type UsageSurface = 'chat' | 'image' | 'video' | '3d'

export type UsageRow = {
  userId: string
  tokenId: string | null
  surface: UsageSurface
  provider?: string | null
  modelName?: string | null
  status?: 'success' | 'failed'
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
  costUsd: number
  refId?: string | null
  errorCode?: string | null
}

export function recordApiUsage(r: UsageRow): void {
  const row = {
    user_id: r.userId, token_id: r.tokenId, surface: r.surface,
    provider: r.provider ?? null, model_name: r.modelName ?? null, status: r.status ?? 'success',
    input_tokens: r.inputTokens ?? null, output_tokens: r.outputTokens ?? null, cached_tokens: r.cachedTokens ?? null,
    cost_usd: Number.isFinite(r.costUsd) ? Math.max(0, Number(r.costUsd.toFixed(6))) : 0,
    ref_id: r.refId ?? null, error_code: r.errorCode ?? null,
  }
  const q = row.ref_id
    ? service().from('api_usage').upsert(row, { onConflict: 'surface,ref_id' })
    : service().from('api_usage').insert(row)
  Promise.resolve(q).then(({ error }) => {
    // Before migration 101 runs the table does not exist; say so once per
    // message instead of throwing into a response that already succeeded.
    if (error) console.warn(`${LOG} write failed (${r.surface} ${r.modelName ?? ''}): ${error.message}`)
  })
}

/** Settle a row that was written with an estimate (Tripo reconciles later). */
export function settleApiUsage(surface: UsageSurface, refId: string, costUsd: number, status: 'success' | 'failed'): void {
  Promise.resolve(
    service().from('api_usage').update({ cost_usd: Math.max(0, Number(costUsd.toFixed(6))), status }).eq('surface', surface).eq('ref_id', refId),
  ).then(({ error }) => { if (error) console.warn(`${LOG} settle failed (${surface} ${refId}): ${error.message}`) })
}

// ── Reading ──────────────────────────────────────────────────────────────

export type UsageQuery = {
  userId: string
  from: Date
  to: Date
  groupBy: 'day' | 'model' | 'key' | 'surface' | 'none'
  tokenId?: string | null
  surface?: UsageSurface | null
  limit: number
  cursor?: string | null
}

type Raw = {
  id: string; token_id: string | null; surface: UsageSurface; provider: string | null; model_name: string | null
  status: string; input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null
  cost_usd: number | string; ref_id: string | null; error_code: string | null; created_at: string
}

const COLS = 'id, token_id, surface, provider, model_name, status, input_tokens, output_tokens, cached_tokens, cost_usd, ref_id, error_code, created_at'
const AGG_MAX_ROWS = 100_000

/** Cursor = "<created_at>|<id>" of the last row returned: stable under new
 *  rows arriving, unlike an offset (a busy key would skip or repeat rows). */
const encodeCursor = (r: Raw) => Buffer.from(`${r.created_at}|${r.id}`).toString('base64url')
function decodeCursor(c: string): { at: string; id: string } | null {
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString().split('|')
    return at && id ? { at, id } : null
  } catch { return null }
}

function base(q: UsageQuery) {
  let b = service().from('api_usage').select(COLS)
    .eq('user_id', q.userId).gte('created_at', q.from.toISOString()).lt('created_at', q.to.toISOString())
  if (q.tokenId) b = b.eq('token_id', q.tokenId)
  if (q.surface) b = b.eq('surface', q.surface)
  return b
}

const money = (n: number) => Number(n.toFixed(6))

export async function queryUsage(q: UsageQuery) {
  // Token names, so a row says "game-server" rather than a uuid.
  const { data: tokens } = await service().from('api_tokens').select('id, name, token_prefix, revoked_at').eq('user_id', q.userId)
  const keyName = new Map((tokens ?? []).map(t => [t.id, t]))
  const keyOf = (id: string | null) => {
    const t = id ? keyName.get(id) : null
    return t ? { key_id: t.id, key_name: t.name, key_prefix: t.token_prefix, revoked: !!t.revoked_at } : { key_id: id, key_name: null, key_prefix: null, revoked: false }
  }
  const shape = (r: Raw) => ({
    id: r.id, created_at: r.created_at, surface: r.surface,
    model: r.provider && r.model_name ? `${r.provider}/${r.model_name}` : r.model_name,
    status: r.status, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cached_tokens: r.cached_tokens,
    cost_usd: money(Number(r.cost_usd)), ref_id: r.ref_id, error_code: r.error_code, ...keyOf(r.token_id),
  })

  // Totals always cover the whole window, whatever the page.
  const rows: Raw[] = []
  for (let offset = 0; offset < AGG_MAX_ROWS; offset += 1000) {
    const { data, error } = await base(q).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Raw[]))
    if (!data || data.length < 1000) break
  }
  const totals = rows.reduce((t, r) => ({
    requests: t.requests + 1,
    failed: t.failed + (r.status === 'failed' ? 1 : 0),
    input_tokens: t.input_tokens + (r.input_tokens ?? 0),
    output_tokens: t.output_tokens + (r.output_tokens ?? 0),
    cost_usd: t.cost_usd + Number(r.cost_usd),
  }), { requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 })
  totals.cost_usd = money(totals.cost_usd)

  if (q.groupBy === 'none') {
    let page = base(q).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(q.limit + 1)
    const c = q.cursor ? decodeCursor(q.cursor) : null
    if (c) page = page.or(`created_at.lt.${c.at},and(created_at.eq.${c.at},id.lt.${c.id})`)
    const { data, error } = await page
    if (error) throw new Error(error.message)
    const got = (data ?? []) as Raw[]
    const more = got.length > q.limit
    const pageRows = got.slice(0, q.limit)
    return { totals, data: pageRows.map(shape), has_more: more, next_cursor: more ? encodeCursor(pageRows[pageRows.length - 1]) : null, truncated: rows.length >= AGG_MAX_ROWS }
  }

  const groups = new Map<string, any>()
  for (const r of rows) {
    const k = q.groupBy === 'day' ? r.created_at.slice(0, 10)
      : q.groupBy === 'model' ? `${r.provider ?? ''}/${r.model_name ?? ''}`
      : q.groupBy === 'key' ? (r.token_id ?? 'none')
      : r.surface
    const g = groups.get(k) ?? {
      ...(q.groupBy === 'day' ? { date: k } : q.groupBy === 'model' ? { model: r.provider && r.model_name ? `${r.provider}/${r.model_name}` : r.model_name, surface: r.surface }
        : q.groupBy === 'key' ? keyOf(r.token_id) : { surface: r.surface }),
      requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0,
    }
    g.requests++; if (r.status === 'failed') g.failed++
    g.input_tokens += r.input_tokens ?? 0; g.output_tokens += r.output_tokens ?? 0; g.cost_usd += Number(r.cost_usd)
    groups.set(k, g)
  }
  let data = [...groups.values()].map(g => ({ ...g, cost_usd: money(g.cost_usd) }))
  if (q.groupBy === 'day') {
    // Every day in the window, zero-filled, so a chart has no gaps to lie about.
    const byDay = new Map(data.map(d => [d.date, d]))
    data = []
    for (let d = new Date(Date.UTC(q.from.getUTCFullYear(), q.from.getUTCMonth(), q.from.getUTCDate())); d < q.to; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10)
      data.push(byDay.get(k) ?? { date: k, requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 })
    }
  } else {
    data.sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests)
  }
  return { totals, data, has_more: false, next_cursor: null, truncated: rows.length >= AGG_MAX_ROWS }
}
