// scripts/xgame-speed-test.ts — which models are fast enough for each XGame
// table (Oct 20; owner: "we should set rule per game. and we test it.
// borderline is ok, limit 30 but 32 is ok but 36 is not").
//
// For every enabled chat model, for each game (chess, 象棋, 五子棋, poker,
// bridge), at each thinking level: three real test moves built by that
// game's own prompt code and sent through that game's own ask function. A
// level passes when two of the three replies come back READABLE within the
// game's limit plus margin (lib/xgame-speed.ts: 30 s + 10% = 33 s; see
// testLevel). A reply still running at 36 s is cut (too slow). Levels are
// tried from the model's default up its declared list; the first failing level
// ends that model's climb for that game (higher levels think longer).
// Qwen-style on/off levels are both tried.
//
// Writes lib/xgame-speed-results.ts (merged with what is there) and prints
// a table. Real calls at list price, paid by the house, stopped at the cap.
// A call cut at 36 s keeps running at the provider, so the cap counts it at
// a conservative guess (its prompt plus 4,000 output tokens); the real spend
// is in provider_calls (surface xgame-*, user_id null) afterwards. A model
// the cap interrupts is left out of the results, so a rerun with --only
// picks it up.
//
//   npx tsx --env-file=.env.local scripts/xgame-speed-test.ts [--cap 40] [--games chess,poker]
//     [--only "GPT-6 Luna,Claude Opus 5"] [--skip "GPT-5.5 Pro"] [--auto-only] [--dry]

import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { ModelInfo } from '../lib/providers'
import { seatThinking } from '../lib/game-thinking'
import { passMs, SPEED_GAMES, type SpeedGame } from '../lib/xgame-speed'
import { XGAME_SPEED } from '../lib/xgame-speed-results'
// chess
import { chessEngine } from '../lib/chess-engine'
import { chessPrompt, readReply as chessRead, providerAsk as chessAsk } from '../lib/chess-turn'
// 象棋
import { xiangqiEngine } from '../lib/xiangqi-engine'
import { xiangqiPrompt, readReply as xqRead, providerAsk as xqAsk } from '../lib/xiangqi-turn'
// 五子棋
import { emptyBoard, place, parseCoord, type Board, type Stone } from '../lib/gomoku-engine'
import { gomokuPrompt, readReply as gkRead, providerAsk as gkAsk } from '../lib/gomoku-turn'
// poker
import { newGame as pokerGame, dealNext as pokerDeal, snapshot, apply as pokerApply } from '../lib/poker-engine'
import { buildPrompt as pokerPrompt, parseReply as pokerRead, askOnce as pokerAskOnce } from '../lib/poker-ai'
// bridge
import { dealHands, dealerOf, vulOf, legalCalls, readCall, readCard, type AuctionEntry, type Seat } from '../lib/bridge-engine'
import { biddingPrompt, playPrompt, readReply as brRead, askOnce as brAskOnce } from '../lib/bridge-ai'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const CAP = Number(arg('--cap') ?? 40)
const GAMES = (arg('--games')?.split(',') ?? SPEED_GAMES) as SpeedGame[]
const ONLY = arg('--only') ? new Set(arg('--only')!.split(',').map(x => x.trim())) : null   // display names or ids
const SKIP = new Set((arg('--skip') ?? '').split(',').map(x => x.trim()).filter(Boolean))
const DRY = process.argv.includes('--dry')
const AUTO_ONLY = process.argv.includes('--auto-only')   // a smoke run: each model's default level only
const CUT_MS = 36_000
const CONCURRENCY = 6

let spent = 0   // this script's own estimate; the cap reads provider_calls
type Sample = { prompt: string; reuse?: boolean; run: (model: ModelInfo, thinking: string | null) => Promise<{ text: string; cost: number }>; readable: (text: string) => boolean }

function race<T>(p: Promise<T>, ms: number): Promise<T | 'cut'> {
  return Promise.race([p, new Promise<'cut'>(r => setTimeout(() => r('cut'), ms))])
}

/** A seeded shuffle, so every model sees the same bridge deal. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

async function samplesFor(game: SpeedGame): Promise<Sample[]> {
  if (game === 'chess') {
    const e = await chessEngine()
    // Three middlegames (Oct 21): opening positions are answered fast by
    // every model, so a test that counted them passed models that took over
    // 36 s on a real middlegame. The first is the first run's own position,
    // so its result is reused (see testLevel).
    const lines = [
      'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7 a1c1 c7c6 f1d3 d5c4 d3c4 f6d5',               // Queen's Gambit Declined
      'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6 f2f3 f8e7 d1d2 e8g8 e1c1 b8d7',   // Najdorf, English Attack
      'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c6a5 b3c2 c7c5 d2d4 d8c7', // Closed Ruy Lopez
    ].map(l => l.split(' '))
    return lines.map((m, i) => {
      const pos = e.position(m)
      return {
        reuse: i === 0,
        prompt: chessPrompt(pos, null),
        run: async (model, thinking) => chessAsk(model, { userId: null, thinking })(chessPrompt(pos, null)),
        readable: text => !!chessRead(text).move,
      }
    })
  }
  if (game === 'xiangqi') {
    const e = await xiangqiEngine()
    // Three middlegames, as in chess; the first is the first run's own.
    const lines = [
      'h3e3 h10g8 e3e7 a10a8 b3b10 a8a9 e7e6 i10i9 b1c3 a9a8',
      'h3e3 h10g8 h1g3 i10h10 i1h1 g7g6 h1h5 b10c8 b1c3 b8b4 c4c5 c10e8 a1b1 a10b10 e3e7 g8e7',   // 中炮過河車對屏風馬
      'h3e3 h8e8 h1g3 h10g8 i1h1 i10h10 b1c3 b10c8 a1b1 a10b10 h1h5 b8b4',                       // 順炮直車
    ].map(l => l.split(' '))
    return lines.map((m, i) => {
      const pos = e.position(m)
      return {
        reuse: i === 0,
        prompt: xiangqiPrompt(pos, null),
        run: async (model, thinking) => xqAsk(model, { userId: null, thinking })(xiangqiPrompt(pos, null)),
        readable: text => !!xqRead(text).move,
      }
    })
  }
  if (game === 'gomoku') {
    // Three middle-game boards of 12-14 stones (Oct 21; the first run's
    // empty and four-stone boards were answered at once).
    const seqs = [
      'H8 H9 I8 G8 I9 J10 G7 F6 I10 I7 J9 K10',
      'H8 G9 I9 G7 G8 F8 H7 H6 I6 J5 I8 I7 J8 K8',
      'H8 I9 G9 G7 H10 H9 I10 J11 G10 F10 I8 J7 F9 E8',
    ].map(l => l.split(' '))
    return seqs.map(seq => {
      let b: Board = emptyBoard()
      const moves = seq.map((c, i) => ({ stone: (i % 2 === 0 ? 'B' : 'W') as Stone, coord: c }))
      for (const m of moves) { const p = parseCoord(m.coord)!; b = place(b, p[0], p[1], m.stone) }
      const stone: Stone = seq.length % 2 === 0 ? 'B' : 'W'
      const prompt = gomokuPrompt(b, stone, moves, null)
      return {
        prompt,
        run: async (model, thinking) => gkAsk(model, { userId: null, thinking })(prompt),
        readable: text => { const m = gkRead(text).move; return !!m && !!parseCoord(m) },
      }
    })
  }
  if (game === 'poker') {
    const g = pokerGame(4, 10)
    pokerDeal(g, { button: 0 })
    const seats = [0, 1, 2, 3].map(s => ({ seat: s, name: `Seat ${s + 1}`, isHuman: false }))
    const prompts: string[] = []
    const take = () => { const s = snapshot(g)!; prompts.push(pokerPrompt(g, s.toAct!, seats, 'en', null)!) }
    take()                                                     // first to act, preflop
    const s1 = snapshot(g)!
    pokerApply(g, s1.toAct!, { act: 'raise', amount: s1.legal!.raise!.min })
    take()                                                     // facing a raise
    for (let k = 0; k < 8 && snapshot(g)!.street === 'preflop'; k++) {
      const s = snapshot(g)!
      pokerApply(g, s.toAct!, s.legal!.canCheck ? { act: 'check' } : { act: 'call' })
    }
    take()                                                     // on the flop
    return prompts.map(prompt => ({
      prompt,
      run: async (model, thinking) => pokerAskOnce(model, prompt, thinking, null as any, CUT_MS),
      readable: text => !!pokerRead(text).decision,
    }))
  }
  // bridge: the same seeded deal for every model
  const hands = dealHands(seeded(20261020))
  const board = 1, dealer = dealerOf(board) as Seat, vul = vulOf(board)
  const A = (calls: string[]): AuctionEntry[] => calls.map((call, i) => ({ seat: ((dealer + i) % 4) as Seat, call }))
  const open = biddingPrompt({ seat: dealer, board, dealer, vul, hand: hands[dealer], auction: [], legal: legalCalls([], dealer), objection: null })
  const a2 = A(['1NT', 'P'])
  const seat2 = ((dealer + 2) % 4) as Seat
  const respond = biddingPrompt({ seat: seat2, board, dealer, vul, hand: hands[seat2], auction: a2, legal: legalCalls(a2, seat2), objection: null })
  const a3 = A(['1NT', 'P', '3NT', 'P', 'P', 'P'])
  const leader = ((dealer + 1) % 4) as Seat
  const lead = playPrompt({ seat: leader, board, dealer, vul, auction: a3, contract: { level: 3, strain: 'NT', doubled: 0, declarer: dealer }, plays: [], from: leader, own: hands[leader], dummy: null, legal: hands[leader], objection: null })
  return [
    { prompt: open, run: (m, t) => brAskOnce(m, open, 'call', t, null, CUT_MS), readable: text => !!readCall(brRead(text, 'call').value ?? '') },
    { prompt: respond, run: (m, t) => brAskOnce(m, respond, 'call', t, null, CUT_MS), readable: text => !!readCall(brRead(text, 'call').value ?? '') },
    { prompt: lead, run: (m, t) => brAskOnce(m, lead, 'card', t, null, CUT_MS), readable: text => !!readCard(brRead(text, 'card').value ?? '') },
  ]
}

type LevelResult = { pass: boolean; ms: number[]; note?: string }

function cutCost(model: ModelInfo, prompt: string): number {
  const t: any = (model.model_pricing as any)?.tokens ?? {}
  const o = t.text_output
  const out = typeof o === 'number' ? o : Number(o?.default) || 0
  return ((prompt.length / 3) * (Number(t.text_input) || 0) + 4000 * out) / 1e6
}

/** The first run's answer on its first position (the same prompt as this
 *  run's first sample), when it can be read off unambiguously. */
function priorFirst(prior: LevelResult | undefined, limit: number): { ok: boolean; ms: number; why?: string } | null {
  if (!prior?.ms.length) return null
  const ms = prior.ms[0]
  if (ms > limit) return { ok: false, ms, why: ms >= CUT_MS - 100 ? 'still thinking at 36 s' : `over the limit (${(ms / 1000).toFixed(1)} s)` }
  if (prior.pass && prior.ms.length === 2) return { ok: true, ms }
  if (!/no reply|could not be read/.test(prior.note ?? '')) return { ok: true, ms }
  return null
}

async function testLevel(model: ModelInfo, thinking: string | null, samples: Sample[], limit: number, prior?: LevelResult): Promise<LevelResult> {
  // Two of the three test moves must come back readable within the limit:
  // one slow move is luck (GPT-6 Luna took 22 s on a chess position once
  // and over 36 s on the same position another time, Oct 20). It stops as
  // soon as the answer is settled.
  const ms: number[] = []
  const misses: string[] = []
  let ok = 0
  for (const s of samples) {
    if (ok >= 2 || misses.length >= 2) break
    const p = s.reuse ? priorFirst(prior, limit) : null
    if (p) { ms.push(p.ms); if (p.ok) ok++; else misses.push(p.why!); continue }
    if (await overCap()) return { pass: false, ms, note: 'budget cap reached' }
    const t0 = Date.now()
    const r = await race(s.run(model, thinking), CUT_MS)
    const took = Date.now() - t0
    ms.push(took)
    if (r === 'cut') { const c = cutCost(model, s.prompt); spent += c; cuts.push({ at: Date.now(), usd: c }); misses.push('still thinking at 36 s'); continue }
    spent += r.cost
    if (!r.text.trim()) misses.push('no reply')
    else if (!s.readable(r.text)) misses.push('reply could not be read')
    else if (took > limit) misses.push(`over the limit (${(took / 1000).toFixed(1)} s)`)
    else ok++
  }
  return ok >= 2 ? { pass: true, ms, ...(misses.length ? { note: misses.join('; ') } : {}) } : { pass: false, ms, note: misses.join('; ') }
}

// The cap is real money: the house-paid rows of provider_calls since this
// run started (a call cut at 36 s is billed when the provider finishes it,
// up to 15 min later, so cuts of the last 15 min are added at an estimate).
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const RUN_START = new Date().toISOString()
const cuts: { at: number; usd: number }[] = []
let billed = 0, billedAt = 0
async function realSpend(): Promise<number> {
  if (Date.now() - billedAt > 20_000) {
    let sum = 0, from = 0
    for (;;) {
      const { data, error } = await sb.from('provider_calls').select('cost_usd').eq('event', 'end').is('user_id', null).gte('created_at', RUN_START).range(from, from + 999)
      if (error) throw new Error(`provider_calls: ${error.message}`)
      for (const r of data ?? []) sum += Number((r as any).cost_usd) || 0
      if (!data || data.length < 1000) break
      from += 1000
    }
    billed = sum; billedAt = Date.now()
  }
  return billed
}
async function overCap(): Promise<boolean> {
  const pending = cuts.filter(c => Date.now() - c.at < 15 * 60_000).reduce((n, c) => n + c.usd, 0)
  return (await realSpend()) + pending >= CAP
}

async function main() {
  const { data } = await sb.from('ai_models')
    .select('*')
    .eq('enabled', true).contains('output_modalities', ['text'])
  const models = ((data ?? []) as any[])
    .filter(m => (m.modes ?? []).includes('text_to_text'))
    .filter(m => !ONLY || ONLY.has(m.display_name) || ONLY.has(m.id))
    .filter(m => !SKIP.has(m.display_name) && !SKIP.has(m.id)) as ModelInfo[]
  const skippedIds = new Set(((data ?? []) as any[]).filter(m => SKIP.has(m.display_name) || SKIP.has(m.id)).map(m => m.id))
  console.log(`${models.length} models × ${GAMES.join(', ')}; pass = 2 of 3 test moves readable within the limit + 10%; cap $${CAP}${DRY ? ' (dry run: no calls)' : ''}`)
  const results: Record<string, Record<string, { name: string; levels: Record<string, LevelResult> }>> = JSON.parse(JSON.stringify(XGAME_SPEED.results))

  for (const game of GAMES) {
    const samples = await samplesFor(game)
    const limit = passMs(game)
    console.log(`\n── ${game}: limit ${limit / 1000} s, ${samples.length} test moves, prompt ~${Math.round(samples.reduce((n, s) => n + s.prompt.length, 0) / samples.length)} chars`)
    if (DRY) { console.log(samples[samples.length - 1].prompt.slice(0, 600) + '\n…'); continue }
    // The models tested now start over: one the cap interrupts is left
    // untested (hidden), never left on an earlier run's numbers. Models not
    // in this run (skipped, or outside --only) keep theirs.
    const testing = new Set(models.map(m => m.id))
    const before = XGAME_SPEED.results[game] ?? {}
    results[game] = Object.fromEntries(Object.entries(before).filter(([id]) => skippedIds.has(id) || !testing.has(id)))
    const queue = [...models]
    const worker = async () => {
      while (queue.length) {
        const m = queue.shift()!
        const declared: string[] = (m as any).output_config?.text?.thinking_levels ?? []
        const dflt = seatThinking(m, null)
        const levels: Record<string, LevelResult> = {}
        const prior = XGAME_SPEED.results[game]?.[m.id]?.levels ?? {}
        const auto = await testLevel(m, dflt, samples, limit, prior.auto)
        levels.auto = auto
        if (dflt) levels[dflt] = auto
        const onOff = declared.includes('thinking_true') && declared.includes('thinking_false')
        for (const lv of declared) {
          if (levels[lv]) continue
          if (AUTO_ONLY) break
          if (await overCap()) { levels[lv] = { pass: false, ms: [], note: 'budget cap reached' }; break }
          const r = await testLevel(m, lv, samples, limit, prior[lv])
          levels[lv] = r
          if (!r.pass && !onOff) break   // higher levels think longer
        }
        if (Object.values(levels).some(v => v.note === 'budget cap reached')) {
          console.log(`${m.display_name.padEnd(26)} not finished: the budget cap was reached`)
          continue
        }
        results[game][m.id] = { name: m.display_name, levels }
        const line = Object.entries(levels).map(([k, v]) => `${k}:${v.pass ? 'ok' : 'no'} [${v.ms.map(x => (x / 1000).toFixed(1)).join(' ')}]${v.note ? ` (${v.note})` : ''}`).join('  ')
        console.log(`${m.display_name.padEnd(26)} ${line}   (billed $${(await realSpend()).toFixed(2)})`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  if (!DRY && !AUTO_ONLY) {
    const body = `// lib/xgame-speed-results.ts — WRITTEN BY scripts/xgame-speed-test.ts; do
// not edit by hand. Per game, per model id, per thinking level ('auto' =
// the model's default): the test moves' times in ms and whether two of
// them came back readable within the game's limit plus margin
// (lib/xgame-speed.ts).

export const XGAME_SPEED = {
  measuredAt: ${JSON.stringify(new Date().toISOString())} as string | null,
  results: ${JSON.stringify(results, null, 2)} as Record<string, Record<string, { name: string; levels: Record<string, { pass: boolean; ms: number[]; note?: string }> }>>,
}
`
    writeFileSync('lib/xgame-speed-results.ts', body)
    console.log(`\nwrote lib/xgame-speed-results.ts`)
  }
  billedAt = 0
  console.log(`billed so far (provider_calls): $${(await realSpend()).toFixed(2)}; calls cut in the last 15 min may still add up to ~$${cuts.filter(c => Date.now() - c.at < 15 * 60_000).reduce((n, c) => n + c.usd, 0).toFixed(2)}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
