// scripts/test-xtell-tarot.ts — 塔羅 (Sep 28): the draw (lib/tarot-draw.ts)
// and the deck the server reads (lib/tarot.ts, content/tarot/cards.json).
//   npx tsx scripts/test-xtell-tarot.ts

import { existsSync } from 'node:fs'
import { drawTarot, validPicks, TAROT_IDS, SPREADS, asSpread } from '../lib/tarot-draw'
import { tarotDeck, tarotChart, tarotFacts } from '../lib/tarot'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

// ── The draw ───────────────────────────────────────────────────────────────
check('78 ids: 22 majors, four suits of 14', TAROT_IDS.length === 78 && new Set(TAROT_IDS).size === 78 && TAROT_IDS[0] === 'major-00' && TAROT_IDS[21] === 'major-21' && TAROT_IDS[22] === 'wands-01' && TAROT_IDS[77] === 'pentacles-14')
let seed = 1
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
let distinct = true, bothWays = new Set<boolean>()
for (let i = 0; i < 500; i++) {
  const d = drawTarot(rand, 3)
  if (new Set(d.map(c => c.id)).size !== 3) distinct = false
  d.forEach(c => bothWays.add(c.reversed))
}
check('three cards are always three different cards', distinct)
check('cards land both upright and reversed', bothWays.size === 2)
const counts = new Map<string, number>()
for (let i = 0; i < 78 * 400; i++) { const [c] = drawTarot(rand, 1); counts.set(c.id, (counts.get(c.id) ?? 0) + 1) }
const lo = Math.min(...counts.values()), hi = Math.max(...counts.values())
check('every card turns up, none far more than another (78 × 400 draws)', counts.size === 78 && lo > 280 && hi < 520, `${lo}–${hi}`)
check('a client may send only the right number of distinct real cards', validPicks('one', [{ id: 'major-00', reversed: true }]) && validPicks('three', [{ id: 'cups-02', reversed: false }, { id: 'major-13', reversed: true }, { id: 'swords-10', reversed: false }])
  && !validPicks('one', []) && !validPicks('three', [{ id: 'cups-02', reversed: false }, { id: 'cups-02', reversed: true }, { id: 'major-01', reversed: false }])
  && !validPicks('one', [{ id: 'major-22', reversed: false }]) && !validPicks('one', [{ id: 'major-00', reversed: 'yes' }]) && !validPicks('one', 'major-00'))
check('spreads: one card, or past · present · future; anything else is one', SPREADS.one.join() === 'answer' && SPREADS.three.join() === 'past,present,future' && asSpread('three') === 'three' && asSpread('ten') === 'one')

// ── The deck ───────────────────────────────────────────────────────────────
const deck = tarotDeck()
check('the deck is the 78 ids, in order', deck.length === 78 && deck.every((c, i) => c.id === TAROT_IDS[i]))
check('every card has five names, both Waite meanings and its picture on disk', deck.every(c => ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => (c.names as any)[l]?.trim()) && c.upright.trim().length > 10 && c.reversed.trim().length > 3 && existsSync(`public${c.image}`)),
  deck.filter(c => !existsSync(`public${c.image}`)).map(c => c.id).join())
check("Waite's numbering: Strength is VIII, Justice XI", deck[8].names.en === 'Strength' && deck[11].names.en === 'Justice')
const chart = tarotChart('three', [{ id: 'major-00', reversed: false }, { id: 'major-13', reversed: true }, { id: 'cups-02', reversed: false }], '換工作？')
check('a laid spread: positions in order, the meaning for the way each landed', chart.cards.map(c => c.position).join() === 'past,present,future' && chart.cards[1].meaning === deck[13].reversed && chart.cards[0].meaning === deck[0].upright)
const facts = tarotFacts(chart)
check("the teacher's facts carry the question, each position and Waite's words", facts.includes('換工作？') && facts.includes('過去：') && facts.includes('逆位') && facts.includes(deck[13].reversed))
check('no question: the teacher is told to ask first', tarotFacts(tarotChart('one', [{ id: 'major-01', reversed: false }], '')).includes('先問清楚'))

console.log(fails ? `\n${fails} FAILED` : '\nall tarot checks passed')
if (fails) process.exit(1)
