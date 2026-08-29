// lib/house-llm.ts
//
// House-paid text calls: the site agent, the XDirect director, the XGame
// host and the story digest. These are NOT a user's model choice. Nobody
// picked Claude here and nobody is billed for it — the owner pays, and the
// only thing the reader wants is an answer.
//
// So when Anthropic is unavailable — the org's monthly spending limit, a
// 429, an outage — the right move is to serve the same turn from OpenAI
// rather than show an error. (Owner, Aug 28: the org limit was hit and the
// director, the site agent and the host hints went down together, because
// every "fallback" in those routes only walked across other *Claude* ids on
// the same account, which fail as one.)
//
// The user-paid path (lib/providers/*) deliberately does NOT do this: there
// the user picked a model and pays its list price, so quietly serving a
// different one would falsify both the bill and the leaderboard. It fails
// loudly instead — see lib/provider-errors.ts.
//
// The wire shape is Anthropic's everywhere. OpenAI's request and response
// are translated in and out, so callers — and the conversations they
// persist — only ever see content blocks and tool_use. A turn served by GPT
// is indistinguishable in storage from one served by Claude, which is what
// lets a conversation cross providers mid-thread and back.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL    = 'https://api.openai.com/v1/chat/completions'
import { workspaceHeader } from './providers/anthropic'
import { ACCOUNT_LIMIT } from './provider-errors'

const API_VERSION   = '2023-06-01'

/** OpenAI stand-ins, tried in order. Same discipline as the Claude
 *  candidate lists: a model id that has been retired falls through to the
 *  next rather than taking the route down. HOUSE_FALLBACK_MODEL is the
 *  exception; the list is the decision. */
export const HOUSE_OPENAI_MODELS = [
  process.env.HOUSE_FALLBACK_MODEL,
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
].filter(Boolean) as string[]

export interface HouseCallOpts {
  /** Anthropic system blocks (cache_control markers are kept for Anthropic
   *  and stripped for OpenAI) or a plain string. */
  system:    string | any[]
  /** Anthropic-shaped messages: content is a string or content blocks. */
  messages:  any[]
  /** Anthropic-shaped tool definitions ({ name, description, input_schema }). */
  tools?:    any[]
  maxTokens?: number
  /** Anthropic model ids, tried in order before the fallback provider. */
  models:    string[]
  /** Log prefix, e.g. '[xdirector]'. Also keys the working-model cache. */
  tag:       string
  /** Pin thinking off on Anthropic models that think adaptively. */
  disableThinking?: boolean
  /** OpenAI stand-ins to prefer, ahead of the house list. A cheap call
   *  (the XGame host's one-line hint) has no business failing over onto a
   *  flagship just because that is what the default order names first. */
  fallbackModels?: string[]
}

export interface HouseResponse {
  /** Which provider actually served this turn. */
  house_provider: 'anthropic' | 'openai'
  model:          string
  content:        any[]
  stop_reason:    string
  usage:          any
}

// Working ids are cached per call site for the process lifetime, so a
// deprecated model costs one 404 per instance rather than one per request.
const working: Record<string, { provider: 'anthropic' | 'openai'; model: string }> = {}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** True when the failure is about the ACCOUNT, not this request — a spending
 *  cap, an exhausted balance, a dead key, an org on hold. Retrying does not
 *  help and neither does another model on the same account: only the other
 *  provider does.
 *
 *  The wording list is ACCOUNT_LIMIT, shared with the user-facing
 *  sanitizer. When a provider invents a new phrasing, BOTH the fallback and
 *  the message a user reads have to learn it, and keeping two copies is how
 *  the Aug 29 "organization has been disabled" slipped past both. */
function isAccountFailure(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true
  return ACCOUNT_LIMIT.test(body) || /invalid.{0,12}api.?key/i.test(body)
}

// Once the account is out of room it stays out for a while, so the whole
// Anthropic leg — three models, three attempts, backoff — is ~8s of certain
// failure in front of every single request. Remember the verdict briefly and
// skip straight to the fallback; 90s is short enough that the limit resetting
// costs at most one slow turn to notice.
const ACCOUNT_COOLDOWN_MS = 90_000
let anthropicOutUntil = 0

// ── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(o: HouseCallOpts, models: string[]): Promise<HouseResponse | { error: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { error: 'ANTHROPIC_API_KEY is not set' }
  // An empty text block is a hard 400 on the Messages API ("text content
  // blocks must be non-empty"), so a caller with no system prompt (the
  // XGame host) sends no system field at all rather than an empty one.
  const sysBlocks = (typeof o.system === 'string' ? [{ type: 'text', text: o.system }] : (o.system ?? []))
    .filter((b: any) => typeof b?.text === 'string' && b.text.trim().length > 0)
  let lastErr = 'no candidates'

  outer: for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response
      try {
        res = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'content-type':      'application/json',
            'x-api-key':         key,
            'anthropic-version': API_VERSION,
            ...workspaceHeader(),
          },
          body: JSON.stringify({
            model,
            max_tokens: o.maxTokens ?? 4096,
            ...(sysBlocks.length ? { system: sysBlocks } : {}),
            messages: o.messages,
            ...(o.tools && o.tools.length ? { tools: o.tools } : {}),
            // 4.6+ models run ADAPTIVE thinking when the field is omitted,
            // and thinking spends from the same max_tokens budget. Older
            // fallbacks predate the field's "disabled" value and get nothing.
            ...(o.disableThinking && /sonnet-5|opus-5|sonnet-4-6|opus-4-6|opus-4-7|opus-4-8/.test(model)
              ? { thinking: { type: 'disabled' } } : {}),
          }),
        })
      } catch (err: any) {
        // A single corrupted TLS record on a reused keep-alive socket ("SSL
        // alert bad record mac", seen live Aug 6) was reaching users as
        // "⚠ fetch failed". A thrown fetch gets a fresh socket on retry.
        lastErr = `network: ${err?.cause?.code ?? err?.message ?? err}`
        if (attempt < 2) { await sleep(500 + attempt * 900); continue }
        continue outer
      }
      if (res.ok) {
        const j = await res.json()
        const u = j?.usage ?? {}
        console.log(`${o.tag} anthropic model=${j?.model} in=${u.input_tokens} cache_write=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} out=${u.output_tokens}`)
        working[o.tag] = { provider: 'anthropic', model }
        return { house_provider: 'anthropic', model: j?.model ?? model, content: j?.content ?? [], stop_reason: j?.stop_reason, usage: u }
      }
      const body = await res.text()
      lastErr = `${res.status} ${body.slice(0, 300)}`
      // The account itself is out: no retry, no other Claude, no waiting.
      if (isAccountFailure(res.status, body)) {
        anthropicOutUntil = Date.now() + ACCOUNT_COOLDOWN_MS
        return { error: lastErr }
      }
      // Model-shaped errors walk the candidate list; other 4xx stop (a 401
      // will not fix itself, and the caller falls through to OpenAI).
      if (res.status === 404 || (res.status === 400 && body.includes('model'))) continue outer
      if (res.status >= 500 || res.status === 429) {
        if (attempt < 2) { await sleep(700 + attempt * 1200); continue }
        continue outer
      }
      break outer
    }
  }
  return { error: lastErr }
}

// ── OpenAI (translated in and out of Anthropic's shape) ────────────────────

/** OpenAI tool-call ids come back as `call_x`; Anthropic's own are
 *  `toolu_x`. The id only has to be internally consistent — it is minted
 *  here and echoed back on the next hop — but keeping it Anthropic-shaped
 *  means a conversation that started on GPT replays cleanly on Claude. */
const toAnthropicId = (id: string) => (id?.startsWith('call_') ? `toolu_${id.slice(5)}` : id)

function toOpenAITools(tools: any[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

function toolResultText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b: any) => b?.text ?? '').join('\n')
  return String(content ?? '')
}

/** Anthropic messages → OpenAI chat messages.
 *
 *  The one structural difference that matters: Anthropic packs every
 *  tool_result of a turn into ONE user message, while OpenAI wants one
 *  `tool` message per call, immediately after the assistant message that
 *  made them. So results are emitted first and any prose in the same
 *  message follows as its own user turn. */
function toOpenAIMessages(system: string | any[], messages: any[]): any[] {
  const out: any[] = []
  const sysText = (Array.isArray(system) ? system.map((s: any) => s?.text ?? '').join('\n\n') : String(system ?? '')).trim()
  if (sysText) out.push({ role: 'system', content: sysText })

  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue }
    const blocks: any[] = Array.isArray(m.content) ? m.content : []

    if (m.role === 'assistant') {
      const text  = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({
        id: b.id, type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }))
      if (!text && calls.length === 0) continue
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }

    const parts: any[] = []
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: toolResultText(b.content) })
      } else if (b.type === 'text') {
        parts.push({ type: 'text', text: b.text ?? '' })
      } else if (b.type === 'image') {
        const url = b.source?.type === 'url'
          ? b.source.url
          : b.source?.type === 'base64'
            ? `data:${b.source.media_type};base64,${b.source.data}`
            : null
        if (url) parts.push({ type: 'image_url', image_url: { url } })
      }
    }
    if (parts.length) out.push({ role: 'user', content: parts })
  }

  // OpenAI 400s if any tool_call goes unanswered. That should not happen —
  // every hand-off path answers or explains every call — but a 400 here
  // would take down the fallback of last resort, so unmatched calls get a
  // stub rather than the whole turn failing.
  for (let i = 0; i < out.length; i++) {
    const calls = out[i]?.tool_calls
    if (!calls?.length) continue
    const answered = new Set<string>()
    for (let j = i + 1; j < out.length && out[j].role === 'tool'; j++) answered.add(out[j].tool_call_id)
    const missing = calls.filter((c: any) => !answered.has(c.id))
    if (missing.length === 0) continue
    let at = i + 1
    while (at < out.length && out[at].role === 'tool') at++
    out.splice(at, 0, ...missing.map((c: any) => ({
      role: 'tool', tool_call_id: c.id, content: 'Not run: this call was never executed.',
    })))
  }
  return out
}

function fromOpenAI(j: any, tag: string): HouseResponse {
  const choice = j?.choices?.[0]
  const msg    = choice?.message ?? {}
  const content: any[] = []
  const text = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? '').join('') : ''
  if (text.trim()) content.push({ type: 'text', text })
  for (const tc of msg.tool_calls ?? []) {
    let input: any = {}
    try { input = JSON.parse(tc.function?.arguments || '{}') } catch { input = {} }
    content.push({ type: 'tool_use', id: toAnthropicId(tc.id), name: tc.function?.name, input })
  }
  const fr = choice?.finish_reason
  const u  = j?.usage ?? {}
  console.log(`${tag} openai model=${j?.model} in=${u.prompt_tokens} out=${u.completion_tokens} finish=${fr}`)
  return {
    house_provider: 'openai',
    model:       j?.model ?? 'openai',
    content,
    stop_reason: fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens:  u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    },
  }
}

async function callOpenAI(o: HouseCallOpts, models: string[]): Promise<HouseResponse | { error: string }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return { error: 'OPENAI_API_KEY is not set' }
  const messages = toOpenAIMessages(o.system, o.messages)
  let lastErr = 'no candidates'
  // Probed live Aug 28: "Function tools with reasoning_effort are not
  // supported for gpt-5.6-sol in /v1/chat/completions ... set
  // reasoning_effort to 'none'." So a call WITH tools must say 'none'
  // explicitly, and a call without tools must not say it at all (the enum
  // is not guaranteed on every id). A 400 naming the field flips this and
  // retries the same model rather than burning a candidate.
  let sendEffortNone = !!(o.tools && o.tools.length)

  outer: for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response
      try {
        res = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages,
            ...(sendEffortNone ? { reasoning_effort: 'none' } : {}),
            // The gpt-5 family bills reasoning out of the completion budget
            // and rejects `max_tokens`. Headroom on top of the caller's cap
            // so a reasoning pass cannot truncate the reply it was asked
            // for — the 4k floor matters most for the SMALL callers (the
            // site agent asks for 400 tokens, which a reasoning pass would
            // eat whole). `reasoning_effort` is deliberately NOT sent: an
            // enum this account is not entitled to would 400 the last resort.
            max_completion_tokens: Math.min(32000, Math.max(4000, (o.maxTokens ?? 4096) * 2)),
            ...(o.tools && o.tools.length ? { tools: toOpenAITools(o.tools) } : {}),
          }),
        })
      } catch (err: any) {
        lastErr = `network: ${err?.cause?.code ?? err?.message ?? err}`
        if (attempt < 2) { await sleep(600); continue }
        continue outer
      }
      if (res.ok) {
        working[o.tag] = { provider: 'openai', model }
        return fromOpenAI(await res.json(), o.tag)
      }
      const body = await res.text()
      lastErr = `${res.status} ${body.slice(0, 300)}`
      if (res.status === 400 && body.includes('reasoning_effort') && attempt < 2) {
        sendEffortNone = !sendEffortNone
        console.warn(`${o.tag} openai ${model}: retrying with reasoning_effort ${sendEffortNone ? "'none'" : 'omitted'}`)
        continue
      }
      if (res.status === 404 || (res.status === 400 && body.includes('model'))) continue outer
      if (res.status >= 500 || res.status === 429) {
        if (attempt < 2) { await sleep(800); continue }
        continue outer
      }
      break outer
    }
  }
  return { error: lastErr }
}

// ── The call ───────────────────────────────────────────────────────────────

/**
 * One house-paid turn. Anthropic first, OpenAI when Anthropic cannot serve
 * it. Throws only when BOTH providers are down — and the message names both
 * failures, because "the agent is broken" with one provider's error in the
 * log is how the Aug 28 outage stayed puzzling for an afternoon.
 */
export async function houseCall(o: HouseCallOpts): Promise<HouseResponse> {
  // A known-good id goes first, but the rest of the list stays behind it —
  // the candidate loop only advances on model-shaped errors, so carrying the
  // tail costs nothing and a retired id doesn't strand the call site.
  const cached = working[o.tag]
  const order = (list: string[], first?: string) =>
    (first ? [first, ...list.filter(m => m !== first)] : list)
  const prefer = [...(o.fallbackModels ?? []), ...HOUSE_OPENAI_MODELS].filter((m, i, a) => a.indexOf(m) === i)
  const anth = order(o.models, cached?.provider === 'anthropic' ? cached.model : undefined)
  const oai  = order(prefer,   cached?.provider === 'openai'    ? cached.model : undefined)

  // A cached OpenAI pick still re-tries Anthropic first once the cooldown
  // lapses: the fallback is a stand-in for an outage, not a migration, and
  // the instance would otherwise stay on GPT until it recycled.
  const cooling = Date.now() < anthropicOutUntil
  const first = cooling
    ? { error: 'anthropic account out of room (cooling down)' }
    : await callAnthropic(o, anth)
  if ('house_provider' in first) return first

  const why = first.error
  if (!cooling) console.warn(`${o.tag} anthropic unavailable (${why.slice(0, 160)}) — falling back to OpenAI`)
  // Anything that got here has already exhausted the Claude candidates and
  // its retries, so we try the other provider whatever the reason: a bug in
  // our own request would fail there too, and the log names both.
  const second = await callOpenAI(o, oai)
  if ('house_provider' in second) return second

  delete working[o.tag]
  throw new Error(`House LLM unavailable — anthropic: ${why} | openai: ${second.error}`)
}
