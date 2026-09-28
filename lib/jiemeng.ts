// lib/jiemeng.ts — 解夢's server half (owner, Sep 27). Reads
// content/jiemeng/zhougong.json (scripts/fetch-zhougong.mjs): 《周公解夢》
// from Wikisource, public domain, 27 themed sections of seven-character
// entries, image then meaning (「被馬咬有祿位至」).
//
// What makes this more than a chat window: the visitor's dream is matched,
// by code, against the book, and the entries it finds are shown free and are
// the only lines a teacher may quote. The match is plain text: the dream's
// two-character runs and content characters against the image half of each
// entry (its first four or five characters), in the Traditional, Simplified
// and Japanese-kanji forms, so 夢見龍 / 梦见龙 / 竜の夢 find the same lines. A
// dream written only in English or Korean finds none, and the teacher is
// told so rather than invent the book.
//
// Server-only (node:fs).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Entry = { id: number; section: number; t: string; s: string; j: string }
type Corpus = { source: Record<string, unknown>; preface: string[]; sections: Array<{ title: string; s: string }>; entries: Entry[] }
let corpus: Corpus | null = null
const book = (): Corpus => corpus ??= JSON.parse(readFileSync(join(process.cwd(), 'content', 'jiemeng', 'zhougong.json'), 'utf-8'))

export const DREAM_MAX = 1500
export const ASK_MAX = 300

export function dreamProblem(dream: unknown): 'dream_required' | 'dream_too_long' | null {
  if (typeof dream !== 'string' || !dream.trim()) return 'dream_required'
  return dream.length > DREAM_MAX ? 'dream_too_long' : null
}

/** A matched entry: the section and the line, Traditional and Simplified. */
export type DreamMatch = { id: number; section: string; sectionS: string; t: string; s: string }

// Characters too common in the telling of a dream to point at an entry on
// their own (they still count inside a two-character run).
const STOP = new Set([...'我你他她它們们的了在是一個个到被很著着也就還还又和跟與与這这那有沒没不上下中裡里夢梦見见看做說说想好會会要去來来人大小主事吉凶得之者時时候後后前自己家都把給给讓让從从對对再才只但而且或所以因為为然嗎吗呢吧啊喔哦著過过已經经直後来掉進进裡里面邊边些很多少子兒儿'])
const CJK = /[㐀-鿿豈-﫿]/

/** How telling each character is at the head of an entry: rare subjects
 *  (蛇, 齒, 棺) outweigh common ones (水, 天), so a dream about a snake by
 *  the water is not answered with a dozen 水 lines. */
let idf: Map<string, number> | null = null
function weights(): Map<string, number> {
  if (idf) return idf
  const df = new Map<string, number>()
  const { entries } = book()
  for (const e of entries) for (const c of new Set([...e.t.slice(0, 4), ...e.s.slice(0, 4), ...e.j.slice(0, 4)])) df.set(c, (df.get(c) ?? 0) + 1)
  idf = new Map([...df].map(([c, n]) => [c, Math.log(entries.length / n)]))
  return idf
}

/** The book's entries a dream points at: best first, at most `max`. A
 *  two-character run inside an entry's image counts most; a single
 *  character counts by how rare it is there, more at the start (the
 *  entry's subject). Matches far weaker than the best are dropped. */
export function dreamMatches(text: string, max = 12): DreamMatch[] {
  const runs = (text ?? '').split(/[^\u3400-\u9fff\uf900-\ufaff]+/).filter(Boolean)
  const pairs = new Set<string>(), singles = new Set<string>()
  for (const r of runs) {
    for (let i = 0; i + 1 < r.length; i++) pairs.add(r.slice(i, i + 2))
    for (const c of r) if (CJK.test(c) && !STOP.has(c)) singles.add(c)
  }
  if (!pairs.size && !singles.size) return []
  const { entries, sections } = book()
  const w = weights()
  const scored: Array<{ e: Entry; score: number }> = []
  for (const e of entries) {
    let best = 0
    for (const v of [e.t, e.s, e.j]) {
      const image = v.slice(0, 5)
      let score = 0
      for (const p of pairs) if (image.includes(p)) score += 6
      for (const c of singles) {
        const at = v.slice(0, 4).indexOf(c)
        if (at >= 0) score += (w.get(c) ?? 0) * (at <= 1 ? 1.5 : 1)
      }
      best = Math.max(best, score)
    }
    if (best >= 4) scored.push({ e, score: best })
  }
  const top = scored.reduce((m, x) => Math.max(m, x.score), 0)
  return scored
    .filter(x => x.score >= top * 0.55)
    .sort((a, b) => b.score - a.score || a.e.id - b.e.id)
    .slice(0, max)
    .sort((a, b) => a.e.id - b.e.id)
    .map(({ e }) => ({ id: e.id, section: sections[e.section].title, sectionS: sections[e.section].s, t: e.t, s: e.s }))
}

/** The teacher's facts: the dream as written, the question, and the book's
 *  matched lines (the only ones that may be quoted). */
export function dreamFacts(dream: string, ask: string, matches: DreamMatch[]): string {
  return [
    `來訪者的夢（照錄）：\n「${dream.trim()}」`,
    ask.trim() ? `想問的事或最近的處境：${ask.trim()}` : '',
    matches.length
      ? `系統以文字比對，在《周公解夢》（維基文庫本；民間夢書，傳統上託名周公）找到的條目（照錄；引用時註明類別）：\n${matches.map(m => `- 〔${m.section}〕${m.t}`).join('\n')}`
      : '系統沒有在《周公解夢》找到文字相符的條目（夢若不是用中文或日文漢字寫的，也比對不到）。不要引用或杜撰《周公解夢》的原文；只能概括說明這類夢在傳統上的看法，並說明書中沒有直接對應的條目。',
  ].filter(Boolean).join('\n\n')
}
