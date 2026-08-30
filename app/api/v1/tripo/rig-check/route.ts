// POST /api/v1/tripo/rig-check — { input: task_id } → riggable? Free on
// Tripo's price list and billed as free here; the input task must be YOURS
// (ids chain, so an unowned id would let anyone walk another user's pipeline).

export const runtime = 'nodejs'

import { guard, tripoPost, recordTask, ownsTask, passThrough } from '@/lib/tripo'

export async function POST(req: Request) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const body = await req.json().catch(() => ({}))
  const input = typeof body?.input === 'string' ? body.input : ''
  if (!input) return Response.json({ error: 'input (task_id) required' }, { status: 400 })
  if (!(await ownsTask(g.userId, input))) return Response.json({ error: 'unknown task id (not yours or not created through ModelXD)' }, { status: 404 })

  const { status, json } = await tripoPost('/animations/rig-check', { input })
  const taskId = json?.data?.task_id
  if (status !== 200 || !taskId) return passThrough(status, json)

  await recordTask({ userId: g.userId, taskId, kind: 'rig_check', inputTaskId: input, params: { input }, billCents: 0 })
  return Response.json({ ...json, usage: { cost_usd: 0 } })
}
