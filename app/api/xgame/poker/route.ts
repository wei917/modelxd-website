// app/api/xgame/poker/route.ts
// No-limit Texas hold'em for the XGame arena (Oct 19). The table itself is
// lib/poker-table.ts; this shell signs the caller in, owns the database row
// and the wallet, and hands both in. One act per request, the client loops
// (gomoku's pattern):
//
//   POST { action: 'create', seats: [{ modelId, thinking } | { human: true }], hands, lang }
//   POST { action: 'state' | 'step' | 'end', id }
//   POST { action: 'act', id, move: 'fold'|'check'|'call'|'bet'|'raise'|'allin', amount }
//
// Every model action is billed at list price as it happens (referenceType
// xgame_poker), the part under a cent carried to the next charge
// (supabase/114), like XOracle.

export const runtime = 'nodejs'
export const maxDuration = 200

import { createClient } from '@supabase/supabase-js'
import { accrueFraction, debitCredits, getUserCredits } from '@/lib/credits'
import { getModelById } from '@/lib/models'
import { handlePoker, type PokerRow } from '@/lib/poker-table'

const LOG = '[xgame:poker]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const COLS = 'id, user_id, game, status, human_seat, players, day, pending, title, winner, cost_usd, updated_at'

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const db = svc()
  let r: { status: number; body: any }
  try {
    r = await handlePoker(body, {
      userId: user.id,
      store: {
        async insert(row) {
          const { data, error } = await db.from('xtalk_sessions').insert({
            ...row, game: 'poker', phase: 'poker', turn_order: [], transcript: [],
          }).select('id').single()
          if (error) console.warn(`${LOG} create failed:`, error.message)
          return data?.id ?? null
        },
        async load(id) {
          const { data } = await db.from('xtalk_sessions').select(COLS).eq('id', id).maybeSingle()
          // Another game's row is not a poker table, whoever owns it.
          if (!data || (data as any).game !== 'poker') return null
          return data as unknown as PokerRow
        },
        async save(id, version, patch) {
          const { data, error } = await db.from('xtalk_sessions')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id).eq('day', version).select('id')
          if (error) console.warn(`${LOG} save failed:`, error.message)
          return !error && (data?.length ?? 0) === 1
        },
      },
      getModel: id => getModelById(id),
      async bill(usd, tableId, model) {
        const carried = await accrueFraction(user.id, usd * 1e6)
        const cents = carried ?? Math.round(usd * 100)
        if (cents > 0) await debitCredits({
          userId: user.id, amountCents: cents, referenceType: 'xgame_poker', referenceId: tableId,
          description: 'XGame poker action', metadata: { model: model.model_name, provider: model.provider, costUsd: usd },
        })
      },
      async canSpend() {
        const c = await getUserCredits(user.id).catch(() => null)
        return (c?.balance_cents ?? 0) > 0
      },
    })
  } catch (e: any) {
    // A replay that cannot be made is a broken table, never a misdeal.
    console.error(`${LOG} ${body?.action} ${body?.id ?? ''} failed:`, e?.message ?? e)
    return Response.json({ error: 'The table hit an error. Try again, or start a new game.' }, { status: 500 })
  }
  return Response.json(r.body, { status: r.status })
}
