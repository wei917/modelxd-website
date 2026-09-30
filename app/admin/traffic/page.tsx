// app/admin/traffic/page.tsx
// Admin-only traffic dashboard (owner, Sep 29): daily active browsers, new
// and returning, signed-in users, stay time and where visits came from.
// Server-side gate, same as /admin/models. The numbers are one call to
// site_visit_daily() (supabase/115_site_visit_daily.sql, widened by
// 116_site_visit_stay_top.sql) over our own visit log; docs/SITE-VISITS.md
// defines what a visit and "stay" mean.

import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/admin'
import TrafficView, { type DayRow } from './TrafficView'

export const dynamic = 'force-dynamic'

/** Days are cut where the traffic is. */
const TZ = 'Asia/Taipei'
const RANGES = [7, 14, 30, 90] as const
const DEFAULT_DAYS = 14

type Row = {
  day: string; visits: number; browsers: number; new_browsers: number; returning_browsers: number
  signed_in_users: number; median_seconds: number; avg_seconds: number; total_seconds: number
  chatgpt_visits: number; google_visits: number; other_visits: number
  // Added by migration 116; absent until the owner has run it.
  p80_seconds?: number | null; p90_seconds?: number | null
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** The function returns only days that had visits. Fill the quiet days in
 *  between with zeros, from the first day it returned through today, so the
 *  x-axis is real time; days before the log has any row are left out rather
 *  than drawn as zero. */
function fill(data: Row[], today: string): DayRow[] {
  const byDay = new Map(data.map(r => [r.day, r]))
  const out: DayRow[] = []
  if (!data.length) return out
  for (let d = data[0].day; d <= today; d = nextDay(d)) {
    const r = byDay.get(d)
    out.push({
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
    })
  }
  return out
}

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const admin = await getAdminUser()
  if (!admin) redirect('/')

  const asked = Number((await searchParams).days)
  const days = (RANGES as readonly number[]).includes(asked) ? asked : DEFAULT_DAYS

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await sb.rpc('site_visit_daily', { p_days: days, p_tz: TZ })
  if (error) {
    // PGRST202 = the function is not there: neither 115 nor 116 has been run.
    // 116 defines the whole function, so it is the one to run.
    const missing = error.code === 'PGRST202'
    return (
      <div style={{ padding: 32, color: 'var(--red)', lineHeight: 1.6 }}>
        {missing
          ? 'This page needs supabase/116_site_visit_stay_top.sql. Run it in the Supabase SQL editor, then reload.'
          : `Failed to load: ${error.message}`}
      </div>
    )
  }

  const found = (data ?? []) as Row[]
  // The top 20% and top 10% stay come from migration 116. Before it has been
  // run the rows simply lack the two columns, and the view says so in their
  // place instead of drawing zeros.
  const topStay = found.some(r => r.p80_seconds != null)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  return <TrafficView rows={fill(found, today)} days={days} ranges={RANGES} tz="Taiwan time" topStay={topStay} />
}
