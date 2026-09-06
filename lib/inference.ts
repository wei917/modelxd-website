// lib/inference.ts — the shared text-inference core.
//
// SERVER-ONLY. Two consumers, one code path:
//
//   • /api/v1/chat/completions  — the public API (games, agents)
//   • XTalk Werewolf's askModel — in process, no HTTP
//
// The second one is the point. Werewolf could have been pointed at the
// public endpoint, but that would be the same lambda calling itself over
// the network — the exact smell in /api/mcp, which hops
// MCP → internal fetch → /api/xcreate → provider. A shared module gives
// both consumers identical semantics with no hop.
//
// What this owns: model resolution (slug / uuid / xd/* route), the
// per-surface block check, balance, structured output across three
// provider tiers, validation, the fallback chain, and billing.
//
// What it deliberately does NOT own: retry policy and per-call timeouts.
// Werewolf retries an empty reply once and never retries a timeout, because
// re-asking a slow model just doubles the wait; a farm sim wants backoff and
// a different model. That is game logic, and a core that decided it for them
// would be wrong for both.
//
// Billing follows /api/xcreate/chat (balance in, debit out), NOT
// /api/xcreate — the studio path writes a job row, slot rows and a gallery
// row per call, which for 200 NPC lines would mean 200 gallery entries.

import { createClient } from '@supabase/supabase-js'
import { sanitizeProviderError } from './provider-errors'
import * as providers from '@/lib/providers'
import type { ModelInfo, JsonSchemaSpec } from '@/lib/providers'
import { PRESETS, rank, type Candidate } from './router-weights'
import { getModelById, getModelByProviderName } from '@/lib/models'
import { isBlockedFor } from '@/lib/model-features'
import { debitCredits, getUserCredits } from '@/lib/credits'
import { validate, extractJson, type SchemaError } from '@/lib/json-schema'
import { adaptSchema, strictIsSafe } from '@/lib/schema-adapt'

const LOG = '[inference]'

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

// ── Structured-output tiers ──────────────────────────────────────────────
//
// Reported back to the caller as `xd.structured_mode`. Pretending the tiers
// are equivalent is how a game ships a parser it didn't know it needed.

export type StructuredMode = 'native_schema' | 'native_json' | 'coaxed' | 'none'

const TIER: Record<string, StructuredMode> = {
  openai:    'native_schema',   // Responses API text.format
  google:    'native_schema',   // responseJsonSchema + responseMimeType
  anthropic: 'native_schema',   // output_config.format
  alibaba:   'native_json',     // response_format json_object only
  xai:       'native_schema',   // response_format json_schema
  moonshot:  'native_json',     // response_format json_object only
}

export const structuredModeFor = (provider: string, hasSchema: boolean): StructuredMode =>
  hasSchema ? (TIER[provider] ?? 'coaxed') : 'none'

// ── Model resolution ─────────────────────────────────────────────────────

/**
 * The four routes. Each must rank on a signal that actually exists — a route
 * sorting on a signal it does not have is silently identical to xd/auto, which
 * is the "gate outlived its API" failure CLAUDE.md warns about in a hat.
 * Measured 2026-09-05, and this is why fast is defined the way it is:
 *
 *   auto    XD Score (XBoard votes)              shipped since Aug 27
 *   budget  list price, above a quality floor    catalog: complete
 *   max     quality_rating alone, price ignored  same votes as auto
 *   fast    measured TTFT (model_latency)        needs the probe below
 *
 * fast means TIME TO FIRST VISIBLE TOKEN — near realtime — not time to finish
 * (owner, Sep 5). Those are different questions and wall_s answers the wrong
 * one: a model can start instantly and grind, or think for 40s and then pour.
 * A chat UI lives or dies on the first token.
 *
 * The signal comes from scripts/probe-latency.ts into model_latency, because
 * nothing else has the breadth: xeval_runs.ttft_s covers 2 of 34 entries
 * (Fable 5.1 only, the SOTOPIA pilot), and provider_calls holds four text
 * models with three or more samples over seven days, 894 of its 1000 rows
 * being a single model. The route REFUSES rather than guessing when the probe
 * has not run — an unmeasured xd/fast is xd/auto in a hat.
 *
 * xd/cheap was renamed to xd/budget (owner, Sep 5) with NO alias. Note for the
 * record: nothing logs which route a caller asked for — provider_calls stores
 * the model that ran — so "nobody used it" could not be verified from data.
 */
export const ROUTES = ['xd/auto', 'xd/fast', 'xd/budget', 'xd/max'] as const
export type RouteId = typeof ROUTES[number]

/** The surface key for blocked_features. A model blocked here is refused on
 *  the API even though the site may still offer it. */
export const API_FEATURE = 'api'

export class InferenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly type = 'invalid_request_error',
  ) { super(message) }
}

/**
 * Resolve one model spec. Accepts `provider/model_name` (canonical), a raw
 * uuid (what MCP has always returned), or an `xd/*` route.
 *
 * A slug that is unknown, disabled, or blocked for the API is a 404 NAMING
 * the model — never a silent substitution. Quietly swapping a model the
 * caller asked for would break the one promise the whole site is built on.
 */
export async function resolveModel(spec: string): Promise<ModelInfo> {
  const raw = (spec ?? '').trim()
  if (!raw) throw new InferenceError('`model` is required.', 400, 'model_required')

  if ((ROUTES as readonly string[]).includes(raw)) {
    return routeModel(raw as RouteId)
  }

  let model: ModelInfo | null = null
  if (raw.includes('/')) {
    const slash = raw.indexOf('/')
    model = await getModelByProviderName(raw.slice(0, slash), raw.slice(slash + 1))
  } else {
    model = await getModelById(raw)
  }

  if (!model) {
    throw new InferenceError(
      `The model \`${raw}\` does not exist. Use provider/model_name (e.g. google/gemini-3.1-flash), or xd/auto to let ModelXD choose.`,
      404, 'model_not_found',
    )
  }
  assertUsable(model)
  return model
}

/** Shared by the explicit and routed paths, so a route can never hand back
 *  something the explicit path would have refused. */
function assertUsable(model: ModelInfo): void {
  const slug = `${model.provider}/${model.model_name}`
  if (!model.enabled) {
    throw new InferenceError(`The model \`${slug}\` is not currently available.`, 404, 'model_unavailable')
  }
  if (!(model.output_modalities ?? []).includes('text')) {
    throw new InferenceError(
      `\`${slug}\` does not generate text. Image and video generation live on the MCP surface, not chat completions.`,
      400, 'model_wrong_modality',
    )
  }
  // audit #2: the block was enforced in the picker and the surface list but
  // never on an API path. This is where it starts to matter.
  if (isBlockedFor(model as any, API_FEATURE)) {
    throw new InferenceError(`The model \`${slug}\` is not available through the API.`, 404, 'model_blocked')
  }
}

/**
 * Pick a model from the leaderboard. Reads `model_ratings` directly rather
 * than calling /api/xboard over HTTP — see the header note about lambdas
 * calling themselves.
 */
/**
 * Every text model the router may consider, with the three axes attached.
 * Exported because the XDev preview panel ranks the SAME candidates through
 * the SAME scoring function — a panel that scored its own way would show a
 * developer one model while the API served another.
 */
export async function routerCandidates(): Promise<{ candidates: Candidate[]; floorQuality: number }> {
  const sb = service()
  const { data: all } = await sb
    .from('model_ratings')
    .select('model_id, xd_score, quality_rating, value_rating, total_votes')
    .eq('mode', 'text')
    .order('xd_score', { ascending: false })
    .limit(40)
  if (!all?.length) return { candidates: [], floorQuality: 0 }

  // A vote floor. The board has had a model leading on six votes — fine on
  // XBoard, where a reader sees the count beside the score, and not fine as the
  // silent default for every API call a game makes. If too few clear it, use
  // the unfiltered list rather than refusing: a thin board should degrade to
  // "best we know", not 503 a running game.
  const rated = all.filter(r => Number(r.total_votes ?? 0) >= MIN_ROUTE_VOTES)
  const rows = rated.length >= 3 ? rated : all
  if (rows !== rated) {
    console.warn(`${LOG} only ${rated.length} text models have >= ${MIN_ROUTE_VOTES} votes; routing on the full board`)
  }

  // The quality floor is a GAP BELOW THE LEADER, not the median of the board.
  //
  // The median was the first version and it was wrong on a thin board: the five
  // rated text models sit within 10% of each other (975-1077, because votes are
  // few and Bradley-Terry starts everyone at 1000), so the median excluded
  // gemini-3.1-flash-lite — 20x cheaper than the winner and 0.9% below it on
  // quality — and xd/budget returned a $35/1M model. A median cuts half the
  // board no matter how alike the halves are.
  //
  // 100 points is roughly a 1-in-3 upset rate on this scale: a real difference.
  // Four points is not, and should not cost a caller 20x.
  const QUALITY_GAP = 100
  const best = Math.max(...rows.map(r => Number(r.quality_rating ?? 0)))
  const floorQuality = best - QUALITY_GAP

  const { data: lat } = await sb.from('model_latency').select('model_id, ttft_s, samples').gte('samples', 3)
  // WORST dot per model, never the best. model_latency has one row per
  // (model, effort) and a route returns a model with no effort attached, so
  // ranking on the best dot promises a speed only one setting delivers —
  // xd/fast picked qwen3.6-plus that way, whose dots are 0.58s and 14.37s.
  const worstTtft = new Map<string, number>()
  for (const r of lat ?? []) {
    if (typeof r.ttft_s !== 'number' || r.ttft_s <= 0) continue
    const seen = worstTtft.get(r.model_id)
    if (seen === undefined || r.ttft_s > seen) worstTtft.set(r.model_id, r.ttft_s)
  }

  const { resolveTokenRate } = await import('@/lib/providers/pricing')
  const candidates = await Promise.all(rows.map(async row => {
    const model = await getModelById(row.model_id)
    const t = model?.model_pricing?.tokens
    // Input + output per 1M, deliberately unweighted: the true ratio depends on
    // the caller's shape (a world-snapshot agent is input-heavy, a storyteller
    // output-heavy) and picking one game's ratio would overfit the router to it.
    const price = t ? resolveTokenRate(t.text_input, null) + resolveTokenRate(t.text_output, null) : null
    return {
      model_id: row.model_id,
      quality: Number(row.quality_rating ?? 0) || null,
      pricePer1m: price && price > 0 ? price : null,
      ttftS: worstTtft.get(row.model_id) ?? null,
    } as Candidate
  }))

  return { candidates, floorQuality }
}

async function routeModel(route: RouteId): Promise<ModelInfo> {
  const preset = PRESETS[route]
  const { candidates, floorQuality } = await routerCandidates()
  if (!candidates.length) {
    throw new InferenceError(
      'No rated text models are available to route to right now. Name a model explicitly.',
      503, 'router_unavailable', 'api_error',
    )
  }

  const pool = preset.floor
    ? (candidates.filter(c => (c.quality ?? 0) >= floorQuality).length
        ? candidates.filter(c => (c.quality ?? 0) >= floorQuality)
        : candidates)
    : candidates

  const ordered = rank(pool, preset.weights)
  if (!ordered.length) {
    // Only reachable when an axis the preset weights has no data at all —
    // today that means xd/fast before the latency probe has run. Say so;
    // handing back the quality leader and calling it fast is the lie.
    throw new InferenceError(
      `${route} cannot be resolved: the data it ranks on has not been measured yet. Name a model explicitly, or use xd/auto.`,
      503, 'route_unmeasured', 'api_error',
    )
  }

  for (const c of ordered) {
    const model = await getModelById(c.model_id)
    if (!model) continue
    try { assertUsable(model); return model } catch { /* try the next one */ }
  }
  throw new InferenceError(
    'No rated text model is currently usable. Name a model explicitly.',
    503, 'router_unavailable', 'api_error',
  )
}

/**
 * How many votes a model needs before the router will pick it unprompted.
 */
const MIN_ROUTE_VOTES = 10

/**
 * Order by list token price, cheapest first. The blend is input + output
 * per 1M — deliberately neutral, because the true ratio depends on the
 * caller's shape (a world-snapshot agent is input-heavy, a storyteller is
 * output-heavy) and picking one game's ratio would quietly overfit the
 * router to that game.
 */
async function byListPrice(rows: any[]): Promise<any[]> {
  const { resolveTokenRate } = await import('@/lib/providers/pricing')
  const priced = await Promise.all(rows.map(async row => {
    const model = await getModelById(row.model_id)
    const t = model?.model_pricing?.tokens
    const price = t
      ? resolveTokenRate(t.text_input, null) + resolveTokenRate(t.text_output, null)
      : Number.POSITIVE_INFINITY
    return { row, price: price > 0 ? price : Number.POSITIVE_INFINITY }
  }))
  return priced.sort((a, b) => a.price - b.price).map(p => p.row)
}

/**
 * Order by measured time to first visible token, fastest first.
 *
 * Reads model_latency, written by scripts/probe-latency.ts — a standing probe
 * rather than a read of live traffic, because production traffic is not a fair
 * sample: it is dominated by whatever the site itself calls most, and a model
 * nobody happens to use looks unmeasured rather than slow.
 *
 * A model is ranked by its WORST measured dot, not its best. model_latency has
 * one row per (model, effort) and this route returns a model with no effort
 * attached — the caller decides that, or the provider default does. Ranking on
 * the best dot picked qwen3.6-plus, whose two dots are 0.58s and 14.37s: fast
 * because of a setting the route cannot guarantee. Taking the maximum makes
 * the ordering a promise that holds however the model is then called.
 *
 * Entries with no measurement are DROPPED, not sunk to the bottom on a null.
 * A route named fast should never return a model whose speed is unknown.
 */
async function byMeasuredTtft(rows: any[]): Promise<any[]> {
  const sb = service()
  const { data } = await sb
    .from('model_latency')
    .select('model_id, ttft_s, samples')
    .gte('samples', 3)

  const worst = new Map<string, number>()
  for (const r of data ?? []) {
    if (typeof r.ttft_s !== 'number' || r.ttft_s <= 0) continue
    const seen = worst.get(r.model_id)
    if (seen === undefined || r.ttft_s > seen) worst.set(r.model_id, r.ttft_s)
  }
  return rows
    .filter(r => worst.has(r.model_id))
    .sort((a, b) => worst.get(a.model_id)! - worst.get(b.model_id)!)
}

// ── The call ─────────────────────────────────────────────────────────────

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface InferenceRequest {
  userId:     string
  /** Model spec, or an ordered fallback chain. The first that works wins. */
  models:     string[]
  messages:   InferenceMessage[]
  jsonSchema?: JsonSchemaSpec | null
  jsonMode?:   boolean
  effort?:     string | null
  search?:     boolean
  maxTokens?:  number
  surface:     string
  /**
   * Whether the core writes the ledger entry. Default true (the API path).
   *
   * Werewolf passes false: it debits ONCE per act, which is what keeps a
   * whole game as a single expandable row in the Profile ledger instead of
   * sixty per-call rows. That grouping is a product decision, so the core
   * offers to bill rather than insisting on it.
   */
  bill?:       boolean
  /**
   * Fires whenever a provider reports usage — including on an attempt that
   * then fails validation or comes back empty. A caller doing its own
   * billing needs the cost of a DEAD attempt too: the tokens were burned
   * upstream whether or not the reply was usable.
   */
  onUsage?:   (u: { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number }) => void
  /** Streams deltas as they arrive. Omitted (or ignored — see below) when a
   *  schema is requested. */
  onDelta?:   (text: string) => void
  /** Fires once the chain has settled on a model, BEFORE the first delta, so
   *  a streaming caller can name the right model in its very first chunk
   *  instead of echoing back an `xd/auto` the router already resolved. */
  onModel?:   (model: ModelInfo) => void
}

export interface InferenceResult {
  model:          ModelInfo
  text:           string
  parsed:         any | null
  structuredMode: StructuredMode
  inputTokens:    number
  outputTokens:   number
  cachedTokens:   number
  costUsd:        number
  /** Models tried and rejected before this one answered. */
  attempts:       Array<{ model: string; error: string }>
}

/** A schema request buys one silent re-ask. You cannot un-send a stream, so
 *  the retry is only possible because schema'd calls buffer (see below). */
const SCHEMA_RETRIES = 1

export async function runInference(req: InferenceRequest): Promise<InferenceResult> {
  if (!req.models.length) throw new InferenceError('`model` is required.', 400, 'model_required')
  if (!req.messages.length) throw new InferenceError('`messages` must not be empty.', 400, 'messages_required')

  // Balance gate. The exact cost isn't known until the provider answers, so
  // this is a floor, not a reservation — one text call cannot meaningfully
  // overdraw, and holding a reserve per NPC line would cost more in ledger
  // rows than the calls themselves.
  const credits = req.bill === false ? null : await getUserCredits(req.userId)
  if (req.bill !== false && (credits?.balance_cents ?? 0) <= 0) {
    throw new InferenceError(
      'Your ModelXD balance is empty. Top up at modelxd.com/profile.',
      402, 'insufficient_credits',
    )
  }

  const attempts: Array<{ model: string; error: string }> = []
  let lastError: InferenceError | null = null

  for (const spec of req.models) {
    let model: ModelInfo
    try {
      model = await resolveModel(spec)
    } catch (err) {
      const e = err as InferenceError
      // A bad name in the chain is worth reporting, but it must not end the
      // chain: `models: ["typo", "google/…"]` should still answer.
      attempts.push({ model: spec, error: e.message })
      lastError = e
      continue
    }

    try {
      return await callOne(model, req, attempts)
    } catch (err) {
      const e = err instanceof InferenceError
        ? err
        : new InferenceError((err as Error)?.message ?? 'generation failed', 502, 'provider_error', 'api_error')
      // Terminal for the caller (bad schema, no credit) — the next model
      // would fail identically, so stop rather than burn the whole chain.
      if (e.status === 400 || e.status === 402 || e.status === 422) throw e
      attempts.push({ model: `${model.provider}/${model.model_name}`, error: e.message })
      lastError = e
    }
  }

  throw lastError ?? new InferenceError('No model in the chain could be reached.', 502, 'provider_error', 'api_error')
}

async function callOne(
  model:    ModelInfo,
  req:      InferenceRequest,
  attempts: Array<{ model: string; error: string }>,
): Promise<InferenceResult> {
  const mode = structuredModeFor(model.provider, !!req.jsonSchema)

  // Every provider carries the system prompt in its own slot, so system
  // turns are lifted OUT of the array. Several system messages concatenate
  // — clients (and agent frameworks) send more than one often enough that
  // dropping the extras would be a silent content loss.
  const systemParts = req.messages.filter(m => m.role === 'system').map(m => m.content.trim()).filter(Boolean)
  const turns = req.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  if (!turns.length) {
    throw new InferenceError(
      '`messages` must contain at least one user or assistant message, not just a system prompt.',
      400, 'messages_required',
    )
  }

  // Tiers below native_schema never see the schema, so it goes in the
  // system prompt where the model can at least read it.
  if (req.jsonSchema && mode !== 'native_schema') {
    systemParts.push(
      'Reply with a single JSON object and nothing else — no prose, no code fence. '
      + 'It must match this JSON Schema exactly:\n'
      + JSON.stringify(req.jsonSchema.schema),
    )
  }
  const system = systemParts.length ? systemParts.join('\n\n') : null

  // A schema'd call BUFFERS even when the caller asked to stream: you cannot
  // un-send a stream, so streaming and re-asking on an invalid object are
  // mutually exclusive. Trustworthy output is the reason the caller set a
  // schema in the first place, so it wins.
  const streaming = !req.jsonSchema && typeof req.onDelta === 'function'
  req.onModel?.(model)

  let lastInvalid: SchemaError[] = []
  for (let attempt = 0; attempt <= (req.jsonSchema ? SCHEMA_RETRIES : 0); attempt++) {
    let text = ''
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }
    let failure: string | null = null

    const nudge = attempt === 0 ? null
      : `Your previous reply did not match the schema: ${lastInvalid.map(e => `${e.path} ${e.message}`).join('; ')}. Reply with corrected JSON only.`

    await providers.streamText(
      model,
      nudge ? [...turns, { role: 'user' as const, content: nudge }] : turns,
      {
        onDelta: (t) => { text += t; if (streaming) req.onDelta!(t) },
        onDone:  (r) => {
          usage = {
            inputTokens:  r.inputTokens  ?? 0,
            outputTokens: r.outputTokens ?? 0,
            cachedTokens: r.cachedTokens ?? 0,
            cost:         r.cost ?? 0,
          }
        },
        onError: (m) => { failure = m },
      },
      [],
      { userId: req.userId, surface: req.surface } as any,
      {
        thinking:   req.effort ?? null,
        search:     req.search === true,
        maxTokens:  req.maxTokens,
        system,
        jsonMode:   req.jsonMode === true,
        // The schema is adapted to THIS provider's dialect; validation on
        // the way back still uses the caller's original. That split is what
        // keeps one schema meaning one thing across a fallback chain.
        jsonSchema: req.jsonSchema
          ? {
              name:   req.jsonSchema.name,
              schema: adaptSchema(req.jsonSchema.schema, model.provider),
              strict: req.jsonSchema.strict !== false && strictIsSafe(req.jsonSchema.schema),
            }
          : null,
      },
    )

    // Report and bill what the provider actually charged, even for a reply we
    // go on to reject: a rejected attempt still burned tokens upstream.
    // Skipping it would make a retry loop free to run and expensive to us.
    req.onUsage?.({
      inputTokens:  usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      costUsd:      usage.cost,
    })
    if (usage.cost > 0 && req.bill !== false) void bill(req.userId, model, usage.cost, req.surface)

    // Sanitized on the way out (Aug 28). An API caller needs to know WHICH
    // kind of failure this is — an ACCOUNT limit on our side means "pick
    // another model", not "retry" — but not the provider's raw JSON, which
    // carries our billing. Full text stays in the log and provider_calls.
    if (failure) {
      console.warn(`[inference] ${model.provider}/${model.model_name} failed: ${String(failure).slice(0, 300)}`)
      throw new InferenceError(sanitizeProviderError(String(failure)), 502, 'provider_error', 'api_error')
    }
    if (!text.trim()) {
      throw new InferenceError(`${model.provider}/${model.model_name} returned an empty reply.`, 502, 'empty_response', 'api_error')
    }

    if (!req.jsonSchema) {
      return { model, text, parsed: req.jsonMode ? extractJson(text) : null, structuredMode: mode, ...usage, costUsd: usage.cost, attempts } as InferenceResult
    }

    const parsed = extractJson(text)
    if (parsed === null) {
      lastInvalid = [{ path: '(root)', message: 'was not valid JSON' }]
    } else {
      const errs = validate(parsed, req.jsonSchema.schema)
      if (errs.length === 0) {
        return { model, text, parsed, structuredMode: mode, ...usage, costUsd: usage.cost, attempts } as InferenceResult
      }
      lastInvalid = errs
    }
    console.warn(`${LOG} ${model.provider}/${model.model_name} schema miss (attempt ${attempt + 1}): ${lastInvalid.map(e => e.path).join(', ')}`)
  }

  // 422, deliberately: the caller can retry or loosen the schema, and it is
  // distinguishable from a 400 (their request was fine) and a 502 (the
  // provider was fine). A game backs off on a number, not on a guess.
  throw new InferenceError(
    `The model did not produce output matching the schema after ${SCHEMA_RETRIES + 1} attempts: `
    + lastInvalid.map(e => `${e.path} ${e.message}`).join('; '),
    422, 'schema_unsatisfied',
  )
}

/** Fire-and-forget, like /api/xcreate/chat's debitChatTurn. The provider
 *  call already happened; failing the user's response because the ledger
 *  write was slow would trade a cent for a turn. */
function bill(userId: string, model: ModelInfo, costUsd: number, surface: string): void {
  const cents = Math.round(costUsd * 100)
  if (cents <= 0) return
  debitCredits({
    userId,
    amountCents:   cents,
    referenceType: 'api',
    description:   `API ${model.provider}/${model.model_name}`,
    metadata:      { provider: model.provider, model: model.model_name, surface, costUsd },
  }).catch(err => console.warn(`${LOG} debit failed for ${userId}:`, err?.message ?? err))
}
