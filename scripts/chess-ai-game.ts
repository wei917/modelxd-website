// scripts/chess-ai-game.ts — one real AI-vs-AI chess game through the
// route's own move code (lib/chess-turn.ts playAiTurn + lib/chess-engine.ts),
// without the database or the wallet. Spends real money at list price, so it
// stops at a budget.
//
//   npx tsx --env-file=.env.local scripts/chess-ai-game.ts [white] [black] [budgetUsd]
//   (models by display name; defaults: "GPT-6 Luna" vs "Qwen 3.8 Flash", $2)
//   Thinking: WHITE_THINKING / BLACK_THINKING (default: the model's lowest
//   declared level that is not off, as 五子棋's duels pick).

import { createClient } from '@supabase/supabase-js'
import { chessEngine } from '../lib/chess-engine'
import { playAiTurn, providerAsk, CHESS_HARNESS } from '../lib/chess-turn'
import { sanLine } from '../lib/chess-board'

const [whiteName = 'GPT-6 Luna', blackName = 'Qwen 3.8 Flash', budgetArg = '2'] = process.argv.slice(2)
const BUDGET = Number(budgetArg) || 2

const pickThinking = (m: any): string | null => {
  const lv: string[] = m.output_config?.text?.thinking_levels ?? []
  return lv.includes('low') ? 'low' : lv.includes('thinking_true') ? 'thinking_true' : lv[0] ?? null
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const load = async (name: string) => {
    const { data } = await sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
      .eq('display_name', name).eq('enabled', true).maybeSingle()
    if (!data) throw new Error(`no enabled model named ${name}`)
    return data
  }
  const seats = [
    { model: await load(whiteName), thinking: process.env.WHITE_THINKING ?? null },
    { model: await load(blackName), thinking: process.env.BLACK_THINKING ?? null },
  ].map(s => ({ ...s, thinking: s.thinking ?? pickThinking(s.model) }))
  console.log(`White: ${seats[0].model.display_name} (${seats[0].thinking})  Black: ${seats[1].model.display_name} (${seats[1].thinking})  budget $${BUDGET}`)
  console.log(`harness v${CHESS_HARNESS.version}: ${JSON.stringify(CHESS_HARNESS)}`)

  const eng = await chessEngine()
  const moves: string[] = []
  let pos = eng.position(moves)
  const stats = [0, 1].map(() => ({ moves: 0, retried: 0, fallback: 0, timeouts: 0, cost: 0, ms: 0 }))
  let total = 0
  while (!pos.end && moves.length < CHESS_HARNESS.plyCap) {
    if (total > BUDGET) { console.log(`\nBUDGET reached ($${total.toFixed(4)}): stopping`); break }
    const i = pos.turn === 'w' ? 0 : 1
    const seat = seats[i]
    const r = await playAiTurn(eng, pos, providerAsk(seat.model, { userId: null, thinking: seat.thinking }))
    moves.push(r.uci)
    pos = eng.position(moves)
    const st = stats[i]
    st.moves++; st.cost += r.cost; st.ms += r.ms
    if (r.retried) st.retried++
    if (r.fallback) st.fallback++
    if (r.timedOut) st.timeouts++
    total += r.cost
    const flag = r.fallback ? ' ⚠ FALLBACK' : r.retried ? ' (retry)' : ''
    console.log(`${String(moves.length).padStart(3)}. ${pos.turn === 'b' ? 'W' : 'B'} ${r.san.padEnd(7)} ${(r.ms / 1000).toFixed(1).padStart(5)}s $${r.cost.toFixed(5)}${flag}${r.rejected ? ` rejected=${JSON.stringify(r.rejected)}` : ''}  ${r.why ?? ''}`)
  }
  const end = pos.end ?? (moves.length >= CHESS_HARNESS.plyCap ? { reason: 'cap', winner: 'draw' } : null)
  console.log(`\nResult: ${end ? `${end.winner} (${end.reason})` : 'unfinished'} after ${moves.length} plies, $${total.toFixed(4)}`)
  console.log(`PGN: ${sanLine(pos.sanHistory)}`)
  console.log(`Final FEN: ${pos.fen}`)
  stats.forEach((s, i) => console.log(`${i === 0 ? 'White' : 'Black'} ${seats[i].model.display_name}: ${s.moves} moves, ${s.retried} retried, ${s.fallback} fallbacks, ${s.timeouts} timeouts, $${s.cost.toFixed(4)}, avg ${(s.ms / Math.max(1, s.moves) / 1000).toFixed(1)}s`))
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
