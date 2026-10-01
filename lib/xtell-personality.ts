// lib/xtell-personality.ts — a visitor's own personality type, typed into
// the XTell account page and attached to a reading only when they tick the
// box (owner, Sep 30: "we allow users to enter in the profile page, and
// optionally give temple master to use").
//
// The four letters people know as "MBTI" (most got theirs from the free
// 16Personalities test), plus the -A / -T some results carry. It is the
// visitor's own description of themselves, not a fortune and not a test we
// ran, and the teacher is told so. Stored server-only (supabase/119), one row
// per account, deleted with the account.
//
// Offered only in the rooms where it helps the question (孫子兵法: what to do
// next depends on who is doing it; 月老: two people, with the partner's type
// typed in the room; 塔羅). Never in the stick rooms or the chart rooms: the
// stick or the chart is the reading there, and a model handed "INFJ" brings
// it up whether it fits or not.
//
// Client-safe.

export type PersonalityType = string
const TYPE_RE = /^[EI][SN][TF][JP](-[AT])?$/

/** A type as typed or sent ('infj', 'INFJ-t' …) → 'INFJ' / 'INFJ-T', or null. */
export function asPersonalityType(v: unknown): PersonalityType | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return TYPE_RE.test(s) ? s : null
}

/** The four letters and the optional fifth, as the account page edits them. */
export type PersonalityParts = { letters: [string, string, string, string]; identity: '' | 'A' | 'T' }
export const PAIRS = [['E', 'I'], ['S', 'N'], ['T', 'F'], ['J', 'P']] as const
export function partsOf(t: PersonalityType | null): PersonalityParts | null {
  const ok = asPersonalityType(t)
  return ok ? { letters: [ok[0], ok[1], ok[2], ok[3]], identity: (ok[5] ?? '') as '' | 'A' | 'T' } : null
}
export const typeOf = (p: PersonalityParts): PersonalityType | null =>
  asPersonalityType(p.letters.join('') + (p.identity ? `-${p.identity}` : ''))

/** The rooms that offer to attach it. */
export const PERSONALITY_TEMPLES = ['sunzi', 'yuelao', 'tarot'] as const
export const offersPersonality = (temple: string): boolean => (PERSONALITY_TEMPLES as readonly string[]).includes(temple)

/** What the teacher is told, in the teacher's own language (the facts are
 *  Chinese, like every room's). `partner` only in 月老. Empty when nothing
 *  valid was attached. */
export function personalityFacts(own: unknown, partner?: unknown): string {
  const me = asPersonalityType(own), them = asPersonalityType(partner)
  if (!me && !them) return ''
  return [
    '來訪者自己填寫的人格類型（MBTI 式的四個字母，多半來自來訪者自己做過的線上測驗，例如 16Personalities；是性格傾向的自我描述，不是命理資料，也不是診斷）：',
    me ? `  來訪者：${me}` : '',
    them ? `  對方：${them}（同樣由來訪者填寫，未必準確）` : '',
    '使用方式：只在與問題相關時參考，全篇提一兩次即可，不要每段都提；不可用它推翻籤、牌、命盤或書中原文，那些才是這次解讀的主體；不要把類型說成固定不變或決定命運，也不談哪一型比較好。',
  ].filter(Boolean).join('\n')
}
