// lib/xtell-lang-check.ts — does a Japanese answer carry Chinese prose?
// (Sep 29: a Japanese tester saw Simplified and Traditional Chinese mixed
// into Japanese readings.) Only characters a Japanese text never uses are
// counted: simplified forms whose Japanese form differs (这 们 说 …), and
// from 繁體 only the vernacular markers (們 麼 嗎 呢 讓 裡), because a quoted
// 籤 poem is 繁體 and may hold 發, 應 or 經 legitimately. Kanji Japanese
// shares with Chinese (学, 会, 里, 現, 問 …) never count. Used to log, so
// the rate can be measured before anything retries on it.
//
// Client-safe.

const CHINESE_ONLY = new Set([...'这们说还现给为么样让应关发经实问题从动种边头两见长门开间东车书习过时对气吗呢們麼嗎讓裡'])

/** Chinese-only characters in `text`, and how many of its CJK characters they are. */
export function chineseLeak(text: string): { count: number; share: number; sample: string } {
  const cjk = [...String(text ?? '')].filter(c => /[㐀-鿿]/.test(c))
  const hits = cjk.filter(c => CHINESE_ONLY.has(c))
  return { count: hits.length, share: cjk.length ? hits.length / cjk.length : 0, sample: [...new Set(hits)].slice(0, 12).join('') }
}

/** A Japanese answer with Chinese prose in it: a few Chinese-only characters,
 *  not one stray form. */
export const leaksChinese = (text: string): boolean => chineseLeak(text).count >= 3
