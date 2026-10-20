// scripts/xiangqi-ai-game.ts — one real AI-vs-AI 象棋 game through the
// route's own move code (lib/xiangqi-turn.ts playAiTurn + lib/xiangqi-engine.ts),
// without the database or the wallet. Spends real money at list price, so it
// stops at a budget.
//
//   npx tsx --env-file=.env.local scripts/xiangqi-ai-game.ts [red] [black] [budgetUsd]
//   (models by display name; defaults: "GPT-6 Luna" vs "Qwen 3.8 Flash", $1)
//   Thinking: RED_THINKING / BLACK_THINKING (default: what a game seat left
//   on auto gets, lib/game-thinking.ts).

import { createClient } from '@supabase/supabase-js'
import { xiangqiEngine } from '../lib/xiangqi-engine'
import { playAiTurn, providerAsk, XIANGQI_HARNESS } from '../lib/xiangqi-turn'
import { wxfToChinese } from '../lib/xiangqi-board'
import { seatThinking } from '../lib/game-thinking'

const [redName = 'GPT-6 Luna', blackName = 'Qwen 3.8 Flash', budgetArg = '1'] = process.argv.slice(2)
const BUDGET = Number(budgetArg) || 1

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const load = async (name: string) => {
    const { data } = await sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
      .eq('display_name', name).eq('enabled', true).maybeSingle()
    if (!data) throw new Error(`no enabled model named ${name}`)
    return data
  }
  const red = await load(redName), black = await load(blackName)
  const seats = [
    { model: red, thinking: seatThinking(red, process.env.RED_THINKING ?? null) },
    { model: black, thinking: seatThinking(black, process.env.BLACK_THINKING ?? null) },
  ]
  console.log(`Red: ${seats[0].model.display_name} (${seats[0].thinking ?? 'default'})  Black: ${seats[1].model.display_name} (${seats[1].thinking ?? 'default'})  budget $${BUDGET}`)

  const eng = await xiangqiEngine()
  const moves: string[] = []
  let pos = eng.position(moves)
  const stats = [0, 1].map(() => ({ moves: 0, retried: 0, fallback: 0, timeouts: 0, cost: 0, ms: 0 }))
  let total = 0
  while (!pos.end && moves.length < XIANGQI_HARNESS.plyCap) {
    if (total > BUDGET) { console.log(`\nBUDGET reached ($${total.toFixed(4)}): stopping`); break }
    const i = pos.turn === 'w' ? 0 : 1
    const seat = seats[i]
    const side = pos.turn
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
    console.log(`${String(moves.length).padStart(3)}. ${side === 'w' ? '紅' : '黑'} ${wxfToChinese(r.wxf, side, 'zh-Hant')} ${r.uci.padEnd(6)} ${(r.ms / 1000).toFixed(1).padStart(5)}s $${r.cost.toFixed(5)}${flag}${r.rejected ? ` rejected=${JSON.stringify(r.rejected)}` : ''}  ${r.why ?? ''}`)
  }
  const end = pos.end ?? (moves.length >= XIANGQI_HARNESS.plyCap ? { reason: 'cap', winner: 'draw' } : null)
  console.log(`\nResult: ${end ? `${end.winner} (${end.reason})` : 'unfinished'} after ${moves.length} plies, $${total.toFixed(4)}`)
  console.log(`Final FEN: ${pos.fen}`)
  stats.forEach((s, i) => console.log(`${i === 0 ? 'Red' : 'Black'} ${seats[i].model.display_name}: ${s.moves} moves, ${s.retried} retried, ${s.fallback} fallbacks, ${s.timeouts} timeouts, $${s.cost.toFixed(4)}, avg ${(s.ms / Math.max(1, s.moves) / 1000).toFixed(1)}s`))
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
