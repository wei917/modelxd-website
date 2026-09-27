// lib/trending-job.ts
//
// The weekly "Trending on social media" search (owner, Sep 26). Grok's
// x_search finds the past month's most-liked showcase posts made with models
// XCreate offers (the prompt is optional since Sep 27: a post without one
// just has no preset button); this file filters them, checks each still
// exists, matches a preset to our catalog when there is a prompt, and stores
// them in trending_posts as 'pending'. Nothing goes live until the owner
// publishes it at /admin/trending.
//
// The rules are the owner's (Sep 26): a post must be made with a video or
// image model and NAME it. Never a post made through an LLM or coding agent
// (Claude Opus briefs), never someone else's characters or real people,
// nothing suggestive. Since Sep 27 ("remove midjourney. we should search
// models we support") only models XCreate offers: the searches are built from
// the catalog, and every model a post credits must be one XCreate can run
// (lib/trending-models.ts). Grok is told all of this and still mislabels, so
// the model rules are enforced again in code, on the names it returns and on
// the post's own text.
//
// Spend: x_search can't be capped per search in dollars (the prompt's search
// limit was ignored and max_tool_calls isn't a request field; max_turns limits
// turns, not cost; searches have cost $0.22 to $3.34), so the guard is
// monthly. Every run is logged to provider_calls with usage_metadata.job =
// 'trending', a cost the response doesn't report stays null (unknown, never
// $0), and a run is refused once the month's total, unknowns counted at
// SEARCH_EST_USD, could pass TRENDING_MONTHLY_BUDGET_USD (default $10).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startCall, endCall } from './providers/call-log'
import {
  chatGptIsApp, eligibility, groupQuery, loadSupport, otherGeneratorsIn, presetModel, searchGroups,
  type Family, type MediaKind, type Support,
} from './trending-models'

export type TrendKind = MediaKind

const GROK_MODEL     = process.env.TRENDING_GROK_MODEL || 'grok-4.7'
const MONTHLY_BUDGET = Number(process.env.TRENDING_MONTHLY_BUDGET_USD || 10)
const CANDIDATES     = 30
/** Recent month = rolling 30-day search window (owner, Sep 27). */
const SEARCH_LOOKBACK_DAYS = 30
/** XCreate refuses longer prompts (app/api/xcreate/route.ts). */
const PROMPT_CAP     = 8000
const LANGS          = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  })
}

/** Monday (UTC) of the week `d` falls in, as YYYY-MM-DD. The list a run
 *  finds is grouped by the week it runs in; its search covers the preceding
 *  SEARCH_LOOKBACK_DAYS days, independently of this weekly grouping. */
export function weekOf(d: Date): string {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7))
  return m.toISOString().slice(0, 10)
}

const day = (d: Date) => d.toISOString().slice(0, 10)

// ── Grok ─────────────────────────────────────────────────────────────────────

export type GrokPost = {
  url?: string
  handle?: string
  likes?: number | null
  models?: string[]
  prompt_text?: string | null
  needs?: 'none' | 'image' | 'video' | null
  image_role?: 'first_frame' | 'character_reference' | null
  duration_seconds?: number | null
  aspect_ratio?: string | null
  summary?: Record<string, string>
}

/** Searches per kind in a run. One Grok search returns a handful of posts,
 *  never the CANDIDATES it is asked for (Sep 26: one search, 5 survived the
 *  filters, against a list meant to hold 20), so a run is several narrower
 *  searches over the families XCreate offers (searchGroups), merged before
 *  the filters. */
const SEARCHES: Record<TrendKind, number> = { video: 4, image: 2 }
/** What one search is planned to cost, and what an unknown one counts as: the
 *  dearest measured (Sep 27: $3.34 without max_turns; $1.79 with it). It was
 *  $0.90 until Codex's review, below every measured search. An estimate, not
 *  a cap. At this rate the default $10 pays for two searches in a fresh
 *  month, not the six a full run plans, so a run does the searches that fit
 *  (planSearches) and reports the rest as deferred. */
export const SEARCH_EST_USD = 3.34

export type PlannedSearch = { kind: TrendKind; group: Family[] }

/** Which of a run's searches the month's remaining budget pays for (Codex
 *  review, Sep 27). `affordable` is how many searches fit at SEARCH_EST_USD.
 *  Kinds alternate so video and image both get a slot, the kind that goes
 *  first alternates by week, and each kind's groups rotate by week, so a
 *  small budget doesn't search the same families every Monday: over four
 *  weeks at two searches a week, every group of both kinds gets its turn. */
export function planSearches(groups: Partial<Record<TrendKind, Family[][]>>, affordable: number, weekIndex: number):
  { chosen: PlannedSearch[]; deferred: PlannedSearch[] } {
  const n = Math.max(0, Math.floor(affordable))
  // With one slot and two kinds, each kind runs every other week. Rotate
  // its groups per appearance so parity cannot starve half the groups.
  const rotation = n === 1 && groups.video?.length && groups.image?.length
    ? Math.floor(weekIndex / 2) : weekIndex
  const rotated = (k: TrendKind): Family[][] => {
    const g = groups[k] ?? []
    return g.map((_, i) => g[(i + rotation) % g.length])
  }
  const first: TrendKind = weekIndex % 2 === 0 ? 'video' : 'image'
  const second: TrendKind = first === 'video' ? 'image' : 'video'
  const a = rotated(first), b = rotated(second)
  const order: PlannedSearch[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) order.push({ kind: first, group: a[i] })
    if (b[i]) order.push({ kind: second, group: b[i] })
  }
  return { chosen: order.slice(0, n), deferred: order.slice(n) }
}

/** Weeks since the epoch for the Monday `d` falls in: planSearches' rotation. */
export const weekIndexOf = (d: Date) => Math.floor(Date.parse(weekOf(d)) / (7 * 86_400_000))
/** One search's cap; see runTrendingKinds for the whole run's time budget. */
const SEARCH_TIMEOUT_MS = 480_000
/** Agentic turns per search (`max_turns`, documented for POST /v1/responses).
 *  A turn limit, not a dollar cap: one turn can run several searches. At 8 an
 *  image search over 30 days made 21 searches and cost $1.79 (Sep 27), where
 *  the unlimited one before it made 48 and cost $3.34. */
const SEARCH_MAX_TURNS = 8

/** The feed is showcase posts made with models XCreate offers (owner, Sep
 *  27: "only 11 posts in one month? you must be kidding me"). Until then the
 *  search asked for posts that SHARE their full prompt and sent Grok digging
 *  through threads for it, which starved the list; the prompt is optional now
 *  (the card just has no preset button without one). */
function searchPrompt(kind: TrendKind, from: string, to: string, group: Family[], support: Support): string {
  const media = kind === 'video' ? 'AI-GENERATED VIDEO' : 'AI-GENERATED IMAGE'
  const filter = kind === 'video' ? 'filter:videos' : 'filter:images'
  const names = groupQuery(group)
  const focus = group.map(f => f.name).join(', ')
  const offered = support.families.map(f => f.name).join(', ')
  return `Find the most-liked posts on X from ${from} to ${to} that show off an ${media} made with ${focus}.

Search in Top mode, most-liked first, with operators, for example:
  ${names} ${filter} min_faves:300 since:${from} until:${to}
  ${names} ("made with" OR "created with" OR prompt) ${filter} min_faves:100 since:${from} until:${to}
Lower min_faves only when a model in this search has too few posts. Cover varied subjects: products, animals, nature, food, architecture and travel, original animation and characters, practical creative demos. Do not fill the list with celebrity or portrait posts.

Keep only posts where the author names the model that made the ${kind}, from this search (${focus}). Every image or video model the author credits must be one of: ${offered}. Drop a post that credits any other generator, including Midjourney, also when it is mixed with another model.
The prompt is optional. Include it only when it is in the post itself or plainly in the author's first reply; do not dig through threads for it.
EXCLUDE: posts made through an LLM or coding agent (Claude, Opus, ChatGPT, GPT-5, Codex, Gemini, Cursor or any "AI agent" workflow); posts showing someone else's characters or real people (franchise or cartoon characters, celebrities, public figures, brand mascots); sexual or suggestive content; ads and promotions (a website, app, deployment guide, discount or referral link); quote posts of someone else's work.

Return ONLY JSON, no prose:
{"posts":[{"url":"https://x.com/<handle>/status/<id>","handle":"<without @>","likes":<number or null>,"models":["EVERY image and video model the author credits, as they write it, including one that made a first frame"],"prompt_text":"the author's prompt as written, or null","needs":"none | image | video (what the viewer must supply to reuse the prompt)","image_role":"first_frame | character_reference | null","duration_seconds":<number or null>,"aspect_ratio":"16:9 or null","summary":{"en":"one sentence in YOUR OWN words describing the ${kind}","zh-Hant":"…","zh-Hans":"…","ja":"…","ko":"…"}}]}
Most-liked first, up to ${CANDIDATES}. Summaries never quote the author and use no em dashes. Only real post URLs you fetched.`
}

/** The posts a response cites (its url annotations): more than it returns
 *  (72 cited against 15 returned on Sep 27), kept for review. */
export function citedPostIds(body: any): string[] {
  const ids = new Set<string>()
  for (const o of body?.output ?? []) for (const c of o.content ?? []) for (const a of c.annotations ?? []) {
    const m = String(a?.url ?? '').match(/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d{5,25})/)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

/** costUsd is null when the response didn't report a valid cost. */
type GrokResult = { posts: GrokPost[]; costUsd: number | null; usage: any }

/** The response's cost in dollars, or null when it is missing or not a
 *  finite, non-negative number: an unknown cost must not read as $0. */
export function reportedCost(usage: any): number | null {
  const ticks = usage?.cost_in_usd_ticks
  if (ticks == null || ticks === '') return null
  const n = Number(ticks)
  return Number.isFinite(n) && n >= 0 ? n / 1e10 : null
}

/** The search is streamed so bytes keep flowing while Grok works. Sent as one
 *  plain request, a search sat silent for over five minutes and Node's fetch
 *  gives up on a response at 300s (Sep 27: all four searches of a run died
 *  exactly there; xAI may still have billed them). Returns the final response
 *  object carried by the `response.completed` event. */
async function completedResponse(stream: ReadableStream<Uint8Array>): Promise<any> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = '', completed: any = null, failure: string | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const line = block.split('\n').find(l => l.startsWith('data:'))
      const data = line?.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let ev: any
      try { ev = JSON.parse(data) } catch { continue }
      if (ev.type === 'response.completed') completed = ev.response
      else if (ev.type === 'response.failed' || ev.type === 'error') failure = JSON.stringify(ev).slice(0, 300)
    }
    if (done) break
  }
  if (!completed) throw new Error(`xAI stream ended without a completed response${failure ? `: ${failure}` : ''}`)
  return completed
}

/** One Grok search, logged as one start row and exactly one end row.
 *  Exported for the offline tests (scripts/test-trending-job.ts). */
export async function searchX(kind: TrendKind, from: string, to: string, group: Family[], support: Support): Promise<GrokResult> {
  const names = groupQuery(group)
  const key = process.env.XAI_API_KEY
  if (!key) throw new Error('XAI_API_KEY is not set')
  const desc = { provider: 'xai', model_name: GROK_MODEL, mode: 'text' as const, user_id: null }
  const requestId = startCall(desc)
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROK_MODEL,
        input: [{ role: 'user', content: searchPrompt(kind, from, to, group, support) }],
        tools: [{ type: 'x_search', from_date: from, to_date: to, enable_image_understanding: false, enable_video_understanding: false }],
        max_turns: SEARCH_MAX_TURNS,
        max_output_tokens: 32000,
        stream: true,
      }),
      // Every search runs in parallel and must end inside the route's 800s
      // with room left for the post checks (CHECK_BUDGET_MS) and writes.
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body: any = await completedResponse(res.body)
    const u = body.usage ?? {}
    const costUsd = reportedCost(u)
    const text = (body.output ?? []).flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n')
    let posts: GrokPost[] = [], parseError: string | null = null
    try {
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      posts = Array.isArray(json.posts) ? json.posts : []
    } catch (e) { parseError = (e as Error).message }
    // One end row per call, with everything the search returned and cited,
    // so a candidate the filters or the reviewer drop is still on record. (An
    // answer that wasn't JSON used to log a success row and then a failed one.)
    endCall(requestId, desc, {
      status: 'success', latency_ms: Date.now() - t0, cost_usd: costUsd,
      input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
      cached_input_tokens: u.input_tokens_details?.cached_tokens ?? null,
      usage_metadata: {
        job: 'trending', kind, from, to, group: names, max_turns: SEARCH_MAX_TURNS,
        tools: u.server_side_tool_usage_details ?? null,
        returned: posts.map(p => ({ url: p.url, handle: p.handle, likes: p.likes ?? null, models: p.models ?? [], summary: p.summary?.en ?? null, prompt: p.prompt_text ? String(p.prompt_text).length : 0 })),
        cited: citedPostIds(body),
        ...(parseError ? { parse_error: parseError, output_head: text.slice(0, 500) } : {}),
      },
    })
    if (parseError) return { posts: [], costUsd, usage: u }
    return { posts, costUsd, usage: u }
  } catch (err) {
    endCall(requestId, desc, {
      status: 'failed', latency_ms: Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 500),
      usage_metadata: { job: 'trending', kind, from, to, group: names },
    })
    throw err
  }
}

// ── filters ──────────────────────────────────────────────────────────────────
// Which credited models a post may name is lib/trending-models.ts
// (eligibility); what is here checks the post's own text.

const POST_URL = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/

/** The post's text if it still exists and belongs to the handle (X's free
 *  oEmbed), else null. */
async function postText(handle: string, id: string): Promise<string | null> {
  try {
    const url = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/${handle}/status/${id}`)}`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const j: any = await r.json()
    if (!String(j.author_url ?? '').toLowerCase().endsWith('/' + handle.toLowerCase())) return null
    return String(j.html ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  } catch { return null }
}

/** The post itself credits an LLM or agent, whatever Grok put in `models`
 *  (Sep 26: @abxxai says "made this with Claude Opus 5.5 and Seedance 2.5"
 *  while Grok listed Seedance alone). */
const LLM_MENTION = /\b(claude|opus|sonnet|chat\s*gpt|gpt[-\s]?5|codex|cursor|copilot|ai agent)\b/i
/** The same without ChatGPT, for an image post crediting a supported image
 *  model: there ChatGPT is the app the model ran in (chatGptIsApp). Agent and
 *  LLM workflows still stay out. */
const LLM_MENTION_BUT_CHATGPT = /\b(claude|opus|sonnet|gpt[-\s]?5|codex|cursor|copilot|ai agent)\b/i

// ── presets ──────────────────────────────────────────────────────────────────
// Which catalog model a preset runs is presetModel (lib/trending-models.ts).

/** Which XCreate recipe reproduces the post, or null when it needs something
 *  our pipeline can't take (a source video). */
function recipeFor(kind: TrendKind, p: GrokPost): string | null {
  if (p.needs === 'video') return null
  if (kind === 'video') {
    if (p.needs !== 'image') return 'text_to_video'
    return p.image_role === 'character_reference' ? 'reference_frames' : 'image_to_video'
  }
  return p.needs === 'image' ? 'image_edit' : 'text_to_image'
}

// ── the run ──────────────────────────────────────────────────────────────────

export type RunReport = {
  kind: TrendKind
  week: string
  from: string
  to: string
  costUsd: number             // what the searches reported
  costUnknown: number         // searches that failed or reported no cost (may still be billed)
  deferred: string[]          // searches of this kind the month's budget left for another week
  found: number
  inserted: number
  alreadyListed: number
  dropped: { url: string; reason: string }[]
}

/** The month's trending spend as far as the log can tell, failing closed:
 *  an unreadable log throws (no run). A search whose cost is unknown counts at
 *  SEARCH_EST_USD, never as zero: one that started but never logged its end (a
 *  run cut off before its log went out, Sep 27), and one that ended without a
 *  cost. Start rows carry no job tag, so every unfinished call to the trending
 *  model counts; that errs toward refusing. */
export async function monthSpend(sb: SupabaseClient, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const known = await sb.from('provider_calls').select('cost_usd')
    .eq('event', 'end').eq('provider', 'xai').eq('usage_metadata->>job', 'trending')
    .gte('created_at', start)
  if (known.error) throw new Error(`Trending budget unreadable: ${known.error.message}`)
  const calls = await sb.from('provider_calls').select('request_id, event')
    .eq('provider', 'xai').eq('model_name', GROK_MODEL).in('event', ['start', 'end'])
    .gte('created_at', start)
  if (calls.error) throw new Error(`Trending budget unreadable: ${calls.error.message}`)
  const ended = new Set((calls.data ?? []).filter((r: any) => r.event === 'end').map((r: any) => r.request_id))
  const orphans = (calls.data ?? []).filter((r: any) => r.event === 'start' && !ended.has(r.request_id)).length
  const rows = (known.data ?? []) as { cost_usd: number | string | null }[]
  const costOf = (r: { cost_usd: number | string | null }) => r.cost_usd == null ? NaN : Number(r.cost_usd)
  const valid = (c: number) => Number.isFinite(c) && c >= 0
  const logged = rows.reduce((sum, r) => valid(costOf(r)) ? sum + costOf(r) : sum, 0)
  const noCost = rows.filter(r => !valid(costOf(r))).length   // null or unreadable
  return logged + (noCost + orphans) * SEARCH_EST_USD
}

/** The run's searches at once (searchGroups over the catalog, then the ones
 *  the month's budget pays for: planSearches), candidates stored as
 *  'pending'. Time budget inside the routes' maxDuration of 800s: all
 *  searches run in parallel and each aborts at SEARCH_TIMEOUT_MS (480s), then
 *  the post checks get CHECK_BUDGET_MS (120s), then the inserts; kinds never
 *  run one after another. The catalog and the month's spend are read before
 *  any paid call; unreadable spend, or a budget with no room for one search at
 *  SEARCH_EST_USD, throws. Searches left out are reported per kind as
 *  `deferred`. Estimates, not a cap: the actual cost can be higher. */
export async function runTrendingKinds(kinds: TrendKind[], now = new Date()): Promise<{ reports: RunReport[]; errors: string[] }> {
  const sb = serviceClient()
  const support = await loadSupport(sb)
  const groups: Partial<Record<TrendKind, Family[][]>> = {}
  for (const k of kinds) groups[k] = searchGroups(k, support, SEARCHES[k])
  if (kinds.every(k => !groups[k]?.length)) throw new Error(`Trending search skipped: XCreate offers no ${kinds.join(' or ')} model to search for.`)
  // What fits the month: spend that can't be read throws (no run), and a run
  // does only the searches the rest of the budget pays for at SEARCH_EST_USD.
  const spent = await monthSpend(sb, now)
  const affordable = Math.floor((MONTHLY_BUDGET - spent) / SEARCH_EST_USD + 1e-9)
  const { chosen, deferred } = planSearches(groups, affordable, weekIndexOf(now))
  const deferredOf = (k: TrendKind) => deferred.filter(d => d.kind === k).map(d => groupQuery(d.group))
  if (chosen.length === 0) {
    throw new Error(`Trending search skipped: about $${spent.toFixed(2)} of the $${MONTHLY_BUDGET} budget is counted this month (unknown costs at $${SEARCH_EST_USD} each), so no search at $${SEARCH_EST_USD} fits. Deferred: ${deferred.map(d => `${d.kind} ${groupQuery(d.group)}`).join('; ')}.`)
  }
  const to = day(now)
  const from = day(new Date(now.getTime() - SEARCH_LOOKBACK_DAYS * 86_400_000))
  const runs = await Promise.allSettled(kinds.map(async kind => {
    if (!groups[kind]?.length) throw new Error(`XCreate offers no ${kind} model to search for`)
    const mine = chosen.filter(c => c.kind === kind).map(c => c.group)
    if (mine.length === 0) {
      const none: RunReport = { kind, week: weekOf(now), from, to, costUsd: 0, costUnknown: 0, deferred: deferredOf(kind), found: 0, inserted: 0, alreadyListed: 0, dropped: [] }
      return none
    }
    const results = await Promise.allSettled(mine.map(g => searchX(kind, from, to, g, support)))
    const ok = results.filter((r): r is PromiseFulfilledResult<GrokResult> => r.status === 'fulfilled').map(r => r.value)
    if (ok.length === 0) throw (results[0] as PromiseRejectedResult).reason
    // Most-liked first across the groups; ingest drops repeats by post id.
    const posts = ok.flatMap(r => r.posts).sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    const costUsd = ok.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
    const costUnknown = ok.filter(r => r.costUsd == null).length + (results.length - ok.length)
    const { report } = await ingestCandidates(sb, kind, posts, now, false, support)
    return { ...report, from, to, costUsd, costUnknown, deferred: deferredOf(kind) }
  }))
  const reports: RunReport[] = []
  const errors: string[] = []
  runs.forEach((r, i) => {
    if (r.status === 'fulfilled') reports.push(r.value)
    else errors.push(`${kinds[i]}: ${(r.reason as Error)?.message ?? r.reason}`)
  })
  return { reports, errors }
}

/** One kind (the admin page's "run"). */
export async function runTrending(kind: TrendKind, now = new Date()): Promise<RunReport> {
  const { reports, errors } = await runTrendingKinds([kind], now)
  if (!reports.length) throw new Error(errors[0] ?? 'Trending search failed')
  return reports[0]
}

/** Post checks run a few at a time and stop at a deadline, so a run with
 *  many candidates still ends inside the route's 800s (Codex review, Sep 27).
 *  A candidate not checked in time is dropped, never stored unverified. */
const CHECK_CONCURRENCY = 6
const CHECK_BUDGET_MS   = 120_000
async function checkPosts(items: { handle: string; postId: string }[]): Promise<Map<string, string | null | 'unchecked'>> {
  const out = new Map<string, string | null | 'unchecked'>()
  const deadline = Date.now() + CHECK_BUDGET_MS
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]
      out.set(it.postId, Date.now() > deadline ? 'unchecked' : await postText(it.handle, it.postId))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, items.length) }, worker))
  return out
}

/** Filter, verify and store Grok's candidates. Split from the search so it
 *  can be exercised on saved results without a paid call; `dry` returns the
 *  rows it would insert and writes nothing. `support` is the run's catalog
 *  read, or read here when absent. */
export async function ingestCandidates(sb: SupabaseClient, kind: TrendKind, posts: GrokPost[], now = new Date(), dry = false, support?: Support) {
  const week = weekOf(now)
  const offered = support ?? await loadSupport(sb)
  const catalog = offered.models.filter(m => m.kinds.includes(kind))

  const report: RunReport = { kind, week, from: '', to: '', costUsd: 0, costUnknown: 0, deferred: [], found: posts.length, inserted: 0, alreadyListed: 0, dropped: [] }
  const rows: any[] = []
  const seen = new Set<string>()

  // Rules that need no network first; the post checks then run in a bounded pool.
  const candidates: { p: GrokPost; url: string; handle: string; postId: string; models: string[] }[] = []
  for (const p of posts) {
    const url = String(p.url ?? '')
    const m = url.match(POST_URL)
    if (!m) { report.dropped.push({ url, reason: 'not an X post URL' }); continue }
    const [, handle, postId] = m
    if (seen.has(postId)) continue
    seen.add(postId)
    const models = (p.models ?? []).map(s => String(s).trim()).filter(Boolean)
    const verdict = eligibility(kind, models, offered)
    if (!verdict.ok) { report.dropped.push({ url, reason: verdict.reason }); continue }
    candidates.push({ p, url, handle, postId, models })
  }
  const texts = await checkPosts(candidates.map(c => ({ handle: c.handle, postId: c.postId })))

  for (const { p, url, handle, postId, models } of candidates) {
    const text = texts.get(postId)
    if (text === 'unchecked') { report.dropped.push({ url, reason: 'not checked in time' }); continue }
    if (text == null) { report.dropped.push({ url, reason: 'post not found on X' }); continue }
    const mention = chatGptIsApp(kind, models, offered) ? LLM_MENTION_BUT_CHATGPT : LLM_MENTION
    if (mention.test(text)) { report.dropped.push({ url, reason: 'post credits an LLM or agent' }); continue }
    const other = otherGeneratorsIn(text, offered)
    if (other.length) { report.dropped.push({ url, reason: `post names a model XCreate doesn't offer (${other.join(', ')})` }); continue }

    const summary: Record<string, string> = {}
    for (const l of LANGS) if (p.summary?.[l]) summary[l] = String(p.summary[l]).replace(/—/g, ', ').trim()
    if (!summary.en) { report.dropped.push({ url, reason: 'no summary' }); continue }

    const prompt = typeof p.prompt_text === 'string' && p.prompt_text.trim() ? p.prompt_text.trim() : null
    const recipe = recipeFor(kind, p)
    const model = recipe ? presetModel(models, recipe, catalog) : null
    const preset = prompt && recipe && model && prompt.length <= PROMPT_CAP
      ? {
          model, recipe,
          ...(p.duration_seconds ? { duration: Math.round(p.duration_seconds) } : {}),
          ...(p.aspect_ratio ? { aspect: p.aspect_ratio } : {}),
          ...(p.needs === 'image' ? { needsImage: true } : {}),
        }
      : null

    rows.push({
      platform: 'x', post_id: postId, handle, url: `https://x.com/${handle}/status/${postId}`,
      kind, models, likes: typeof p.likes === 'number' ? p.likes : null,
      summary, prompt, preset, week, rank: null, status: 'pending', found_by: 'grok_x_search',
    })
  }

  if (rows.length) {
    // A post already on the list (an earlier week, or the seed) keeps its row.
    const { data: existing } = await sb.from('trending_posts').select('post_id')
      .eq('platform', 'x').in('post_id', rows.map(r => r.post_id))
    const known = new Set((existing ?? []).map((r: any) => r.post_id))
    const fresh = rows.filter(r => !known.has(r.post_id))
    report.alreadyListed = rows.length - fresh.length
    if (fresh.length && !dry) {
      const { error } = await sb.from('trending_posts').insert(fresh)
      if (error) throw new Error(`trending_posts insert failed: ${error.message}`)
    }
    report.inserted = dry ? 0 : fresh.length
    return { report, rows: fresh }
  }
  return { report, rows: [] as any[] }
}

/** The kinds the weekly job searches: video and image unless TRENDING_KINDS
 *  narrows it. */
export function enabledKinds(): TrendKind[] {
  // Images joined the default on Sep 27 (owner: "we should start to load
  // popular image posts too"); TRENDING_KINDS still narrows it.
  const raw = (process.env.TRENDING_KINDS || 'video,image').split(',').map(s => s.trim())
  return raw.filter((k): k is TrendKind => k === 'video' || k === 'image')
}
