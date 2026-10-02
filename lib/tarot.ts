// lib/tarot.ts — 塔羅's server half (Sep 28). The deck is the original 1909
// Waite–Smith cards (Pamela Colman Smith's art) with A. E. Waite's own
// divinatory meanings from The Pictorial Key to the Tarot (1911), both public
// domain, built by scripts/fetch-tarot.mjs into content/tarot/cards.json and
// public/xtell/tarot/. The draw arrives as ids (lib/tarot-draw.ts); every
// name, picture and meaning is read here, so a teacher only ever sees
// Waite's real text.
//
// Server-only (node:fs).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPREADS, type TarotOptions, type TarotPick, type TarotSpread } from './tarot-draw'
export { SPREADS, asSpread, asOptions, validPicks, drawTarot, TAROT_IDS, type TarotPick, type TarotSpread, type TarotOptions } from './tarot-draw'

type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export type TarotCard = {
  id: string; arcana: 'major' | 'minor'; suit: string | null; rank: number
  names: Record<Lang, string>; upright: string; reversed: string; image: string
}

let deck: TarotCard[] | null = null
export const tarotDeck = (): TarotCard[] => deck ??= JSON.parse(readFileSync(join(process.cwd(), 'content', 'tarot', 'cards.json'), 'utf-8'))

/** Our own short modern reading of each card, upright and reversed, in the
 *  five languages (Oct 2, content/tarot/modern.json, written for X先知: not
 *  taken from any book). Shown under the card; Waite's text stays the
 *  teacher's source. Missing file or card: none. */
type Modern = Record<string, { up: Record<Lang, string>; rev: Record<Lang, string> }>
let modern: Modern | null = null
export const tarotModern = (id: string, reversed: boolean): Record<Lang, string> | null => {
  if (!modern) { try { modern = JSON.parse(readFileSync(join(process.cwd(), 'content', 'tarot', 'modern.json'), 'utf-8')) } catch { modern = {} } }
  return modern![id]?.[reversed ? 'rev' : 'up'] ?? null
}
export const tarotCard = (id: string) => tarotDeck().find(c => c.id === id) ?? null

export const ASK_MAX = 300

/** A laid spread: each card at its position, face up, with the meaning for
 *  the way it landed. This is what the page shows and what is saved. */
export type TarotChart = {
  spread: TarotSpread
  ask: string
  /** 二擇一 only: the two options as named (either may be empty). */
  options?: TarotOptions
  cards: Array<{ id: string; reversed: boolean; position: string; names: Record<Lang, string>; image: string; meaning: string; modern: Record<Lang, string> | null }>
}
export function tarotChart(spread: TarotSpread, picks: TarotPick[], ask: string, options?: TarotOptions): TarotChart {
  return {
    spread, ask,
    ...(spread === 'choice' ? { options: { a: options?.a ?? '', b: options?.b ?? '' } } : {}),
    cards: picks.map((p, i) => {
      const c = tarotCard(p.id)!
      return { id: c.id, reversed: p.reversed, position: SPREADS[spread][i], names: c.names, image: c.image, meaning: p.reversed ? c.reversed : c.upright, modern: tarotModern(c.id, p.reversed) }
    }),
  }
}

const POSITION_ZH: Record<string, string> = {
  answer: '所問之答', past: '過去', present: '現在', future: '未來',
  now: '現況', pathA: '選 A 的發展', pathB: '選 B 的發展', endA: '選 A 的結果', endB: '選 B 的結果',
  you: '你的心意', them: '對方的心意', bond: '目前的關係', block: '需要面對的', next: '接下來的走向',
}
const SPREAD_ZH: Record<TarotSpread, string> = {
  one: '單張牌', three: '三張牌（過去、現在、未來）',
  choice: '二擇一（五張：現況；選 A、選 B 各自的發展與結果）',
  love: '關係（五張：你的心意、對方的心意、目前的關係、需要面對的、接下來的走向）',
}

/** The teacher's facts: the question, the spread, and every card with its
 *  position, orientation and Waite's words for it. */
export function tarotFacts(chart: TarotChart): string {
  return [
    chart.ask.trim() ? `來訪者想問的事：${chart.ask.trim()}` : '來訪者沒有寫下想問的事（請先問清楚，再解牌）。',
    `牌陣：${SPREAD_ZH[chart.spread] ?? SPREAD_ZH.one}`,
    ...(chart.spread === 'choice' ? [`選項 A：${chart.options?.a || '（來訪者沒有寫）'}　選項 B：${chart.options?.b || '（來訪者沒有寫）'}`] : []),
    ...chart.cards.map(c => `${POSITION_ZH[c.position] ?? c.position}：${c.names['zh-Hant']}（${c.names.en}）${c.reversed ? '逆位' : '正位'}\n  韋特原文（${c.reversed ? 'Reversed' : 'Divinatory meaning'}）：${c.meaning}`
      + (c.modern?.['zh-Hant'] ? `\n  本站的現代解讀（來訪者在牌下看得到）：${c.modern['zh-Hant']}` : '')),
    '牌由來訪者的瀏覽器亂數洗牌抽出；正逆位各半機率。',
  ].join('\n')
}
