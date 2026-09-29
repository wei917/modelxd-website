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
import { SPREADS, type TarotPick, type TarotSpread } from './tarot-draw'
export { SPREADS, asSpread, validPicks, drawTarot, TAROT_IDS, type TarotPick, type TarotSpread } from './tarot-draw'

type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export type TarotCard = {
  id: string; arcana: 'major' | 'minor'; suit: string | null; rank: number
  names: Record<Lang, string>; upright: string; reversed: string; image: string
}

let deck: TarotCard[] | null = null
export const tarotDeck = (): TarotCard[] => deck ??= JSON.parse(readFileSync(join(process.cwd(), 'content', 'tarot', 'cards.json'), 'utf-8'))
export const tarotCard = (id: string) => tarotDeck().find(c => c.id === id) ?? null

export const ASK_MAX = 300

/** A laid spread: each card at its position, face up, with the meaning for
 *  the way it landed. This is what the page shows and what is saved. */
export type TarotChart = {
  spread: TarotSpread
  ask: string
  cards: Array<{ id: string; reversed: boolean; position: string; names: Record<Lang, string>; image: string; meaning: string }>
}
export function tarotChart(spread: TarotSpread, picks: TarotPick[], ask: string): TarotChart {
  return {
    spread, ask,
    cards: picks.map((p, i) => {
      const c = tarotCard(p.id)!
      return { id: c.id, reversed: p.reversed, position: SPREADS[spread][i], names: c.names, image: c.image, meaning: p.reversed ? c.reversed : c.upright }
    }),
  }
}

const POSITION_ZH: Record<string, string> = { answer: '所問之答', past: '過去', present: '現在', future: '未來' }

/** The teacher's facts: the question, the spread, and every card with its
 *  position, orientation and Waite's words for it. */
export function tarotFacts(chart: TarotChart): string {
  return [
    chart.ask.trim() ? `來訪者想問的事：${chart.ask.trim()}` : '來訪者沒有寫下想問的事（請先問清楚，再解牌）。',
    `牌陣：${chart.spread === 'three' ? '三張牌（過去、現在、未來）' : '單張牌'}`,
    ...chart.cards.map(c => `${POSITION_ZH[c.position] ?? c.position}：${c.names['zh-Hant']}（${c.names.en}）${c.reversed ? '逆位' : '正位'}\n  韋特原文（${c.reversed ? 'Reversed' : 'Divinatory meaning'}）：${c.meaning}`),
    '牌由來訪者的瀏覽器亂數洗牌抽出；正逆位各半機率。',
  ].join('\n')
}
