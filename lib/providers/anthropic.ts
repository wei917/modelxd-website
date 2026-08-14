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

import type { ModelInfo, Attachment, TextStreamCallbacks } from './types'
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

export async function streamText(
  model:       ModelInfo,
  messages:    { role: 'user' | 'assistant'; content: any }[],
  callbacks:   TextStreamCallbacks,
  attachments: Attachment[] = [],
  thinking:    string | null = null,
  search:      boolean = false,
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
  const chatMessages = messages.map((m, i) => {
    const last = i === messages.length - 1 && m.role === 'user'
    const text = String(m.content)
    if (i === 0 && !last && text.length >= CACHE_MIN_CH) {
      return {
        role: m.role,
        content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
      }
    }
    return {
      role: m.role,
      content: last ? buildContent(text, attachments) : text,
    }
  })

  let res: Response
  try {
    res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: model.model_name,
        max_tokens: 4096,
        stream: true,
        messages: chatMessages,
        // Adaptive thinking + effort (probed live July 23: low/medium/
        // high/xhigh/max on Fable 5 / Sonnet 5 / Opus 4.8).
        ...(thinking ? { thinking: { type: 'adaptive' }, output_config: { effort: thinking } } : {}),
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
            inputTokens  = event.message?.usage?.input_tokens ?? 0
            cachedTokens = event.message?.usage?.cache_read_input_tokens ?? 0
            // Cache WRITES bill at 1.25x the input rate and arrive in their
            // own counter — fold them into inputTokens at the premium so
            // calcTextCost stays provider-agnostic. Without this the write
            // turn billed 18 tokens for a 4K-token head (seen live, Aug 13).
            {
              const w = event.message?.usage?.cache_creation_input_tokens ?? 0
              if (w > 0) inputTokens += Math.ceil(w * 1.25)
            }
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
            outputTokens = event.usage?.output_tokens ?? outputTokens
            if (event.usage?.input_tokens) inputTokens = event.usage.input_tokens
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
    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking, searchCount })
    console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
  } catch (err: any) {
    console.error(`${TAG} ERROR`, err?.message ?? err)
    callbacks.onError(`Anthropic: ${err?.message ?? err}`)
  }
}
