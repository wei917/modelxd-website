// app/api/xcreate/film/[id]/route.ts — one film, for its owner.
//   GET  → the film's view (progress, spend, the video once it exists)
//   POST → the same, and one drive pass after the answer (`after`): the open
//          page is what keeps a film moving between the cron's minutes. A
//          pass that runs a clip takes minutes; the page does not wait for it.

export const runtime = 'nodejs'
export const maxDuration = 800

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { driveFilm, filmService, filmView, loadFilm } from '@/lib/film/driver'
import { isFilmActive } from '@/lib/film/config'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function owned(id: string) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const svc = filmService()
  const film = await loadFilm(svc, id, user.id)
  if (!film) return Response.json({ error: 'Not found' }, { status: 404 })
  return { svc, film }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  return Response.json(await filmView(o.svc, o.film))
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  if (isFilmActive(o.film.status)) after(() => driveFilm(o.film.id))
  return Response.json(await filmView(o.svc, o.film))
}
