// lib/classics.ts — grounding XTell readings in the actual classics.
//
// Idea learned from Sudo-Biao/Chinese-Metaphysics-Platform (MIT), which
// grounds its readings in an 8,600-line classical knowledge base with BM25
// retrieval: a 批文 that quotes 《滴天髓》 reads like a master, a 批文 made
// of free prose reads like a chatbot. Our v1 is deliberately small — two
// public-domain texts from Wikisource, CJK-bigram scoring instead of real
// BM25 — because the payoff is in the citations existing at all.
//
// The passages are handed to the master as OPTIONAL material with the source
// named; the prompt orders it to cite by book title and to ignore anything
// irrelevant. The model never fabricates a classic — everything quotable is
// in the corpus, on disk, checkable.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Temple } from './xtell'
import { keyOf, segments } from './yijing-retrieval'
import { HEXAGRAMS } from './yijing-core'

const DIR = join(process.cwd(), 'content', 'classics')

// temple -> corpus files (八字 texts serve 月老 too: 合婚 is read off two
// 八字 charts).
const SOURCES: Record<Temple, string[]> = {
  bazi:   ['ditiansui.txt'],
  yuelao: ['ditiansui.txt'],
  ziwei:  ['ziweiquanshu-j1.txt'],
  // 關帝廟: the 籤's own six commentaries ride with the poem (lib/xtell.ts
  // guandiFacts) — 一籤一書 — so nothing here to retrieve.
  guandi:   [],
  mazu:     [],
  xingming: [],
  // 測字亭: 清 程省《測字秘牒》, the one classic of the craft (Wikisource).
  cezi:     ['cezimidie.txt'],
  // 四面佛 reads the visitor's 八字 against the four faces.
  simianfo: ['ditiansui.txt'],
  // 九曜廟: the Tang 《宿曜經》 (Amoghavajra), the text that carried the
  // twelve signs and 27 nakshatras into Chinese — its 宿 names are the ones
  // the facts use, so retrieval lands on the visitor's actual 宿.
  navagraha: ['suyaojing.txt'],
  // 占星塔 has no corpus. Its classics are Ptolemy's Tetrabiblos and Lilly's
  // Christian Astrology, neither of which is in content/classics — and
  // pointing it at 《宿曜經》 because that file happens to mention the twelve
  // signs would ground a Western reading in a Buddhist text about a different
  // system. An empty corpus is honest; a wrong one reads as authority.
  zhanxing: [],
  // 易學堂: the 十翼 outside the hexagram pages (繫辭上下, 說卦, 序卦, 雜卦).
  // 彖/象/文言 ride with each hexagram's own text in lib/yijing.ts.
  yixue: ['zhouyi-xici-shang.txt', 'zhouyi-xici-xia.txt', 'zhouyi-shuogua.txt', 'zhouyi-xugua.txt', 'zhouyi-zagua.txt'],
}

type Passage = { book: string; text: string }

const cache = new Map<string, Passage[]>()

// `min` drops fragments. The 易學堂 keeps every line (min 1): 序卦 and 雜卦
// lines are short, and its phrase index must hold the whole text.
function passagesOf(file: string, min = 24): Passage[] {
  const id = `${file}:${min}`
  if (cache.has(id)) return cache.get(id)!
  const path = join(DIR, file)
  if (!existsSync(path)) { cache.set(id, []); return [] }
  const raw = readFileSync(path, 'utf-8')
  const [header, ...body] = raw.split('\n\n')
  const book = header.match(/《[^》]+》/)?.[0] ?? file
  // Passage = paragraph, split further so nothing exceeds ~420 chars — a
  // quotable unit, not a chapter.
  const out: Passage[] = []
  for (const para of body.join('\n\n').split(/\n{2,}/)) {
    const p = para.trim()
    if (p.length < min) continue
    if (p.length <= 420) { out.push({ book, text: p }); continue }
    for (const piece of p.split(/(?<=[。！？])/).reduce<string[]>((acc, s) => {
      const last = acc[acc.length - 1]
      if (last !== undefined && last.length + s.length <= 420) acc[acc.length - 1] = last + s
      else acc.push(s)
      return acc
    }, [])) {
      if (piece.trim().length >= min) out.push({ book, text: piece.trim() })
    }
  }
  cache.set(id, out)
  return out
}

/** CJK bigrams — the workable unit for Chinese scoring without a tokenizer. */
function bigrams(s: string): Set<string> {
  const chars = s.replace(/[^一-鿿]/g, '')
  const out = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) out.add(chars.slice(i, i + 2))
  return out
}

/**
 * Top passages for this consultation. The query is the visitor's question
 * plus the chart's own vocabulary (day master, pillars, strong gods) so a
 * questionless "full reading" still retrieves on the chart's terms.
 */
export function classicPassages(temple: Temple, query: string, limit = 3): Passage[] {
  if (temple === 'yixue') return yixuePassages(query, limit)
  const q = bigrams(query)
  if (q.size === 0) return []
  const scored: Array<{ p: Passage; score: number }> = []
  for (const file of SOURCES[temple]) {
    for (const p of passagesOf(file)) {
      let hit = 0
      const pb = bigrams(p.text)
      for (const b of q) if (pb.has(b)) hit++
      if (hit > 0) scored.push({ p, score: hit / Math.sqrt(pb.size) })
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.p)
}

/** Every 十翼 line and passage, for lib/yijing.ts's phrase index. */
export const yixueBookPassages = (): Passage[] => SOURCES.yixue.flatMap(f => passagesOf(f, 1))

// 易學堂 only. The 十翼 are short and full of words modern questions share
// (天下, 君子, 可以, 之道), so one shared bigram proves nothing: under the
// rule above, 「可以教我易經嗎」 matched 繫辭下 through 以教. Here:
//   - both sides are folded (lib/yijing-retrieval), so simplified and
//     Japanese questions match, and question bigrams stay inside one clause;
//   - a bigram in more than COMMON passages distinguishes nothing;
//   - a bigram with a grammar character (之, 以, 的 …), made only of numerals
//     (「通勤二十分鐘」 must not reach 大衍之數), ending in 卦, or equal to a
//     two-character hexagram name (家人, 同人, 大有, 大過 are also ordinary
//     words; 說卦's 「為乾卦」 is the dry trigram) is WEAK;
//   - a passage counts with two shared bigrams, at least one not weak, or
//     with one strong bigram found in at most RARE passages (太極, 事業).
// Every other temple keeps the rule above, unchanged.
const COMMON = 12
const RARE = 3
const GLUE = new Set(keyOf('之乎者也矣焉哉而以其於為所是不可有無與則故此何如若乃且亦皆的了嗎呢在和或我你他她它們這那'))
const NUMERALS = new Set(keyOf('〇一二三四五六七八九十百千萬兩'))
const NAMES = new Set(HEXAGRAMS.filter(h => h.name.length === 2).map(h => keyOf(h.name)))
const weak = (b: string) => [...b].some(c => GLUE.has(c)) || [...b].every(c => NUMERALS.has(c)) || b.endsWith('卦') || NAMES.has(b)
let yixueStats: { passages: Passage[]; grams: Array<Set<string>>; df: Map<string, number> } | null = null

function pairsOf(key: string, into: Set<string>) {
  for (let i = 0; i + 1 < key.length; i++) into.add(key.slice(i, i + 2))
}

function yixuePassages(query: string, limit: number): Passage[] {
  if (!yixueStats) {
    const passages = yixueBookPassages()
    const grams = passages.map(p => { const g = new Set<string>(); pairsOf(keyOf(p.text), g); return g })
    const df = new Map<string, number>()
    for (const g of grams) for (const b of g) df.set(b, (df.get(b) ?? 0) + 1)
    yixueStats = { passages, grams, df }
  }
  const { passages, grams, df } = yixueStats
  // Question bigrams never cross punctuation either: the facts' own label
  // 「下卦離、上卦巽」 must not become 離上 and match 雜卦「離上，而坎下也」.
  const q = new Set<string>()
  for (const clause of query.split(/[\p{P}\p{Z}\s]+/u)) for (const seg of segments(clause)) pairsOf(seg.key, q)
  const useful = [...q].filter(b => (df.get(b) ?? 0) > 0 && df.get(b)! <= COMMON)
  if (useful.length === 0) return []
  const scored: Array<{ p: Passage; score: number }> = []
  passages.forEach((p, i) => {
    const hit = useful.filter(b => grams[i].has(b))
    const strong = hit.filter(b => !weak(b))
    if ((hit.length >= 2 && strong.length >= 1) || strong.some(b => df.get(b)! <= RARE)) {
      const weight = hit.reduce((s, b) => s + Math.log(passages.length / df.get(b)!), 0)
      scored.push({ p, score: weight / Math.sqrt(grams[i].size) })
    }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.p)
}

/** The block appended to the master's system prompt. Empty string when nothing scored. */
export function classicsBlock(temple: Temple, query: string): string {
  const hits = classicPassages(temple, query)
  if (hits.length === 0) return ''
  return '\n\n可引用的古籍段落（僅在切題時引用，並標明出處；不相關就忽略，絕不可自行杜撰古籍原文）：\n'
    + hits.map(h => `${h.book}：「${h.text}」`).join('\n')
}
