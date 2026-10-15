// lib/xsports-day.ts — the scores by the viewer's own calendar day (owner,
// Oct 15: "the timezone is wrong. The xsport shows 'today' but it's
// actually tomorrow"). The leagues list games by their US (New York) date;
// a viewer in Taipei or Tokyo lives most of a day ahead, so their day is the
// games that START on it where they are: in Taiwan mostly the US day before
// (a 7 pm ET game is 7 am there), the way Japanese sites list MLB in 日本時間.

import { mlbToday } from './mlb'

/** The time zone the browser sent, if it is one. */
export function zoneOf(v: string | null): string | null {
  if (!v || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(v)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return v
  } catch {
    return null
  }
}

const nextDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** When a calendar day (YYYY-MM-DD) begins in a time zone, in ms. */
export function dayStart(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  // Guess UTC midnight, then move by what the zone's clock reads there
  // (again, in case the guess crossed a daylight-saving change).
  let t = wall
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]))
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
    if (seen === wall) break
    t -= seen - wall
  }
  return t
}

/** A viewer's day: when it begins and ends, and the US dates whose games
 *  can start in it (one or two). */
export function viewerDay(date: string, tz: string): { from: number; to: number; usDates: string[] } {
  const from = dayStart(date, tz)
  const to = dayStart(nextDay(date), tz)
  const usDates: string[] = []
  for (let d = mlbToday(new Date(from)), last = mlbToday(new Date(to - 1)); usDates.length < 3; d = nextDay(d)) {
    usDates.push(d)
    if (d >= last) break
  }
  return { from, to, usDates }
}
