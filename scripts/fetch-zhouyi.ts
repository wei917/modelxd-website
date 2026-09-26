// scripts/fetch-zhouyi.ts — build the 周易 corpus for 易學堂.
//
//   npx tsx scripts/fetch-zhouyi.ts
//     → content/yijing/zhouyi.json          (64 hexagrams: 經 + 彖 + 象 + 文言)
//     → content/classics/zhouyi-*.txt       (十翼 passages for lib/classics)
//
// Source: 維基文庫《周易》 (zh.wikisource.org/wiki/周易), public domain. Each
// hexagram page is regular: 「周易　第N卦」, the trigram line 「震下坎上」,
// then 易經 (卦辭 + six 爻辭, plus 用九/用六 on 乾/坤), 彖曰, 象曰 (大象 +
// one 小象 per line) and, on 乾/坤 only, 文言曰. The text is kept exactly as
// transcribed there (羣, 无, 恒 …), only the wiki markup is removed.
//
// Three independent checks must agree for every page or the build fails:
//   1. the page's own number (第N卦) is the King Wen position we fetched it as;
//   2. its trigram line (X下Y上) gives six lines through the trigram table;
//   3. its 爻 labels (初九, 六二 … 上六: 九 = yang, 六 = yin) give six lines.
// 2 and 3 are the same fact written two ways by the text itself, so a wrong
// entry in the hand-written table below cannot survive the build.
//
// Corrections (CORRECTIONS below) are the one place the text is edited. Each
// is a slip in the Wikisource transcription, mostly a simplified form where
// the traditional text has another character (后/後, 系/係/繫, 丑/醜, 云/雲 …),
// found by passing every character through Wikisource's own zh-hant converter
// and reading each hit in context, plus two wrong characters and one broken
// phrase. Every entry names a witness edition on Wikisource that reads the
// corrected form, must match exactly where stated or the build fails, and
// is written into the JSON so the board and the docs can say what changed.
// Forms that are right in the classical text stay as transcribed: 于, 无, 恒,
// 尸 (輿尸), 机 (渙奔其机), 干 (鴻漸于干), 辟 (辟難, 辟咎), 云 (變化云為),
// and the 大象's 后 meaning sovereign (后以財成天地之道, 后不省方, 后以施命).

import fs from 'node:fs/promises'
import path from 'node:path'

const UA = 'ModelXD-XTell/1.0 (https://modelxd.com; public-domain corpus fetch)'
const OUT = path.join(process.cwd(), 'content', 'yijing', 'zhouyi.json')
const CLASSICS = path.join(process.cwd(), 'content', 'classics')

// King Wen order, as Wikisource titles its pages (恒 not 恆, 无妄 not 無妄).
// Checked against each page's own 第N卦 below, never trusted on its own.
const TITLES = [
  '乾', '坤', '屯', '蒙', '需', '訟', '師', '比', '小畜', '履', '泰', '否', '同人', '大有', '謙', '豫',
  '隨', '蠱', '臨', '觀', '噬嗑', '賁', '剝', '復', '无妄', '大畜', '頤', '大過', '坎', '離', '咸', '恒',
  '遯', '大壯', '晉', '明夷', '家人', '睽', '蹇', '解', '損', '益', '夬', '姤', '萃', '升', '困', '井',
  '革', '鼎', '震', '艮', '漸', '歸妹', '豐', '旅', '巽', '兌', '渙', '節', '中孚', '小過', '既濟', '未濟',
]

// Trigram lines bottom → top, 1 = yang. The same table lib/yijing-core.ts uses.
const TRIGRAM_LINES: Record<string, number[]> = {
  乾: [1, 1, 1], 兌: [1, 1, 0], 離: [1, 0, 1], 震: [1, 0, 0],
  巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0],
}
const POSITIONS = ['初', '二', '三', '四', '五', '上']

// The rest of the 十翼, for 問老師's retrieval. 彖/象/文言 already ride with
// each hexagram, so they are not repeated here. 周易/繫辭上 etc. are
// redirects; the text lives under 易傳/.
const ZHUAN: Array<{ title: string; file: string; book: string }> = [
  { title: '易傳/繫辭上', file: 'zhouyi-xici-shang.txt', book: '《繫辭上傳》' },
  { title: '易傳/繫辭下', file: 'zhouyi-xici-xia.txt', book: '《繫辭下傳》' },
  { title: '易傳/說卦', file: 'zhouyi-shuogua.txt', book: '《說卦傳》' },
  { title: '易傳/序卦', file: 'zhouyi-xugua.txt', book: '《序卦傳》' },
  { title: '易傳/雜卦', file: 'zhouyi-zagua.txt', book: '《雜卦傳》' },
]

type Page = { title: string; revid: number; content: string }

type Correction = {
  where: string          // hexagram name, or a 十翼 file
  part: string           // 卦辭 | 彖 | 大象 | a 爻 label (六五) | `${label}小象` | text
  from: string
  to: string
  count?: number         // occurrences expected in that part (default 1)
  witness: string        // a Wikisource edition that reads `to`
  reason: string
}
const SIMPLIFIED = 'simplified form in the transcription'
const CORRECTIONS: Correction[] = [
  { where: '剝', part: '卦辭', from: '不利。有攸往。', to: '不利有攸往。', witness: '周易正義/03剝 (and the entry\'s own 彖: 不利有攸往)', reason: 'a stop split the phrase 不利有攸往' },
  { where: '小過', part: '六五', from: '密云不雨', to: '密雲不雨', witness: '周易正義/06小過', reason: SIMPLIFIED },
  { where: '小過', part: '六五小象', from: '密云不雨', to: '密雲不雨', witness: '周易正義/06小過', reason: SIMPLIFIED },
  { where: '中孚', part: '六四', from: '月几望', to: '月幾望', witness: '周易正義/06中孚', reason: SIMPLIFIED },
  { where: '中孚', part: '九二小象', from: '中心愿也', to: '中心願也', witness: '周易正義/06中孚', reason: SIMPLIFIED },
  { where: '同人', part: '九五', from: '先號啕而后笑', to: '先號咷而後笑', witness: '周易正義/07.06 (先號啕而後笑 is unattested)', reason: SIMPLIFIED },
  { where: '明夷', part: '上六', from: '后入于地', to: '後入于地', witness: '大易粹言 (四庫全書本)/卷36', reason: SIMPLIFIED },
  { where: '明夷', part: '上六小象', from: '后入于地', to: '後入于地', witness: '大易粹言 (四庫全書本)/卷36', reason: SIMPLIFIED },
  { where: '睽', part: '上九', from: '見豕負涂', to: '見豕負塗', witness: '周易正義/04睽', reason: SIMPLIFIED },
  { where: '睽', part: '上九', from: '后說之弧', to: '後說之弧', witness: '周易正義/04睽', reason: SIMPLIFIED },
  { where: '震', part: '彖', from: '后有則也', to: '後有則也', witness: '周易正義/05震', reason: SIMPLIFIED },
  { where: '震', part: '初九', from: '后笑言啞啞', to: '後笑言啞啞', witness: '周易正義/05震', reason: SIMPLIFIED },
  { where: '震', part: '初九小象', from: '后有則也', to: '後有則也', witness: '周易正義/05震', reason: SIMPLIFIED },
  { where: '旅', part: '上九', from: '先笑后號咷', to: '先笑後號咷', witness: '周易正義/06旅', reason: SIMPLIFIED },
  { where: '巽', part: '九五', from: '后庚三日', to: '後庚三日', witness: '周易正義/06巽', reason: SIMPLIFIED },
  { where: '井', part: '九三', from: '并受其福', to: '並受其福', witness: '周易正義/05井', reason: SIMPLIFIED },
  { where: '漸', part: '九五小象', from: '得所愿也', to: '得所願也', witness: '周易正義/05漸', reason: SIMPLIFIED },
  { where: '漸', part: '九三小象', from: '離群丑也', to: '離群醜也', witness: '周易正義/05漸', reason: SIMPLIFIED },
  { where: '渙', part: '九二小象', from: '得愿也', to: '得願也', witness: '原本周易本義 (四庫全書本)/卷06', reason: SIMPLIFIED },
  { where: '坎', part: '六四小象', from: '剛柔济也', to: '剛柔際也', witness: '東坡易傳/29 (剛柔際也: 234 hits; 剛柔濟也: none in an 易 text)', reason: 'wrong character in the transcription' },
  { where: '觀', part: '卦辭', from: '盥而不荐', to: '盥而不薦', witness: '周易正義/03觀', reason: SIMPLIFIED },
  { where: '觀', part: '彖', from: '盥而不荐', to: '盥而不薦', witness: '周易正義/03觀', reason: SIMPLIFIED },
  { where: '觀', part: '六二小象', from: '亦可丑也', to: '亦可醜也', witness: '周易正義/03觀', reason: SIMPLIFIED },
  { where: '豐', part: '上六', from: '三歲不觌', to: '三歲不覿', witness: '周易正義/05困 (the same phrase in 困 初六)', reason: SIMPLIFIED },
  { where: '隨', part: '六二', from: '系小子', to: '係小子', witness: '童溪易傳 (四庫全書本)/卷09', reason: SIMPLIFIED },
  { where: '隨', part: '六二小象', from: '系小子', to: '係小子', witness: '原本周易本義 (四庫全書本)/卷05', reason: SIMPLIFIED },
  { where: '隨', part: '六三', from: '系丈夫', to: '係丈夫', witness: '童溪易傳 (四庫全書本)/卷09', reason: SIMPLIFIED },
  { where: '隨', part: '六三小象', from: '系丈夫', to: '係丈夫', witness: '原本周易本義 (四庫全書本)/卷05', reason: SIMPLIFIED },
  { where: '隨', part: '上六', from: '拘系之', to: '拘係之', witness: '兒易内儀以 (四庫全書本)/卷02', reason: SIMPLIFIED },
  { where: '隨', part: '上六小象', from: '拘系之', to: '拘係之', witness: '周易 (四部叢刊本)/卷二', reason: SIMPLIFIED },
  { where: '无妄', part: '六三', from: '或系之牛', to: '或繫之牛', witness: '周易要義 (四庫全書本)/卷03上', reason: SIMPLIFIED },
  { where: '遯', part: '九三', from: '系遯', to: '係遯', witness: '周易集説 (四庫全書本)/卷06', reason: SIMPLIFIED },
  { where: '遯', part: '九三小象', from: '系遯之厲', to: '係遯之厲', witness: '原本周易本義 (四庫全書本)/卷06', reason: SIMPLIFIED },
  { where: '姤', part: '初六', from: '系于金柅', to: '繫于金柅', witness: '合訂刪補大易集義粹言 (四庫全書本)/卷48', reason: SIMPLIFIED },
  { where: '姤', part: '初六小象', from: '系于金柅', to: '繫于金柅', witness: '原本周易本義 (四庫全書本)/卷06', reason: SIMPLIFIED },
  { where: '離', part: '彖', from: '百谷草木', to: '百穀草木', witness: '周易正義/03離', reason: SIMPLIFIED },
  { where: '大過', part: '九五小象', from: '亦可丑也', to: '亦可醜也', witness: '周易正義/03大過', reason: SIMPLIFIED },
  { where: '解', part: '六三小象', from: '亦可丑也', to: '亦可醜也', witness: '周易正義/04解', reason: SIMPLIFIED },
  { where: 'zhouyi-xici-shang.txt', part: 'text', from: '八卦相荡', to: '八卦相蕩', witness: '周易正義/07.01', reason: SIMPLIFIED },
  { where: 'zhouyi-xici-xia.txt', part: 'text', from: '長裕而不没', to: '長裕而不設', witness: '周易正義/08.6 (長裕而不沒 is unattested)', reason: 'wrong character in the transcription' },
  { where: 'zhouyi-shuogua.txt', part: 'text', from: '為大涂', to: '為大塗', witness: '周易正義/09.11', reason: SIMPLIFIED },
  { where: 'zhouyi-xugua.txt', part: 'text', from: '而后', to: '而後', count: 5, witness: '周易正義/10', reason: SIMPLIFIED },
]

function fix(where: string, part: string, value: string): string {
  let out = value
  for (const c of CORRECTIONS.filter(x => x.where === where && x.part === part)) {
    const n = out.split(c.from).length - 1
    if (n !== (c.count ?? 1)) throw new Error(`correction ${where} ${part}: 「${c.from}」 found ${n} times, expected ${c.count ?? 1}`)
    out = out.split(c.from).join(c.to)
  }
  return out
}

function applyCorrections(h: Hexagram): Hexagram {
  return {
    ...h,
    judgment: fix(h.name, '卦辭', h.judgment),
    tuan: fix(h.name, '彖', h.tuan),
    daxiang: fix(h.name, '大象', h.daxiang),
    yao: h.yao.map(y => ({ ...y, text: fix(h.name, y.label, y.text), xiaoxiang: fix(h.name, `${y.label}小象`, y.xiaoxiang) })),
  }
}

async function fetchPages(titles: string[]): Promise<Map<string, Page>> {
  const out = new Map<string, Page>()
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40)
    const url = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main',
      format: 'json', formatversion: '2', titles: batch.join('|'),
    })
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const j: any = await res.json()
    for (const p of j.query?.pages ?? []) {
      const rev = p.revisions?.[0]
      const content = rev?.slots?.main?.content
      if (typeof content !== 'string') throw new Error(`missing page: ${p.title}`)
      out.set(p.title, { title: p.title, revid: rev.revid, content })
    }
  }
  return out
}

/** Wiki markup out, text exactly as transcribed in. */
function clean(s: string): string {
  return s
    .replace(/-\{(?:[^{}|]*\|)?([^{}]*)\}-/g, '$1')            // -{无}- → 无
    .replace(/\{\{\*\|([^{}]*)\}\}/g, '（$1）')                  // {{*|一作太和}} → a visible variant note
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''|''/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t　]+/g, '')
    .trim()
}

const DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function cnNumber(s: string): number {
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? DIGITS[m[1]] : 1) * 10 + (m[2] ? DIGITS[m[2]] : 0)
  if (s.length === 1 && DIGITS[s]) return DIGITS[s]
  throw new Error(`numeral: ${s}`)
}

export type Yao = { label: string; text: string; xiaoxiang: string }
export type Hexagram = {
  n: number
  name: string            // King Wen name as the page titles it
  label: string           // how the 卦辭 names it (習坎 on 坎)
  lower: string
  upper: string
  lines: number[]         // bottom → top, 1 = yang
  judgment: string        // 卦辭 (朱熹: 彖辭, 「卦下之辭」)
  tuan: string            // 彖傳
  daxiang: string         // 大象
  yao: Yao[]              // six, bottom → top
  use?: Yao               // 用九 (乾) / 用六 (坤)
  wenyan?: string         // 文言 (乾/坤)
  page: string
  revid: number
}

/** A `**` line and the `***` lines that continue it (坤's 卦辭 runs over
 *  three), still in wiki markup so the caller can see the bold name. */
function withContinuationRaw(lines: string[]): string | null {
  const i = lines.findIndex(l => /^\*\*[^*#]/.test(l))
  if (i < 0) return null
  const parts = [lines[i].replace(/^\*\*/, '')]
  for (let j = i + 1; j < lines.length && /^\*\*\*/.test(lines[j]); j++) parts.push(lines[j].replace(/^\*\*\*/, ''))
  return parts.join('')
}
const withContinuation = (lines: string[]) => { const r = withContinuationRaw(lines); return r === null ? null : clean(r) }

function parseHexagram(n: number, title: string, page: Page): Hexagram {
  // A tag broken over two lines (坤: `*<span` / `style=…>'''易經：'''`) is one line.
  const raw = page.content.replace(/<([a-z]+)\s*\n\s*/g, '<$1 ')
  // Pages 1–21 link the book ([[周易]]　第三卦); 22–64 do not (周易　第二十二卦).
  const num = raw.match(/(?:\[\[)?周易(?:\]\])?[\s　]*第([一二三四五六七八九十]+)卦/)
  if (!num) throw new Error(`${title}: no 第N卦`)
  if (cnNumber(num[1]) !== n) throw new Error(`${title}: page says 第${num[1]}卦, expected ${n}`)

  const tri = clean(raw).match(/([乾坤震巽坎離艮兌])下([乾坤震巽坎離艮兌])上/)
  if (!tri) throw new Error(`${title}: no X下Y上 line`)
  const [, lower, upper] = tri

  // Sections by their header line.
  const lines = raw.split('\n')
  const sections: Record<string, string[]> = {}
  let cur = ''
  for (const line of lines) {
    const h = line.match(/^\*\s*(?:<span[^>]*>)?\s*'''(易經|彖曰|象曰|文言曰)：'''/)
    if (h) { cur = h[1]; sections[cur] = []; continue }
    if (cur && /^\*/.test(line)) sections[cur].push(line)
  }
  for (const s of ['易經', '彖曰', '象曰']) if (!sections[s]?.length) throw new Error(`${title}: no ${s} section`)

  // 易經: one ** line (卦辭), then *# lines (爻辭, then 用九/用六).
  const jing = sections['易經']
  // The 卦辭 opens with the bold name. Followed by a colon it is a label
  // (乾：元亨。利貞。); followed by text it is the first word of the sentence
  // (履虎尾，不咥人，亨。 否之匪人 同人于野) and stays in the text.
  const headRaw = withContinuationRaw(jing)
  if (!headRaw) throw new Error(`${title}: no 卦辭`)
  const hm = clean(headRaw.replace(/'''([^']+)'''/, '⟦$1⟧')).match(/^⟦([^⟧]+)⟧(：)?([\s\S]+)$/)
  if (!hm) throw new Error(`${title}: 卦辭 does not open with the bold name`)
  const label = hm[1]
  const judgment = hm[2] ? hm[3] : hm[1] + hm[3]
  const yaoRaw = jing.filter(l => /^\*#/.test(l)).map(l => clean(l.replace(/^\*#/, '')))
  const yaoParsed = yaoRaw.map(t => {
    // 否 writes its labels with a comma (初六，拔茅茹…); the rest with a colon.
    const m = t.match(/^(初[九六]|[九六][二三四五]|上[九六]|用[九六])[：，:,]([\s\S]+)$/)
    if (!m) throw new Error(`${title}: bad 爻 line: ${t}`)
    return { label: m[1], text: m[2] }
  })
  const six = yaoParsed.filter(y => !y.label.startsWith('用'))
  const use = yaoParsed.find(y => y.label.startsWith('用'))
  if (six.length !== 6) throw new Error(`${title}: ${six.length} 爻`)
  six.forEach((y, i) => {
    if (!y.label.includes(POSITIONS[i])) throw new Error(`${title}: 爻 ${i + 1} labelled ${y.label}`)
  })

  // Check 2 vs check 3: trigram line and 爻 labels must give the same lines.
  const fromTrigrams = [...TRIGRAM_LINES[lower], ...TRIGRAM_LINES[upper]]
  const fromLabels = six.map(y => (y.label.includes('九') ? 1 : 0))
  if (fromTrigrams.join('') !== fromLabels.join('')) {
    throw new Error(`${title}: ${lower}下${upper}上 gives ${fromTrigrams.join('')} but the 爻 labels give ${fromLabels.join('')}`)
  }
  if ((n === 1) !== (use?.label === '用九') || (n === 2) !== (use?.label === '用六') || (use && n > 2)) {
    throw new Error(`${title}: unexpected 用 line ${use?.label}`)
  }

  // 彖曰: every line, joined.
  const tuan = sections['彖曰'].map(l => clean(l.replace(/^\*+#?:?/, ''))).filter(Boolean).join('')

  // 象曰: the ** line is the 大象, the *# lines are the 小象 in 爻 order.
  const xiang = sections['象曰']
  const daxiang = withContinuation(xiang)
  if (!daxiang) throw new Error(`${title}: no 大象`)
  const xiao = xiang.filter(l => /^\*#/.test(l)).map(l => clean(l.replace(/^\*#/, '')))
  const want = use ? 7 : 6
  if (xiao.length !== want) throw new Error(`${title}: ${xiao.length} 小象, expected ${want}`)

  const yao: Yao[] = six.map((y, i) => ({ ...y, xiaoxiang: xiao[i] }))
  const useYao: Yao | undefined = use ? { ...use, xiaoxiang: xiao[6] } : undefined

  let wenyan: string | undefined
  if (sections['文言曰']?.length) {
    wenyan = sections['文言曰']
      .map(l => clean(l.replace(/^\*+[#:]*/, '')))
      .filter(Boolean)
      .join('\n')
  }
  if ((n <= 2) !== Boolean(wenyan)) throw new Error(`${title}: 文言 ${wenyan ? 'present' : 'missing'}`)

  for (const [k, v] of Object.entries({ judgment, tuan, daxiang })) if (!v) throw new Error(`${title}: empty ${k}`)
  return {
    n, name: title, label, lower, upper, lines: fromTrigrams, judgment, tuan, daxiang, yao,
    ...(useYao ? { use: useYao } : {}), ...(wenyan ? { wenyan } : {}),
    page: page.title, revid: page.revid,
  }
}

/** A 十翼 page as quotable paragraphs for lib/classics (header, blank line, paragraphs). */
function zhuanText(book: string, page: Page): string {
  // Chapter headings (==第一章==) and template-only lines clean down to
  // nothing or a few characters and drop out; {{gap}} paragraphs stay.
  const paras = page.content
    .split('\n')
    .filter(l => !/^\s*(\||\[\[File:|__)/.test(l))
    .map(l => clean(l.replace(/^[*#:;]+/, '').replace(/^=+.*=+$/, '')))
    .filter(l => l.length >= 8)
  if (paras.length < 3) throw new Error(`${page.title}: only ${paras.length} paragraphs`)
  return `${book}（《周易》十翼）\n來源：維基文庫《周易》，${page.title}（公有領域），revision ${page.revid}\n\n${paras.join('\n\n')}\n`
}

async function main() {
  const pages = await fetchPages([...TITLES.map(t => `周易/${t}`), ...ZHUAN.map(z => z.title)])
  const hexagrams = TITLES.map((t, i) => {
    const p = pages.get(`周易/${t}`)
    if (!p) throw new Error(`not fetched: 周易/${t}`)
    return applyCorrections(parseHexagram(i + 1, t, p))
  })
  // Every correction must have been used: a stale entry means Wikisource
  // changed underneath us and the table needs a look.
  const parts = new Set(hexagrams.flatMap(h => [h.name + '|卦辭', h.name + '|彖', h.name + '|大象', ...h.yao.flatMap(y => [h.name + '|' + y.label, h.name + '|' + y.label + '小象'])]))
  for (const c of CORRECTIONS) if (!c.where.endsWith('.txt') && !parts.has(c.where + '|' + c.part)) throw new Error(`correction points nowhere: ${c.where} ${c.part}`)
  // Every six-line pattern exactly once.
  const patterns = new Set(hexagrams.map(h => h.lines.join('')))
  if (patterns.size !== 64) throw new Error(`only ${patterns.size} distinct patterns`)

  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify({
    source: {
      title: '周易',
      url: 'https://zh.wikisource.org/wiki/周易',
      license: 'Public domain. Transcription from 維基文庫 (zh.wikisource.org).',
      fetched: new Date().toISOString().slice(0, 10),
      note: 'Text as transcribed on Wikisource; wiki markup removed, variant notes shown as （一作…）, and the corrections listed here applied, each with a witness edition.',
      corrections: CORRECTIONS,
    },
    hexagrams,
  }, null, 1) + '\n')

  for (const z of ZHUAN) {
    const p = pages.get(z.title)
    if (!p) throw new Error(`not fetched: ${z.title}`)
    await fs.writeFile(path.join(CLASSICS, z.file), fix(z.file, 'text', zhuanText(z.book, p)))
  }

  const chars = hexagrams.reduce((s, h) => s + h.judgment.length + h.tuan.length + h.daxiang.length
    + h.yao.reduce((a, y) => a + y.text.length + y.xiaoxiang.length, 0) + (h.wenyan?.length ?? 0), 0)
  console.log(`64 hexagrams, ${chars} characters, all three checks agree → ${path.relative(process.cwd(), OUT)}`)
  for (const z of ZHUAN) console.log(`${z.book} → content/classics/${z.file}`)
}

main().catch(e => { console.error(e); process.exit(1) })
