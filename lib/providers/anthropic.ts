// lib/providers/anthropic.ts
//
// Anthropic Claude — text streaming via the Messages API (SSE).
// Docs: platform.claude.com/docs — POST https://api.anthropic.com/v1/messages
// First model: claude-fable-5 ($10/MTok in, $50/MTok out, 1M context).
// Raw fetch + SSE (no SDK dependency), mirroring the alibaba provider shape.
//
// Requires ANTHROPIC_API_KEY. The DB row stays disabled until the key is
// present in the deploy env — a drawn-but-keyless model would fail every
// duel slot.

import type { ModelInfo, Attachment, TextStreamCallbacks, TextGenExtras } from './types'
import { calcTextCost } from './pricing'

const BASE = 'https://api.anthropic.com/v1'
const API_VERSION = '2023-06-01'

// Server-side web search. `web_search_20250305` is the baseline version and
// is what we pin: the later snapshots (20260209 adds dynamic filtering,
// 20260318 adds response-inclusion control) buy features we don't use, and a
// version string the account isn't entitled to is a hard 400 on every call.
const WEB_SEARCH_TOOL = 'web_search_20250305'
// Cap searches per response. At $10/1k a runaway research loop is a bill,
// and a duel answer that needed more than five queries wasn't going to win
// on cost anyway.
const MAX_SEARCHES = 5

function apiKey(): string {
  const k = process.env.ANTHROPIC_API_KEY
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set')
  return k
}

/**
 * An "identity-linked" API key belongs to a user rather than a workspace, so
 * Anthropic cannot tell which workspace the call bills to and answers 400:
 *   "anthropic-workspace-id is required when authenticating with an
 *    identity-linked API key"
 * It broke every Claude call on the site at once (Aug 29) — agent, director,
 * digest and the Claude models in XCreate/XDuel. Set ANTHROPIC_WORKSPACE_ID to
 * the wrkspc_… from console → Settings → Workspaces. A workspace-scoped key
 * needs no header, so leaving this unset stays correct for those.
 */
export function workspaceHeader(): Record<string, string> {
  const id = process.env.ANTHROPIC_WORKSPACE_ID
  return id ? { 'anthropic-workspace-id': id } : {}
}

// Images ride along as base64 content blocks; text/PDF attachments are
// handled upstream by resolveDocAttachments (Claude also accepts PDFs
// natively via the document block, but the folded-text path keeps duels
// consistent across providers for v1).
function buildContent(text: string, attachments: Attachment[]): any {
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  if (imageAtts.length === 0) return text
  return [
    ...imageAtts.map(a => ({
      type: 'image',
      source: { type: 'base64', media_type: a.mediaType, data: a.buffer.toString('base64') },
    })),
    { type: 'text', text },
  ]
}

/**
 * Output ceiling for a request.
 *
 * A flat 4096 silently truncated high-effort answers: thinking tokens are
 * billed as output and share this ceiling, so a `max`-effort run spent its
 * budget reasoning and stopped mid-sentence — measured 2026-08-29 on Fable
 * 5.1 (exactly 4096 tokens, no conclusion; the same question at `low`
 * finished correctly in 824). The user paid 5x for a worse answer.
 *
 * This is a RAIL, not a budget. Only generated tokens are billed, so a low
 * ceiling never saves money — it destroys output already paid for. Cost is
 * controlled by the effort the user picks and by the credit reserve.
 *
 * The rail's real constraint is the SERVERLESS WALL CLOCK, not spend.
 * Measured 2026-08-29: Fable 5.1 streams ~94 tok/s at max effort, and
 * /api/xcreate runs with maxDuration = 800s — so ~75k tokens is all that
 * can physically finish. A full 128k response would need ~1,366s and the
 * function is killed first, which is WORSE than truncation: the user gets
 * nothing at all and the credit reserve never settles cleanly. 64k sits
 * under that ceiling with room for the upload/settle tail, and is far
 * above any real answer (~48k words).
 *
 * Deliberately NOT scaled by effort: effort shifts the typical length, it
 * does not bound it. Our own eval data has Fable at `low` legitimately
 * emitting 25,277 output tokens on one task — an effort ladder would have
 * truncated that at the tier meant to be cheap and safe.
 *
 * Clamped to the model's real cap when the row declares one
 * (output_config.text.max_output_tokens); exceeding a model's limit is a
 * hard 400.
 */
const DEFAULT_MAX_TOKENS = 64_000
function outputCeiling(model: ModelInfo): number {
  const cap = (model.output_config as any)?.text?.max_output_tokens
  return typeof cap === 'number' && cap > 0
    ? Math.min(DEFAULT_MAX_TOKENS, cap)
    : DEFAULT_MAX_TOKENS
}

export async function streamText(
  model:       ModelInfo,
  messages:    { role: 'user' | 'assistant'; content: any }[],
  callbacks:   TextStreamCallbacks,
  attachments: Attachment[] = [],
  thinking:    string | null = null,
  search:      boolean = false,
  /** Output cap. 4096 suits chat; a caller producing a long structured
   *  reply (XDirect's story digest — one JSON bible from ~50k tokens of
   *  summaries, which hit the cap and truncated, Aug 22) passes its own. */
  maxTokens?:  number,
  extras:      TextGenExtras = {},
): Promise<void> {
  const TAG = `[anthropic/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length}`)

  // PROMPT CACHING (owner bill, Aug 13: $4.72 to chat with one character —
  // her prompt head is deliberately byte-stable "cache-shaped", but no
  // breakpoint was ever set, so every turn re-billed it at full input rate;
  // on Fable 5 that is $10/M for text the cache serves at $1/M). Mark the
  // FIRST message with cache_control when it is heavy: XCharacter's stable
  // head, XTalk's room prompt and any fat opening context all ride there.
  // 5-min TTL fits a conversation's cadence; a consolidation rewrites the
  // head and simply pays one fresh write (25% premium on that turn only).
  const CACHE_MIN_CH = 4000   // ~1K tokens — Anthropic's minimum cacheable
  // Incremental conversation caching (Aug 27, for the API/agent path): a
  // second breakpoint rides on the LAST message whenever the transcript is
  // heavy. Anthropic looks up the longest previously-cached prefix behind a
  // breakpoint, so turn N+1 — same transcript plus one new exchange — reads
  // turn N's write instead of re-billing the whole history at full rate.
  // That is the difference between a 10-agent game's token bill growing
  // linearly and growing quadratically. Below the minimum a marker caches
  // nothing and costs nothing, but it does burn one of the four breakpoint
  // slots, so it stays gated on size.
  const totalCh   = messages.reduce((n, m) => n + String(m.content ?? '').length, 0)
  const cacheTail = totalCh >= CACHE_MIN_CH && messages.length > 1
  const chatMessages = messages.map((m, i) => {
    const isLast = i === messages.length - 1
    const last = isLast && m.role === 'user'
    const text = String(m.content)
    if (i === 0 && !isLast && text.length >= CACHE_MIN_CH) {
      return {
        role: m.role,
        content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
      }
    }
    let content: any = last ? buildContent(text, attachments) : text
    if (isLast && cacheTail) {
      const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : [...content]
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
      content = blocks
    }
    return { role: m.role, content }
  })

  let res: Response
  try {
    res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': API_VERSION,
        ...workspaceHeader(),
      },
      body: JSON.stringify({
        model: model.model_name,
        max_tokens: maxTokens ?? outputCeiling(model),
        stream: true,
        messages: chatMessages,
        // Top-level `system`, never a message — the Messages API has no
        // system role in the array and rejects one. Always a marked block:
        // the system prompt is the stable head of every agent's requests
        // (persona, rules, schema), which is exactly what a cache is for.
        ...(extras.system ? { system: [{ type: 'text', text: extras.system, cache_control: { type: 'ephemeral' } }] } : {}),
        // Adaptive thinking + effort (probed live July 23: low/medium/
        // high/xhigh/max on Fable 5 / Sonnet 5 / Opus 4.8).
        ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
        // effort and format are BOTH children of output_config, so they are
        // built as one object — two conditional spreads would have the
        // second silently delete the first.
        ...((thinking || extras.jsonSchema) ? {
          output_config: {
            ...(thinking ? { effort: thinking } : {}),
            // No `name` field here and no beta header (verified against the
            // structured-outputs doc, Aug 2026) — unlike OpenAI's shape.
            ...(extras.jsonSchema ? { format: { type: 'json_schema', schema: extras.jsonSchema.schema } } : {}),
          },
        } : {}),
        // Server-side web search. Billed per search ($10/1k) on top of the
        // tokens the results add to the prompt, hence max_uses: a runaway
        // research loop is a real bill, not just a slow answer.
        ...(search ? { tools: [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: MAX_SEARCHES }] } : {}),
      }),
    })
  } catch (err: any) {
    callbacks.onError(`Anthropic request failed: ${err?.message ?? err}`)
    return
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    callbacks.onError(`Anthropic ${res.status}: ${errText.slice(0, 500)}`)
    return
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let searchCount = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let event: any
        try { event = JSON.parse(payload) } catch { continue }
        switch (event.type) {
          case 'message_start':
            inputTokens      = event.message?.usage?.input_tokens ?? 0
            cachedTokens     = event.message?.usage?.cache_read_input_tokens ?? 0
            cacheWriteTokens = event.message?.usage?.cache_creation_input_tokens ?? 0
            if (typeof event.message?.usage?.server_tool_use?.web_search_requests === 'number') {
              searchCount = Math.max(searchCount, event.message.usage.server_tool_use.web_search_requests)
            }
            break
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              callbacks.onDelta(event.delta.text)
            }
            break
          case 'message_delta':
            // A safety refusal arrives as HTTP 200 with stop_reason 'refusal'
            // and little or no content — NOT as an error. Unchecked, the user
            // got a blank generation, no explanation, and a credit reserve that
            // settled as a success. Throwing routes it through
            // sanitizeProviderError like any other provider failure and leaves
            // nothing to settle; Anthropic does not bill a refusal that
            // produced no output, so failing loudly is also the honest bill.
            // Deliberately thrown even mid-stream: a half-answer presented as
            // complete is worse than a clear refusal, and this path is rare.
            // Applies to every Anthropic model with classifiers (Fable 5.1,
            // Opus 5), not just the one that prompted the fix.
            if (event.delta?.stop_reason === 'refusal') {
              const cat = event.delta?.stop_details?.category
              throw new Error('USERMSG:This model declined the request for safety reasons'
                + (cat ? ` (${cat})` : '') + '. You were not charged. Try rephrasing it, or pick another model.')
            }
            outputTokens = event.usage?.output_tokens ?? outputTokens
            if (event.usage?.input_tokens) inputTokens = event.usage.input_tokens
            if (event.usage?.cache_read_input_tokens)     cachedTokens     = event.usage.cache_read_input_tokens
            if (event.usage?.cache_creation_input_tokens) cacheWriteTokens = event.usage.cache_creation_input_tokens
            // Anthropic reports the tally itself; take the largest seen
            // rather than the last, since only some events carry usage.
            if (typeof event.usage?.server_tool_use?.web_search_requests === 'number') {
              searchCount = Math.max(searchCount, event.usage.server_tool_use.web_search_requests)
            }
            break
          case 'error':
            throw new Error(event.error?.message ?? 'Anthropic stream error')
        }
      }
    }
    // Cache WRITES bill at 1.25x the input rate and arrive in their own
    // counter — fold them into inputTokens at the premium so calcTextCost
    // stays provider-agnostic. The fold happens HERE, after the stream: it
    // used to live in message_start, where message_delta's final usage tally
    // (which excludes cache traffic) silently overwrote it — a 2800-token
    // write billed as 20 tokens (seen live, Aug 27; same bug class as the
    // 18-token head of Aug 13).
    if (cacheWriteTokens > 0) inputTokens += Math.ceil(cacheWriteTokens * 1.25)
    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking, searchCount })
    console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
  } catch (err: any) {
    console.error(`${TAG} ERROR`, err?.message ?? err)
    callbacks.onError(`Anthropic: ${err?.message ?? err}`)
  }
}
