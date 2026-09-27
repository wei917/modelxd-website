// lib/xtell-time.ts — wall clocks, zones and "today" for XTell's daily
// fortune. Client-safe and pure (Intl only).
//
// Two rules the daily feature rests on (Codex review):
//  - "Today" is a DATE in the visitor's chosen zone, and the day's snapshot is
//    computed at one fixed instant of it (local noon), never at whatever
//    moment the request arrived, so a reading reopened at 23:59 is the one
//    made at 00:01.
//  - A wall-clock birth time is resolved against its zone's real history.
//    Clocks that jumped forward leave times that never existed (refused);
//    clocks that went back make an hour happen twice (the visitor says which,
//    `fold`: 0 the first, 1 the second). Taiwan kept summer time until 1979
//    and Korea in 1987–88, so an older Asian birthday can hit either.

/** Is `tz` an IANA zone this runtime knows? */
export function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number }
function partsIn(at: number, tz: string): Parts {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(at))
  const g = (t: string) => Number(p.find(x => x.type === t)?.value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') }
}
/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(at: number, tz: string): number {
  const p = partsIn(at, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at / 1000) * 1000
}

export type WallTime =
  | { kind: 'exact'; utc: number }
  /** Clocks jumped over this time; it never happened. */
  | { kind: 'gap' }
  /** Clocks went back; this time happened twice, [first, second]. */
  | { kind: 'ambiguous'; utc: [number, number] }

/**
 * A wall-clock time in a zone, resolved. Every offset the zone used within a
 * day either side is tried; the instants that really show this wall time are
 * the answer: none (a gap), one, or two (a repeat).
 */
export function resolveWallTime(y: number, m: number, d: number, h: number, mi: number, tz: string): WallTime {
  const naive = Date.UTC(y, m - 1, d, h, mi)
  const offsets = new Set<number>()
  for (const probe of [-36, -24, -12, -6, 0, 6, 12, 24, 36]) offsets.add(offsetAt(naive + probe * 3600_000, tz))
  const hits = [...offsets]
    .map(off => naive - off)
    .filter(at => { const p = partsIn(at, tz); return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi })
    .sort((a, b) => a - b)
  const unique = hits.filter((v, i) => i === 0 || v !== hits[i - 1])
  if (unique.length === 0) return { kind: 'gap' }
  if (unique.length === 1) return { kind: 'exact', utc: unique[0] }
  return { kind: 'ambiguous', utc: [unique[0], unique[unique.length - 1]] }
}

/** The instant of a birth time, or why there is none. `fold` picks the
 *  first (0) or second (1) of a repeated hour; without it a repeat is an
 *  error, never a silent choice. */
export function birthInstant(y: number, m: number, d: number, h: number, mi: number, tz: string, fold?: 0 | 1 | null):
  { ok: true; utc: number } | { ok: false; problem: 'gap' | 'ambiguous' } {
  const w = resolveWallTime(y, m, d, h, mi, tz)
  if (w.kind === 'exact') return { ok: true, utc: w.utc }
  if (w.kind === 'gap') return { ok: false, problem: 'gap' }
  if (fold === 0 || fold === 1) return { ok: true, utc: w.utc[fold] }
  return { ok: false, problem: 'ambiguous' }
}

/** The calendar date in `tz` at an instant, as YYYY-MM-DD. */
export function localDateIn(tz: string, at: number = Date.now()): string {
  const p = partsIn(at, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** The fixed instant a day's snapshot is computed at: 12:00 on that date in
 *  that zone (never inside a DST jump, which happen at night). */
export function dayAnchor(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const w = resolveWallTime(y, m, d, 12, 0, tz)
  if (w.kind === 'exact') return w.utc
  if (w.kind === 'ambiguous') return w.utc[0]
  // A zone that skipped noon itself (none today): the first instant after.
  return resolveWallTime(y, m, d, 13, 0, tz).kind === 'exact' ? (resolveWallTime(y, m, d, 13, 0, tz) as { utc: number }).utc : Date.UTC(y, m - 1, d, 12)
}

/** A wall clock in UTC+8, the clock the Chinese calendar library keeps its
 *  solar terms (節) on: an instant expressed there, for year and month
 *  pillars. Day and hour pillars keep the local civil date and time. */
export function inUtc8(at: number): Parts {
  const t = new Date(at + 8 * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() }
}

/** The browser's own zone, for the form's default. */
export function detectedZone(): string {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return validZone(z) ? z : 'Asia/Taipei' } catch { return 'Asia/Taipei' }
}
