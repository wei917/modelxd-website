// scripts/chess-check.ts — the chess rules wrapper (lib/chess-engine.ts)
// against positions with known answers: mates, stalemate, castling, en
// passant, promotion, the draws, reading moves the way models write them, and
// the AI turn's retry / fallback logic with a scripted model. No network, no
// database, no spend. Run: npx tsx scripts/chess-check.ts

import { chessEngine, fallbackMove, type ChessPosition } from '../lib/chess-engine'
import { boardText, pieceList, parseFen, sanLine } from '../lib/chess-board'
import { playAiTurn, readReply, chessPrompt, type AskFn } from '../lib/chess-turn'

let failed = 0, passed = 0
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) { passed++; return }
  failed++
  console.error(`✗ ${label}`, extra ?? '')
}

async function main() {
  const t0 = Date.now()
  const eng = await chessEngine()
  console.log(`ffish loaded in ${Date.now() - t0} ms — ${eng.info()}`)

  // Replay a SAN line through resolve(), the way the route applies moves.
  const play = (sans: string[], startFen?: string) => {
    const uci: string[] = []
    let pos = eng.position(uci, startFen)
    for (const s of sans) {
      const r = eng.resolve(pos, s)
      if ('error' in r) throw new Error(`${s}: ${r.error}`)
      uci.push(r.uci)
      pos = eng.position(uci, startFen)
    }
    return { pos, uci }
  }
  const at = (pos: ChessPosition, sq: string) => {
    const { grid } = parseFen(pos.fen)
    return grid[8 - Number(sq[1])]['abcdefgh'.indexOf(sq[0])]
  }

  // ── start position ──
  const start = eng.position([])
  ok(start.legalUci.length === 20 && start.legalSan.length === 20, 'start: 20 legal moves', start.legalUci.length)
  ok(start.turn === 'w' && !start.check && !start.end, 'start: white to move, no check, not over')
  ok(start.legalSan.includes('Nf3') && start.legalUci.includes('g1f3'), 'start: Nf3 / g1f3 listed')
  ok(start.legalSan[start.legalUci.indexOf('g1f3')] === 'Nf3', 'start: SAN and UCI lists are pairwise')

  // ── mates ──
  const fools = play(['f3', 'e5', 'g4', 'Qh4#']).pos
  ok(fools.end?.reason === 'checkmate' && fools.end.winner === 'black', "fool's mate: black mates", fools.end)
  ok(fools.check && fools.legalUci.length === 0, "fool's mate: in check, no legal moves")
  const scholar = play(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  ok(scholar.pos.end?.reason === 'checkmate' && scholar.pos.end.winner === 'white', "scholar's mate: white mates", scholar.pos.end)
  ok(scholar.pos.sanHistory.join(' ') === 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#', 'scholar: SAN history rebuilt', scholar.pos.sanHistory)
  ok(sanLine(scholar.pos.sanHistory).startsWith('1. e4 e5 2. Bc4 Nc6'), 'sanLine numbers moves')
  const backRank = play(['Re8#'], '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1').pos
  ok(backRank.end?.reason === 'checkmate' && backRank.end.winner === 'white', 'back-rank mate', backRank.end)

  // ── stalemate ──
  const stale0 = eng.position([], '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  ok(stale0.end?.reason === 'stalemate' && stale0.end.winner === 'draw', 'stalemate: given position', stale0.end)
  const stale1 = play(['Qf7'], '7k/8/5QK1/8/8/8/8/8 w - - 0 1').pos
  ok(stale1.end?.reason === 'stalemate', 'stalemate: reached by Qf7', stale1.end)
  ok(!stale1.check, 'stalemate: not in check')

  // ── castling ──
  const cfen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  const c0 = eng.position([], cfen)
  ok(c0.legalSan.includes('O-O') && c0.legalSan.includes('O-O-O'), 'castling: both sides legal', c0.legalSan)
  for (const form of ['O-O', '0-0', 'o-o', 'e1g1', 'e1-g1']) {
    const r = eng.resolve(c0, form)
    ok(!('error' in r) && r.uci === 'e1g1' && r.san === 'O-O', `castling: "${form}" reads as O-O`, r)
  }
  const long = eng.resolve(c0, '0-0-0')
  ok(!('error' in long) && long.uci === 'e1c1', 'castling: 0-0-0 reads as e1c1', long)
  const afterOO = play(['O-O'], cfen).pos
  ok(at(afterOO, 'g1') === 'wK' && at(afterOO, 'f1') === 'wR' && at(afterOO, 'h1') === null, 'castling: king g1, rook f1', afterOO.fen)
  ok(/^\S+ b kq /.test(afterOO.fen), 'castling: white loses both rights', afterOO.fen)
  const through = eng.position([], '4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1')
  ok(!through.check && !through.legalSan.includes('O-O') && through.legalSan.includes('O-O-O'), 'castling: not through f1 covered by a rook on f2', through.legalSan)
  const blocked = eng.position([], '4k3/8/8/8/8/8/8/R3KB1R w KQ - 0 1')
  ok(!blocked.legalSan.includes('O-O') && blocked.legalSan.includes('O-O-O'), 'castling: blocked by a bishop on f1', blocked.legalSan)
  const inCheck = eng.position([], '4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1')
  ok(inCheck.check && !inCheck.legalSan.some(m => m.startsWith('O-O')), 'castling: not out of check', inCheck.legalSan)
  const rookCovers = eng.position([], '4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1')
  ok(!rookCovers.legalSan.includes('O-O'), 'castling: not across g1 covered by a rook on g2', rookCovers.legalSan)

  // ── en passant ──
  const ep = play(['e4', 'a6', 'e5', 'd5'])
  ok(ep.pos.legalSan.includes('exd6'), 'en passant: exd6 available', ep.pos.legalSan)
  ok(/ d6 /.test(ep.pos.fen), 'en passant: FEN target d6', ep.pos.fen)
  const epRead = eng.resolve(ep.pos, 'exd6 e.p.')
  ok(!('error' in epRead) && epRead.uci === 'e5d6', 'en passant: "exd6 e.p." reads as e5d6', epRead)
  const afterEp = play(['e4', 'a6', 'e5', 'd5', 'exd6']).pos
  ok(at(afterEp, 'd6') === 'wP' && at(afterEp, 'd5') === null, 'en passant: captured pawn removed', afterEp.fen)
  const late = play(['e4', 'a6', 'e5', 'd5', 'Nf3', 'h6']).pos
  ok(!late.legalSan.includes('exd6'), 'en passant: gone a move later', late.legalSan)

  // ── promotion ──
  const pfen = 'r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1'
  const p0 = eng.position([], pfen)
  for (const s of ['b8=Q', 'bxa8=N']) ok(p0.legalSan.some(m => m.replace(/[+#]/g, '') === s), `promotion: ${s} listed`, p0.legalSan)
  const forms: Array<[string, string]> = [['b8=Q', 'b7b8q'], ['b8Q', 'b7b8q'], ['b7b8', 'b7b8q'], ['b7b8n', 'b7b8n'], ['b8=N', 'b7b8n'], ['bxa8=R', 'b7a8r'], ['b7a8', 'b7a8q']]
  for (const [form, want] of forms) {
    const r = eng.resolve(p0, form)
    ok(!('error' in r) && r.uci === want, `promotion: "${form}" reads as ${want}`, r)
  }
  const under = play(['b8=N'], pfen).pos
  ok(at(under, 'b8') === 'wN' && at(under, 'b7') === null, 'promotion: knight on b8', under.fen)
  const queen = play(['bxa8=Q'], pfen).pos
  ok(at(queen, 'a8') === 'wQ' && queen.check, 'promotion: queen takes a8 with check', queen.fen)

  // ── draws ──
  const rep = play(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']).pos
  ok(rep.end?.reason === 'threefold' && rep.end.winner === 'draw', 'threefold repetition', rep.end)
  const twice = play(['Nf3', 'Nf6', 'Ng1', 'Ng8']).pos
  ok(!twice.end, 'twofold is not a draw yet', twice.end)
  const fifty = play(['Rf2'], '7k/8/6K1/8/8/8/8/5R2 w - - 99 80').pos
  ok(fifty.end?.reason === 'fifty', '50-move rule at 100 half-moves', fifty.end)
  const kvk = eng.position([], '7k/8/6K1/8/8/8/8/8 w - - 0 1')
  ok(kvk.end?.reason === 'insufficient', 'insufficient: K v K', kvk.end)
  const kbk = play(['Kxh7'], '8/7r/6K1/8/8/8/8/k4B2 w - - 0 1').pos
  ok(kbk.end?.reason === 'insufficient', 'insufficient: K+B v K after the last capture', kbk.end)
  const krk = eng.position([], '7k/8/6K1/8/8/8/8/5R2 w - - 0 1')
  ok(!krk.end, 'K+R v K is not a draw')

  // ── reading moves ──
  const s0 = eng.position([])
  const reads: Array<[string, string | null]> = [
    ['Nf3', 'g1f3'], ['Nf3+', 'g1f3'], ['nf3', 'g1f3'], ['Ngf3', 'g1f3'], ['1. e4', 'e2e4'], ['"e4"', 'e2e4'],
    ['e2e4', 'e2e4'], ['E4', null], ['e5', null], ['Qh9', null], ['', null], ['Ke2', null],
  ]
  for (const [form, want] of reads) {
    const r = eng.resolve(s0, form)
    ok(want ? (!('error' in r) && r.uci === want) : 'error' in r, `read "${form}" → ${want ?? 'refused'}`, r)
  }
  const twoKnights = eng.position([], '4k3/8/8/8/8/8/8/2N1K1N1 w - - 0 1')
  const amb = eng.resolve(twoKnights, 'Ne2')
  ok('error' in amb && /could mean/.test(amb.error), 'read: ambiguous Ne2 refused with both options', amb)
  const dis = eng.resolve(twoKnights, 'Nge2')
  ok(!('error' in dis) && dis.uci === 'g1e2', 'read: Nge2 disambiguated', dis)
  const capNoX = eng.resolve(play(['e4', 'd5']).pos, 'ed5')
  ok(!('error' in capNoX) && capNoX.uci === 'e4d5', 'read: "ed5" without x', capNoX)
  const bishopB = eng.position([], '4k3/8/8/8/8/8/1P6/2B1K3 w - - 0 1')
  const bb = eng.resolve(bishopB, 'bb2')
  ok('error' in bb, 'read: "bb2" is neither a pawn move nor a legal bishop move here', bb)

  // ── fallback ──
  const fb1 = fallbackMove(scholar.pos.end ? eng.position(scholar.uci.slice(0, 4)) : s0)
  const fb2 = fallbackMove(eng.position(scholar.uci.slice(0, 4)))
  const p4 = eng.position(scholar.uci.slice(0, 4))
  ok(p4.legalUci.includes(fb1.uci) && fb1.uci === fb2.uci, 'fallback: legal and deterministic', fb1)

  // ── records ──
  let threw = false
  try { eng.position(['e2e4', 'e2e4']) } catch { threw = true }
  ok(threw, 'an illegal game record throws')

  // ── the text the model reads ──
  const bt = boardText(start.fen)
  ok(bt.split('\n')[1] === '8 | r n b q k b n r |' && bt.includes('1 | R N B Q K B N R |'), 'boardText: rank 8 on top', bt)
  ok(pieceList(start.fen, 'w') === 'K e1; Q d1; R a1, h1; B c1, f1; N b1, g1; P a2, b2, c2, d2, e2, f2, g2, h2', 'pieceList: white', pieceList(start.fen, 'w'))

  // ── the AI turn (lib/chess-turn.ts) with a scripted model ──
  const r1 = readReply('Let me think... {"why": "Develop.", "move": "Nf3"} done')
  ok(r1.move === 'Nf3' && r1.why === 'Develop.', 'readReply: JSON inside prose', r1)
  const r2 = readReply('{"why": "The pawn, "move": "e4"')
  ok(r2.move === 'e4', 'readReply: broken JSON still yields the move', r2)
  ok(readReply('I think e4 is best').move === null, 'readReply: prose without the JSON is unreadable')
  const scripted = (...replies: Array<string | null>): { ask: AskFn; prompts: string[] } => {
    const prompts: string[] = []
    return {
      prompts,
      ask: async (prompt) => {
        prompts.push(prompt)
        const r = replies.shift()
        return r === null ? { text: '', cost: 0, timedOut: true } : { text: r ?? '', cost: 0.001, timedOut: false }
      },
    }
  }
  const okMove = scripted('{"why": "Center.", "move": "e4"}')
  const t1 = await playAiTurn(eng, s0, okMove.ask)
  ok(t1.uci === 'e2e4' && !t1.fallback && !t1.retried && t1.why === 'Center.' && t1.cost === 0.001, 'turn: a legal first answer is played', t1)
  const retry = scripted('{"why": "x", "move": "Qh9"}', '{"why": "Fine.", "move": "d4"}')
  const t2 = await playAiTurn(eng, s0, retry.ask)
  ok(t2.uci === 'd2d4' && t2.retried && !t2.fallback && t2.cost === 0.002 && t2.rejected?.[0] === 'Qh9', 'turn: one retry, then the move', t2)
  ok(retry.prompts[1].includes('Your previous answer was rejected: "Qh9" is not a legal move'), 'turn: the retry carries the reason', retry.prompts[1].split('\n').find(l => l.includes('rejected')))
  const misses = scripted('nonsense', '{"move": "Ke2"}')
  const t3 = await playAiTurn(eng, s0, misses.ask)
  ok(t3.fallback && t3.retried && s0.legalUci.includes(t3.uci) && t3.uci === fallbackMove(s0).uci && t3.rejected?.length === 2, 'turn: two misses play the marked fallback', t3)
  const silent = scripted(null, '{"move": "e4"}')
  const t4 = await playAiTurn(eng, s0, silent.ask)
  ok(t4.fallback && t4.timedOut && !t4.retried && silent.prompts.length === 1, 'turn: a timeout goes straight to the fallback (no retry)', t4)
  const checkPos = eng.position(['e2e4', 'f7f6', 'd2d4', 'g7g5'])
  const pr = chessPrompt(eng.position(['e2e4', 'd7d6', 'f1b5']), null)
  ok(pr.includes('You are in CHECK') && pr.includes('White just played Bb5+'), 'prompt: says check and the last move', pr.split('\n').filter(l => /CHECK|just played/.test(l)))
  // Harness v2: no legal list on the first ask; the retry carries all of them.
  ok(!chessPrompt(checkPos, null).includes('Your legal moves'), 'prompt v2: no legal list on the first ask')
  const rp = chessPrompt(checkPos, '"Qh9" is not a legal move in this position')
  ok(rp.includes('Your legal moves (all of them): ') && rp.includes('Qh5#') && rp.indexOf('Your legal moves') < rp.indexOf('rejected'), 'prompt v2: the retry lists every legal move, mate included, before the reason')
  ok(retry.prompts[0] && !retry.prompts[0].includes('Your legal moves') && retry.prompts[1].includes('Your legal moves'), 'turn v2: the first ask has no list, the retry has it')
  ok(!/Nf3|Bxe5/.test(chessPrompt(s0, null).split('Reply with ONLY')[1]), 'prompt: no example move a model could copy')

  // ── speed: a 200-ply record rebuilt per request ──
  const long200: string[] = []
  let p = eng.position([])
  for (let i = 0; i < 200 && !p.end; i++) { long200.push(fallbackMove(p).uci); p = eng.position(long200) }
  const tt = Date.now()
  for (let i = 0; i < 20; i++) eng.position(long200)
  console.log(`a ${long200.length}-ply record rebuilds in ${((Date.now() - tt) / 20).toFixed(1)} ms (ended: ${p.end?.reason ?? 'no'})`)

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
