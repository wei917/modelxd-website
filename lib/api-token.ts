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

/** Reserve `usd` against the key's lifetime cap BEFORE generating, the way
 *  the wallet reserves credits. Atomic check-and-increment in one statement
 *  (see supabase/88_token_spend_cap.sql): concurrent callers serialize on the
 *  row, so ten parallel agent calls cannot all pass the same stale reading.
 *  Returns false when the reservation would cross the cap. */
export async function reserveTokenSpend(tok: ApiTokenContext, usd: number): Promise<boolean> {
  if (!(usd > 0)) return true
  const { data, error } = await service().rpc('reserve_token_spend', { p_token_id: tok.tokenId, p_usd: usd })
  if (!error) return data !== null && data !== undefined
  // Migrations are run by hand, so this code can be live before function 88
  // exists. Degrade to the PRE-88 check (read spent_usd, compare) rather than
  // failing open — a cap that is merely racy beats a cap that silently isn't
  // there, and this branch disappears the moment the migration lands.
  console.warn(`[api-token] reserve_token_spend unavailable (${error.message}) — falling back to the non-atomic check; run supabase/88_token_spend_cap.sql`)
  if (tok.spendCapUsd === null) return true
  return tok.spentUsd + usd <= tok.spendCapUsd
}

/** Settle the reservation: a SIGNED delta (negative when the run came in under
 *  estimate or produced nothing). Fire-and-forget — the wallet already has the
 *  authoritative record of the money. */
export function adjustTokenSpend(tokenId: string, deltaUsd: number): void {
  if (!Number.isFinite(deltaUsd) || deltaUsd === 0) return
  service().rpc('adjust_token_spend', { p_token_id: tokenId, p_usd: deltaUsd })
    .then(({ error }) => { if (error) console.warn('[api-token] spend adjust failed:', error.message) })
}
