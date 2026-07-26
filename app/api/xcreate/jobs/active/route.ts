// app/api/xcreate/jobs/active/route.ts
// Returns ALL of the current user's running xcreate jobs.
//
// Was "the most recent running job", which /xcreate used to force itself into
// the generating phase on mount — and that phase is what blocked starting
// another run. Runs are concurrent now, so this is a list: the sidebar shows
// them and the page opens one only when the URL names it (CC, July 26).

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: jobs } = await sb
    .from('xcreate_jobs')
    .select('id, mode, prompt, created_at')
    .eq('user_id', user.id)
    .eq('status', 'running')
    // maxDuration is 300s, so a 'running' row older than 10 minutes belongs to
    // a function that was killed and will never close it. Nothing sweeps those
    // now that the supersede cleanup is gone, so filter them out here rather
    // than leave a permanent spinner in the sidebar (CC, July 26).
    .gt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10)

  return Response.json({ jobs: jobs ?? [] })
}
