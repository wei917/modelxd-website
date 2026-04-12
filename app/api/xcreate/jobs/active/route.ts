// app/api/xcreate/jobs/active/route.ts
// Returns the current user's most recent running xcreate job, if any.
// Called by /xcreate on mount so a navigation-then-return resumes the stream.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job } = await sb
    .from('xcreate_jobs')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return Response.json({ jobId: job?.id ?? null })
}
