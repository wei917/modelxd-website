// app/api/xtell/profile/route.ts — the birth details saved for the free
// daily fortune (supabase/109). Signed-in only, and only the caller's own
// row: the session decides the user id, the body never does.
//
//   GET     the saved profile, or null
//   PUT     save it: explicit consent to create it (checked in SQL, under the
//           row lock, so a delete in between cannot be undone silently), the same date checks
//           as every temple (no gender: v1 reads none), a birth place, a real
//           display zone, and a clock time that happened exactly once there
//           (or the visitor's choice of which of two)
//   DELETE  the profile, its daily readings and their follow-up questions

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xtellAdmin, dailyMissing } from '@/lib/xtell-admin'
import { profileProblem, cleanBirth, CONSENT_VERSION } from '@/lib/xtell-daily'
import { resolveWallTime } from '@/lib/xtell-time'
import { placeOf } from '@/lib/xtell-places'

const unavailable = () => Response.json({ error: 'daily_unavailable' }, { status: 503 })

async function signedIn() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

type Row = { birth: any; birth_place: string; fold: number | null; display_tz: string; revision: number; consent_at: string }
const shape = (r: Row | null) => r ? { birth: r.birth, place: r.birth_place, fold: r.fold, displayTz: r.display_tz, revision: r.revision, consentAt: r.consent_at } : null
const COLUMNS = 'birth, birth_place, fold, display_tz, revision, consent_at'

async function current(userId: string) {
  return xtellAdmin().from('xtell_profiles').select(COLUMNS).eq('user_id', userId).maybeSingle()
}

export async function GET() {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await current(user.id)
  if (error) return dailyMissing(error) ? unavailable() : Response.json({ error: 'profile_failed' }, { status: 500 })
  return Response.json({ profile: shape(data as Row | null) })
}

export async function PUT(req: Request) {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const input = { birth: body?.birth, place: body?.place, fold: body?.fold ?? null, displayTz: body?.displayTz }
  const problem = profileProblem(input)
  if (problem) return Response.json({ error: 'bad profile', code: problem }, { status: 400 })

  const birth = cleanBirth(input.birth)
  // A repeated-hour choice means something only for a time that repeated.
  const repeated = !birth.hourUnknown && resolveWallTime(birth.y, birth.m, birth.d, birth.h, birth.mi, placeOf(input.place)!.tz).kind === 'ambiguous'
  // Nothing is kept before the visitor has said yes to keeping it: without
  // `consent` the function only edits an existing profile, never makes one.
  const { data: revision, error: saveError } = await xtellAdmin().rpc('xtell_profile_save', {
    p_user: user.id, p_birth: birth, p_place: input.place, p_fold: repeated ? input.fold : null, p_tz: input.displayTz,
    p_consent: body?.consent === true, p_consent_text: CONSENT_VERSION,
  })
  if (saveError) return dailyMissing(saveError) ? unavailable() : Response.json({ error: 'profile_failed' }, { status: 500 })
  if (revision === null || revision === undefined) return Response.json({ error: 'consent required', code: 'consent_required' }, { status: 400 })
  const { data } = await current(user.id)
  return Response.json({ profile: shape(data as Row | null) })
}

export async function DELETE() {
  const user = await signedIn()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { error } = await xtellAdmin().rpc('xtell_profile_delete', { p_user: user.id })
  if (error) return dailyMissing(error) ? unavailable() : Response.json({ error: 'profile_failed' }, { status: 500 })
  return Response.json({ deleted: true })
}
