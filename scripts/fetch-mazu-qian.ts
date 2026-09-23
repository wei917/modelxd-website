// scripts/fetch-mazu-qian.ts — build the 天上聖母六十甲子籤 corpus.
//
//   npx tsx scripts/fetch-mazu-qian.ts        → content/qian/mazu.json
//
// Source: 維基文庫《天上聖母六十甲子籤》, public domain — the 六十甲子籤 set
// used at 大甲鎮瀾宮, 北港朝天宮 and most Mazu temples in Taiwan. One page,
// sixty entries, each: number + 甲子 label, a 五行/season/direction line
// (屬金利秋 宜其西方), a four-line poem, and the 卦頭故事 (the historical
// tales the stick alludes to). This edition carries no per-topic 解曰 and no
// 吉凶 grade, so `luck` holds the 五行 line and the stories go in a section
// so the board and the master both see them. Same shape as guandi.json.

import fs from 'node:fs/promises'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'content', 'qian', 'mazu.json')
const UA = 'ModelXD-XTell/1.0 (https://modelxd.com; public-domain corpus fetch)'
const TITLE = '天上聖母六十甲子籤'

type Qian = { n: number; ganZhi: string; luck: string; story: string; poem: string[]; sections: Record<string, string> }

async function fetchRaw(): Promise<string> {
  const url = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', titles: TITLE,
  })
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j: any = await res.json()
  const c = j.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content
  if (typeof c !== 'string') throw new Error('no content')
  return c
}

const clean = (s: string) => s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').replace(/[ \t　]+/g, ' ').trim()

export function parseMazu(raw: string): Qian[] {
  const out: Qian[] = []
  const re = /^\s*(\d+)\.\s*【([^】]+)】\s*([^\n]*)\n籤詩：\s*\n([^\n]+)\n([^\n]+)\n(?:卦頭故事：\s*([^\n]*))?/gm
  for (const m of raw.matchAll(re)) {
    const n = Number(m[1])
    const label = clean(m[2])                    // 甲子第一
    const ganZhi = label.slice(0, 2)
    const luck = clean(m[3])                      // 屬金利秋 宜其西方
    const poem = [m[4], m[5]].map(clean).join('').split(/[，。]/).map(s => s.trim()).filter(Boolean)
    const stories = clean(m[6] ?? '').replace(/[。.]$/, '')
    out.push({
      n, ganZhi, luck, story: stories.split(/[、，]/)[0] ?? '', poem,
      sections: stories ? { 卦頭故事: stories } : {},
    })
  }
  return out
}

async function main() {
  const qian = parseMazu(await fetchRaw())
  if (qian.length !== 60) throw new Error(`parsed ${qian.length} sticks, expected 60`)
  for (const q of qian) {
    if (q.poem.length !== 4) throw new Error(`籤 ${q.n}: poem has ${q.poem.length} lines: ${q.poem.join('/')}`)
    console.log(`${q.n} ${q.ganZhi} ${q.luck} ${q.poem[0]} · ${q.story}`)
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify(qian, null, 1) + '\n')
  console.log(`\nwrote ${qian.length} 籤 → ${path.relative(process.cwd(), OUT)}`)
}

if (process.argv[1]?.endsWith('fetch-mazu-qian.ts')) main().catch(e => { console.error(e); process.exit(1) })
