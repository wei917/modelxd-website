// scripts/test-yijing-retrieval.ts — 易學堂's bounded retrieval, on the real
// corpus. Offline: no model, no network.
//   npx tsx scripts/test-yijing-retrieval.ts
//
// What the teacher is handed for a question: the hexagram it names, the
// places a line it quotes occurs, one of three indexed topics, or an honest
// "nothing found". Checked in Traditional and Simplified Chinese, Japanese,
// Korean and English; knowledge, situation and irrelevant questions;
// ambiguous lines and explicit-name precedence; follow-ups; and that nothing
// here ever hands a person a hexagram of their own.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { yixueFacts } from '../lib/yijing'
import { classicPassages } from '../lib/classics'
import { fold, CONCEPTS } from '../lib/yijing-retrieval'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name)
}
type Turn = { role: string; content: string }
const ask = (q: string, history: Turn[] = []) => yixueFacts({ mode: 'ask' }, q, history)
/** 【heading】第N卦 lines: whole-hexagram texts handed over. */
const blocks = (f: string) => [...f.matchAll(/【([^】]+)】第(\d+)卦/g)].map(m => `${m[1]}:${m[2]}`)
const noHexagramFor = (f: string) => blocks(f).length === 0 && !/第\d+卦/.test(f) && !f.includes('本次應讀')

// ── Folding is for matching only ───────────────────────────────────────────
check('Japanese, simplified and traditional forms fold together',
  fold('潜竜勿用') === fold('潛龍勿用') && fold('潜龙勿用') === fold('潛龍勿用')
  && fold('厚徳載物') === fold('厚德載物') && fold('厚德载物') === fold('厚德載物'))
check('乾 stays 乾; Taiwan 恆 meets the corpus 恒; 餘 meets 余', fold('乾') === '乾' && fold('恆') === fold('恒') && fold('餘') === fold('余'))

// ── A quoted line, no hexagram named ───────────────────────────────────────
const SHARED = ['乾卦 卦辭', '屯卦 卦辭', '隨卦 卦辭', '臨卦 卦辭', '无妄卦 卦辭', '革卦 卦辭']
for (const q of ['元亨利貞是什麼意思？', '元亨利贞是什么意思？', '「元、亨、利、貞」怎麼解釋？', '元亨利貞とは？', '원형이정은 무슨 뜻인가요?', 'What does yuan heng li zhen mean?']) {
  const f = ask(q)
  check(`shared line is listed everywhere, credited to none: ${q}`,
    f.includes('不是某一卦獨有') && SHARED.every(w => f.includes(`- ${w}：「`)) && f.includes('乾卦 文言傳') && blocks(f).length === 0, blocks(f).join())
}
for (const q of ['潛龍勿用是什麼意思？', '潜龙勿用是什么意思？', '潜竜勿用とはどういう意味ですか', '潛龍勿用이 무슨 뜻인가요?', '잠룡물용은 무슨 뜻인가요?', 'What does qián lóng wù yòng mean?']) {
  const f = ask(q)
  check(`a line found in one hexagram brings that hexagram: ${q}`,
    blocks(f).join() === '問題引用的句子所在的卦:1' && f.includes('卦內只見於乾卦') && f.includes('不代表此人得到任何一卦'), blocks(f).join())
}
{
  const f = ask('利涉大川是什麼意思？')
  check('a common line (利涉大川) stays shared', f.includes('不是某一卦獨有') && blocks(f).length === 0)
  const g = ask('一陰一陽之謂道是什麼意思？')
  check('a line from the 十翼 is cited from its book', g.includes('- 《繫辭上傳》：「一陰一陽之謂道') && blocks(g).length === 0)
}
{
  const f = ask('「否極泰來」出自哪一卦？')
  check('a quotation the corpus lacks is reported, not forced', f.includes('“否極泰來”') && f.includes('找不到逐字相同的句子') && noHexagramFor(f))
}

// ── An explicitly named hexagram outranks a quoted line ────────────────────
{
  const f = ask('乾卦的元亨利貞是什麼意思？')
  check('named 乾 is the text; the other five places are only named',
    blocks(f).join() === '問題提到的卦:1' && f.includes('不只見於所點名的卦') && f.includes('屯卦 卦辭') && !f.includes('第3卦'), blocks(f).join())
  const g = ask('蒙卦裡有潛龍勿用嗎？')
  check('a line quoted against the wrong hexagram is located, the named one kept',
    blocks(g).join() === '問題提到的卦:4' && g.includes('不在所點名的卦中') && g.includes('- 乾卦 初九爻辭：「潛龍勿用。」') && !g.includes('第1卦'), blocks(g).join())
}

// ── Topics, in all five languages ──────────────────────────────────────────
const topics: Array<[string, string, string[]]> = [
  ['進退與工作抉擇', '艮卦 彖傳：「時止則止', ['我工作三年，該轉職嗎？', '我工作三年，该转职吗？', '転職すべきか迷っています', '이직을 해야 할지 고민입니다', 'Should I change jobs? My career feels stuck.']],
  ['合作與意見分歧', '睽卦 大象：「上火下澤，睽；君子以同而異。」', ['合夥人和我意見不合，怎麼辦？', '合伙人和我意见不合，怎么办？', '同僚と意見が合わない', '동업자와 의견 충돌이 있어요', 'My co-founder and I disagree on strategy.']],
  ['陰陽與八卦的基本觀念', '《繫辭上傳》：「一陰一陽之謂道', ['什麼是陰陽？', '什么是阴阳？', '陰と陽とは何ですか', '음양이 뭐예요?', 'What are yin and yang?', '八卦怎麼記？']],
]
for (const [topic, quote, qs] of topics) for (const q of qs) {
  const f = ask(q)
  check(`topic ${topic}: ${q}`, f.includes(`話題：${topic}`) && f.includes(quote) && f.includes('不是起卦') && noHexagramFor(f))
}
// Every quotation in the index is exact corpus text, found exactly once.
{
  const corpus = JSON.parse(readFileSync(join(process.cwd(), 'content', 'yijing', 'zhouyi.json'), 'utf-8'))
  const hexText = (h: any) => [h.judgment, h.tuan, h.daxiang, ...h.yao.flatMap((y: any) => [y.text, y.xiaoxiang]), h.use?.text ?? '', h.use?.xiaoxiang ?? '', h.wenyan ?? ''].join('\n')
  const dir = join(process.cwd(), 'content', 'classics')
  const texts = [...corpus.hexagrams.map(hexText), ...readdirSync(dir).filter(f => f.startsWith('zhouyi-')).map(f => readFileSync(join(dir, f), 'utf-8'))]
  const count = (q: string) => texts.reduce((n, t) => n + t.split(q).length - 1, 0)
  const all = CONCEPTS.flatMap(c => c.anchors)
  check('every indexed quotation occurs verbatim exactly once in the corpus', all.every(a => count(a.quote) === 1), all.filter(a => count(a.quote) !== 1).map(a => a.quote).join(' | '))
  for (const c of CONCEPTS) {
    const f = ask(c.id === 'career' ? '該不該轉職？' : c.id === 'together' ? '和同事意見不合' : '什麼是陰陽？')
    check(`every ${c.id} quotation reaches the teacher with its source`, c.anchors.every(a => f.includes(`- ${a.in}：「${a.quote}」`)))
  }
}

// ── Situation words are not a hexagram ─────────────────────────────────────
{
  const f = ask('我今年三十歲，工作三年了，屬龍。')
  check('age, tenure and zodiac assign nothing; the topic is framed as reading',
    noHexagramFor(f) && f.includes('不可根據年資、年齡') && f.includes('話題：進退與工作抉擇') && f.includes('不是起卦'))
  check('a bare age is not a hexagram', noHexagramFor(ask('我今年64歲，屬龍，今年運勢如何？')))
  const g = ask('公司突如其來的裁員讓我很焦慮，該轉職嗎？')
  check('an idiom from the text inside a situation brings only its line, not the hexagram',
    blocks(g).length === 0 && g.includes('- 離卦 九四爻辭：「') && g.includes('話題：進退與工作抉擇'))
}
const ORDINARY = [
  '我最近工作壓力很大，不知道該不該離職', '我和男朋友吵架了，他說我想太多', '明天要考試，我很緊張',
  '我想知道今年適不適合買房子', '家人希望我回老家工作', '我們公司最近在裁員，大家都很不安',
  '請問易經適合初學者自學嗎', '我今年三十五歲，還來得及轉行嗎', '孩子不喜歡念書怎麼辦',
  '最近睡不好，常常做夢', '我想創業但是沒有資金', '朋友借錢不還，我該怎麼辦',
  '我对未来很迷茫，不知道该怎么办', '我想学习易经，从哪里开始比较好', '上司と意見が合わず、転職を考えています',
  '易経を独学で勉強したいです', '요즘 회사 일이 너무 힘들어요', 'I feel lost about my future.',
]
check('ordinary sentences quote nothing from the text',
  ORDINARY.every(q => !ask(q).includes('以下是使用者引用的句子')), ORDINARY.filter(q => ask(q).includes('以下是使用者引用的句子')).join(' | '))

// ── Irrelevant questions: nothing is forced ────────────────────────────────
for (const q of ['今天天氣如何？', '今天天气怎么样？', '今日の天気は？', '오늘 날씨 어때요?', 'What is the weather today?', '推薦一家好吃的拉麵店', '我需要比較家人的意見，最近很困難']) {
  const f = ask(q)
  check(`irrelevant: ${q}`, f.includes('系統沒有找到') && !f.includes('話題：') && noHexagramFor(f) && classicPassages('yixue', q).length === 0)
}

// ── Follow-ups: the nearest grounded user turn, and no further ─────────────
{
  const f = ask('那下一爻呢？', [{ role: 'user', content: '潛龍勿用是什麼意思？' }, { role: 'assistant', content: '這是乾卦初九。' }])
  check('an ambiguous follow-up keeps a quoted line\'s hexagram', blocks(f).join() === '最近對話引用的句子所在的卦:1' && f.includes('見龍在田'))
  const history: Turn[] = [
    { role: 'user', content: '蒙卦是什麼意思？' },
    { role: 'assistant', content: '蒙卦講啟蒙與求教。' },
  ]
  const career = ask('我工作三年，該轉職嗎？', history)
  check('a new career question supersedes the older 蒙', career.includes('話題：進退與工作抉擇') && !career.includes('第4卦') && !career.includes('沿用'))
  const followUp = ask('那我該怎麼開始準備？', [...history, { role: 'user', content: '我工作三年，該轉職嗎？' }, { role: 'assistant', content: '可以先看時機與準備。' }])
  check('its follow-up stays on career and does not revive 蒙',
    followUp.includes('話題：進退與工作抉擇') && followUp.includes('沿用最近一則') && !followUp.includes('第4卦'))
  const yin = ask('陰陽是什麼？', [{ role: 'user', content: '請講解乾卦' }])
  check('a new yin-yang question supersedes an older named 乾', yin.includes('話題：陰陽與八卦的基本觀念') && !yin.includes('第1卦'))
  check('assistant turns never ground a follow-up', !ask('再解釋一下', [{ role: 'assistant', content: '潛龍勿用' }]).includes('潛龍勿用'))
}

// ── Canonical-text claim is scoped to labelled sources ─────────────────────
{
  const f = ask('潛龍勿用是什麼意思？')
  check('the visitor\'s words are in “ ”, never in 「 」', f.includes('“潛龍勿用”') && !f.includes('引用的「') && f.includes('凡標明出處'))
}

// ── A manual cast: six supplied values, no coins claimed ───────────────────
{
  const lines = [7, 8, 9, 6, 7, 7]
  const coins = [[3, 2, 2], [3, 3, 2], [3, 3, 3], [2, 2, 2], [3, 2, 2], [3, 2, 2]]
  const thrown = yixueFacts({ mode: 'cast', ask: '要不要搬家', lines, coins })
  const manual = yixueFacts({ mode: 'cast', ask: '要不要搬家', lines })
  check('the room\'s own throw is described as three coins', thrown.includes('三枚硬幣擲六次') && !thrown.includes('自行起卦'))
  check('supplied values are described as supplied, never as our throw',
    manual.includes('來訪者自行起卦後輸入的六個爻值') && !manual.includes('三枚硬幣擲六次') && !manual.includes('這是三枚硬幣起卦') && manual.includes('本次應讀'))
}

// ── The 十翼 retriever: 易學堂 stricter, every other temple unchanged ───────
{
  const hit = (q: string, s: string) => classicPassages('yixue', q).some(p => p.text.includes(s))
  check('太極 (traditional and simplified) finds 易有太極', hit('什麼是太極？', '易有太極') && hit('什么是太极？', '易有太極'))
  check('a quoted 十翼 line finds its passage first', classicPassages('yixue', '一陰一陽之謂道是什麼意思')[0]?.text.includes('一陰一陽之謂道') === true)
  check('吉凶悔吝 finds 繫辭', hit('吉凶悔吝是什麼意思', '悔吝'))
  for (const q of ['可以教我易經嗎', '我和家人吵架了', '乾卦的元亨利貞是什麼意思？', '現職通勤二十分鐘，新職要搬家']) {
    check(`one weak bigram is not evidence: ${q}`, classicPassages('yixue', q).length === 0, classicPassages('yixue', q).map(p => p.text.slice(0, 20)).join(' | '))
  }
  // The rule every other temple keeps, copied from lib/classics.ts before this change.
  const legacy = (files: string[], query: string) => {
    const bigrams = (s: string) => { const c = s.replace(/[^一-鿿]/g, ''); const o = new Set<string>(); for (let i = 0; i < c.length - 1; i++) o.add(c.slice(i, i + 2)); return o }
    const q = bigrams(query)
    if (q.size === 0) return [] as string[]
    const scored: Array<{ t: string; score: number }> = []
    for (const file of files) {
      const [, ...body] = readFileSync(join(process.cwd(), 'content', 'classics', file), 'utf-8').split('\n\n')
      const out: string[] = []
      for (const para of body.join('\n\n').split(/\n{2,}/)) {
        const p = para.trim()
        if (p.length < 24) continue
        if (p.length <= 420) { out.push(p); continue }
        for (const piece of p.split(/(?<=[。！？])/).reduce<string[]>((acc, s) => {
          const last = acc[acc.length - 1]
          if (last !== undefined && last.length + s.length <= 420) acc[acc.length - 1] = last + s
          else acc.push(s)
          return acc
        }, [])) if (piece.trim().length >= 24) out.push(piece.trim())
      }
      for (const t of out) {
        let h = 0
        const pb = bigrams(t)
        for (const b of q) if (pb.has(b)) h++
        if (h > 0) scored.push({ t, score: h / Math.sqrt(pb.size) })
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.t)
  }
  const temples: Array<[any, string[]]> = [
    ['bazi', ['ditiansui.txt']], ['yuelao', ['ditiansui.txt']], ['simianfo', ['ditiansui.txt']],
    ['ziwei', ['ziweiquanshu-j1.txt']], ['cezi', ['cezimidie.txt']], ['navagraha', ['suyaojing.txt']], ['zhanxing', []],
  ]
  const queries = ['甲木日主身弱，今年財運如何？', '紫微在命宮', '測「心」字', '昴宿的人個性如何', '今天天氣如何', '我工作三年，該轉職嗎？']
  const same = temples.every(([t, files]) => queries.every(q => JSON.stringify(classicPassages(t, q).map(p => p.text)) === JSON.stringify(legacy(files, q))))
  check('every other temple retrieves exactly as before', same)
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
