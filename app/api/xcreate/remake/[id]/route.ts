// app/api/xcreate/remake/[id]/route.ts: one 同款 read, kept as a Library item
// (lib/remake/saved.ts, Oct 17), so /xfilm/remake?remake=<id> opens it again.
//
//   GET   → { result, choices }   the viewer's own read, pictures signed for an hour
//   PATCH { choices } → { ok }    keeps the viewer's latest choices on it
//
// Only the owner of the row gets it; anyone else (or a deleted row) gets 404.

export const runtime = 'nodejs'

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadRead, saveChoices } from '@/lib/remake/saved'

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

async function viewer() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const { data: { user } } = await (await createSupabaseServer()).auth.getUser()
  return user
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await viewer()
  if (!user) return Response.json({ code: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const read = await loadRead(admin(), user.id, id)
  if (!read) return Response.json({ code: 'not_found' }, { status: 404 })
  return Response.json(read)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await viewer()
  if (!user) return Response.json({ code: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null) as { choices?: unknown } | null
  const ok = await saveChoices(admin(), user.id, id, body?.choices)
  return ok ? Response.json({ ok: true }) : Response.json({ code: 'not_found' }, { status: 404 })
}
