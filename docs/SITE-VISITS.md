# The visit log (`site_visits`)

Owner, Sep 27: see which visitors and users come from Google Ads, and how long
people stay. Before this nothing measured either: Vercel Analytics counts page
views, `profiles.last_seen_at` moves once a day, `activity_logs` holds logins.

- **Table**: `supabase/109_site_visits.sql`. Server-only (RLS on, no policies,
  anon/authenticated revoked from the table and `log_site_visit()`).
- **Browser**: `app/components/VisitTracker.tsx`, mounted in the root layout.
- **Server**: `app/api/visit/route.ts` (bypasses the www password gate, so ad
  clicks that land on `/coming-soon` still count).

## What a row means

- **One visit = one tab's stay.** Reloads and in-app navigation continue it;
  30 minutes without input ends it. Moving between front doors (www → xtell)
  is a new visit, because each host has its own tab storage. Same visitor.
- **`active_seconds`** = time with the tab in front, pausing 5 minutes after
  the last input (mouse, keys, scroll, touch). An idle period can add at most
  those 5 minutes. The tab reports at the start, every minute while in front,
  and when hidden or closed, so an abrupt end loses at most a minute.
- **`visitor_id`** = the `modelxd_vid` cookie (first party, one year,
  `.modelxd.com`, server-set so Safari does not cut it to 7 days). One per
  browser, not per person.
- **`user_id`** = the first signed-in user seen during the visit. Visits
  before sign-in are tied to the user through `visitor_id`.
- **Source**: `gclid` / `gbraid` / `wbraid` (Google Ads auto-tagging; gbraid and
  wbraid are iOS), `utm_*` from the landing URL, `referrer` host. Only taken
  when the tab arrived from outside: a reload of an ad URL is not a new click.
- **`env`**: `production`, `preview` (dev.modelxd.com) or `development`
  (localhost). **Every report filters `env = 'production'`.**
- **Not logged**: the EEA, the UK and Switzerland (`lib/consent.ts`), crawlers
  (Googlebot, AdsBot, headless Chrome, Lighthouse), browsers without
  JavaScript. No IP address is stored anywhere.

## The daily dashboard: `/admin/traffic`

Admin only (`ADMIN_EMAILS`, on www). Days are cut in Taiwan time. The page
has two kinds of chart (owner, Sep 30: "overall settings/filters/toggles and
pre defined charts without effecting by the filters"):

- **Filters**, at the top: the range (7 / 14 / 30 / 90 days) and the country
  (`?country=JP`; the picker offers the five countries with the most browsers
  in the range).
- **Filtered part**, which follows both: tiles for the range as a whole
  (see "The range as a whole" below), then per day: active
  browsers split into new and returning, signed-in users, visits by source
  (ChatGPT ads = `utm_source='chatgpt'`, Google Ads = a click id, other), and
  stay for two groups, each with median, top 20%, top 10% and average. With a
  country picked, "new" and "returning" mean within that country.
- **Fixed charts**, always every country (only the range applies): browsers
  by country (the three biggest named, the rest Other) and sign-ins by
  method (Google, LINE Taiwan, LINE Japan).
- **Tables** for every chart.

Three functions in `supabase/117_site_visit_groups_country.sql`, service key
only: `site_visit_daily_v2(p_days, p_tz, p_country)`,
`site_visit_by_country(p_days, p_tz, p_top)` and
`site_signins_daily(p_days, p_tz)`. PostgREST cannot group or take a median,
and "returning" needs each browser's first day over the whole table, so the
work is done in the database in one round trip each. Until 117 has been run
the page falls back to `site_visit_daily()` (115, widened by 116): every
country, one stay chart, no fixed charts, and a line saying what is missing.

**The range as a whole** (Oct 1). The tiles at the top are the RANGE's
numbers, with today so far and yesterday in small type under each:
`site_visit_summary(p_days, p_tz, p_country)` in
`supabase/118_site_visit_summary.sql` returns one row for the window. It
cannot be added up from the daily rows: a browser that comes on three days
is three in the daily counts and one here, and a median of medians is not a
median. Active browsers and signed-in users are counted once; **returning**
= browsers that came on more than one day (the earlier day may be before the
range); stay is still per browser per day, over every day in the range. Two
boxes under the tiles give stay for the browsers that had an account on any
visit in the range and for the rest (the daily rule with a window of one day
is the same rule). Until 118 has been run the tiles are today's, every label
ends in "today", and a line says what is missing. They were today's at first
under the heading "Filtered: 14 days"; twenty minutes into a new Taiwan day
the owner read "3" as the log having been emptied.

**Stay** is per browser per day (that browser's visits added up, tab in
front), not per visit. **Top 20% / top 10% stay** is the stay that the most
engaged fifth and tenth of the browsers reached or passed: the 80th and 90th
percentile.

**Signed in / not signed in** (Sep 30). A browser counts as signed in on a
day if any of its visits that day carried an account. The numbers over
everyone mix two very different groups and describe neither: from Sep 28 to
Sep 30 the 8% of browsers that signed in stayed a median of about 5 minutes
(top 10%: 16 to 44 minutes) and the 92% that did not, 6 to 12 seconds. So
the page draws the two groups as two charts, each on its own scale. A day
with nobody in a group is a gap in the line and a dash in the table, not
"0s". The owner's own sessions are in the signed-in group.

**Sign-ins by method** counts accounts per day by the method the account was
made with (`activity_logs.metadata.provider`: `google`, `custom:line-tw`,
`custom:line-jp`), plus new accounts and sign-ins over the range. The login
log does not record the host, so sign-ins on dev.modelxd.com and localhost
are in these numbers too.

## Reports (Supabase SQL editor)

Time on site by source, last 7 days:

```sql
select
  case when gclid is not null or gbraid is not null or wbraid is not null then 'google ads'
       when utm_source is not null then 'utm: ' || utm_source
       when coalesce(referrer, '') = '' then 'direct'
       when referrer like '%modelxd.com' then 'internal'
       else referrer end                                          as source,
  count(*)                                                        as visits,
  count(distinct visitor_id)                                      as visitors,
  round(avg(active_seconds))                                      as avg_seconds,
  percentile_cont(0.5) within group (order by active_seconds)     as median_seconds,
  round(100.0 * avg((active_seconds < 10)::int), 1)               as pct_under_10s,
  round(avg(pages), 1)                                            as avg_pages,
  count(user_id)                                                  as signed_in_visits
from site_visits
where env = 'production' and started_at > now() - interval '7 days'
group by 1 order by visits desc;
```

Which users came from Google Ads (their browser's first ad click), and whether
they signed up after it or were already members:

```sql
with ad as (
  select distinct on (u.user_id)
         u.user_id, v.started_at as clicked_at, v.gclid, v.utm_campaign,
         v.host || coalesce(v.landing, '') as landed_on, v.country, v.city
  from (select distinct user_id, visitor_id from site_visits where user_id is not null) u
  join site_visits v on v.visitor_id = u.visitor_id
  where v.env = 'production' and (v.gclid is not null or v.gbraid is not null or v.wbraid is not null)
  order by u.user_id, v.started_at
)
select au.email, ad.clicked_at, au.created_at as signed_up_at,
       au.created_at >= ad.clicked_at as new_from_ad,
       ad.utm_campaign, ad.landed_on, ad.country, ad.city,
       (select round(sum(s.active_seconds) / 60.0) from site_visits s
         where s.user_id = ad.user_id and s.env = 'production') as minutes_signed_in
from ad join auth.users au on au.id = ad.user_id
order by ad.clicked_at desc;
```

Ad clicks per day: how long they stayed, how many bounced, how many of those
browsers have signed in since:

```sql
select date_trunc('day', started_at)::date                       as day,
       count(*)                                                  as ad_visits,
       round(avg(active_seconds))                                as avg_seconds,
       count(*) filter (where active_seconds < 10)               as under_10s,
       count(*) filter (where landing = '/coming-soon')          as hit_password_page,
       count(distinct visitor_id) filter (where visitor_id in
         (select visitor_id from site_visits where user_id is not null)) as signed_in_later
from site_visits
where env = 'production' and (gclid is not null or gbraid is not null or wbraid is not null)
group by 1 order by 1 desc;
```

Time on site per signed-in user per day:

```sql
select au.email, v.started_at::date as day, count(*) as visits,
       round(sum(v.active_seconds) / 60.0, 1) as minutes, sum(v.pages) as pages
from site_visits v join auth.users au on au.id = v.user_id
where v.env = 'production' and v.started_at > now() - interval '7 days'
group by 1, 2 order by 2 desc, 4 desc;
```
