// lib/xtell-birth.ts — which births XTell can chart. Client-safe: the form
// and the routes share it, so the form never offers a date the server would
// refuse, and the server never trusts the form (audit F01, Sep 26: 1990-02-31
// was accepted and charted, because the chart libraries quietly compute any
// day-of-month up to 31).

/** The earliest year offered and accepted. The chart engines cover it and no
 *  older birth is plausible for a living visitor or anyone they would ask
 *  about. There is no upper age rule: a child's or a partner's chart is
 *  ordinary use, so the range runs to today. */
export const BIRTH_MIN_YEAR = 1900

/** Why a birth cannot be charted. `shape`: a missing or malformed field;
 *  `range`: before 1900; `date`: no such day (2 月 31 日, 2 月 29 日 in a
 *  common year); `future`: after today. */
export type BirthProblem = 'shape' | 'range' | 'date' | 'future'

/** Days in a Gregorian month, m = 1–12. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The latest date a birth may have: today, read in the world's most
 *  advanced time zone (UTC+14), so a baby born "today" in Taipei is never
 *  refused by a server whose UTC date is still yesterday. */
export function latestBirthDate(now: Date = new Date()): { y: number; m: number; d: number } {
  const t = new Date(now.getTime() + 14 * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** The years a form offers, newest first: this year back to 1900. */
export function birthYears(now: Date = new Date()): number[] {
  const top = latestBirthDate(now).y
  return Array.from({ length: top - BIRTH_MIN_YEAR + 1 }, (_, i) => top - i)
}

/** Why `b` is not a birth XTell can chart, or null when it is one. */
export function birthProblem(b: any, now: Date = new Date()): BirthProblem | null {
  if (!b || typeof b !== 'object') return 'shape'
  const { y, m, d } = b
  if (![y, m, d].every(Number.isInteger)) return 'shape'
  if (b.gender !== 'male' && b.gender !== 'female') return 'shape'
  if (b.hourUnknown !== true
    && !(Number.isInteger(b.h) && b.h >= 0 && b.h <= 23 && Number.isInteger(b.mi) && b.mi >= 0 && b.mi <= 59)) return 'shape'
  if (m < 1 || m > 12) return 'shape'
  if (y < BIRTH_MIN_YEAR) return 'range'
  if (d < 1 || d > daysInMonth(y, m)) return 'date'
  const top = latestBirthDate(now)
  if (y * 10000 + m * 100 + d > top.y * 10000 + top.m * 100 + top.d) return 'future'
  return null
}
