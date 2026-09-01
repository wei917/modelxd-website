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
  // The settled figure, or the ledger row — RE-READ when this poll didn't
  // settle, because a concurrent poll may have claimed reconciliation
  // between our ownership check and here, and the pre-claim snapshot then
  // reports the estimate (or worse: a caller saw `cost_usd: null` on a
  // terminal poll — reported Sep 1). Number() also guards bigint-as-string
  // from the driver; if no numeric figure exists at all, say so explicitly
  // with the reason rather than serializing NaN into a bare null.
  const row = settled !== null ? null : await ownsTask(g.userId, id)
  const cents = settled !== null ? settled : Number(row?.billed_cents ?? own.billed_cents)
  const reconciled = settled !== null || row?.reconciled === true || own.reconciled === true
  if (!Number.isFinite(cents)) {
    return Response.json({ ...json, usage: { cost_usd: null, reconciled: false, note: 'no billing figure recorded for this task — the create-time estimate stands; contact us if this persists' } })
  }
  return Response.json({ ...json, usage: { cost_usd: cents / 100, reconciled } })
}
