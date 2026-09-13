// app/api/xarch/projects/[id]/chat/route.ts — the design agent. One turn:
// the architect answers and may take ONE action — edit the plan (ops,
// applied by code, undoable) or edit a room photo (GPT Image 2).

export const runtime = 'nodejs'
export const maxDuration = 800

import { service, agentTurn, applyAgentOps, assertBalance, bill } from '@/lib/xarch-ai'
import { ARCHITECTS, KINDS, isArchitect, type ArchitectId, type Selection } from '@/lib/xarch'
import { owned, view, fail, HISTORY_CAP } from '../../../_shared'
import { runPhotoEdit } from '../../../_photo'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const body = await req.json().catch(() => ({}))
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 4000) : ''
  if (!message) return Response.json({ error: 'Empty message' }, { status: 400 })
  if (o.row.status !== 'ready' || !o.row.plan) return Response.json({ error: 'The plan is not ready yet.' }, { status: 409 })
  const architect: ArchitectId = isArchitect(body?.architect) ? body.architect : 'fable'
  const selection: Selection = body?.selection && KINDS.includes(body.selection.kind) && typeof body.selection.id === 'string' ? body.selection : null
  const at = new Date().toISOString()

  try {
    await assertBalance(o.userId, ARCHITECTS[architect].editEstimateCents)
    const history = (o.row.chat ?? []).map((t: any) => ({ role: t.role, text: t.text }))
    const turn = await agentTurn(architect, o.userId, o.row.plan, selection, o.row.media ?? [], history, message)
    let spent = await bill(o.userId, turn.cost, o.row.id, `agent (${ARCHITECTS[architect].label})`, { architect, kind: 'chat' })
    let actionOut: any = null
    let newItem: any = null

    if (turn.action?.type === 'edit_photo' && turn.action.media_id && turn.action.prompt) {
      try {
        const { item, cents } = await runPhotoEdit(req, o.row, o.userId, String(turn.action.media_id), String(turn.action.prompt))
        newItem = item; spent += cents
        actionOut = { type: 'edit_photo', media_id: item.id, room_id: item.room_id, prompt: item.prompt }
      } catch (e) {
        actionOut = { type: 'edit_photo', error: e instanceof Error ? e.message : String(e) }
      }
    }

    // Build the write on a FRESH read (see the edit route): a turn takes up to
    // a minute and whatever was saved meanwhile must not be overwritten.
    const { data: fresh } = await service().from('xarch_projects').select('*').eq('id', o.row.id).single()
    const base = fresh ?? o.row
    const patch: Record<string, unknown> = {}
    if (turn.action?.type === 'edit_plan' && Array.isArray(turn.action.ops) && turn.action.ops.length) {
      const r = applyAgentOps(base.plan, turn.action.ops)
      patch.plan = r.plan
      patch.history = [...(base.history ?? []), base.plan].slice(-HISTORY_CAP)
      actionOut = { type: 'edit_plan', changed: turn.action.ops.map((x: any) => x.id), notes: String(turn.action.notes ?? ''), warnings: (turn.action.warnings ?? []).map(String), errors: r.errors, issues: r.issues }
    }
    const chat = [...(base.chat ?? []), { role: 'user', text: message, at }, { role: 'assistant', text: turn.reply, at: new Date().toISOString(), architect, action: actionOut }]
    const { data } = await service().from('xarch_projects').update({
      ...patch, chat: chat.slice(-80), media: newItem ? [...(base.media ?? []), newItem] : (base.media ?? []),
      spent_cents: (base.spent_cents ?? 0) + spent, updated_at: new Date().toISOString(),
    }).eq('id', o.row.id).select('*').single()
    return Response.json({ project: await view(data ?? base), action: actionOut, cost_cents: spent })
  } catch (e) {
    return fail(e, 'The agent could not answer')
  }
}
