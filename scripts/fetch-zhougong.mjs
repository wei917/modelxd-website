// scripts/fetch-zhougong.mjs — 解夢's book: 《周公解夢》 from Chinese
// Wikisource (public domain, {{Pd-old}}), as content/jiemeng/zhougong.json.
//
// The page is a folk dream book: an eight-line preface poem, then 27 themed
// sections of seven-character entries, image then meaning (「被馬咬有祿位至」).
// Each entry keeps its section and, beside the Traditional text, a
// Simplified and a Japanese-kanji form (OpenCC, used here only, at build
// time), so a dream written in any of the three finds the same entries. The
// page revision is recorded so the file can be rebuilt byte for byte.
//
//   npm i --no-save opencc-js@1 && node scripts/fetch-zhougong.mjs [revid]
// (or with NODE_PATH pointing at an opencc-js install elsewhere)

import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OpenCC = require('opencc-js')
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })
const toJa = OpenCC.Converter({ from: 'tw', to: 'jp' })

const TITLE = '周公解夢'
const API = 'https://zh.wikisource.org/w/api.php'
const UA = 'ModelXD-build/1.0 (https://www.modelxd.com)'
const pinned = process.argv[2]

const q = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|content|timestamp', rvslots: 'main', format: 'json', formatversion: '2', ...(pinned ? { revids: pinned } : { titles: TITLE }) })
const res = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } })
const page = (await res.json()).query.pages[0]
const rev = page.revisions[0]
const text = rev.slots.main.content
if (!/\{\{Pd-old\}\}/.test(text)) throw new Error('the page no longer carries {{Pd-old}}: check its licence before using it')

const preface = []
const sections = []
for (const raw of text.split('\n')) {
  const line = raw.trim()
  if (!line || line.startsWith('{{') || line === '詩曰') continue
  const head = line.match(/^==\s*(.+?)\s*==$/)
  if (head) { sections.push({ title: head[1], entries: [] }); continue }
  const parts = line.split(/[　\s]+/).filter(Boolean)
  if (!sections.length) { preface.push(...parts); continue }
  sections.at(-1).entries.push(...parts)
}

let id = 0
const out = {
  source: {
    title: `《${TITLE}》`, site: '維基文庫 (zh.wikisource.org)', page: `https://zh.wikisource.org/wiki/${encodeURIComponent(TITLE)}`,
    revid: rev.revid, revTimestamp: rev.timestamp, licence: 'Public domain ({{Pd-old}})',
    note: 'Folk dream book traditionally attributed to 周公; Simplified and Japanese forms by OpenCC (tw→cn, tw→jp).',
  },
  preface,
  sections: sections.map(s => ({ title: s.title, s: toHans(s.title) })),
  entries: sections.flatMap((s, si) => s.entries.map(t => ({ id: id++, section: si, t, s: toHans(t), j: toJa(t) }))),
}
fs.mkdirSync('content/jiemeng', { recursive: true })
fs.writeFileSync('content/jiemeng/zhougong.json', JSON.stringify(out) + '\n')
console.log(`revision ${rev.revid} (${rev.timestamp}): ${out.sections.length} sections, ${out.entries.length} entries, preface ${preface.length} lines`)
