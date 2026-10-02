// scripts/test-xtell-tarot.ts — 塔羅 (Sep 28): the draw (lib/tarot-draw.ts)
// and the deck the server reads (lib/tarot.ts, content/tarot/cards.json).
//   npx tsx scripts/test-xtell-tarot.ts

import { existsSync, readFileSync } from 'node:fs'
import { drawTarot, validPicks, TAROT_IDS, SPREADS, SPREAD_KEYS, asSpread, asOptions, OPTION_MAX, shuffleDeck, cutDeck, tarotImage } from '../lib/tarot-draw'
import { STRINGS } from '../lib/i18n'
import { tarotDeck, tarotChart, tarotFacts, tarotModern } from '../lib/tarot'

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

// ── The ritual (Oct 1: shuffle, cut, choose face down, turn over) ──────────
{
  const full = shuffleDeck(rand)
  check('ritual: the shuffle is the whole deck, each card once, each lying one way', full.length === 78 && new Set(full.map(c => c.id)).size === 78 && full.every(c => typeof c.reversed === 'boolean') && full.some(c => c.reversed) && full.some(c => !c.reversed))
  const order = (d: typeof full) => d.map(c => c.id).join()
  check('ritual: two shuffles differ', order(shuffleDeck(rand)) !== order(shuffleDeck(rand)))
  const piles = [full.slice(0, 26), full.slice(26, 52), full.slice(52)]
  const cutMid = cutDeck(full, 1), cutLast = cutDeck(full, 2)
  check('ritual: the cut puts the chosen pile on top, the other two below in order, nothing lost', order(cutMid) === order([...piles[1], ...piles[0], ...piles[2]]) && order(cutLast) === order([...piles[2], ...piles[0], ...piles[1]]) && order(cutDeck(full, 0)) === order(full) && cutMid.every(c => full.includes(c)))
  check('ritual: chosen places give real, distinct cards the server accepts', validPicks('three', [cutMid[5], cutMid[40], cutMid[77]].map(c => ({ id: c.id, reversed: c.reversed }))))
  check('ritual: the picture shown when a card is turned is the one the spread lays', tarotDeck().every(c => tarotImage(c.id) === c.image))
  const ui = readFileSync('app/components/xtell/TarotRitual.tsx', 'utf8')
  check('ritual: 洗牌 → 切牌 → 選牌 → 翻牌, in that order', /stage === 'deck' \|\| stage === 'shuffling'/.test(ui) && /setStage\('cut'\)/.test(ui) && /setStage\('fan'\)/.test(ui) && /setStage\('reveal'\)/.test(ui))
  check('ritual: nothing is sent until the last card is turned, then exactly the chosen places', /if \(next\.every\(Boolean\)\) later\(\(\) => \{ setStage\('done'\); onDone\(picked\.map\(i => deck\[i\]\)\) \}/.test(ui) && (ui.match(/onDone\(/g) ?? []).length === 1)
  check('ritual: a chosen card cannot be chosen twice, and no more than the spread holds', /picked\.includes\(i\) \|\| picked\.length >= count/.test(ui))
  check('ritual: a failed laying starts again from the shuffle', /else if \(laying\.current\) restart\(\)/.test(ui))
  check('ritual: the arc follows the swipe; cards are buttons with their place in words', /setProperty\('--s'/.test(ui) && /aria-label=\{fill\('xtell\.tarot\.r\.card', i \+ 1\)\}/.test(ui) && /aria-label=\{t\('xtell\.tarot\.r\.flip'\)/.test(ui))
  const css = readFileSync('app/globals.css', 'utf8')
  check('ritual: still for those who ask for less motion; hover lifts only with a mouse', /@media \(prefers-reduced-motion: reduce\) \{ \.xtell-tr \*/.test(css) && /@media \(hover: hover\) \{ \.xtell-tr-card\.is-fan/.test(css))
  check('ritual: the card back is the owner\'s design D, on every back, the pattern under it until it loads', existsSync('public/xtell/tarot-back.webp')
    && /\.xtell-tr-back \{\s*background:\s*url\('\/xtell\/tarot-back\.webp'\) center \/ 100% 100% no-repeat,\s*radial-gradient/.test(css))
  const client = readFileSync('app/xtell/client.tsx', 'utf8')
  check('room: the panel runs the ritual (a new spread starts it again); the old one-press deal is gone', /<TarotRitual key=\{spread\}/.test(client) && !/drawTarot\(cryptoRand/.test(client))
  const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.tarot.r.'))
  check('strings: every ritual line in five languages', keys.length === 14 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k][l] === 'string' && (STRINGS as any)[k][l].trim())), String(keys.length))
}

// ── 二擇一 and 關係 (Oct 1) ─────────────────────────────────────────────────
{
  check('spreads: four, the two new ones five cards each, in the order the places are filled', SPREAD_KEYS.join() === 'one,three,choice,love'
    && SPREADS.choice.join() === 'now,pathA,pathB,endA,endB' && SPREADS.love.join() === 'you,them,bond,block,next')
  check('spreads: a name that is not a spread (or an inherited key) is one card', asSpread('choice') === 'choice' && asSpread('love') === 'love' && asSpread('toString') === 'one' && asSpread('__proto__') === 'one' && asSpread(3) === 'one')
  const five = shuffleDeck(rand).slice(0, 5)
  check('spreads: five distinct real cards are a valid 二擇一 or 關係, four are not', validPicks('choice', five) && validPicks('love', five) && !validPicks('choice', five.slice(0, 4)))
  const o = asOptions({ optA: '  留在現在的公司  ', optB: 'x'.repeat(OPTION_MAX + 9) })
  check('options: trimmed, capped, and empty when not given', o.a === '留在現在的公司' && o.b.length === OPTION_MAX && asOptions({}).a === '' && asOptions(null).b === '')
  const ch = tarotChart('choice', five, '換工作？', o)
  const cf = tarotFacts(ch)
  check('二擇一: the chart keeps the options; the teacher gets them and every place by name', ch.options?.a === '留在現在的公司' && cf.includes('選項 A：留在現在的公司') && cf.includes('二擇一')
    && ['現況：', '選 A 的發展：', '選 B 的發展：', '選 A 的結果：', '選 B 的結果：'].every(x => cf.includes(x)))
  check('二擇一 without names: the teacher is told they were not written', tarotFacts(tarotChart('choice', five, '', { a: '', b: '' })).includes('選項 A：（來訪者沒有寫）'))
  const lf = tarotFacts(tarotChart('love', five, ''))
  check('關係: every place by name, and no options', ['你的心意：', '對方的心意：', '目前的關係：', '需要面對的：', '接下來的走向：'].every(x => lf.includes(x)) && !lf.includes('選項 A') && !tarotChart('love', five, '').options)
  const master = readFileSync('lib/xtell.ts', 'utf8')
  check('teacher: told how to read 二擇一 (compare, never decide for them) and 關係 (never 注定)', /二擇一先講現況/.test(master) && /不替來訪者做決定/.test(master) && /關係先講兩人各自的心意/.test(master))
  const routes = readFileSync('app/api/xtell/chart/route.ts', 'utf8') + readFileSync('app/api/xtell/reading/route.ts', 'utf8')
  check('routes: the options are kept with the visit and reach the teacher', /'optA', 'optB'\] as const/.test(routes) && /tarotChart\(spread, body\.picks, ask, options\)/.test(routes) && /: '', asOptions\(body\)\)\)/.test(routes))
  const css = readFileSync('app/globals.css', 'utf8')
  check('layouts: 二擇一 and 關係 in their own shapes, two columns on a phone', /grid-template-areas: "endA \. endB" "pathA now pathB"/.test(css) && /grid-template-areas: "you bond them" "block \. next"/.test(css) && /\.xtell-tarot-cards\.is-five \.xtell-tarot-card \{ grid-area: auto !important; \}/.test(css))
  const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
  const need = ['xtell.tarot.spread.choice', 'xtell.tarot.spread.love', ...SPREAD_KEYS.map(k => `xtell.tarot.spread.${k}.sub`), ...[...SPREADS.choice, ...SPREADS.love].map(p => `xtell.tarot.pos.${p}`), 'xtell.tarot.opt.a', 'xtell.tarot.opt.b', 'xtell.tarot.opt.a.ph', 'xtell.tarot.opt.b.ph']
  check('strings: the new spreads, places and option boxes in five languages', need.every(k => LANGS.every(l => typeof (STRINGS as any)[k]?.[l] === 'string' && (STRINGS as any)[k][l].trim())), need.filter(k => !(STRINGS as any)[k]).join())
}

// ── Modern meanings (Oct 2) ────────────────────────────────────────────────
{
  const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
  const all = TAROT_IDS.flatMap(id => [tarotModern(id, false), tarotModern(id, true)])
  check('modern: every card, upright and reversed, in five languages', all.every(m => !!m && LANGS.every(l => typeof m[l] === 'string' && m[l].trim().length > 5)), String(all.filter(m => !m).length))
  check('modern: no em dashes, and no card names inside the text', TAROT_IDS.every(id => [false, true].every(r => { const m = tarotModern(id, r)!, c = deck.find(x => x.id === id)!; return LANGS.every(l => !m[l].includes('—') && !(c.names[l].length > 1 && m[l].includes(c.names[l]))) })))
  check('modern: no death, illness or money advice', TAROT_IDS.every(id => [false, true].every(r => !/死亡|疾病|自殺|投資|股票|\bdisease|\billness|\binvest|\bsuicide/.test(Object.values(tarotModern(id, r)!).join(' ')))))
  check('modern: 死神 reads as change, not death', /轉變|改變|變化/.test(tarotModern('major-13', false)!['zh-Hant']))
  const laid = tarotChart('one', [{ id: 'major-13', reversed: true }], 'x')
  check('modern: a laid card carries the reading for the way it landed; the teacher sees it as ours', laid.cards[0].modern?.['zh-Hant'] === tarotModern('major-13', true)!['zh-Hant'] && tarotFacts(laid).includes('本站的現代解讀'))
  const client = readFileSync('app/xtell/client.tsx', 'utf8')
  check('modern: shown under each card in the visitor\'s language, Waite one tap away', /className="xtell-tarot-modern">\{c\.modern\?\.\[lang\] \?\? c\.modern\?\.en\}/.test(client) && /<summary>\{t\('xtell\.tarot\.meaning'\)\}<\/summary>/.test(client))
}

console.log(fails ? `\n${fails} FAILED` : '\nall tarot checks passed')
if (fails) process.exit(1)
