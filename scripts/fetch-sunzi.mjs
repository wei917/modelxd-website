// scripts/fetch-sunzi.mjs — 孫子兵法's book: 《孫子兵法》 from Chinese
// Wikisource, as content/sunzi/sunzi.json (Sep 29).
//
// The page holds the thirteen chapters (始計第一 … 用間第十三) and, after
// them, 孫星衍's appended 答話 and notes, which are not 孫子's text and are
// left out. The work is 孫武's (c. 500 BC), public domain everywhere; the
// page has no licence tag of its own, so the header's author is checked
// instead. Each chapter is split into its paragraphs and those into
// sentences (at 。！, a closing 」 kept with its sentence; see sentences()):
// the sentence is the unit a quick model picks and a teacher may quote. Links keep their
// text; {{另|A|B}} (A, "B in another edition") keeps A, the page's reading.
// A Simplified form of each line is added with OpenCC (tw→cn) for 简体
// pages, at build time only. The revision is recorded so the file can be
// rebuilt byte for byte.
//
//   NODE_PATH=<dir with opencc-js@1> node scripts/fetch-sunzi.mjs [revid]

import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OpenCC = require('opencc-js')
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })

const TITLE = '孫子兵法'
const API = 'https://zh.wikisource.org/w/api.php'
const UA = 'ModelXD-build/1.0 (https://www.modelxd.com)'
const pinned = process.argv[2]
const CHAPTERS = ['始計第一', '作戰第二', '謀攻第三', '軍形第四', '兵勢第五', '虛實第六', '軍爭第七', '九變第八', '行軍第九', '地形第十', '九地第十一', '火攻第十二', '用間第十三']

const q = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|content|timestamp', rvslots: 'main', format: 'json', formatversion: '2', ...(pinned ? { revids: pinned } : { titles: TITLE }) })
const res = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } })
const page = (await res.json()).query.pages[0]
const rev = page.revisions[0]
const text = rev.slots.main.content
if (!/\|author=孫武/.test(text)) throw new Error('the page header no longer names 孫武: check what the page is before using it')

const clean = s => s
  .replace(/\{\{另\|([^|}]*)\|[^}]*\}\}/g, '$1')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .trim()

// Split a paragraph after 。 or ！ (and a closing quote right after them),
// not after ？: 始計's 七計 are seven short questions and one answer
// (「主孰有道？將孰有能？……吾以此知勝負矣。」), one thought. A
// sentence over LONG characters is a list joined by ； (行軍's 「敵近而靜者，
// 恃其險也；遠而挑戰者……」 runs to 304), so it is split at each ； too; a
// sentence of three characters or fewer (「微哉！微哉！」) joins the next.
const LONG = 100
const sentences = p => {
  const out = []
  let carry = ''
  for (const raw of p.match(/[^。！]+[。！][」』]*|[^。！]+$/g) ?? []) {
    const s = carry + raw.trim()
    if (!s) continue
    if (s.replace(/[，。？！；：「」『』、]/g, '').length <= 3) { carry = s; continue }
    carry = ''
    out.push(...(s.length > LONG ? s.match(/[^；]+；|[^；]+$/g).map(x => x.trim()).filter(Boolean) : [s]))
  }
  if (carry) out.push(carry)
  return out
}

const heads = [...text.matchAll(/^==\s*(.+?)\s*==\s*$/gm)]
const chapters = []
for (const [i, h] of heads.entries()) {
  if (!CHAPTERS.includes(h[1])) continue
  const body = text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length)
  const paras = body.split(/\n\s*\n/).map(clean).filter(p => p && !p.startsWith('[[Category'))
  chapters.push({ title: h[1], paras })
}
if (chapters.map(c => c.title).join() !== CHAPTERS.join()) throw new Error(`expected the thirteen chapters, got ${chapters.map(c => c.title).join(' ')}`)

let id = 0
const lines = []
chapters.forEach((c, ci) => c.paras.forEach((p, pi) => sentences(p).forEach(t => lines.push({ id: id++, chapter: ci, para: pi, t, s: toHans(t) }))))
const out = {
  source: {
    title: `《${TITLE}》`, author: '孫武', site: '維基文庫 (zh.wikisource.org)', page: `https://zh.wikisource.org/wiki/${encodeURIComponent(TITLE)}`,
    revid: rev.revid, revTimestamp: rev.timestamp, licence: 'Public domain (孫武, c. 500 BC)',
    note: 'The thirteen chapters only (the appended 答話 and notes are left out); {{另}} variants keep the page reading; Simplified by OpenCC (tw→cn).',
  },
  chapters: chapters.map(c => ({ title: c.title, s: toHans(c.title), short: c.title.replace(/第.+$/, ''), paras: c.paras.length })),
  lines,
}
fs.mkdirSync('content/sunzi', { recursive: true })
fs.writeFileSync('content/sunzi/sunzi.json', JSON.stringify(out) + '\n')
console.log(`revision ${rev.revid} (${rev.timestamp}): ${out.chapters.length} chapters, ${lines.length} lines, ${lines.reduce((n, l) => n + l.t.length, 0)} characters`)
