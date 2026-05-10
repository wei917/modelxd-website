// app/api/profile/delete/route.ts
// Soft-deletes a duel or xcreate by setting deleted_at.
// Only the owner can delete their own items.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, id } = await req.json()
  if (!type || !id) return Response.json({ error: 'Missing type or id' }, { status: 400 })
  if (type !== 'duel' && type !== 'xcreate') return Response.json({ error: 'Invalid type' }, { status: 400 })

  const table = type === 'duel' ? 'duels' : 'xcreates'
  const sb = serviceClient()

  // Only soft-delete if the row belongs to this user.
  const { data, error } = await sb
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .single()

  if (error || !data) {
    return Response.json({ error: 'Not found or not yours' }, { status: 404 })
  }

  return Response.json({ ok: true, id: data.id })
}
