// lib/trending-job.ts
//
// The weekly "Trending on social media" search (owner, Sep 26). Grok's
// x_search finds the past week's most-liked AI posts that share their
// prompt; this file filters them, checks each still exists, matches a preset
// to our catalog, and stores them in trending_posts as 'pending'. Nothing
// goes live until the owner publishes it at /admin/trending.
//
// The rules are the owner's (Sep 26): a post must be made with a video or
// image model and NAME it. Never a post made through an LLM or coding agent
// (Claude Opus briefs), never someone else's characters or real people,
// nothing suggestive. Grok is told all of this and still mislabels, so the
// LLM rule is enforced again in code on the model names it returns.
//
// Spend: x_search can't be capped per run (the prompt's search limit and
// max_tool_calls were both ignored in the Sep 26 tests, $0.22–0.82 a run),
// so the guard is monthly. Every run is logged to provider_calls with
// usage_metadata.job = 'trending', and a run is refused once the month's
// total reaches TRENDING_MONTHLY_BUDGET_USD (default $10).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startCall, endCall } from './providers/call-log'

export type TrendKind = 'video' | 'image'

const GROK_MODEL     = process.env.TRENDING_GROK_MODEL || 'grok-4.7'
const MONTHLY_BUDGET = Number(process.env.TRENDING_MONTHLY_BUDGET_USD || 10)
const CANDIDATES     = 30
/** XCreate refuses longer prompts (app/api/xcreate/route.ts). */
const PROMPT_CAP     = 8000
const LANGS          = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  })
}

/** Monday (UTC) of the week `d` falls in, as YYYY-MM-DD. The list a run
 *  finds is shown for the week it runs in; it covers the 7 days before. */
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

function searchPrompt(kind: TrendKind, from: string, to: string): string {
  const media = kind === 'video' ? 'AI-GENERATED VIDEO' : 'AI-GENERATED IMAGE'
  const filter = kind === 'video' ? 'filter:videos' : 'filter:images'
  const names = kind === 'video'
    ? '(Seedance OR Kling OR Veo OR Hailuo OR MiniMax OR Wan OR "Grok Imagine" OR HappyHorse OR Runway OR "AI video")'
    : '("GPT Image" OR Midjourney OR "Nano Banana" OR Imagen OR Seedream OR Flux OR "Qwen Image" OR "AI art")'
  return `Find the most-liked posts on X from ${from} to ${to} that contain an ${media} and share the PROMPT used to make it, in the post itself or in the author's own reply.

Search with operators so the search filters for you, for example:
  ${names} prompt ${filter} min_faves:300 since:${from} until:${to}
  "prompt" ${filter} min_faves:500 since:${from} until:${to}
Fetch the thread when the post says the prompt is below or in the replies.

Keep only posts where the ${kind} was made with a NAMED ${kind} model and you found the author's full prompt text.
EXCLUDE: posts made through an LLM or coding agent (Claude, Opus, ChatGPT, GPT-5, Codex, Gemini, Cursor or any "AI agent" workflow); posts showing someone else's characters or real people (franchise or cartoon characters, celebrities, brand mascots); sexual or suggestive content; ads with referral links.

Return ONLY JSON, no prose:
{"posts":[{"url":"https://x.com/<handle>/status/<id>","handle":"<without @>","likes":<number or null>,"models":["model names as the author gives them"],"prompt_text":"the author's prompt, exactly as written","needs":"none | image | video (what the viewer must supply to reuse the prompt)","image_role":"first_frame | character_reference | null","duration_seconds":<number or null>,"aspect_ratio":"16:9 or null","summary":{"en":"one sentence in YOUR OWN words describing the ${kind}","zh-Hant":"…","zh-Hans":"…","ja":"…","ko":"…"}}]}
Sort by likes, most first, at most ${CANDIDATES}. Summaries never quote the author and use no em dashes. Only real post URLs you fetched.`
}

type GrokResult = { posts: GrokPost[]; costUsd: number; usage: any }

async function searchX(kind: TrendKind, from: string, to: string): Promise<GrokResult> {
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
        input: [{ role: 'user', content: searchPrompt(kind, from, to) }],
        tools: [{ type: 'x_search', from_date: from, to_date: to, enable_image_understanding: false, enable_video_understanding: false }],
        max_output_tokens: 32000,
      }),
      signal: AbortSignal.timeout(9 * 60 * 1000),
    })
    const body: any = await res.json()
    if (!res.ok) throw new Error(`xAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
    const u = body.usage ?? {}
    const costUsd = u.cost_in_usd_ticks != null ? u.cost_in_usd_ticks / 1e10 : 0
    endCall(requestId, desc, {
      status: 'success', latency_ms: Date.now() - t0, cost_usd: costUsd,
      input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
      cached_input_tokens: u.input_tokens_details?.cached_tokens ?? null,
      usage_metadata: { job: 'trending', kind, from, to, tools: u.server_side_tool_usage_details ?? null },
    })
    const text = (body.output ?? []).flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n')
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return { posts: Array.isArray(json.posts) ? json.posts : [], costUsd, usage: u }
  } catch (err) {
    endCall(requestId, desc, {
      status: 'failed', latency_ms: Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 500),
      usage_metadata: { job: 'trending', kind, from, to },
    })
    throw err
  }
}

// ── filters ──────────────────────────────────────────────────────────────────

/** A model name that is an LLM or coding agent, not a video/image model.
 *  "GPT Image 2", "Gemini Omni", "Nano Banana", "Grok Imagine" stay allowed. */
export function isLlmName(name: string): boolean {
  const n = name.toLowerCase()
  if (/claude|opus|sonnet|haiku|chat\s*gpt|codex|cursor|copilot|deepseek|kimi|llama|manus|agent/.test(n)) return true
  if (/\bgpt[-\s]?\d/.test(n) && !/image/.test(n)) return true
  if (/gemini/.test(n) && !/image|omni|veo|nano/.test(n)) return true
  if (/grok/.test(n) && !/imagine/.test(n)) return true
  return false
}

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

// ── presets ──────────────────────────────────────────────────────────────────

type CatalogRow = { model_name: string; display_name: string; modes: string[] | null }

const norm = (s: string) => s.toLowerCase().replace(/hailuo/g, 'minimax').replace(/[^a-z0-9]/g, '')

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

/** The catalog model the author names that can run the recipe: a name match
 *  in either direction on letters and digits ("Seedance 2.5" → seedance2_5,
 *  "Hailuo H3" → MiniMax-H3), first name the author lists wins. */
function matchModel(names: string[], recipe: string, catalog: CatalogRow[]): string | null {
  for (const raw of names) {
    const want = norm(raw)
    if (want.length < 3) continue
    const hit = catalog.find(c => {
      if (!(c.modes ?? []).includes(recipe)) return false
      const a = norm(c.display_name), b = norm(c.model_name)
      return a.includes(want) || b.includes(want) || want.includes(b)
    })
    if (hit) return hit.model_name
  }
  return null
}

// ── the run ──────────────────────────────────────────────────────────────────

export type RunReport = {
  kind: TrendKind
  week: string
  from: string
  to: string
  costUsd: number
  found: number
  inserted: number
  alreadyListed: number
  dropped: { url: string; reason: string }[]
}

async function monthSpend(sb: SupabaseClient, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data } = await sb.from('provider_calls').select('cost_usd')
    .eq('event', 'end').eq('provider', 'xai').eq('usage_metadata->>job', 'trending')
    .gte('created_at', start)
  return (data ?? []).reduce((s, r: any) => s + (Number(r.cost_usd) || 0), 0)
}

/** One kind, one Grok search, candidates stored as 'pending'. Throws when
 *  the month's budget is spent, before any paid call. */
export async function runTrending(kind: TrendKind, now = new Date()): Promise<RunReport> {
  const sb = serviceClient()
  const spent = await monthSpend(sb, now)
  if (spent >= MONTHLY_BUDGET) {
    throw new Error(`Trending search skipped: $${spent.toFixed(2)} spent this month, budget $${MONTHLY_BUDGET}.`)
  }
  const to = day(now)
  const from = day(new Date(now.getTime() - 7 * 86_400_000))
  const { posts, costUsd } = await searchX(kind, from, to)
  const { report } = await ingestCandidates(sb, kind, posts, now)
  return { ...report, from, to, costUsd }
}

/** Filter, verify and store Grok's candidates. Split from the search so it
 *  can be exercised on saved results without a paid call; `dry` returns the
 *  rows it would insert and writes nothing. */
export async function ingestCandidates(sb: SupabaseClient, kind: TrendKind, posts: GrokPost[], now = new Date(), dry = false) {
  const week = weekOf(now)
  const { data: catalog } = await sb.from('ai_models').select('model_name, display_name, modes')
    .eq('enabled', true).contains('output_modalities', [kind])

  const report: RunReport = { kind, week, from: '', to: '', costUsd: 0, found: posts.length, inserted: 0, alreadyListed: 0, dropped: [] }
  const rows: any[] = []
  const seen = new Set<string>()

  for (const p of posts) {
    const url = String(p.url ?? '')
    const m = url.match(POST_URL)
    if (!m) { report.dropped.push({ url, reason: 'not an X post URL' }); continue }
    const [, handle, postId] = m
    if (seen.has(postId)) continue
    seen.add(postId)
    const models = (p.models ?? []).map(s => String(s).trim()).filter(Boolean)
    if (models.length === 0) { report.dropped.push({ url, reason: 'names no model' }); continue }
    if (models.some(isLlmName)) { report.dropped.push({ url, reason: `LLM or agent post (${models.join(', ')})` }); continue }
    const text = await postText(handle, postId)
    if (text === null) { report.dropped.push({ url, reason: 'post not found on X' }); continue }
    if (LLM_MENTION.test(text)) { report.dropped.push({ url, reason: 'post credits an LLM or agent' }); continue }

    const summary: Record<string, string> = {}
    for (const l of LANGS) if (p.summary?.[l]) summary[l] = String(p.summary[l]).replace(/—/g, ', ').trim()
    if (!summary.en) { report.dropped.push({ url, reason: 'no summary' }); continue }

    const prompt = typeof p.prompt_text === 'string' && p.prompt_text.trim() ? p.prompt_text.trim() : null
    const recipe = recipeFor(kind, p)
    const model = recipe ? matchModel(models, recipe, (catalog ?? []) as CatalogRow[]) : null
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

/** The kinds the weekly job searches. Images join when the owner turns them
 *  on (TRENDING_KINDS=video,image); the table and page already take them. */
export function enabledKinds(): TrendKind[] {
  const raw = (process.env.TRENDING_KINDS || 'video').split(',').map(s => s.trim())
  return raw.filter((k): k is TrendKind => k === 'video' || k === 'image')
}
