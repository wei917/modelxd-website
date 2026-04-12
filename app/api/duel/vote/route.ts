// app/api/duel/vote/route.ts
// Saves blind vote (vote1) and informed vote (vote2) to the duels table

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createSupabaseServer()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { duelId, vote1, vote2, vote1ModelId, vote2ModelId } = await req.json() as {
      duelId: string
      vote1?: string | number | null       // slot index or 'T'
      vote2?: string | number | null
      vote1ModelId?: string | null         // model id e.g. 'openai/gpt-4o', null for tie
      vote2ModelId?: string | null
    }

    if (!duelId) {
      return NextResponse.json({ error: 'Missing duelId' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if (vote1 !== undefined) update.vote1 = vote1 === null ? null : String(vote1)
    if (vote2 !== undefined) update.vote2 = vote2 === null ? null : String(vote2)
    if (vote1ModelId !== undefined) update.vote1_model_id = vote1ModelId
    if (vote2ModelId !== undefined) update.vote2_model_id = vote2ModelId

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No vote data provided' }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    )

    const { error } = await sb
      .from('duels')
      .update(update)
      .eq('id', duelId)
      .eq('user_id', user.id) // ensure ownership

    if (error) {
      console.error('[vote] update error:', error.message)
      return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[vote] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
