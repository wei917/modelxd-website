// app/admin/traffic/page.tsx
// Admin-only traffic dashboard (owner, Sep 29): daily active browsers, new
// and returning, signed-in users, stay time and where visits came from.
// Server-side gate, same as /admin/models. docs/SITE-VISITS.md defines what
// a visit and "stay" mean.
//
// Two kinds of chart (owner, Sep 30: "overall settings/filters/toggles and
// pre defined charts without effecting by the filters"):
//   - FILTERED: the tiles, browsers, sources, stay and the daily table
//     follow the range and the country picked at the top. One call to
//     site_visit_daily_v2(days, tz, country).
//   - FIXED: browsers by country and sign-ins by method are always for every
//     country; only the range applies. site_visit_by_country() and
//     site_signins_daily().
// All three come from supabase/117_site_visit_groups_country.sql. Until the
// owner has run it the page falls back to site_visit_daily() (115/116): no
// country filter, no signed-in split, no fixed charts, and a line saying so.

import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/admin'
import TrafficView from './TrafficView'
import { askedCountry, countryDays, countryNames, fillDaily, signinDays, type CountryRow, type DailyRow, type SigninRow } from './data'

export const dynamic = 'force-dynamic'

/** Days are cut where the traffic is. */
const TZ = 'Asia/Taipei'
const RANGES = [7, 14, 30, 90] as const
const DEFAULT_DAYS = 14
/** PostgREST: no function by that name and arguments. */
const NOT_THERE = 'PGRST202'

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<{ days?: string; country?: string }> }) {
  const admin = await getAdminUser()
  if (!admin) redirect('/')

  const q = await searchParams
  const asked = Number(q.days)
  const days = (RANGES as readonly number[]).includes(asked) ? asked : DEFAULT_DAYS
  const wanted = askedCountry(q.country)

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )

  let daily = await sb.rpc('site_visit_daily_v2', { p_days: days, p_tz: TZ, p_country: wanted })
  // Migration 117 not run yet: the older function still answers, for every
  // country and without the two groups.
  const upgraded = daily.error?.code !== NOT_THERE
  if (!upgraded) daily = await sb.rpc('site_visit_daily', { p_days: days, p_tz: TZ })
  if (daily.error) {
    return (
      <div style={{ padding: 32, color: 'var(--red)', lineHeight: 1.6 }}>
        {daily.error.code === NOT_THERE
          ? 'This page needs supabase/117_site_visit_groups_country.sql. Run it in the Supabase SQL editor, then reload.'
          : `Failed to load: ${daily.error.message}`}
      </div>
    )
  }

  // The fixed charts. A failure here leaves them out instead of taking the
  // page down: they are extra views of the same log.
  const [byCountry, signins] = upgraded
    ? await Promise.all([
        sb.rpc('site_visit_by_country', { p_days: days, p_tz: TZ, p_top: 5 }),
        sb.rpc('site_signins_daily', { p_days: days, p_tz: TZ }),
      ])
    : [null, null]
  if (byCountry?.error) console.error('[admin/traffic] site_visit_by_country:', byCountry.error.message)
  if (signins?.error) console.error('[admin/traffic] site_signins_daily:', signins.error.message)

  const found = (daily.data ?? []) as DailyRow[]
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  const countries = countryDays((byCountry?.data ?? []) as CountryRow[], today)
  const methods = signinDays((signins?.data ?? []) as SigninRow[], today)

  return (
    <TrafficView
      rows={fillDaily(found, today)}
      days={days}
      ranges={RANGES}
      tz="Taiwan time"
      // The top 20% and top 10% stay come from migration 116, the two groups
      // from 117. Without them the rows lack the columns, and the view says so
      // in their place instead of drawing zeros.
      topStay={found.length === 0 || found.some(r => r.p80_seconds != null)}
      upgraded={upgraded}
      country={upgraded ? wanted : null}
      picker={countries.picker.slice(0, 5)}
      names={countryNames([...countries.picker, ...countries.codes, wanted])}
      countryDays={countries.days}
      countryCodes={countries.codes}
      signinDays={methods.days}
      signinTotals={methods.totals}
    />
  )
}
