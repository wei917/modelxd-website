// scripts/fetch-guandi-qian.ts — build the 關聖帝君靈籤 corpus.
//
//   npx tsx scripts/fetch-guandi-qian.ts        → content/qian/guandi.json
//
// Source: 維基文庫《關聖帝君靈籤》(清刊本, 姑蘇鈕氏藏板; public domain —
// author dead >100 years, published before 1931). Fetched through the
// MediaWiki API in two batches of 50 (anonymous bulk page loads without a
// User-Agent get refused).
//
// The hundred pages were transcribed by two hands in two formats:
//   A (籤 1–10):   ==第一籤　甲甲　大吉==, <poem>, ===聖意=== … ===占驗===
//   B (籤 11–100): ==第11簽 下下 ==, two 。-joined lines, '''聖意：''' …
//                  '''故事及記載：''', plus a modern twelve-topic sheet
//                  (功名/六甲/求財/…) inside 聖意.
// Both carry the Qing commentaries (聖意, 東坡解, 碧仙註, 解曰, 釋義; A adds
// 占驗, B adds the 典故 story). The twelve-topic sheet is a 20th-century
// temple 解籤簿, not the Qing text, so it is DROPPED — only the clearly
// public-domain edition goes in. ■ marks in B are the transcriber's
// variant-character notes and are stripped. The 甲子 label absent from B is
// derived: 第n籤 = STEMS[(n-1)/10] + STEMS[(n-1)%10] (第一籤 甲甲 … 第十籤
// 甲癸 … 第一百籤 癸癸), which matches every A page.

import fs from 'node:fs/promises'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'content', 'qian', 'guandi.json')
const UA = 'ModelXD-XTell/1.0 (https://modelxd.com; public-domain corpus fetch)'
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const SECTIONS = ['聖意', '東坡解', '碧仙註', '解曰', '釋義', '占驗'] as const
const TOPIC = /^(功名|六甲|求財|婚姻|農畜|農牧|失物|生意|丁口|出行|疾病|官司|時運|家宅|移徙|求子|田蠶|六畜|尋人|行人|訟事|求醫|山墳|自身|財運)[：:]/

export type Qian = {
  n: number
  ganZhi: string
  luck: string
  story: string
  poem: string[]
  sections: Record<string, string>
}

async function fetchBatch(from: number, to: number): Promise<Map<number, string>> {
  const titles = Array.from({ length: to - from + 1 }, (_, i) => `關聖帝君靈籤/${from + i}`).join('|')
  const url = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', titles,
  })
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j: any = await res.json()
  const out = new Map<number, string>()
  for (const p of j.query?.pages ?? []) {
    const n = Number(String(p.title).split('/')[1])
    const c = p.revisions?.[0]?.slots?.main?.content
    if (Number.isInteger(n) && typeof c === 'string') out.set(n, c)
  }
  return out
}

function clean(s: string): string {
  return s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''/g, '')
    .split('\n')
    .map(l => l.replace(/^■\s*/, '').replace(/[ \t　]+/g, ' ').trim())
    // A line that still holds ■ is a variant-character note (道■識); a bare
    // one is a separator. Neither is text.
    .filter(l => l && !l.includes('■'))
    .join('\n')
    .trim()
}

const ganZhiOf = (n: number) => STEMS[Math.floor((n - 1) / 10)] + STEMS[(n - 1) % 10]

function parseA(n: number, raw: string): Qian {
  const head = raw.match(/^==\s*第[^\s　=]+籤\s*[　\s]*([^\s　=]+)[　\s]+([^\s　=]+)\s*==/m)
  if (!head) throw new Error(`籤 ${n}: no A header`)
  const poemM = raw.match(/<poem>([\s\S]*?)<\/poem>/)
  if (!poemM) throw new Error(`籤 ${n}: no poem`)
  const poem = poemM[1].split('\n').map(l => clean(l)).filter(Boolean)
  const story = clean(raw.slice(head.index! + head[0].length, poemM.index!))
  const sections: Record<string, string> = {}
  for (const name of SECTIONS) {
    const m = raw.match(new RegExp(`===\\s*${name}\\s*===([\\s\\S]*?)(?=\\n===|$)`))
    if (m) { const t = clean(m[1]); if (t) sections[name] = t }
  }
  if (head[1] !== ganZhiOf(n)) throw new Error(`籤 ${n}: label ${head[1]} ≠ derived ${ganZhiOf(n)}`)
  return { n, ganZhi: head[1], luck: head[2], story, poem, sections }
}

function parseB(n: number, raw: string): Qian {
  const head = raw.match(/^==\s*第\s*(\d+)\s*[籤簽]\s*([^\s=]+)\s*==/m)
  if (!head || Number(head[1]) !== n) throw new Error(`籤 ${n}: no B header`)
  const firstBold = raw.indexOf("'''")
  const pre = clean(raw.slice(head.index! + head[0].length, firstBold < 0 ? undefined : firstBold)).split('\n')
  // The poem is the two 。-joined lines; whatever precedes them is the story title.
  const poemIdx = pre.findIndex(l => (l.match(/。/g) ?? []).length >= 2)
  if (poemIdx < 0) throw new Error(`籤 ${n}: no poem lines`)
  const poem = pre.slice(poemIdx, poemIdx + 2).join('').split('。').map(s => s.trim()).filter(Boolean)
  const story = pre.slice(0, poemIdx).join('；')
  const sections: Record<string, string> = {}
  const re = /'''([^']+?)[：:]?'''([\s\S]*?)(?='''|$)/g
  for (const m of raw.matchAll(re)) {
    const name = m[1].trim()
    const body = clean(m[2]).split('\n').filter(l => !TOPIC.test(l)).join('\n').trim()
    if (!body) continue
    if (name === '故事及記載') sections['典故'] = body
    else if ((SECTIONS as readonly string[]).includes(name)) sections[name] = body
  }
  return { n, ganZhi: ganZhiOf(n), luck: head[2], story, poem, sections }
}

export function parseQian(n: number, raw: string): Qian {
  const q = raw.includes('<poem>') ? parseA(n, raw) : parseB(n, raw)
  if (q.poem.length !== 4) throw new Error(`籤 ${n}: poem has ${q.poem.length} lines: ${q.poem.join('/')}`)
  if (!q.sections['聖意'] || !q.sections['解曰']) throw new Error(`籤 ${n}: missing 聖意/解曰`)
  return q
}

async function main() {
  const pages = new Map<number, string>()
  for (const [a, b] of [[1, 50], [51, 100]]) for (const [k, v] of await fetchBatch(a, b)) pages.set(k, v)
  const out: Qian[] = []
  for (let n = 1; n <= 100; n++) {
    const raw = pages.get(n)
    if (!raw) throw new Error(`籤 ${n}: page missing`)
    const q = parseQian(n, raw)
    out.push(q)
    console.log(`${n} ${q.ganZhi} ${q.luck} ${q.poem[0]}  [${Object.keys(q.sections).join(' ')}]`)
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n')
  console.log(`\nwrote ${out.length} 籤 → ${path.relative(process.cwd(), OUT)}`)
}

if (process.argv[1]?.endsWith('fetch-guandi-qian.ts')) main().catch(e => { console.error(e); process.exit(1) })
