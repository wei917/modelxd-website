// scripts/test-story-digest.ts — unit test for the story digest pure functions (lib/story-digest.ts).
//   npx tsx scripts/test-story-digest.ts
import { splitIntoWindows, parseBible, renderBible, mapPrompt, reducePrompt, prepareText } from '../lib/story-digest'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name, extra) }

// 1. A 西遊記-shaped text: 30 chapters with 第X回 headings, ~9k chars each → packed windows of ≤ 40k
const nums = '一二三四五六七八九十'.split('')
const chapterNo = (i: number) => i < 10 ? nums[i] : i === 10 ? '十' : i < 20 ? '十' + nums[i - 10] : '二十' + (i === 20 ? '' : nums[i - 20])
const body = (i: number) => `第${chapterNo(i)}回 標題甲乙丙丁 標題戊己庚辛\n\n` + ('話說悟空在花果山水簾洞中，聚集群猴。'.repeat(12) + '\n\n').repeat(35)
const novel = '西遊記\n\n作者：吳承恩\n\n' + Array.from({ length: 30 }, (_, i) => body(i)).join('\n')
const w = splitIntoWindows(novel)
check('novel splits into several windows', w.length >= 4 && w.length <= 12, `→ ${w.length} windows, ${novel.length} chars`)
check('no window over 40k', w.every(x => x.text.length <= 40_000), `max ${Math.max(...w.map(x => x.text.length))}`)
check('headings carried', w.flatMap(x => x.headings).length === 30, `→ ${w.flatMap(x => x.headings).length} headings`)
check('front matter kept', w[0].text.startsWith('西遊記'))
check('all text kept', w.reduce((n, x) => n + x.text.length, 0) >= novel.length * 0.97)

// 2. "Chapter N" English headings
const eng = Array.from({ length: 5 }, (_, i) => `Chapter ${i + 1}\n\n${'The monkey leapt. '.repeat(300)}`).join('\n\n')
const we = splitIntoWindows(eng)
check('English chapters detected', we.flatMap(x => x.headings).length === 5)

// 3. No headings, one long blob → paragraph cuts, nothing lost
const blob = ('Lorem ipsum dolor sit amet. '.repeat(200) + '\n\n').repeat(60)
const wb = splitIntoWindows(blob)
check('blob cut into ≤40k windows', wb.every(x => x.text.length <= 40_000) && wb.length >= 8, `→ ${wb.length}`)
check('blob text kept', wb.reduce((n, x) => n + x.text.length, 0) >= blob.trim().length * 0.97)

// 4. A short pasted story = one window
check('short story = one window', splitIntoWindows('Once upon a time there was a fox.').length === 1)
check('empty = none', splitIntoWindows('   ').length === 0)

// 5. parseBible tolerates fences/prose and clamps
const reply = 'Here you go:\n```json\n' + JSON.stringify({
  title: '西遊記', logline: 'A monkey wants freedom…', setting: { era: 'Tang', world: 'myth China', tone: 'epic comic' },
  cast: Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, role: 'r', look: 'l' })),
  beats: Array.from({ length: 14 }, (_, i) => ({ n: 99, title: `B${i}`, what_happens: 'x', change: 'y', who: ['C0'], where: 'z' })),
  omitted: 'lots',
}) + '\n```\nDone.'
const b = parseBible(reply)!
check('bible parsed', !!b)
check('cast clamped to 5', b.cast.length === 5)
check('beats clamped to 10 and renumbered', b.beats.length === 10 && b.beats[9].n === 10)
check('garbage → null', parseBible('no json here') === null)
check('no beats → null', parseBible('{"title":"x","beats":[]}') === null)
const r = renderBible(b)
check('render has title/cast/beats', r.includes('📖 **西遊記**') && r.includes('**Cast:**') && r.includes('**Beats (10):**'))
check('render separates blocks with blank lines (Markdown)', r.split('\n\n').length >= 5)

// 7. PDF-style text: headings mid-line, Kangxi radicals, Gutenberg wrapper
const pdfish = 'The Project Gutenberg eBook of ⻄遊記 … *** START OF THE PROJECT GUTENBERG EBOOK ⻄遊記 *** 卷一 第一回 靈根育孕源流出 心性修持大道生 詩曰：混沌未分天地亂… ' + '話說美猴王。'.repeat(40) + ' 第二回 悟徹菩提真妙理 斷魔歸本合元神 ' + '話說悟空。'.repeat(40) + ' 第三回 四海千山皆拱伏 ' + '話說龍宮。'.repeat(40) + ' *** END OF THE PROJECT GUTENBERG EBOOK ⻄遊記 *** licence text licence text'
const wp = splitIntoWindows(pdfish)
check('mid-line 第X回 headings found', wp.flatMap(x => x.headings).length === 3, `→ ${wp.flatMap(x => x.headings).length}`)
check('Kangxi radical folded to 西', prepareText('⻄遊記').includes('西遊記'))
check('Gutenberg header stripped', !wp[0].text.includes('Project Gutenberg') && wp[0].text.startsWith('卷一'))
check('Gutenberg footer stripped', !wp[wp.length - 1].text.includes('licence text'))

// 6. prompts carry focus + language + part index
check('map prompt', mapPrompt(w[0], w.length, 'zh-Hant', '大鬧天宮').includes('FOCUS on: "大鬧天宮"') && mapPrompt(w[0], w.length, 'zh-Hant').includes('Traditional Chinese'))
check('reduce prompt', reducePrompt(['a', 'b'], 'ja').includes('PART 2 of 2') && reducePrompt(['a'], 'ja').includes('Japanese'))

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
