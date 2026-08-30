// GET /api/v1/tripo/tasks/{id} — poll. Tripo's response passes through
// verbatim (progress, output.model_url, output.rendered_image_url, and their
// error bodies), plus our usage block. The first terminal poll reconciles
// billing against the task's consumed_credit.

export const runtime = 'nodejs'

import { guard, tripoGet, ownsTask, reconcile, passThrough } from '@/lib/tripo'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { id } = await params
  const own = await ownsTask(g.userId, id)
  if (!own) return Response.json({ error: 'unknown task id (not yours or not created through ModelXD)' }, { status: 404 })

  const { status, json } = await tripoGet(`/tasks/${encodeURIComponent(id)}`)
  if (status !== 200) return passThrough(status, json)

  const task = json?.data ?? {}
  const settled = await reconcile(g.userId, id, task)
  const billed = settled ?? own.billed_cents
  return Response.json({ ...json, usage: { cost_usd: billed / 100, reconciled: settled !== null || own.reconciled } })
}
