// app/api/xarch/projects/[id]/edit/route.ts — the click menu's "Edit": the
// selected element + an instruction go to the chosen architect, its ops are
// applied by code, the previous plan goes on the undo stack.

export const runtime = 'nodejs'
export const maxDuration = 800

import { service, editPlan, assertBalance, bill } from '@/lib/xarch-ai'
import { ARCHITECTS, KINDS, isArchitect, type ArchitectId, type Selection } from '@/lib/xarch'
import { owned, view, fail, HISTORY_CAP } from '../../../_shared'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const body = await req.json().catch(() => ({}))
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim().slice(0, 2000) : ''
  if (!instruction) return Response.json({ error: 'Say what to change.' }, { status: 400 })
  if (o.row.status !== 'ready' || !o.row.plan) return Response.json({ error: 'The plan is not ready yet.' }, { status: 409 })
  const architect: ArchitectId = isArchitect(body?.architect) ? body.architect : 'fable'
  const selection: Selection = body?.selection && KINDS.includes(body.selection.kind) && typeof body.selection.id === 'string' ? body.selection : null

  try {
    await assertBalance(o.userId, ARCHITECTS[architect].editEstimateCents)
    const r = await editPlan(architect, o.userId, o.row.plan, selection, instruction)
    const cents = await bill(o.userId, r.cost, o.row.id, `edit (${ARCHITECTS[architect].label})`, { architect, kind: 'edit' })
    const patch: Record<string, unknown> = { spent_cents: (o.row.spent_cents ?? 0) + cents, updated_at: new Date().toISOString() }
    if (r.ops.length > 0) {
      patch.plan = r.plan
      patch.history = [...(o.row.history ?? []), o.row.plan].slice(-HISTORY_CAP)
    }
    const { data } = await service().from('xarch_projects').update(patch).eq('id', o.row.id).select('*').single()
    return Response.json({
      project: await view(data ?? o.row),
      result: { changed: r.ops.map(op => op.id), notes: r.notes, warnings: r.warnings, errors: r.errors, issues: r.newIssues, cost_cents: cents },
    })
  } catch (e) {
    return fail(e, 'The edit failed')
  }
}
