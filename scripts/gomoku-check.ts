// scripts/gomoku-check.ts — the 五子棋 rebuild's checks (Oct 20). No
// database, no spend: the viewer marks, the reply reader, the turn logic with
// a scripted model (legal, retried, fallback, timeout), the prompt, and the
// two-game match score. Run: npx tsx scripts/gomoku-check.ts

import { emptyBoard, place, parseCoord, threats, type Board, type Stone } from '../lib/gomoku-engine'
import { gomokuPrompt, readReply, playAiTurn, type AskFn } from '../lib/gomoku-turn'
import { GOMOKU_HARNESS, matchScore, matchWinner, blackSeat, type GameResult } from '../lib/gomoku-match'

let fails = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) fails++
}

/** A board from coordinates: put('B', 'H8', 'I8') … */
function board(stones: Partial<Record<Stone, string[]>>): Board {
  let b = emptyBoard()
  for (const s of ['B', 'W'] as Stone[]) for (const c of stones[s] ?? []) {
    const p = parseCoord(c)!
    b = place(b, p[0], p[1], s)
  }
  return b
}
const marksAt = (b: Board, coord: string) => {
  const p = parseCoord(coord)!
  return threats(b).filter(t => t.at[0] === p[0] && t.at[1] === p[1])
}

// ── viewer marks ──────────────────────────────────────────────────────────
{
  const b = board({ B: ['E8', 'F8', 'G8', 'H8'] })
  ok(marksAt(b, 'D8').some(t => t.stone === 'B' && t.kind === 'win'), 'a four: the open end D8 is a win point for Black')
  ok(marksAt(b, 'I8').some(t => t.stone === 'B' && t.kind === 'win'), 'a four: the other end I8 too')
  ok(marksAt(b, 'J8').length === 0, 'no mark one point past the end')
}
{
  const b = board({ B: ['E8', 'F8', 'G8', 'I8'] })
  ok(marksAt(b, 'H8').some(t => t.stone === 'B' && t.kind === 'win'), 'a split four XXX.X: the gap is a win point')
}
{
  const b = board({ B: ['F8', 'G8', 'H8'] })
  ok(marksAt(b, 'E8').some(t => t.stone === 'B' && t.kind === 'four'), 'an open three: E8 makes an open four')
  ok(marksAt(b, 'I8').some(t => t.stone === 'B' && t.kind === 'four'), 'an open three: I8 makes an open four')
  ok(!threats(b).some(t => t.kind === 'win'), 'an open three has no win point yet')
}
{
  const b = board({ B: ['F8', 'G8', 'I8'] })
  ok(marksAt(b, 'H8').some(t => t.stone === 'B' && t.kind === 'four'), 'a split three X X.X: the gap makes an open four')
}
{
  const b = board({ B: ['F8', 'G8', 'H8'], W: ['E8'] })
  ok(!threats(b).some(t => t.stone === 'B' && t.kind === 'four'), 'a three blocked at one end makes no open four')
}
{
  const b = board({ W: ['D4', 'E5', 'F6', 'G7'] })
  ok(marksAt(b, 'C3').some(t => t.stone === 'W' && t.kind === 'win') && marksAt(b, 'H8').some(t => t.stone === 'W' && t.kind === 'win'), 'a diagonal four: both ends are win points for White')
}
{
  const b = board({ B: ['A1', 'A2', 'A3', 'A4'] })
  ok(marksAt(b, 'A5').some(t => t.kind === 'win'), 'a four on the edge: the one open end wins')
  ok(threats(emptyBoard()).length === 0, 'an empty board has no marks')
}

// ── reading a reply ───────────────────────────────────────────────────────
ok(readReply('{"why":"block","move":"H8"}').move === 'H8', 'plain JSON')
ok(readReply('```json\n{"why":"x","move":"h8"}\n```').move === 'h8', 'fenced JSON')
ok(readReply('I think {"why": "take the center", "move": "H8"} is best').why === 'take the center', 'prose around the JSON keeps the reason')
ok(readReply('{"why": "Block the four", "move": "K12"').move === 'K12', 'a reply cut off after the move still reads')
ok(readReply('no idea').move === null, 'no move in prose')

// ── the turn ──────────────────────────────────────────────────────────────
const scripted = (replies: Array<string | { timeout: true }>): AskFn => {
  let i = 0
  return async () => {
    const r = replies[Math.min(i++, replies.length - 1)]
    if (typeof r !== 'string') return { text: '', cost: 0, timedOut: true }
    return { text: r, cost: 0.001, timedOut: false }
  }
}
const mid = board({ B: ['H8'], W: ['H9'] })
;(async () => {
  const a = await playAiTurn(mid, 'B', [{ stone: 'B', coord: 'H8' }, { stone: 'W', coord: 'H9' }], [8, 7], scripted(['{"why":"extend","move":"I8"}']))
  ok(a.coord === 'I8' && !a.fallback && !a.retried && a.why === 'extend', 'a legal move is played as given')

  const b = await playAiTurn(mid, 'B', [], [8, 7], scripted(['{"why":"x","move":"H9"}', '{"why":"y","move":"G8"}']))
  ok(b.coord === 'G8' && b.retried && !b.fallback && b.rejected?.[0] === 'H9', 'an occupied point is retried once with the reason')

  const c = await playAiTurn(mid, 'B', [], [8, 7], scripted(['{"why":"x","move":"Z99"}', 'nonsense']))
  ok(c.fallback && c.retried, 'two misses: the marked fallback')
  ok(mid[parseCoord(c.coord)![0]][parseCoord(c.coord)![1]] === '.', 'the fallback is an empty point')

  const d = await playAiTurn(mid, 'B', [], [8, 7], scripted([{ timeout: true }]))
  ok(d.fallback && !d.retried && !!d.timedOut, 'a timeout is not retried: fallback at once')

  // ── the prompt ──────────────────────────────────────────────────────────
  const p1 = gomokuPrompt(emptyBoard(), 'B', [], null)
  const p2 = gomokuPrompt(board({ B: ['H8', 'I9', 'J10', 'G8', 'F8'], W: ['H9', 'I8', 'K11', 'E8', 'D8'] }), 'B', [], 'x')
  ok(!/"lines"/.test(p1), 'no "lines" field any more')
  ok(!/"move":\s*"[A-O]\d/.test(p1), 'no example coordinate in the reply shape')
  ok(p2.length - p1.length < 400, `the prompt grows only with the stone lists (${p1.length} → ${p2.length} chars)`)
  ok(p1.includes('Black (B)') && p1.includes('row 1 at the TOP'), 'the side and the board orientation are stated')

  // ── the match ───────────────────────────────────────────────────────────
  const g = (winner: 0 | 1 | null, n: 1 | 2): GameResult => ({ winner, black: blackSeat(n), plies: 30, reason: winner === null ? 'cap' : 'five' })
  ok(blackSeat(1) === 0 && blackSeat(2) === 1, 'seat 0 plays Black in game 1, seat 1 in game 2')
  ok(JSON.stringify(matchScore([g(0, 1), g(0, 2)])) === '[2,0]' && matchWinner([g(0, 1), g(0, 2)]) === 'seat0', '2-0 is a match win')
  ok(matchWinner([g(0, 1), g(1, 2)]) === 'draw', '1-1 (each wins with Black) is a drawn match')
  ok(JSON.stringify(matchScore([g(null, 1), g(1, 2)])) === '[0.5,1.5]' && matchWinner([g(null, 1), g(1, 2)]) === 'seat1', 'a draw is half a point each')
  ok(matchWinner([g(0, 1)]) === null, 'no match winner after one game')
  ok(GOMOKU_HARNESS.timeoutSec === 90 && GOMOKU_HARNESS.games === 2 && !GOMOKU_HARNESS.hints, 'harness: 90 s, two games, no hints')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})()
