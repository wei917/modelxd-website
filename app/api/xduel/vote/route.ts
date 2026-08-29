// app/api/xduel/vote/route.ts
// Saves blind vote (vote1) and informed vote (vote2) to the duels table

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { maybeRefit } from '@/lib/xdrating'

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createSupabaseServer()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // The client sends a SLOT INDEX, never a model id (Aug 29). It used to
    // send `vote1ModelId` too, and this route wrote it through untouched —
    // ownership was checked, but never that the id was one of THAT duel's
    // two models. Since the column feeds XDRating through the DB triggers, a
    // crafted POST could credit any model in the catalog. The id is now
    // derived here from the duel's own slots; a client-supplied one is
    // ignored, so the tampering path is gone rather than validated.
    const { duelId, vote1, vote2 } = await req.json() as {
      duelId: string
      vote1?: string | number | null       // slot index or 'T'
      vote2?: string | number | null
    }

    if (!duelId) {
      return NextResponse.json({ error: 'Missing duelId' }, { status: 400 })
    }
    if (vote1 === undefined && vote2 === undefined) {
      return NextResponse.json({ error: 'No vote data provided' }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    )

    // The duel row is the authority on what actually ran — including a slot
    // XDuel redrew after its first model failed.
    const { data: duel } = await sb
      .from('duels').select('slots, vote1_model_id')
      .eq('id', duelId).eq('user_id', user.id).single()
    if (!duel) {
      return NextResponse.json({ error: 'Duel not found' }, { status: 404 })
    }
    const slots: any[] = Array.isArray(duel.slots) ? duel.slots : []

    /** Slot index → the model that filled it. 'T' (tie) and anything that
     *  isn't a real slot both resolve to null rather than to a guess. */
    const modelIdFor = (v: string | number | null | undefined): string | null => {
      if (v === undefined || v === null || v === 'T') return null
      const i = Number(v)
      return Number.isInteger(i) && i >= 0 && i < slots.length ? (slots[i].model_id ?? null) : null
    }

    const update: Record<string, unknown> = {}
    if (vote1 !== undefined) {
      update.vote1 = vote1 === null ? null : String(vote1)
      update.vote1_model_id = modelIdFor(vote1)
    }
    if (vote2 !== undefined) {
      update.vote2 = vote2 === null ? null : String(vote2)
      const winner = modelIdFor(vote2)
      update.vote2_model_id = winner
      update.vote_changed = (duel.vote1_model_id !== winner)
    }

    const { error } = await sb
      .from('duels')
      .update(update)
      .eq('id', duelId)
      .eq('user_id', user.id) // ensure ownership

    if (error) {
      console.error('[vote] update error:', error.message)
      return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
    }

    // Refresh the XDRating snapshot. The DB trigger already updated the
    // aggregate tables inside the vote's transaction; this fits BT over
    // them (throttled to one run / 10s — see docs/xdrating-pipeline.md).
    // Awaited on purpose: serverless may kill un-awaited work, and a
    // skipped run returns in one indexed select.
    try {
      await maybeRefit(sb, 'vote')
    } catch (err) {
      console.warn('[vote] refit skipped:', err instanceof Error ? err.message : err)
    }

    // The reveal rides back on the vote-1 response. Identities and prices
    // are never sent while the duel is still blind (see the `meta` note in
    // ../route.ts), so this is the moment they become knowable — and only
    // to someone who has just had a vote recorded on a duel they own.
    if (vote1 !== undefined) {
      return NextResponse.json({
        ok: true,
        models: slots.map((sl: any, index: number) => ({
          index,
          id:          sl.model_id,
          provider:    sl.provider,
          model_name:  sl.model_name,
          name:        sl.name,
          outputPrice: sl.outputPrice ?? 0,
          priceLabel:  sl.priceLabel ?? '…',
        })),
      })
    }
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[vote] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
