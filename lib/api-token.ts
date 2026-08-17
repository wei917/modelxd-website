// lib/api-token.ts — API keys for the MCP / external-agent surface.
// SERVER-ONLY (service-role client). Keys are `xd_` + 32 base64url chars,
// stored as SHA-256 hex; the plaintext exists exactly once, in the mint
// response. See supabase/82_api_tokens.sql.

import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

export type ApiTokenContext = {
  tokenId: string
  userId: string
  name: string
  spendCapUsd: number | null
  spentUsd: number
}

export async function mintApiToken(userId: string, name: string, spendCapUsd: number | null): Promise<{
  plaintext: string
  id: string
  prefix: string
}> {
  const plaintext = 'xd_' + randomBytes(24).toString('base64url')
  const prefix = plaintext.slice(0, 8) + '…'
  const { data, error } = await service().from('api_tokens').insert({
    user_id: userId,
    name: name.slice(0, 60) || 'default',
    token_hash: hash(plaintext),
    token_prefix: prefix,
    spend_cap_usd: spendCapUsd,
  }).select('id').single()
  if (error || !data) throw new Error(`token mint failed: ${error?.message ?? 'no row'}`)
  return { plaintext, id: data.id, prefix }
}

/** Resolve an Authorization header to a live token, or null. Accepts
 *  'Bearer xd_…' (any case on Bearer). Revoked keys resolve to null. */
export async function resolveApiToken(authorization: string | null | undefined): Promise<ApiTokenContext | null> {
  const m = (authorization ?? '').match(/^\s*bearer\s+(xd_[A-Za-z0-9_-]{20,})\s*$/i)
  if (!m) return null
  const { data } = await service()
    .from('api_tokens')
    .select('id, user_id, name, spend_cap_usd, spent_usd, revoked_at')
    .eq('token_hash', hash(m[1]))
    .maybeSingle()
  if (!data || data.revoked_at) return null
  return {
    tokenId: data.id,
    userId: data.user_id,
    name: data.name,
    spendCapUsd: data.spend_cap_usd === null ? null : Number(data.spend_cap_usd),
    spentUsd: Number(data.spent_usd ?? 0),
  }
}

/** True when the key has hit its lifetime cap. The check is a floor at
 *  request time — the generation that crosses the line still completes and
 *  is recorded, so a key can overshoot by at most one generation's cost. */
export function tokenCapReached(tok: ApiTokenContext): boolean {
  return tok.spendCapUsd !== null && tok.spentUsd >= tok.spendCapUsd
}

/** Fire-and-forget spend accumulation after a run settles. */
export function recordTokenSpend(tokenId: string, usd: number): void {
  if (!(usd > 0)) return
  service().rpc('increment_token_spend', { p_token_id: tokenId, p_usd: usd })
    .then(({ error }) => { if (error) console.warn('[api-token] spend record failed:', error.message) })
}
