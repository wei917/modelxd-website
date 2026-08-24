// app/api/xdev/tokens/route.ts — mint / revoke / recap API keys (XDev page).
// Session-auth only: a key can never mint another key. Listing happens in
// the client via owner-read RLS on api_tokens; this route owns the writes.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { mintApiToken } from '@/lib/api-token'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
}

async function sessionUser(): Promise<{ id: string } | null> {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user ?? null
}

export async function POST(req: Request) {
  const user = await sessionUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'default'
  const cap = body.spend_cap_usd === null || body.spend_cap_usd === undefined || body.spend_cap_usd === ''
    ? null
    : Math.max(0, Number(body.spend_cap_usd))
  if (cap !== null && !Number.isFinite(cap)) {
    return Response.json({ error: 'invalid_cap' }, { status: 400 })
  }

  // A modest per-user key budget; MCP needs one, maybe two.
  const { count } = await service().from('api_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).is('revoked_at', null)
  if ((count ?? 0) >= 10) {
    return Response.json({ error: 'too_many_keys', message: 'Revoke an old key first (max 10 live keys).' }, { status: 400 })
  }

  const minted = await mintApiToken(user.id, name, cap)
  // plaintext appears in THIS response and nowhere else, ever.
  return Response.json({ id: minted.id, key: minted.plaintext, prefix: minted.prefix })
}

export async function PATCH(req: Request) {
  const user = await sessionUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })
  const cap = body.spend_cap_usd === null || body.spend_cap_usd === '' ? null : Math.max(0, Number(body.spend_cap_usd))
  if (cap !== null && !Number.isFinite(cap)) return Response.json({ error: 'invalid_cap' }, { status: 400 })

  const { error } = await service().from('api_tokens')
    .update({ spend_cap_usd: cap })
    .eq('id', id).eq('user_id', user.id)   // ownership enforced in the WHERE
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const user = await sessionUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })

  // Revoke, not delete — spent_usd stays as the audit trail.
  const { error } = await service().from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
