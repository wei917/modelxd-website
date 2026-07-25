// lib/providers/moonshot.ts
//
// Moonshot AI (Kimi) — OpenAI-compatible chat-completions streaming at
// https://api.moonshot.ai/v1. First model: kimi-k3 ($3/$15 per MTok,
// $0.30 cached, flat 1M context, launched July 16 2026).
//
// Kimi specifics (probed live July 23):
//   - Reasoning effort rides in `thinking: { effort }` (low/high/max).
//   - Deltas may carry `reasoning_content` (chain-of-thought) separately
//     from `content` — we stream ONLY `content` to the user.
//
// Requires MOONSHOT_API_KEY.

import type { ModelInfo, Attachment, TextStreamCallbacks } from './types'
import { calcTextCost } from './pricing'

const BASE = 'https://api.moonshot.ai/v1'

function apiKey(): string {
  const k = process.env.MOONSHOT_API_KEY
  if (!k) throw new Error('MOONSHOT_API_KEY is not set')
  return k
}

function buildContent(text: string, attachments: Attachment[]): any {
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  if (imageAtts.length === 0) return text
  return [
    ...imageAtts.map(a => ({
      type: 'image_url',
      image_url: { url: `data:${a.mediaType};base64,${a.buffer.toString('base64')}` },
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
  const TAG = `[moonshot/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length} thinking=${thinking ?? 'auto'}`)

  const chatMessages = messages.map((m, i) => ({
    role: m.role,
    content: i === messages.length - 1 && m.role === 'user'
      ? buildContent(String(m.content), attachments)
      : String(m.content),
  }))

  let res: Response
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: model.model_name,
        stream: true,
        messages: chatMessages,
        stream_options: { include_usage: true },
        ...(thinking ? { thinking: { effort: thinking } } : {}),
      }),
    })
  } catch (err: any) {
    callbacks.onError(`Moonshot request failed: ${err?.message ?? err}`)
    return
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    callbacks.onError(`Moonshot ${res.status}: ${errText.slice(0, 500)}`)
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
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]' || data === '') continue
          let json: any
          try { json = JSON.parse(data) } catch { continue }

          if (json?.error) {
            const msg = typeof json.error === 'string'
              ? json.error
              : (json.error.message ?? JSON.stringify(json.error))
            callbacks.onError(`Moonshot: ${msg}`)
            return
          }

          // Only the answer text — reasoning_content stays server-side.
          const delta = json?.choices?.[0]?.delta?.content
          if (delta) callbacks.onDelta(String(delta))

          if (json?.usage) {
            inputTokens  = json.usage.prompt_tokens ?? inputTokens
            outputTokens = json.usage.completion_tokens ?? outputTokens
            cachedTokens = json.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens
          }
        }
      }
    }
  } catch (err: any) {
    callbacks.onError(`Stream read failed: ${err?.message ?? err}`)
    return
  }

  const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking })
  console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} cost=$${cost.toFixed(6)}`)
  callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
}
