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

// xd/fast is NOT here. It was implemented, then measured: over the last
// seven days provider_calls holds 128 rows, and exactly one model on the
// text board clears three samples. A route that sorts on a signal that
// doesn't exist yet is silently identical to xd/auto — which is precisely
// the "gate outlived its API" failure CLAUDE.md warns about, wearing a
// different hat. byMeasuredLatency() below is kept and correct; the route
// turns on when there is traffic to rank.
export const ROUTES = ['xd/auto', 'xd/cheap'] as const
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
async function routeModel(route: RouteId): Promise<ModelInfo> {
  const sb = service()
  const { data: all } = await sb
    .from('model_ratings')
    .select('model_id, xd_score, value_rating, total_votes')
    .eq('mode', 'text')
    .order('xd_score', { ascending: false })
    .limit(40)

  if (!all?.length) {
    throw new InferenceError(
      'No rated text models are available to route to right now. Name a model explicitly.',
      503, 'router_unavailable', 'api_error',
    )
  }

  // A vote floor. The board today has a model leading on SIX votes and
  // another rated on one — fine on XBoard, where a reader sees the vote
  // count beside the score, and not fine as the silent default for every
  // API call a game makes. If too few models clear the floor the unfiltered
  // list is used rather than refusing: a thin board should degrade to
  // "best we know" and say so in the logs, not 503 a running game.
  const rated = all.filter(r => Number(r.total_votes ?? 0) >= MIN_ROUTE_VOTES)
  const rows  = rated.length >= 3 ? rated : all
  if (rows !== rated) {
    console.warn(`${LOG} only ${rated.length} text models have >= ${MIN_ROUTE_VOTES} votes; routing on the full board`)
  }

  let ordered = rows
  if (route === 'xd/cheap') {
    // "Cheap" has to mean cheap. Sorting by value_rating alone put Fable 5
    // — the single most expensive model on the site — at the top of a route
    // called cheap, because value is a rating and not a price. So: keep the
    // models that are good enough (at or above the median XD Score of the
    // rated set), then order those by what they actually charge.
    const scores = [...rows].map(r => Number(r.xd_score ?? 0)).sort((a, b) => a - b)
    const median = scores[Math.floor(scores.length / 2)] ?? 0
    const goodEnough = rows.filter(r => Number(r.xd_score ?? 0) >= median)
    ordered = await byListPrice(goodEnough.length ? goodEnough : rows)
  }

  for (const row of ordered) {
    const model = await getModelById(row.model_id)
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

/** Sort candidates by their median latency over the last week. Models with
 *  no measurements sink to the bottom rather than winning on a null.
 *
 *  Currently UNUSED: this is what xd/fast will sort on once provider_calls
 *  holds enough text traffic to rank (see the ROUTES note). Kept rather than
 *  deleted because the query is the hard part and it is already right. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function byMeasuredLatency(rows: any[]): Promise<any[]> {
  const sb = service()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await sb
    .from('provider_calls')
    .select('model_name, latency_ms')
    .eq('event', 'end')
    .eq('status', 'success')
    .gte('created_at', since)
    .limit(4000)

  const byName = new Map<string, number[]>()
  for (const r of data ?? []) {
    if (typeof r.latency_ms !== 'number') continue
    const list = byName.get(r.model_name) ?? []
    list.push(r.latency_ms)
    byName.set(r.model_name, list)
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : Number.POSITIVE_INFINITY
  }

  const scored = await Promise.all(rows.map(async row => {
    const model = await getModelById(row.model_id)
    const samples = model ? byName.get(model.model_name) ?? [] : []
    return { row, p50: samples.length >= 3 ? median(samples) : Number.POSITIVE_INFINITY }
  }))
  return scored.sort((a, b) => a.p50 - b.p50).map(s => s.row)
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
