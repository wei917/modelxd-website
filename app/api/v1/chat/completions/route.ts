// app/api/v1/chat/completions/route.ts — the public inference API.
//
// OpenAI-shaped on purpose. A game developer sets three env vars
// (MODELXD_API_BASE_URL / MODELXD_API_KEY / MODELXD_MODEL), points any
// existing SDK at the base URL, and is done. There is no ModelXD client
// library and there should never be one — needing one would be the failure.
//
// The shape is OpenAI's; the routing is ours. `model: "xd/auto"` picks from
// the leaderboard, which is built from blind human votes rather than the
// price/throughput sort every other gateway offers. That is the only part of
// this a competitor cannot clone by reading docs.
//
// Two games specified this surface: XTalk Werewolf (7 seats, growing
// transcript, tolerant JSON salvage) and the Gauntlet farm loop (10 agents,
// concurrent decisions, output that must be machine-validatable). Where they
// disagreed the API stayed stateless; where they agreed it became a feature.
//
// NO CORS HEADERS, deliberately. Gauntlet's own spec lists "the client
// contains the ModelXD API key" as an automatic fail. A key that cannot be
// used from a browser cannot be stolen from one, so the rule is enforced
// rather than documented.

export const runtime     = 'nodejs'
export const maxDuration = 300

import { resolveApiToken, reserveTokenSpend, adjustTokenSpend } from '@/lib/api-token'
import {
  runInference, InferenceError,
  type InferenceMessage, type InferenceResult,
} from '@/lib/inference'

const LOG = '[api/v1]'

/**
 * Held against the key's cap for the duration of one call, then trued up to
 * the real cost. Text pricing isn't knowable before the provider answers, so
 * a floor is the only thing that can be reserved — and reserving SOMETHING
 * is what stops ten concurrent agent calls from all reading an unspent cap.
 * Exposure is bounded by (in-flight × this), which for text is cents.
 */
const CAP_RESERVE_USD = 0.02

// ── OpenAI-shaped errors ─────────────────────────────────────────────────
// Clients parse this envelope. Inventing our own shape would break every
// SDK's error handling, which is most of what the compatibility buys.

function fail(status: number, message: string, code: string, type = 'invalid_request_error', extra?: HeadersInit) {
  return Response.json({ error: { message, type, code, param: null } }, { status, headers: extra })
}

const errorResponse = (err: InferenceError) =>
  fail(err.status, err.message, err.code, err.type,
       err.status === 429 ? { 'Retry-After': '2' } : undefined)

// ── Handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const tok = await resolveApiToken(req.headers.get('authorization'))
  if (!tok) {
    return fail(401,
      'Pass a ModelXD API key: Authorization: Bearer xd_… (mint one at modelxd.com/xdev).',
      'invalid_api_key', 'authentication_error')
  }

  let body: any
  try { body = await req.json() } catch { return fail(400, 'Request body must be valid JSON.', 'invalid_json') }

  // Tool calling is not implemented. Accepting `tools` and returning prose
  // would leave the caller debugging a model that "ignores" its functions —
  // a far worse hour than reading this sentence.
  if (body.tools || body.functions || body.tool_choice) {
    return fail(400,
      'Tool calling is not supported yet. For structured decisions use response_format with a json_schema — that is what it is for.',
      'tools_unsupported')
  }

  const messages = parseMessages(body.messages)
  if (!messages) return fail(400, '`messages` must be a non-empty array of {role, content}.', 'invalid_messages')

  // A fallback chain: the first model that answers wins. Ten NPCs a tick
  // means one provider's 429 would otherwise silence a character mid-scene.
  const models: string[] = Array.isArray(body.models) && body.models.length
    ? body.models.map(String)
    : body.model ? [String(body.model)] : []
  if (!models.length) return fail(400, '`model` is required.', 'model_required')

  let schema
  try { schema = parseResponseFormat(body.response_format) }
  catch (err) { return fail(400, (err as Error).message, 'invalid_response_format') }

  const xd = (body.xd && typeof body.xd === 'object') ? body.xd : {}
  const wantsStream = body.stream === true

  // Reserve against the key's cap BEFORE spending anything upstream.
  if (!(await reserveTokenSpend(tok, CAP_RESERVE_USD))) {
    return fail(402,
      `This API key has reached its spend cap ($${(tok.spendCapUsd ?? 0).toFixed(2)}). Raise it at modelxd.com/xdev.`,
      'spend_cap_reached', 'insufficient_quota')
  }
  let settled = false
  const settle = (actualUsd: number) => {
    if (settled) return
    settled = true
    adjustTokenSpend(tok.tokenId, actualUsd - CAP_RESERVE_USD)
  }

  const request = {
    userId:     tok.userId,
    models,
    messages,
    jsonSchema: schema.jsonSchema,
    jsonMode:   schema.jsonMode,
    effort:     typeof xd.effort === 'string' ? xd.effort : null,
    search:     xd.search === true,
    maxTokens:  Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : undefined,
    surface:    'api-v1',
  }

  const created = Math.floor(Date.now() / 1000)

  // ── Streaming ──────────────────────────────────────────────────────────
  // A schema'd request streams nothing until it validates (you cannot
  // un-send a stream, and re-asking is the whole point of a schema), so the
  // core buffers it and we emit one content chunk. Everything else streams
  // live. Either way the final chunk carries usage — so a caller reading the
  // stream never has to make a second request to learn what it cost.
  if (wantsStream) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const id = `chatcmpl-${crypto.randomUUID()}`
        const send = (obj: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        let costUsd = 0
        // Which model the chunks name. Starts as whatever was asked for and
        // becomes the resolved slug the moment the chain settles, which is
        // before the first delta.
        let named = request.models[0]
        let streamedAnything = false
        try {
          const result = await runInference({
            ...request,
            onModel: (m) => { named = `${m.provider}/${m.model_name}` },
            onDelta: (t) => { streamedAnything = true; send(chunkOf(id, created, named, { content: t })) },
          })
          costUsd = result.costUsd
          // The schema path buffers, so nothing has gone out yet — emit it
          // now. Keyed on what was actually sent, NOT on whether the reply
          // parsed: a json_object request without a schema both streams and
          // parses, and testing `parsed` would send the whole reply twice.
          if (!streamedAnything && result.text) {
            send(chunkOf(id, created, slug(result), { content: result.text }))
          }
          send({ ...chunkOf(id, created, slug(result), {}, 'stop'), usage: usageOf(result) })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err) {
          const e = err instanceof InferenceError
            ? err : new InferenceError((err as Error)?.message ?? 'generation failed', 502, 'provider_error', 'api_error')
          console.warn(`${LOG} stream failed: ${e.message}`)
          // Mid-stream there is no status code left to set, so the error goes
          // in-band. Clients that follow OpenAI's SSE contract surface it.
          send({ error: { message: e.message, type: e.type, code: e.code } })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } finally {
          settle(costUsd)
          controller.close()
        }
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type':      'text/event-stream; charset=utf-8',
        'Cache-Control':     'no-cache, no-transform',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // ── Non-streaming ──────────────────────────────────────────────────────
  try {
    const result = await runInference(request)
    settle(result.costUsd)
    return Response.json({
      id:      `chatcmpl-${crypto.randomUUID()}`,
      object:  'chat.completion',
      created,
      model:   slug(result),           // the RESOLVED model — never routed blind
      choices: [{
        index:         0,
        message:       { role: 'assistant', content: result.text },
        finish_reason: 'stop',
      }],
      usage: usageOf(result),
      xd: {
        structured_mode: result.structuredMode,
        // Models tried and passed over. Empty on the happy path; the reason
        // the first choice was skipped is the thing you want at 3am.
        fallbacks: result.attempts,
      },
    })
  } catch (err) {
    settle(0)
    if (err instanceof InferenceError) return errorResponse(err)
    console.error(`${LOG} unhandled:`, err)
    return fail(500, 'Internal error.', 'internal_error', 'api_error')
  }
}

// GET/OPTIONS are not part of the surface. No OPTIONS handler means no
// preflight succeeds, which is the CORS stance stated at the top.
export async function GET() {
  return fail(405, 'Use POST.', 'method_not_allowed')
}

// ── Shaping helpers ──────────────────────────────────────────────────────

const slug = (r: InferenceResult) => `${r.model.provider}/${r.model.model_name}`

function usageOf(r: InferenceResult) {
  return {
    prompt_tokens:     r.inputTokens,
    completion_tokens: r.outputTokens,
    total_tokens:      r.inputTokens + r.outputTokens,
    prompt_tokens_details: { cached_tokens: r.cachedTokens },
    // Not an OpenAI field. It is here because publishing the price and then
    // making you query for it separately would be a strange way to run a
    // site whose whole argument is that prices should be visible.
    cost_usd: Number(r.costUsd.toFixed(6)),
  }
}

function chunkOf(id: string, created: number, model: string, delta: any, finish: string | null = null) {
  return {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

function parseMessages(raw: any): InferenceMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: InferenceMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const role = m.role === 'system' || m.role === 'assistant' || m.role === 'developer' ? m.role : 'user'
    // OpenAI's newer `developer` role is the system role under another name.
    const normalized = role === 'developer' ? 'system' : role
    // Content can be a string or the multimodal parts array. We take the
    // text: this endpoint is text-only, and silently dropping an image the
    // caller sent would be worse than the parts never being read at all —
    // so images are refused upstream by the model's own modality check.
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n')
        : ''
    out.push({ role: normalized as InferenceMessage['role'], content })
  }
  return out
}

function parseResponseFormat(rf: any): { jsonSchema: any | null; jsonMode: boolean } {
  if (!rf || typeof rf !== 'object') return { jsonSchema: null, jsonMode: false }
  if (rf.type === 'text') return { jsonSchema: null, jsonMode: false }
  if (rf.type === 'json_object') return { jsonSchema: null, jsonMode: true }
  if (rf.type === 'json_schema') {
    const spec = rf.json_schema
    if (!spec || typeof spec !== 'object' || !spec.schema || typeof spec.schema !== 'object') {
      throw new Error('response_format.json_schema requires a `schema` object.')
    }
    return {
      jsonSchema: {
        name:   typeof spec.name === 'string' && spec.name ? spec.name : 'response',
        schema: spec.schema,
        strict: spec.strict !== false,
      },
      jsonMode: true,
    }
  }
  throw new Error(`Unknown response_format.type "${rf.type}". Use text, json_object, or json_schema.`)
}
