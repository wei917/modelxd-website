// GET /api/v1/tripo/tasks — your recent tasks, newest first. This is the
// recovery path the spec asked for: "if I lose the response to a create call
// I need to be able to find that task again."

export const runtime = 'nodejs'

import { guard, service } from '@/lib/tripo'

export async function GET(req: Request) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { data, error } = await service().from('tripo_tasks')
    .select('task_id, kind, input_task_id, params, billed_cents, reconciled, status_cache, created_at')
    .eq('user_id', g.userId).order('created_at', { ascending: false }).limit(50)
  if (error) {
    const msg = /tripo_tasks/.test(error.message) ? 'Tripo storage is not set up yet (run supabase/89_tripo_tasks.sql).' : error.message
    return Response.json({ error: msg }, { status: 503 })
  }
  return Response.json({
    tasks: (data ?? []).map(t => ({ ...t, usage: { cost_usd: t.billed_cents / 100 } })),
  })
}
