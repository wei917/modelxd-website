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
): Promise<void> {
  const TAG = `[anthropic/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length}`)

  const chatMessages = messages.map((m, i) => ({
    role: m.role,
    content: i === messages.length - 1 && m.role === 'user'
      ? buildContent(String(m.content), attachments)
      : String(m.content),
  }))

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
            break
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              callbacks.onDelta(event.delta.text)
            }
            break
          case 'message_delta':
            outputTokens = event.usage?.output_tokens ?? outputTokens
            if (event.usage?.input_tokens) inputTokens = event.usage.input_tokens
            break
          case 'error':
            throw new Error(event.error?.message ?? 'Anthropic stream error')
        }
      }
    }
    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking })
    console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
  } catch (err: any) {
    console.error(`${TAG} ERROR`, err?.message ?? err)
    callbacks.onError(`Anthropic: ${err?.message ?? err}`)
  }
}
