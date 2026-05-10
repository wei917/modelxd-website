// app/api/admin/models/[id]/route.ts
// Admin-only: hard-delete a model row by id.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { assertAdmin } from '@/lib/admin'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function DELETE(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await assertAdmin()
  if (guard) return guard

  const { id } = await ctx.params
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const sb = serviceClient()
  const { error } = await sb.from('ai_models').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
