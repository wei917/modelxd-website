// POST /api/v1/tripo/rig — { input, model, rig_type, spec } → skeleton task.
// `spec` passes through untouched. The caller's spec calls "mixamo" the
// single most important parameter in the document — it is what lets their
// existing CC0 animation library drive the rigged character — so this proxy
// forwards it verbatim and defaults NOTHING.
//
// `model` passes through too — LEARNED THE HARD WAY (bug report, Sep 1:
// "rigging is impossible"). This route used to drop the field; with none
// sent, Tripo fills in its own GENERATION-tier default (v2.5-20250123) and
// then rejects it against the rig enum (v1.0-20240301 / v2.5-20260210),
// so every request failed whatever the caller sent — and the error named a
// value the caller never wrote, which read as injection from outside.

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
  if (typeof body.model === 'string' && body.model.length <= 40) fwd.model = body.model
  if (typeof body.rig_type === 'string' && body.rig_type.length <= 30) fwd.rig_type = body.rig_type
  if (typeof body.spec === 'string' && body.spec.length <= 30) fwd.spec = body.spec

  const cents = listPriceCents('rig', undefined, false)
  const { status, json } = await tripoPost('/animations/rig', fwd)
  const taskId = json?.data?.task_id
  if (status !== 200 || !taskId) return passThrough(status, json)

  await recordTask({ userId: g.userId, taskId, kind: 'rig', inputTaskId: input, params: fwd, billCents: cents })
  return Response.json({ ...json, usage: { cost_usd: cents / 100, billing: 'debited now; reconciled to Tripo consumed_credit at first terminal poll' } })
}
