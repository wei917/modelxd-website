// GET /api/v1/jobs — the caller's recent image and video jobs.
//
// The recovery path. A create returns an id and nothing else remembers it, so
// a client that dies between POST and its first poll has paid for a run it can
// never read: the only safe move is to resubmit and pay twice. The Tripo proxy
// already answers this with GET /api/v1/tripo/tasks; this is the same door for
// the generation jobs (asked for by a game client after a 504, 2026-08-31).
//
// Text runs are deliberately excluded. /v1/chat/completions is synchronous and
// has no job to list, so everything here is something you can still fetch.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { v1Caller, err } from '@/lib/v1-generation'

const MAX_LIMIT = 100

export async function GET(req: Request) {
  const caller = await v1Caller(req)
  if (!caller) return err('Unauthorized', 401)

  const url = new URL(req.url)
  const rawLimit = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(rawLimit) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit))) : 20
  const wantType = url.searchParams.get('type')       // image | video

  if (wantType && wantType !== 'image' && wantType !== 'video') {
    return err('`type` must be `image` or `video`.')
  }

  // No `status` filter on purpose. A job's reported status is derived from its
  // slot (a job row can read `completed` while its only slot carries an error),
  // so a SQL filter on the row would quietly disagree with the status printed
  // beside it, and filtering after the LIMIT would return "the failures inside
  // the newest 20" while looking like "the newest 20 failures". The list is
  // short; filter it client-side and it cannot lie.

  // Service role: an API-key caller has no session for RLS to key off. The
  // user_id filter below is the ownership check, the same one the single-job
  // route makes explicitly.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })

  let q = sb.from('xcreate_jobs')
    .select('id, mode, prompt, status, error, created_at, completed_at')
    .eq('user_id', caller.userId)
    .in('mode', wantType ? [wantType] : ['image', 'video'])
    .order('created_at', { ascending: false })
    .limit(limit)
  const { data: jobs, error: qErr } = await q
  if (qErr) {
    console.error('[v1] jobs list failed:', qErr.message)
    return err('Could not list jobs.', 500, 'server_error')
  }

  // One extra round trip for the model names rather than N. Slot 0 is the
  // model: /v1 only ever submits one per job.
  const ids = (jobs ?? []).map(j => j.id)
  const byJob = new Map<string, any>()
  if (ids.length) {
    const { data: slots } = await sb.from('xcreate_job_slots')
      .select('job_id, slot_index, provider, model_name, done, error, cost')
      .in('job_id', ids).eq('slot_index', 0)
    for (const s of slots ?? []) byJob.set(s.job_id, s)
  }

  const data = (jobs ?? []).map(j => {
    const s = byJob.get(j.id)
    const failed = j.status === 'failed' || Boolean(s?.error)
    const status = failed ? 'failed' : s?.done ? 'succeeded' : 'running'
    return {
      id: j.id,
      object: `${j.mode}.generation.job`,
      status,
      model: s?.model_name ? `${s.provider}/${s.model_name}` : undefined,
      prompt: j.prompt,
      created: Math.floor(new Date(j.created_at).getTime() / 1000),
      completed: j.completed_at ? Math.floor(new Date(j.completed_at).getTime() / 1000) : undefined,
      usage: { cost_usd: Number(s?.cost) || 0 },
      error: failed ? (s?.error ?? j.error ?? 'generation failed') : undefined,
      // Files are not inlined: they are signed URLs with a 24h life, so a list
      // read a day later would hand back links that are already dead. Poll for
      // the one you want and get a URL signed now.
      poll: `/api/v1/jobs/${j.id}`,
    }
  })

  return Response.json({ object: 'list', data, has_more: (jobs ?? []).length === limit })
}
