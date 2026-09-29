// app/api/xcreate/film/route.ts — start a film (XCreate's fifth type).
// POST { brief, aspect, seconds, budgetCents } → { id }
//
// Reserves the budget, creates the Managed Agents session and returns. The
// film is then driven by POST /api/xcreate/film/[id] (the page) and
// /api/xcreate/film/cron (every minute). See lib/film/driver.ts.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createSupabaseServer } from '@/lib/supabase-server'
import { startFilm, FilmError } from '@/lib/film/driver'
import { FILM_BRIEF_MAX, isFilmAspect, isFilmBudget, isFilmLength } from '@/lib/film/config'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || user.is_anonymous) return Response.json({ error: 'Sign in to make a film.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const brief = typeof body?.brief === 'string' ? body.brief.trim() : ''
  if (!brief) return Response.json({ error: 'Describe the film first.' }, { status: 400 })
  if (brief.length > FILM_BRIEF_MAX) return Response.json({ error: `The brief is too long (max ${FILM_BRIEF_MAX.toLocaleString('en-US')} characters).` }, { status: 400 })
  if (!isFilmAspect(body?.aspect) || !isFilmLength(body?.seconds) || !isFilmBudget(body?.budgetCents)) {
    return Response.json({ error: 'Pick a shape, a length and a budget.' }, { status: 400 })
  }

  try {
    const id = await startFilm(user.id, { brief, aspect: body.aspect, seconds: body.seconds, budgetCents: body.budgetCents })
    return Response.json({ id })
  } catch (e) {
    if (e instanceof FilmError) return Response.json({ error: e.message, ...e.extra }, { status: e.status })
    console.error('[film] start failed:', e)
    return Response.json({ error: 'Could not start the film. Nothing was charged.' }, { status: 500 })
  }
}
