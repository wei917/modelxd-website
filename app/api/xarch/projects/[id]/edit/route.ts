// app/api/xarch/projects/[id]/edit/route.ts — the click menu's "Edit": the
// selected element + an instruction go to the chosen architect, its ops are
// applied by code, the previous plan goes on the undo stack.

export const runtime = 'nodejs'
export const maxDuration = 800

import { service, editPlan, applyAgentOps, assertBalance, bill } from '@/lib/xarch-ai'
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

    // An architect takes 20-60s. Anything saved meanwhile (another edit, an
    // agent turn, an upload) must survive, so the write is built on a FRESH
    // read and the ops are applied to the fresh plan — building it on the row
    // read before the call is how a kitchen edit was silently overwritten
    // (Sep 13).
    const { data: fresh } = await service().from('xarch_projects').select('*').eq('id', o.row.id).single()
    const base = fresh ?? o.row
    const applied = r.ops.length ? applyAgentOps(base.plan, r.ops) : null
    const result = {
      changed: r.ops.map(op => op.id), notes: r.notes, warnings: r.warnings,
      errors: applied?.errors ?? [], issues: applied?.issues ?? [], cost_cents: cents,
    }
    const at = new Date().toISOString()
    const patch: Record<string, unknown> = {
      spent_cents: (base.spent_cents ?? 0) + cents, updated_at: at,
      // The menu edit is logged in the conversation too, so the agent (and
      // the user scrolling back) can see what was changed and why.
      chat: [...(base.chat ?? []),
        { role: 'user', text: `${selection ? `[${selection.kind} ${selection.id}] ` : ''}${instruction}`, at, via: 'menu' },
        { role: 'assistant', text: r.notes || (r.ops.length ? 'Done.' : 'No change made.'), at, architect, via: 'menu',
          action: r.ops.length ? { type: 'edit_plan', ...result } : null },
      ].slice(-80),
    }
    if (applied) {
      patch.plan = applied.plan
      patch.history = [...(base.history ?? []), base.plan].slice(-HISTORY_CAP)
    }
    const { data } = await service().from('xarch_projects').update(patch).eq('id', o.row.id).select('*').single()
    return Response.json({ project: await view(data ?? base), result })
  } catch (e) {
    return fail(e, 'The edit failed')
  }
}
