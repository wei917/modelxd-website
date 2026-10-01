// app/admin/traffic/data.ts
// The shapes /admin/traffic draws, and how the rows the database functions
// return (supabase/117_site_visit_groups_country.sql, 118_site_visit_summary.sql)
// become them.
// Pure functions, no I/O: page.tsx does the calls.

/** One day of the FILTERED part of the page (range + country). */
export type DayRow = {
  day: string                // YYYY-MM-DD in the page's time zone
  visits: number
  browsers: number
  newBrowsers: number
  returningBrowsers: number
  signedInUsers: number
  medianSeconds: number
  p80Seconds: number         // the stay the top 20% of browsers reached or passed
  p90Seconds: number         // the same for the top 10%
  avgSeconds: number
  totalSeconds: number
  chatgpt: number
  google: number
  other: number
  // Stay for the two groups (migration 117). A browser is "signed" on a day
  // if any of its visits that day carried an account; otherwise a guest.
  signedBrowsers: number
  signedMedian: number
  signedP80: number
  signedP90: number
  signedAvg: number
  guestBrowsers: number
  guestMedian: number
  guestP80: number
  guestP90: number
  guestAvg: number
}

/** A row of site_visit_daily_v2(), or of the older site_visit_daily() (which
 *  lacks the p80/p90 columns before 116 and the group columns before 117). */
export type DailyRow = {
  day: string; visits: number; browsers: number; new_browsers: number; returning_browsers: number
  signed_in_users: number; median_seconds: number; avg_seconds: number; total_seconds: number
  chatgpt_visits: number; google_visits: number; other_visits: number
  p80_seconds?: number | null; p90_seconds?: number | null
  signed_browsers?: number | null; signed_median_seconds?: number | null; signed_p80_seconds?: number | null
  signed_p90_seconds?: number | null; signed_avg_seconds?: number | null
  guest_browsers?: number | null; guest_median_seconds?: number | null; guest_p80_seconds?: number | null
  guest_p90_seconds?: number | null; guest_avg_seconds?: number | null
}

/** The one row of site_visit_summary() (migration 118): the whole range.
 *  Browsers and accounts are counted once here, which the daily rows cannot
 *  be added up to; stay is still per browser per day. */
export type SummaryRow = {
  visits: number; browsers: number; new_browsers: number; returning_browsers: number; signed_in_users: number
  median_seconds: number; p80_seconds: number; p90_seconds: number; avg_seconds: number; total_seconds: number
  chatgpt_visits: number; google_visits: number; other_visits: number
  signed_browsers: number; signed_median_seconds: number; signed_p80_seconds: number; signed_p90_seconds: number; signed_avg_seconds: number
  guest_browsers: number; guest_median_seconds: number; guest_p80_seconds: number; guest_p90_seconds: number; guest_avg_seconds: number
}

/** One group's stay over the range: how many browsers, and the four times. */
export type StayLine = { browsers: number; median: number; p80: number; p90: number; avg: number }

/** The whole range, as the view shows it. */
export type Summary = {
  visits: number
  browsers: number
  newBrowsers: number
  /** Browsers in the range that were also seen on an earlier day: they came back. */
  returningBrowsers: number
  signedInUsers: number
  everyone: StayLine
  signed: StayLine
  guest: StayLine
}

export function toSummary(r: SummaryRow | undefined | null): Summary | null {
  if (!r) return null
  return {
    visits: r.visits,
    browsers: r.browsers,
    newBrowsers: r.new_browsers,
    returningBrowsers: r.returning_browsers,
    signedInUsers: r.signed_in_users,
    everyone: { browsers: r.browsers, median: r.median_seconds, p80: r.p80_seconds, p90: r.p90_seconds, avg: r.avg_seconds },
    signed: { browsers: r.signed_browsers, median: r.signed_median_seconds, p80: r.signed_p80_seconds, p90: r.signed_p90_seconds, avg: r.signed_avg_seconds },
    guest: { browsers: r.guest_browsers, median: r.guest_median_seconds, p80: r.guest_p80_seconds, p90: r.guest_p90_seconds, avg: r.guest_avg_seconds },
  }
}

/** A row of site_visit_by_country(): country is a two-letter code, '??' for a
 *  visit with no country, or 'other' for everything outside the top few. */
export type CountryRow = { day: string; country: string; visits: number; browsers: number }

/** A row of site_signins_daily(). day is null on the rows for the whole window. */
export type SigninRow = { day: string | null; provider: string; logins: number; people: number; new_people: number }

/** Browsers per day for the three biggest countries, and the rest. */
export type CountryDay = { day: string; c0: number; c1: number; c2: number; other: number }

/** A row of site_signin_taps_window() (migration 120): presses of a sign-in
 *  button over the window, in activity_logs' provider words. */
export type TapRow = { provider: string; taps: number; browsers: number }
/** Taps per sign-in method, keyed like the sign-in chart. */
export type TapTotals = Record<'google' | 'lineTw' | 'lineJp' | 'other', { taps: number; browsers: number }>

/** Accounts that signed in per day, by the method the account was made with. */
export type SigninDay = { day: string; google: number; lineTw: number; lineJp: number; other: number }
export type SigninTotal = { key: keyof Omit<SigninDay, 'day'>; logins: number; people: number; newPeople: number }

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Every day from `first` through `today`, so an x-axis is real time. */
export function daysThrough(first: string | undefined, today: string): string[] {
  const out: string[] = []
  if (!first) return out
  for (let d = first; d <= today; d = nextDay(d)) out.push(d)
  return out
}

/** The functions return only days that had visits. Fill the quiet days in
 *  between with zeros, from the first day returned through today; days before
 *  the log has any row are left out rather than drawn as zero. */
export function fillDaily(data: DailyRow[], today: string): DayRow[] {
  const byDay = new Map(data.map(r => [r.day, r]))
  return daysThrough(data[0]?.day, today).map(d => {
    const r = byDay.get(d)
    return {
      day: d,
      visits: r?.visits ?? 0,
      browsers: r?.browsers ?? 0,
      newBrowsers: r?.new_browsers ?? 0,
      returningBrowsers: r?.returning_browsers ?? 0,
      signedInUsers: r?.signed_in_users ?? 0,
      medianSeconds: r?.median_seconds ?? 0,
      p80Seconds: r?.p80_seconds ?? 0,
      p90Seconds: r?.p90_seconds ?? 0,
      avgSeconds: r?.avg_seconds ?? 0,
      totalSeconds: Number(r?.total_seconds ?? 0),
      chatgpt: r?.chatgpt_visits ?? 0,
      google: r?.google_visits ?? 0,
      other: r?.other_visits ?? 0,
      signedBrowsers: r?.signed_browsers ?? 0,
      signedMedian: r?.signed_median_seconds ?? 0,
      signedP80: r?.signed_p80_seconds ?? 0,
      signedP90: r?.signed_p90_seconds ?? 0,
      signedAvg: r?.signed_avg_seconds ?? 0,
      guestBrowsers: r?.guest_browsers ?? 0,
      guestMedian: r?.guest_median_seconds ?? 0,
      guestP80: r?.guest_p80_seconds ?? 0,
      guestP90: r?.guest_p90_seconds ?? 0,
      guestAvg: r?.guest_avg_seconds ?? 0,
    }
  })
}

const isCode = (c: string) => /^[A-Z]{2}$/.test(c)

/** The by-country rows as a chart: the three countries with the most
 *  browser-days get a column part each (`codes`, biggest first) and everything
 *  else, including 'other' and visits with no country, is `other`. `picker`
 *  is every named country in the rows, busiest first, for the filter. */
export function countryDays(data: CountryRow[], today: string): { days: CountryDay[]; codes: string[]; picker: string[] } {
  const totals = new Map<string, { browsers: number; visits: number }>()
  for (const r of data) {
    if (!isCode(r.country)) continue
    const t = totals.get(r.country) ?? { browsers: 0, visits: 0 }
    t.browsers += r.browsers; t.visits += r.visits
    totals.set(r.country, t)
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].browsers - a[1].browsers || a[0].localeCompare(b[0])).map(([c]) => c)
  const codes = ranked.slice(0, 3)
  const first = data.reduce<string | undefined>((m, r) => (m === undefined || r.day < m ? r.day : m), undefined)
  const days = daysThrough(first, today).map(d => {
    const row: CountryDay = { day: d, c0: 0, c1: 0, c2: 0, other: 0 }
    for (const r of data) {
      if (r.day !== d) continue
      const i = codes.indexOf(r.country)
      if (i === 0) row.c0 += r.browsers
      else if (i === 1) row.c1 += r.browsers
      else if (i === 2) row.c2 += r.browsers
      else row.other += r.browsers
    }
    return row
  })
  return { days, codes, picker: ranked }
}

const METHOD: Record<string, SigninTotal['key']> = { google: 'google', 'custom:line-tw': 'lineTw', 'custom:line-jp': 'lineJp' }

export function tapTotals(data: TapRow[]): TapTotals {
  const out: TapTotals = { google: { taps: 0, browsers: 0 }, lineTw: { taps: 0, browsers: 0 }, lineJp: { taps: 0, browsers: 0 }, other: { taps: 0, browsers: 0 } }
  for (const r of data) { const t = out[METHOD[r.provider] ?? 'other']; t.taps += r.taps; t.browsers += r.browsers }
  return out
}

/** The sign-in rows as a chart of accounts per day by method, and the totals
 *  for the whole window (from the rows whose day is null). */
export function signinDays(data: SigninRow[], today: string): { days: SigninDay[]; totals: SigninTotal[] } {
  const daily = data.filter((r): r is SigninRow & { day: string } => r.day !== null)
  const first = daily.reduce<string | undefined>((m, r) => (m === undefined || r.day < m ? r.day : m), undefined)
  const days = daysThrough(first, today).map(d => {
    const row: SigninDay = { day: d, google: 0, lineTw: 0, lineJp: 0, other: 0 }
    for (const r of daily) if (r.day === d) row[METHOD[r.provider] ?? 'other'] += r.people
    return row
  })
  const sum: Record<SigninTotal['key'], SigninTotal> = {
    google: { key: 'google', logins: 0, people: 0, newPeople: 0 },
    lineTw: { key: 'lineTw', logins: 0, people: 0, newPeople: 0 },
    lineJp: { key: 'lineJp', logins: 0, people: 0, newPeople: 0 },
    other: { key: 'other', logins: 0, people: 0, newPeople: 0 },
  }
  for (const r of data) {
    if (r.day !== null) continue
    const t = sum[METHOD[r.provider] ?? 'other']
    t.logins += r.logins; t.people += r.people; t.newPeople += r.new_people
  }
  return { days, totals: [sum.google, sum.lineTw, sum.lineJp, sum.other] }
}

/** 'TW' → 'Taiwan', 'HK' → 'Hong Kong'. Falls back to the code. SERVER ONLY:
 *  Node and a browser can disagree on a name ('Hong Kong SAR China'), which
 *  breaks hydration, so the page names the countries once and hands the view
 *  plain strings. */
export function countryName(code: string): string {
  if (!isCode(code)) return 'Unknown'
  try { return new Intl.DisplayNames(['en'], { type: 'region', style: 'short' }).of(code) ?? code } catch { return code }
}

/** Names for every code the view will show. */
export function countryNames(codes: Array<string | null>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of codes) if (c) out[c] = countryName(c)
  return out
}

/** A two-letter country code from a query string, or null. */
export function askedCountry(v: string | undefined): string | null {
  const c = (v ?? '').trim().toUpperCase()
  return isCode(c) ? c : null
}
