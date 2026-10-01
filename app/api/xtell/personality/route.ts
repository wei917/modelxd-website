// app/api/xtell/personality/route.ts — the visitor's own personality type
// (supabase/119, lib/xtell-personality.ts). Signed-in only, and only the
// caller's own row: the session decides the user id, the body never does.
//
//   GET     the saved type, or null
//   PUT     save it ({ type: 'INFJ' | 'INFJ-A' … }); a type typed in is
//           source 'self'
//   DELETE  remove it
//
// Before migration 119 runs, every method answers 503
// personality_unavailable and the account page hides the section.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xtellAdmin, dailyMissing } from '@/lib/xtell-admin'
import { asPersonalityType } from '@/lib/xtell-personality'

const unavailable = () => Response.json({ error: 'personality_unavailable' }, { status: 503 })
const failed = () => Response.json({ error: 'personality_failed' }, { status: 500 })

async function signedIn() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

type Row = { type: string; source: string; updated_at: string }
const shape = (r: Row | null) => r ? { type: r.type, source: r.source, updatedAt: r.updated_at } : null

export async function GET() {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await xtellAdmin().from('xtell_personality').select('type, source, updated_at').eq('user_id', user.id).maybeSingle()
  if (error) return dailyMissing(error) ? unavailable() : failed()
  return Response.json({ personality: shape(data as Row | null) })
}

export async function PUT(req: Request) {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const type = asPersonalityType(body?.type)
  if (!type) return Response.json({ error: 'bad type', code: 'personality_bad_type' }, { status: 400 })
  const { data, error } = await xtellAdmin().from('xtell_personality')
    .upsert({ user_id: user.id, type, source: 'self', scores: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('type, source, updated_at').single()
  if (error) return dailyMissing(error) ? unavailable() : failed()
  return Response.json({ personality: shape(data as Row) })
}

export async function DELETE() {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { error } = await xtellAdmin().from('xtell_personality').delete().eq('user_id', user.id)
  if (error) return dailyMissing(error) ? unavailable() : failed()
  return Response.json({ deleted: true })
}
