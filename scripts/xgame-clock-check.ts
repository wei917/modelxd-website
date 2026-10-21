// scripts/xgame-clock-check.ts — the two-person clocks (lib/xgame-clock.ts)
// and the seat rules (lib/xgame-duo.ts seatOf / tokenOk / isDuo), no network.
//   npx tsx scripts/xgame-clock-check.ts

import { afterMove, flagged, fmtClock, newClock, remaining, startClock } from '../lib/xgame-clock'
import { isDuo, seatOf, tokenOk } from '../lib/xgame-duo'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, got?: unknown) => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  (got ${JSON.stringify(got)})`}`)
}

const T0 = Date.parse('2026-10-21T12:00:00Z')
let c = newClock('chess')
ok('10 minutes each, 5 s increment', c.base === 600_000 && c.inc === 5_000 && c.left[0] === 600_000 && c.left[1] === 600_000)
ok('no time runs before the start', remaining(c, 0, 0, T0 + 60_000) === 600_000, remaining(c, 0, 0, T0 + 60_000))
ok('nobody is out of time before the start', !flagged(c, 0, T0 + 10 * 3600_000))
c = startClock(c, T0)
ok('White loses time on White\'s turn', remaining(c, 0, 0, T0 + 30_000) === 570_000, remaining(c, 0, 0, T0 + 30_000))
ok('Black keeps its time on White\'s turn', remaining(c, 1, 0, T0 + 30_000) === 600_000)
c = afterMove(c, 0, T0 + 30_000)
ok('a move adds the increment', c.left[0] === 575_000, c.left)
ok('Black\'s turn starts at the move', c.turnStart === new Date(T0 + 30_000).toISOString())
ok('White\'s time stops while Black thinks', remaining(c, 0, 1, T0 + 90_000) === 575_000)
ok('Black thinks 60 s', remaining(c, 1, 1, T0 + 90_000) === 540_000, remaining(c, 1, 1, T0 + 90_000))
ok('not out of time at 9:59', !flagged(c, 1, T0 + 30_000 + 599_000))
ok('out of time at exactly 10:00', flagged(c, 1, T0 + 30_000 + 600_000))
ok('a game over (no side to move) never flags', !flagged(c, null, T0 + 99 * 3600_000))
const late = afterMove(c, 1, T0 + 30_000 + 700_000)
ok('a move after the flag keeps no negative time (the server ends the game first)', late.left[1] === 5_000, late.left)
ok('clock text 9:58', fmtClock(598_400) === '9:58', fmtClock(598_400))
ok('clock text under 10 s shows tenths', fmtClock(7_340) === '0:07.3', fmtClock(7_340))
ok('clock text never negative', fmtClock(-5) === '0:00.0', fmtClock(-5))

const host = 'aaaaaaaa-0000-0000-0000-000000000000', guest = 'bbbbbbbb-0000-0000-0000-000000000000'
const duoRow = { user_id: host, human_seat: 0, players: [
  { isHuman: true, userId: host, name: 'Host' }, { isHuman: true, userId: guest, name: 'Guest' },
] }
ok('the host sits at seat 0', seatOf(duoRow, host) === 0)
ok('the guest sits at seat 1', seatOf(duoRow, guest) === 1)
ok('a stranger sits nowhere', seatOf(duoRow, 'cccccccc-0000-0000-0000-000000000000') === -1)
ok('two people make a duo', isDuo(duoRow.players))
const waiting = { ...duoRow, players: [duoRow.players[0], { isHuman: true, userId: null, name: '', invited: true }] }
ok('an invited seat belongs to nobody yet', seatOf(waiting, guest) === -1)
ok('a table with an invited seat is a duo from the start', isDuo(waiting.players))
const legacy = { user_id: host, human_seat: 1, players: [{ isHuman: false, name: 'GPT-6 Luna' }, { isHuman: true, name: 'You' }] }
ok('a table from before Oct 21: the creator is at human_seat', seatOf(legacy, host) === 1)
ok('...and nobody else is', seatOf(legacy, guest) === -1)
ok('one person and a model is not a duo', !isDuo(legacy.players as any))
const lobby = { token: 'Abc123_-xyz', open: [1] }
ok('the right token opens the table', tokenOk(lobby, 'Abc123_-xyz'))
ok('a wrong token does not', !tokenOk(lobby, 'Abc123_-xyZ'))
ok('a token of another length does not', !tokenOk(lobby, 'Abc'))
ok('no token does not', !tokenOk(lobby, undefined) && !tokenOk(null, 'Abc123_-xyz'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
