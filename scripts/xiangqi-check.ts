// scripts/xiangqi-check.ts — XGame 象棋's checks (Oct 20). No database, no
// spend: the rules through ffish, the move names (WXF ↔ 炮二平五), reading a
// model's move in every form, the turn logic with a scripted model, and the
// prompt. Run: npx tsx scripts/xiangqi-check.ts

import { xiangqiEngine } from '../lib/xiangqi-engine'
import { wxfToChinese, toWxf, XIANGQI_HARNESS, parseFen, squareXY, squareName } from '../lib/xiangqi-board'
import { xiangqiPrompt, readReply, playAiTurn, type AskFn } from '../lib/xiangqi-turn'

let fails = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) fails++
}

;(async () => {
  const e = await xiangqiEngine()
  const start = e.position([])

  // ── the start ─────────────────────────────────────────────────────────
  ok(start.legalUci.length === 44, `44 legal opening moves (${start.legalUci.length})`)
  ok(start.turn === 'w' && !start.check && !start.end, 'Red moves first, no check, not over')
  const i = start.legalUci.indexOf('h3e3')
  ok(i >= 0 && start.legalWxf[i] === 'C2=5', 'h3e3 is C2=5')
  ok(wxfToChinese('C2=5', 'w', 'zh-Hant') === '炮二平五', 'C2=5 reads 炮二平五')
  ok(wxfToChinese('H8+7', 'b', 'zh-Hant') === '馬８進７', 'Black H8+7 reads 馬８進７')
  ok(wxfToChinese('H8+7', 'b', 'zh-Hans') === '马８进７', '... and 马８进７ in simplified')
  ok(wxfToChinese('C-=9', 'w', 'zh-Hant') === '後炮平九' && wxfToChinese('C+=9', 'b', 'zh-Hans') === '前炮平９', 'two on one file: 後炮平九 / 前炮平９')
  ok(squareName(...squareXY('e1')!) === 'e1' && squareXY('e10')![1] === 0, 'squares round-trip; rank 10 is the top row')
  ok(parseFen(start.fen).grid[9][4] === 'K' && parseFen(start.fen).grid[0][4] === 'k', 'generals on e1 and e10')

  // Every opening move's Chinese name reads back as the same WXF, both scripts.
  const round = start.legalWxf.every(w => toWxf(wxfToChinese(w, 'w', 'zh-Hant')) === w && toWxf(wxfToChinese(w, 'w', 'zh-Hans')) === w)
  ok(round, 'every opening move: WXF → Chinese → WXF')

  // ── reading a model's move ────────────────────────────────────────────
  const r = (s: string) => { const x = e.resolve(start, s); return 'error' in x ? null : x.uci }
  ok(r('h3e3') === 'h3e3' && r('H3-E3') === 'h3e3', 'coordinates, any case, with a dash')
  ok(r('C2=5') === 'h3e3' && r('c2.5') === 'h3e3', 'WXF, = or .')
  ok(r('炮二平五') === 'h3e3' && r('炮2平5') === 'h3e3', 'Chinese, Chinese or Arabic numerals')
  ok(r('h2e2') === null && r('e1e3') === null, 'illegal moves are refused')
  ok(r('h3e3 (C2=5)') === 'h3e3' && r('h3e3（C2=5）') === 'h3e3', 'a move copied with its WXF name in brackets')
  const afterC = e.position(['h3e3'])
  const rb = (s: string) => { const x = e.resolve(afterC, s); return 'error' in x ? null : x.uci }
  ok(rb('馬8進7') === 'h10g8' && rb('马８进７') === 'h10g8' && rb('h10g8') === 'h10g8', 'Black: 馬8進7 = h10g8, two-digit rank read')

  // ── the end ───────────────────────────────────────────────────────────
  // Red mates with a chariot: black general d10 alone, red chariot to d2.
  const mate = e.position(['e2d2'], '3k5/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1')
  ok(!!mate.end && mate.end.reason === 'checkmate' && mate.end.winner === 'red', 'checkmate ends it for Red')
  // 困斃: Black to move, not in check, no legal move — Black LOSES.
  const stuck = e.position([], '3k5/R8/9/9/9/9/9/9/9/4RK3 b - - 0 1')
  ok(!stuck.check && !!stuck.end && stuck.end.reason === 'stalemate' && stuck.end.winner === 'red', 'no legal move and no check: the side to move loses')
  // Flying generals: the chariot between the generals may not leave the file.
  const fly = e.position([], '4k4/9/9/9/4R4/9/9/9/9/4K4 w - - 0 1')
  ok(!fly.legalUci.includes('e6d6') && fly.legalUci.includes('e6e7'), 'flying generals: the screening chariot stays on the file')
  const bare = e.position([], '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1')
  ok(!!bare.end && bare.end.winner === 'draw', `two bare generals is a draw (${bare.end?.reason})`)

  // ── the turn ──────────────────────────────────────────────────────────
  const scripted = (replies: Array<string | { timeout: true }>): AskFn => {
    let k = 0
    return async () => {
      const x = replies[Math.min(k++, replies.length - 1)]
      if (typeof x !== 'string') return { text: '', cost: 0, timedOut: true }
      return { text: x, cost: 0.001, timedOut: false }
    }
  }
  const a = await playAiTurn(e, start, scripted(['{"why":"central cannon","move":"h3e3"}']))
  ok(a.uci === 'h3e3' && a.wxf === 'C2=5' && !a.fallback && !a.retried, 'a legal move is played as given')
  const b = await playAiTurn(e, start, scripted(['{"why":"x","move":"e1e3"}', '{"why":"y","move":"炮二平五"}']))
  ok(b.uci === 'h3e3' && b.retried && !b.fallback && b.rejected?.[0] === 'e1e3', 'an illegal move is retried once; Chinese accepted')
  const c = await playAiTurn(e, start, scripted(['nonsense', '{"move":"z9z9"}']))
  ok(c.fallback && start.legalUci.includes(c.uci), 'two misses: a legal marked fallback')
  const d = await playAiTurn(e, start, scripted([{ timeout: true }]))
  ok(d.fallback && !d.retried && !!d.timedOut, 'a timeout is not retried')
  ok(readReply('```json\n{"why":"w","move":"b1c3"}\n```').move === 'b1c3', 'fenced JSON reads')

  // ── the prompt ────────────────────────────────────────────────────────
  const p = xiangqiPrompt(afterC, null)
  ok(p.includes('as Black') && p.includes('h3e3 (C2=5)') && p.includes('river'), 'the prompt names the side, the record with WXF, the river')
  ok(!/"move":\s*"[a-i]\d/.test(p) && !/like h3e3/.test(p), 'no sample coordinate anywhere a model could copy')
  ok(!xiangqiPrompt(start, null).includes('Your legal moves'), 'prompt v2: no legal list on the first ask')
  const rp = xiangqiPrompt(start, '"e1e3" is not a legal move in this position')
  ok(rp.includes('Your legal moves (all of them): ') && rp.includes('h3e3 (C2=5)') && rp.indexOf('Your legal moves') < rp.indexOf('rejected'), 'prompt v2: the retry lists every legal move with its WXF name')
  ok(XIANGQI_HARNESS.timeoutSec === 90 && XIANGQI_HARNESS.plyCap === 200 && XIANGQI_HARNESS.legalList === 'retry' && XIANGQI_HARNESS.version === 2, 'harness v2: 90 s, 200 plies, the legal list on the retry')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})()
