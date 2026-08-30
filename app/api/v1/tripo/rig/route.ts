// POST /api/v1/tripo/rig — { input, rig_type, spec } → skeleton task.
// `spec` passes through untouched. The caller's spec calls "mixamo" the
// single most important parameter in the document — it is what lets their
// existing CC0 animation library drive the rigged character — so this proxy
// forwards it verbatim and defaults NOTHING.

export const runtime = 'nodejs'

import { guard, tripoPost, recordTask, ownsTask, listPriceCents, passThrough } from '@/lib/tripo'

export async function POST(req: Request) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const body = await req.json().catch(() => ({}))
  const input = typeof body?.input === 'string' ? body.input : ''
  if (!input) return Response.json({ error: 'input (task_id) required' }, { status: 400 })
  if (!(await ownsTask(g.userId, input))) return Response.json({ error: 'unknown task id (not yours or not created through ModelXD)' }, { status: 404 })

  const fwd: Record<string, unknown> = { input }
  if (typeof body.rig_type === 'string' && body.rig_type.length <= 30) fwd.rig_type = body.rig_type
  if (typeof body.spec === 'string' && body.spec.length <= 30) fwd.spec = body.spec

  const cents = listPriceCents('rig', undefined, false)
  const { status, json } = await tripoPost('/animations/rig', fwd)
  const taskId = json?.data?.task_id
  if (status !== 200 || !taskId) return passThrough(status, json)

  await recordTask({ userId: g.userId, taskId, kind: 'rig', inputTaskId: input, params: fwd, billCents: cents })
  return Response.json({ ...json, usage: { cost_usd: cents / 100, billing: 'debited now; reconciled to Tripo consumed_credit at first terminal poll' } })
}
