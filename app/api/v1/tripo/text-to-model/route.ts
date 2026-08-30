// POST /api/v1/tripo/text-to-model — prompt → mesh. Thin proxy, allowlisted
// params passed through VERBATIM (the caller's spec: a hardcoded high-fidelity
// default would make every output unusable for a low-poly game world).

export const runtime = 'nodejs'

import { guard, tripoPost, recordTask, listPriceCents, passThrough } from '@/lib/tripo'

export async function POST(req: Request) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const body = await req.json().catch(() => ({}))

  const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, 4000) : ''
  if (!prompt.trim()) return Response.json({ error: 'prompt required' }, { status: 400 })

  // Allowlist, not rewrite: everything Tripo documents for this endpoint that
  // a proxy can safely forward. Unknown keys are dropped, known keys are not
  // second-guessed.
  const fwd: Record<string, unknown> = { prompt }
  if (typeof body.model === 'string' && body.model.length <= 40) fwd.model = body.model
  if (Number.isInteger(body.face_limit) && body.face_limit >= 100 && body.face_limit <= 500000) fwd.face_limit = body.face_limit
  if (typeof body.texture === 'boolean') fwd.texture = body.texture
  if (typeof body.quad === 'boolean') fwd.quad = body.quad
  if (typeof body.negative_prompt === 'string') fwd.negative_prompt = body.negative_prompt.slice(0, 2000)
  if (typeof body.style === 'string' && body.style.length <= 60) fwd.style = body.style
  if (Number.isInteger(body.seed)) fwd.seed = body.seed

  const cents = listPriceCents('text_to_model', fwd.model as string | undefined, fwd.texture !== false)
  const { status, json } = await tripoPost('/generation/text-to-model', fwd)
  const taskId = json?.data?.task_id
  if (status !== 200 || !taskId) return passThrough(status, json)

  await recordTask({ userId: g.userId, taskId, kind: 'text_to_model', params: fwd, billCents: cents })
  return Response.json({ ...json, usage: { cost_usd: cents / 100, billing: 'debited now; reconciled to Tripo consumed_credit at first terminal poll' } })
}
