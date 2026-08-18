// app/api/xcreate/node/route.ts
// Remove nodes from a board (CC, July 28).
//
// DELETE is a soft delete: it stamps deleted_at and leaves the row alone.
// Two reasons. The user paid for these generations, so "delete" meaning
// "gone forever" is the wrong default on a board people prune while
// experimenting. And the row is still the historical record of a charge —
// credit_transactions reference it.
//
// This needs a route rather than a browser-side update because xcreates has
// owner select/insert/delete policies but NO update policy (supabase/
// 03_xcreates.sql), so the anon client cannot stamp the column. The service
// client can, and ownership is checked here before it does.
//
// Children of a deleted node are deliberately NOT cascaded. A node can have
// several parents now, so cascading would delete a video that still derives
// from three surviving angles. Instead the canvas simply drops wires to
// nodes that are no longer on the board, and an orphaned angle re-flows to
// the first column. Nothing breaks, and one undo is one row.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const LOG = '[xcreate:node]'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function DELETE(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, restore = false } = await req.json()
  const idList: string[] = (Array.isArray(ids) ? ids : []).filter((x: any) => typeof x === 'string')
  if (idList.length === 0) return Response.json({ error: 'No node ids provided' }, { status: 400 })
  if (idList.length > 200) return Response.json({ error: 'Too many nodes' }, { status: 400 })

  const sb = serviceClient()

  // Ownership check before the write — an id from another account must not
  // be touchable even though the service client bypasses RLS.
  const { data: owned, error: readErr } = await sb.from('xcreates')
    .select('id, user_id').in('id', idList)
  if (readErr) {
    console.error(`${LOG} ownership read failed:`, readErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }
  const mine = (owned ?? []).filter((r: any) => r.user_id === user.id).map((r: any) => r.id)
  if (mine.length === 0) return Response.json({ error: 'Nodes not found' }, { status: 404 })

  const { error: updErr } = await sb.from('xcreates')
    .update({ deleted_at: restore ? null : new Date().toISOString() })
    .in('id', mine)
  if (updErr) {
    console.error(`${LOG} soft delete failed:`, updErr.message)
    return Response.json({ error: 'Delete failed' }, { status: 500 })
  }

  console.log(`${LOG} ${restore ? 'restored' : 'soft-deleted'} ${mine.length} node(s) for ${user.id}`)
  return Response.json({ ok: true, ids: mine, restored: !!restore })
}
