// app/api/xtell/vote/route.ts — 👍 / 👎 on a teacher's answer (owner, Oct 1:
// "add thumb up and thumb down for each response"). supabase/122,
// lib/xtell-feedback.ts.
//
//   GET  ?readingId=   the caller's own votes in that visit
//   POST { readingId, qid, modelId, vote }   vote 1 or -1 sets it, 0 takes
//        it back. The answer must be in the caller's own visit: the visit is
//        read with the caller's session (RLS: own rows only) before anything
//        is written with the service key, and the user id comes from the
//        session, never the body.
//
// Before migration 122 runs, both answer 503 votes_unavailable and the room
// hides the buttons.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xtellAdmin, dailyMissing } from '@/lib/xtell-admin'
import { asVote } from '@/lib/xtell-feedback'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable = () => Response.json({ error: 'votes_unavailable' }, { status: 503 })
const failed = () => Response.json({ error: 'vote_failed' }, { status: 500 })

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const readingId = new URL(req.url).searchParams.get('readingId') ?? ''
  if (!UUID.test(readingId)) return Response.json({ error: 'bad visit', code: 'vote_bad_input' }, { status: 400 })
  const { data, error } = await xtellAdmin().from('xtell_answer_votes')
    .select('qid, model_id, vote').eq('user_id', user.id).eq('reading_id', readingId)
  if (error) return dailyMissing(error) ? unavailable() : failed()
  return Response.json({ votes: (data ?? []).map((r: any) => ({ qid: r.qid, modelId: r.model_id, vote: r.vote })) })
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const readingId = body?.readingId, qid = body?.qid, modelId = body?.modelId, vote = asVote(body?.vote)
  if (typeof readingId !== 'string' || !UUID.test(readingId) || typeof qid !== 'string' || !UUID.test(qid)
    || typeof modelId !== 'string' || !UUID.test(modelId) || vote === null) {
    return Response.json({ error: 'bad vote', code: 'vote_bad_input' }, { status: 400 })
  }

  // The answer, in the caller's own visit.
  const { data: visit } = await sb.from('xtell_readings').select('temple, turns')
    .eq('id', readingId).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  const turns = Array.isArray((visit as any)?.turns) ? (visit as any).turns : []
  if (!visit || !turns.some((tn: any) => tn?.role === 'assistant' && tn.qid === qid && tn.modelId === modelId)) {
    return Response.json({ error: 'no such answer', code: 'vote_no_answer' }, { status: 404 })
  }

  const admin = xtellAdmin()
  const key = { user_id: user.id, reading_id: readingId, qid, model_id: modelId }
  const { error } = vote === 0
    ? await admin.from('xtell_answer_votes').delete().match(key)
    : await admin.from('xtell_answer_votes').upsert({
        ...key, vote,
        temple: /^[a-z]{2,20}$/.test(String((visit as any).temple)) ? (visit as any).temple : 'other',
        env: process.env.VERCEL_ENV ?? 'development',
        country: req.headers.get('x-vercel-ip-country')?.slice(0, 2) ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,reading_id,qid,model_id' })
  if (error) return dailyMissing(error) ? unavailable() : failed()
  return Response.json({ vote })
}
