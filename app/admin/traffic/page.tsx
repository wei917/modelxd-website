// app/admin/traffic/page.tsx
// Admin-only traffic dashboard (owner, Sep 29): daily active browsers, new
// and returning, signed-in users, stay time and where visits came from.
// Server-side gate, same as /admin/models. docs/SITE-VISITS.md defines what
// a visit and "stay" mean.
//
// Two kinds of chart (owner, Sep 30: "overall settings/filters/toggles and
// pre defined charts without effecting by the filters"):
//   - FILTERED: the tiles, browsers, sources, stay and the daily table
//     follow the range and the country picked at the top.
//     site_visit_daily_v2(days, tz, country) for the days, and
//     site_visit_summary(days, tz, country) (118) for the range as a whole:
//     the tiles are the RANGE's numbers, with today and yesterday under
//     them. They were today's at first, under a heading that said "14 days",
//     and twenty minutes into a new day the owner asked if the data was gone.
//   - FIXED: browsers by country and sign-ins by method are always for every
//     country; only the range applies. site_visit_by_country() and
//     site_signins_daily().
// The daily and fixed functions come from supabase/117_site_visit_groups_country.sql.
// Until the owner has run it the page falls back to site_visit_daily()
// (115/116): no country filter, no signed-in split, no fixed charts, and a
// line saying so. Until 118 has been run the tiles are today's, and their
// heading and labels say "today".

import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/admin'
import TrafficView from './TrafficView'
import { askedCountry, countryDays, countryNames, fillDaily, shareLines, signinDays, tapTotals, toSummary, voteLines, type CountryRow, type DailyRow, type ShareRow, type SigninRow, type SummaryRow, type TapRow, type VoteRow, type AccountRow, type FunnelRow } from './data'

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
  // The same goes for the range's own numbers (migration 118): without them
  // the tiles show today, under a heading that says so.
  // Taps on the sign-in buttons (migration 120) follow the country too, and
  // so do XTell's answer votes and share presses (122), and what ad visitors
  // did (123). Accounts per country (123) are every country.
  const [byCountry, signins, range, tapped, voted, shared, funnel, accounts] = upgraded
    ? await Promise.all([
        sb.rpc('site_visit_by_country', { p_days: days, p_tz: TZ, p_top: 5 }),
        sb.rpc('site_signins_daily', { p_days: days, p_tz: TZ }),
        sb.rpc('site_visit_summary', { p_days: days, p_tz: TZ, p_country: wanted }),
        sb.rpc('site_signin_taps_window', { p_days: days, p_tz: TZ, p_country: wanted }),
        sb.rpc('xtell_vote_window', { p_days: days, p_tz: TZ, p_country: wanted }),
        sb.rpc('xtell_share_window', { p_days: days, p_tz: TZ, p_country: wanted }),
        sb.rpc('site_ad_funnel', { p_days: days, p_tz: TZ, p_country: wanted }),
        sb.rpc('site_registered_users', { p_days: days, p_tz: TZ }),
      ])
    : [null, null, null, null, null, null, null, null]
  if (byCountry?.error) console.error('[admin/traffic] site_visit_by_country:', byCountry.error.message)
  if (signins?.error) console.error('[admin/traffic] site_signins_daily:', signins.error.message)
  if (range?.error && range.error.code !== NOT_THERE) console.error('[admin/traffic] site_visit_summary:', range.error.message)
  if (tapped?.error && tapped.error.code !== NOT_THERE) console.error('[admin/traffic] site_signin_taps_window:', tapped.error.message)
  if (voted?.error && voted.error.code !== NOT_THERE) console.error('[admin/traffic] xtell_vote_window:', voted.error.message)
  if (shared?.error && shared.error.code !== NOT_THERE) console.error('[admin/traffic] xtell_share_window:', shared.error.message)
  if (funnel?.error && funnel.error.code !== NOT_THERE) console.error('[admin/traffic] site_ad_funnel:', funnel.error.message)
  if (accounts?.error && accounts.error.code !== NOT_THERE) console.error('[admin/traffic] site_registered_users:', accounts.error.message)
  const accountRows = accounts && !accounts.error ? (accounts.data ?? []) as AccountRow[] : null
  // The teachers' names for the votes card.
  const voteRows = (voted && !voted.error ? voted.data ?? [] : []) as VoteRow[]
  const modelIds = [...new Set(voteRows.map(r => r.model_id))]
  const { data: models } = modelIds.length ? await sb.from('ai_models').select('id, display_name').in('id', modelIds) : { data: [] }
  const modelNames = Object.fromEntries(((models ?? []) as Array<{ id: string; display_name: string }>).map(m => [m.id, m.display_name]))

  const found = (daily.data ?? []) as DailyRow[]
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  const countries = countryDays((byCountry?.data ?? []) as CountryRow[], today)
  const methods = signinDays((signins?.data ?? []) as SigninRow[], today)

  return (
    <TrafficView
      rows={fillDaily(found, today)}
      whole={toSummary(((range?.data ?? []) as SummaryRow[])[0])}
      taps={tapped && !tapped.error ? tapTotals((tapped.data ?? []) as TapRow[]) : null}
      votes={voted && !voted.error ? voteLines(voteRows, modelNames) : null}
      shares={shared && !shared.error ? shareLines((shared.data ?? []) as ShareRow[]) : null}
      funnel={funnel && !funnel.error ? (funnel.data ?? []) as FunnelRow[] : null}
      accounts={accountRows}
      days={days}
      ranges={RANGES}
      tz="Taiwan time"
      // The top 20% and top 10% average stay come from migration 128, the two
      // groups from 117. Without them the rows lack the columns, and the view
      // says so in their place instead of drawing zeros.
      topStay={found.length === 0 || found.some(r => r.top10_avg_seconds != null)}
      upgraded={upgraded}
      country={upgraded ? wanted : null}
      picker={countries.picker.slice(0, 5)}
      names={countryNames([...countries.picker, ...countries.codes, wanted, ...(accountRows ?? []).map(r => r.country)])}
      countryDays={countries.days}
      countryCodes={countries.codes}
      signinDays={methods.days}
      signinTotals={methods.totals}
    />
  )
}
