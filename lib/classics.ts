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
  // 四面佛 reads the visitor's 八字 against the four faces.
  simianfo: ['ditiansui.txt'],
}

type Passage = { book: string; text: string }

const cache = new Map<string, Passage[]>()

function passagesOf(file: string): Passage[] {
  if (cache.has(file)) return cache.get(file)!
  const path = join(DIR, file)
  if (!existsSync(path)) { cache.set(file, []); return [] }
  const raw = readFileSync(path, 'utf-8')
  const [header, ...body] = raw.split('\n\n')
  const book = header.match(/《[^》]+》/)?.[0] ?? file
  // Passage = paragraph, split further so nothing exceeds ~420 chars — a
  // quotable unit, not a chapter.
  const out: Passage[] = []
  for (const para of body.join('\n\n').split(/\n{2,}/)) {
    const p = para.trim()
    if (p.length < 24) continue
    if (p.length <= 420) { out.push({ book, text: p }); continue }
    for (const piece of p.split(/(?<=[。！？])/).reduce<string[]>((acc, s) => {
      const last = acc[acc.length - 1]
      if (last !== undefined && last.length + s.length <= 420) acc[acc.length - 1] = last + s
      else acc.push(s)
      return acc
    }, [])) {
      if (piece.trim().length >= 24) out.push({ book, text: piece.trim() })
    }
  }
  cache.set(file, out)
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

/** The block appended to the master's system prompt. Empty string when nothing scored. */
export function classicsBlock(temple: Temple, query: string): string {
  const hits = classicPassages(temple, query)
  if (hits.length === 0) return ''
  return '\n\n可引用的古籍段落（僅在切題時引用，並標明出處；不相關就忽略，絕不可自行杜撰古籍原文）：\n'
    + hits.map(h => `${h.book}：「${h.text}」`).join('\n')
}
