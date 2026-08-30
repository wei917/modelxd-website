// POST /api/v1/tripo/image-to-model — image → mesh (the spec's nice-to-have).
// The `file` object is forwarded AS the caller built it, per Tripo's own
// docs — this proxy adds keys and billing, not opinions about file plumbing.

export const runtime = 'nodejs'

import { guard, tripoPost, recordTask, listPriceCents, passThrough } from '@/lib/tripo'

export async function POST(req: Request) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const body = await req.json().catch(() => ({}))
  if (!body?.file || typeof body.file !== 'object') {
    return Response.json({ error: 'file object required (Tripo image-to-model shape)' }, { status: 400 })
  }

  const fwd: Record<string, unknown> = { file: body.file }
  if (typeof body.model === 'string' && body.model.length <= 40) fwd.model = body.model
  if (Number.isInteger(body.face_limit) && body.face_limit >= 100 && body.face_limit <= 500000) fwd.face_limit = body.face_limit
  if (typeof body.texture === 'boolean') fwd.texture = body.texture
  if (typeof body.quad === 'boolean') fwd.quad = body.quad
  if (Number.isInteger(body.seed)) fwd.seed = body.seed

  const cents = listPriceCents('image_to_model', fwd.model as string | undefined, fwd.texture !== false)
  const { status, json } = await tripoPost('/generation/image-to-model', fwd)
  const taskId = json?.data?.task_id
  if (status !== 200 || !taskId) return passThrough(status, json)

  await recordTask({ userId: g.userId, taskId, kind: 'image_to_model', params: { ...fwd, file: '(forwarded)' }, billCents: cents })
  return Response.json({ ...json, usage: { cost_usd: cents / 100, billing: 'debited now; reconciled to Tripo consumed_credit at first terminal poll' } })
}
