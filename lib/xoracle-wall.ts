// lib/xoracle-wall.ts — 觀音廟's 廟外 (Oct 22, owner: 「一般廟裡如果抽到不好的簽
// 會讓用戶掛在廟外。有些廟則是可以讓用戶付錢許願，然後也是掛在廟外。」).
//
// Two things hang outside the temple (docs/GUANYIN-HANGING-PLAN.md,
// supabase/151_xoracle_hangings.sql):
//   a stick   the visitor ties outside, free, 30 days on the wall. Only its
//             number, edition and grade as printed go up: never the question,
//             the name or the birth.
//   a wish    a plaque the visitor pays $0.10 to hang for a year. Public by
//             default (owner); the writer may seal it, and then only its back
//             (the stamp and the date) shows.
// Both need an account. Client-safe: the limits, the wording rules a plaque
// must pass before any model sees it, and the shape the wall API returns.

export const WALL_TEMPLE = 'guanyin' as const
/** What a wish costs, in cents (owner, Oct 22: "we can start from $0.1"). */
export const WISH_CENTS = 10
export const WISH_MAX = 60
export const STICK_DAYS = 30
export const WISH_DAYS = 365
/** Per account per day: ties are free and textless, wishes are paid. */
export const TIES_PER_DAY = 20
export const WISHES_PER_DAY = 10
/** At this many reports a plaque is hidden from everyone but its writer. */
export const REPORTS_TO_HIDE = 3
export const PAGE = 60

export const WISH_FOR = ['peace', 'health', 'study', 'love', 'work', 'wealth', 'other'] as const
export type WishFor = (typeof WISH_FOR)[number]
export const asWishFor = (v: unknown): WishFor | null => (WISH_FOR as readonly string[]).includes(v as string) ? v as WishFor : null

export const REPORT_REASONS = ['personal_info', 'harassment', 'hate', 'sexual', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const asReason = (v: unknown): ReportReason | null => (REPORT_REASONS as readonly string[]).includes(v as string) ? v as ReportReason : null

export const WALL_LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
export const asWallLang = (v: unknown): (typeof WALL_LANGS)[number] => (WALL_LANGS as readonly string[]).includes(v as string) ? v as any : 'zh-Hant'

/** Characters as Postgres counts them (code points), so 60 here is 60 there. */
export const charCount = (s: string) => Array.from(s).length

/** A wish as it will be stored: one line per paragraph kept, runs of blanks
 *  folded, invisible characters out, NFKC so full-width digits are digits. */
export function cleanWish(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFKC')
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Contact details and addresses, refused on every plaque, sealed or not
 *  (the Japanese shrines' lesson: plaques get photographed and posted, and
 *  some carried a stranger's full name and address). Names are the model
 *  check's job; this is the part a pattern catches for certain. */
const CONTACT: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/,                                   // an email
  /(https?:\/\/|www\.)\S+/i,                                     // a link
  /\b[\w-]+\.(com|net|org|tw|jp|kr|cn|hk|io|me|co|app|xyz|info)\b/i,
  /(^|[^\w])@[A-Za-z0-9_.]{3,}/,                                 // an @handle
  /\b(line|ig|instagram|wechat|weixin|kakao|telegram|whatsapp)\s*(id)?\s*[:：]/i,
  /(\d[\s\-().]*){6,}/,                                          // a phone, an id number, any long number
  /\d+\s*(號|号|巷|弄|樓|楼|室|番地|丁目|번지|호)/,                  // a street address
  /[路街道里]\s*\d+/, /(로|길)\s*\d+/, /\d+-\d+-\d+/,
]
export type WishProblem = 'empty' | 'too_long' | 'contact'
export function wishProblem(text: string): WishProblem | null {
  if (!text) return 'empty'
  if (charCount(text) > WISH_MAX) return 'too_long'
  if (CONTACT.some(re => re.test(text))) return 'contact'
  return null
}

/** The grades a printed slip calls bad: 凶 (元三大師's set, 30 of 100) and any
 *  下. The 觀音一百籤 prints none, so there the visitor decides. */
export const badLuck = (luck: unknown) => typeof luck === 'string' && /凶|下/.test(luck)

/** One thing on the wall, as anyone may see it. No user id, no visit, never
 *  the text of a sealed plaque. */
export type WallItem = {
  id: string
  kind: 'stick' | 'wish'
  at: string
  lang: string
  // a stick
  n?: number
  edition?: 'yibai' | 'gansan'
  luck?: string
  // a wish
  text?: string | null
  wishFor?: WishFor | null
  sealed?: boolean
  fulfilled?: boolean
  /** The viewer's own (the mine list only). */
  mine?: boolean
}
/** The viewer's own rows carry their state too. */
export type MyItem = WallItem & {
  mine: true
  readingId?: string | null
  downAt: string
  takenDown: boolean
  hidden: boolean
}

export const WALL_COLUMNS = 'id, kind, edition, stick_no, luck, wish_text, wish_for, sealed, fulfilled_at, lang, created_at'
export const MINE_COLUMNS = `${WALL_COLUMNS}, reading_id, down_at, taken_down_at, hidden_at`

export function wallItem(r: any): WallItem {
  const base = { id: String(r.id), kind: r.kind === 'wish' ? 'wish' as const : 'stick' as const, at: String(r.created_at), lang: String(r.lang ?? '') }
  if (base.kind === 'stick') return { ...base, n: Number(r.stick_no), edition: r.edition === 'gansan' ? 'gansan' : 'yibai', luck: typeof r.luck === 'string' ? r.luck : '' }
  return { ...base, text: r.sealed ? null : String(r.wish_text ?? ''), wishFor: asWishFor(r.wish_for), sealed: !!r.sealed, fulfilled: !!r.fulfilled_at }
}

export function myItem(r: any): MyItem {
  const item = wallItem(r)
  // The writer always reads their own plaque, sealed or hidden.
  if (item.kind === 'wish') item.text = String(r.wish_text ?? '')
  return { ...item, mine: true, readingId: r.reading_id ?? null, downAt: String(r.down_at), takenDown: !!r.taken_down_at, hidden: !!r.hidden_at }
}

/** The date on a plaque or a tied slip, never baked into a picture: written
 *  out for whoever reads it, in their language's own order, with the year
 *  (owner, Oct 22: 10/22 alone is unclear, and month/day order differs by
 *  country). One temple for everyone; only the way the date is written
 *  follows the reader. The day is the reader's own calendar day.
 *    en  2026/10/22 (the owner's choice)   zh / ja  2026年10月22日   ko  2026년 10월 22일 */
export function wallDate(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate()
  if (lang === 'ko') return `${y}년 ${m}월 ${day}일`
  if (lang === 'en') return `${y}/${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}`
  return `${y}年${m}月${day}日`
}

/** Still on the wall: not taken down, not hidden, not past its time. */
export const isUp = (m: MyItem, now = Date.now()) => !m.takenDown && !m.hidden && Date.parse(m.downAt) > now
