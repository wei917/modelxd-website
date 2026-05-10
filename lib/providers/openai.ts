// lib/providers/openai.ts
//
// Direct OpenAI provider using the official SDK.
//   - Text:  Responses API with streaming (supports all models including GPT-5-pro)
//   - Image: Responses API with image_generation tool + previous_response_id for
//            multi-turn editing
//   - Video: Not supported directly

import OpenAI from 'openai'
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  Attachment,
} from './types'
import { calcTextCost, calcImageCost } from './pricing'

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('OPENAI_API_KEY is not set')
    _client = new OpenAI({ apiKey: key })
  }
  return _client
}

// ── text (streaming via Responses API) ────────────────────────────────────────

// Pro reasoning models (gpt-5-pro, gpt-5.5-pro, etc.) think for many minutes
// before producing visible output. SSE streaming hangs idle in the meantime
// and frequently dies on intermediate proxies. For these, we follow the same
// create → poll pattern Alibaba uses for video generation: kick off the call
// in background mode, poll until completed, then emit the final text.
function isProModel(modelName: string): boolean {
  return /-pro\b/.test(modelName)
}

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachments: Attachment[] = [],
): Promise<void> {
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length}`)

  // Build input array for Responses API
  const input: any[] = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user' && attachments.length > 0) {
      return buildMultimodalInput(String(m.content), attachments)
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }
  })

  // Pro models: background + poll path
  if (isProModel(model.model_name)) {
    return streamTextBackground(model, input, callbacks, TAG)
  }

  try {
    const requestBody = {
      model: model.model_name,
      input,
      stream: true,
    }
    console.log(`${TAG} request body:`, JSON.stringify({ ...requestBody, input: `[${input.length} message(s)]` }))

    const stream = await client().responses.create(requestBody)

    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0
    let reasoningTokens = 0
    let responseModel: string | null = null
    let responseId: string | null = null

    for await (const event of stream as any) {
      // Log non-delta events in full so we can see exactly what OpenAI returned
      if (event.type === 'response.output_text.delta') {
        callbacks.onDelta(event.delta)
      } else if (event.type === 'response.created') {
        responseModel = (event as any).response?.model ?? null
        responseId    = (event as any).response?.id ?? null
        console.log(`${TAG} response.created id=${responseId} model=${responseModel}`)
      } else if (event.type === 'response.completed') {
        const resp = (event as any).response
        responseModel = resp?.model ?? responseModel
        const usage = resp?.usage
        if (usage) {
          inputTokens     = usage.input_tokens ?? 0
          outputTokens    = usage.output_tokens ?? 0
          cachedTokens    = usage.input_tokens_details?.cached_tokens ?? 0
          reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0
        }
        console.log(`${TAG} response.completed model=${responseModel} usage=`, JSON.stringify(usage))
      } else {
        console.log(`${TAG} event type=${event.type}`)
      }
    }

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    console.log(`${TAG} done sent_model=${model.model_name} returned_model=${responseModel} in=${inputTokens} out=${outputTokens} cached=${cachedTokens} reasoning=${reasoningTokens} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
  } catch (err: any) {
    console.error(`${TAG} ERROR`, err?.message ?? err, err?.response?.data ?? err)
    callbacks.onError(`OpenAI: ${err?.message ?? err}`)
  }
}

// ── background-mode text (for pro reasoning models) ──────────────────────────
//
// Pro models can reason for 2–10 minutes. Mirrors the create → poll pattern
// used by Alibaba video. Returns final text in one onDelta call when done.

async function streamTextBackground(
  model: ModelInfo,
  input: any[],
  callbacks: TextStreamCallbacks,
  TAG: string,
): Promise<void> {
  console.log(`${TAG} background mode (pro model detected)`)
  try {
    // Kick off in background mode — returns immediately with a response ID.
    const initial: any = await client().responses.create({
      model: model.model_name,
      input,
      background: true,
    } as any)
    const responseId = initial.id
    console.log(`${TAG} background started id=${responseId} status=${initial.status} model=${initial.model}`)

    // Poll until completed/failed/cancelled. ~10 min ceiling matches video.
    const intervalMs   = 5_000
    const maxAttempts  = 120 // 5s * 120 = 10 min
    let resp: any = initial
    for (let i = 0; i < maxAttempts; i++) {
      if (resp.status === 'completed' || resp.status === 'failed' || resp.status === 'cancelled' || resp.status === 'incomplete') {
        break
      }
      await new Promise(r => setTimeout(r, intervalMs))
      resp = await (client().responses as any).retrieve(responseId)
      console.log(`${TAG} background poll ${i + 1}/${maxAttempts} status=${resp.status}`)
    }

    if (resp.status !== 'completed') {
      const reason = resp.incomplete_details?.reason || resp.error?.message || resp.status
      throw new Error(`pro model did not complete: ${reason}`)
    }

    // Extract final text. The Responses API exposes a convenience
    // `output_text` aggregated string on completed responses.
    const text: string = resp.output_text ?? ''
    if (text) callbacks.onDelta(text)

    const usage = resp.usage ?? {}
    const inputTokens     = usage.input_tokens ?? 0
    const outputTokens    = usage.output_tokens ?? 0
    const cachedTokens    = usage.input_tokens_details?.cached_tokens ?? 0
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    console.log(`${TAG} background done sent_model=${model.model_name} returned_model=${resp.model} in=${inputTokens} out=${outputTokens} cached=${cachedTokens} reasoning=${reasoningTokens} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
  } catch (err: any) {
    console.error(`${TAG} background ERROR`, err?.message ?? err, err?.response?.data ?? err)
    callbacks.onError(`OpenAI: ${err?.message ?? err}`)
  }
}

function buildMultimodalInput(text: string, attachments: Attachment[]) {
  const images = attachments.filter(a => a.mediaType.startsWith('image/'))
  const docs   = attachments.filter(a => a.mediaType === 'application/pdf' || a.mediaType.startsWith('text/'))

  if (images.length > 0) {
    const content: any[] = images.map(img => ({
      type: 'input_image',
      image_url: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`,
    }))
    // Append any document text
    if (docs.length > 0) {
      const docText = docs.map(d => d.buffer.toString('utf-8')).join('\n\n---\n\n')
      content.push({ type: 'input_text', text: `${docText}\n\n${text}` })
    } else {
      content.push({ type: 'input_text', text })
    }
    return { role: 'user' as const, content }
  }
  if (docs.length > 0) {
    const docText = docs.map(d => d.buffer.toString('utf-8')).join('\n\n---\n\n')
    return { role: 'user' as const, content: `File content:\n${docText}\n\n${text}` }
  }
  return { role: 'user' as const, content: text }
}

// ── image generation ─────────────────────────────────────────────────────────
//
// Two routes:
//
//   1. Direct image models (gpt-image-2 and any future gpt-image-*)
//      → /v1/images/generations and /v1/images/edits. Required because the
//      image model isn't a chat model and can't be passed as `model` in
//      /v1/responses.
//
//   2. Chat-driving models (gpt-5.x, etc.) that *call* image_generation as
//      a Responses-API tool. Supports `previous_response_id` for multi-turn
//      edits without re-uploading the previous image.
//
// The branch is chosen on model_name: anything matching /^gpt-image-/ goes
// through the direct path.

function isDirectImageModel(modelName: string): boolean {
  return /^gpt-image-/.test(modelName)
}

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  quality: 'low' | 'medium' | 'high' = 'medium',
  size: string = '1024x1024',
  attachments: Attachment[] = [],
  previousResponseId: string | null = null,
): Promise<ImageResult & { responseId?: string }> {
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} generateImage quality=${quality} size=${size} attachments=${attachments.length} prevId=${previousResponseId ?? 'none'}`)

  const images = attachments.filter(a => a.mediaType.startsWith('image/'))

  // ── Direct Images API (gpt-image-*) ────────────────────────────────────────
  if (isDirectImageModel(model.model_name)) {
    return generateImageDirect(model, prompt, quality, size, images, TAG)
  }

  // ── Responses API + image_generation tool (chat-driving models) ────────────
  // Build the input. For multi-turn edits with previous_response_id, we just
  // send the new prompt. For first-turn or explicit attachment, include images.
  const input: any[] = []

  if (images.length > 0 && !previousResponseId) {
    // First turn with attachments: include all images inline
    const content: any[] = images.map(img => ({
      type: 'input_image',
      image_url: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`,
    }))
    content.push({ type: 'input_text', text: prompt })
    input.push({ role: 'user', content })
  } else {
    input.push({ role: 'user', content: prompt })
  }

  const params: any = {
    model: model.model_name,
    input,
    tools: [{ type: 'image_generation', quality, size }],
  }

  if (previousResponseId) {
    params.previous_response_id = previousResponseId
  }

  console.log(`${TAG} request body:`, JSON.stringify({ ...params, input: `[${input.length} message(s)]` }))

  const response = await client().responses.create(params)

  // Log the full response shape (minus the base64 payload — that's huge)
  const respAny = response as any
  console.log(`${TAG} response.id=${respAny.id} model=${respAny.model} status=${respAny.status}`)
  console.log(`${TAG} response.usage=`, JSON.stringify(respAny.usage))
  console.log(`${TAG} response.output items=${(respAny.output ?? []).length} types=`, (respAny.output ?? []).map((o: any) => o.type))

  // Extract the generated image from the response output
  let imageB64: string | null = null
  for (const item of respAny.output ?? []) {
    if (item.type === 'image_generation_call' && item.result) {
      imageB64 = item.result
      break
    }
  }

  if (!imageB64) {
    // Some models return the image in a different structure
    const outputText = respAny.output_text
    if (outputText && outputText.startsWith('data:image')) {
      const match = outputText.match(/^data:([^;]+);base64,(.*)$/)
      if (match) imageB64 = match[2]
    }
  }

  if (!imageB64) {
    throw new Error(`OpenAI returned no image. Response output: ${JSON.stringify(respAny.output ?? []).slice(0, 500)}`)
  }

  const buffer = Buffer.from(imageB64, 'base64')
  const mediaType = 'image/png'

  // Cost from usage
  const usage = respAny.usage
  let cost = calcImageCost(model, quality, size)
  if (usage) {
    const inputTokens  = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
    const tokenCost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    if (tokenCost > 0) cost = tokenCost
  }

  const responseId = respAny.id ?? undefined

  console.log(`${TAG} image ok sent_model=${model.model_name} returned_model=${respAny.model} bytes=${buffer.length} responseId=${responseId ?? 'none'} cost=$${cost.toFixed(6)}`)
  return { buffer, mediaType, cost, responseId }
}

// ── Direct Images API path (gpt-image-2 and any future gpt-image-*) ─────────
//
// Uses /v1/images/generations for first-turn (no input images) or
// /v1/images/edits for image-to-image. The Images API doesn't support
// previous_response_id; multi-turn edits work by re-sending the prior image
// as the input — the caller is responsible for that.

async function generateImageDirect(
  model:    ModelInfo,
  prompt:   string,
  quality:  'low' | 'medium' | 'high',
  size:     string,
  images:   Attachment[],
  TAG:      string,
): Promise<ImageResult & { responseId?: string }> {
  // All current gpt-image-* models accept `quality` (low/medium/high). Even
  // though gpt-image-2 is token-billed, the field still controls how much
  // compute the model uses, so we pass it through.
  let respAny: any
  if (images.length > 0) {
    // ── Edit path ──
    // The SDK accepts a Blob/File-like for `image`. We synthesise a File from
    // the buffer to keep this Node-runtime friendly.
    const first = images[0]
    const file  = await toUploadable(first)
    const params: any = {
      model:   model.model_name,
      prompt,
      image:   file,
      size,
      quality,
      n:       1,
    }
    console.log(`${TAG} images.edit body:`, JSON.stringify({ ...params, image: `<${first.mediaType} ${first.buffer.length}B>` }))
    respAny = await (client().images as any).edit(params)
  } else {
    // ── Generate path ──
    const params: any = {
      model:   model.model_name,
      prompt,
      size,
      quality,
      n:       1,
    }
    console.log(`${TAG} images.generate body:`, JSON.stringify(params))
    respAny = await client().images.generate(params)
  }

  console.log(`${TAG} response:`, JSON.stringify({
    created: respAny.created,
    data_count: (respAny.data ?? []).length,
    usage: respAny.usage,
  }))

  const item = (respAny.data ?? [])[0] ?? {}
  let buffer: Buffer
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64')
  } else if (item.url) {
    // Some models return a hosted URL — fetch and bufferize.
    const res = await fetch(item.url)
    const ab  = await res.arrayBuffer()
    buffer    = Buffer.from(ab)
  } else {
    throw new Error(`OpenAI Images API returned no image. Response: ${JSON.stringify(respAny).slice(0, 500)}`)
  }

  const mediaType = 'image/png'

  // Cost: GPT Image 2 (and other token-billed image models) returns a usage
  // block with text/image input tokens and image output tokens. Pass it to
  // calcImageCost so the token branch fires when model_pricing.tokens is set.
  // Falls back to per_image[size] / per_image[quality] for flat-rate models.
  const usage = respAny.usage
  const inputTextTokens   = usage?.input_tokens_details?.text_tokens  ?? 0
  const inputImageTokens  = usage?.input_tokens_details?.image_tokens ?? 0
  const outputImageTokens = usage?.output_tokens ?? 0
  const cost = calcImageCost(model, quality, size, {
    inputTextTokens,
    inputImageTokens,
    outputImageTokens,
  })

  console.log(`${TAG} image ok (direct) sent_model=${model.model_name} bytes=${buffer.length} in_text=${inputTextTokens} in_img=${inputImageTokens} out_img=${outputImageTokens} cost=$${cost.toFixed(6)}`)
  return { buffer, mediaType, cost }
}

// Convert an Attachment buffer into something the OpenAI SDK accepts as a
// file upload. The SDK's `toFile()` helper does the right thing in both
// Node 18+ and Edge runtimes.
async function toUploadable(att: Attachment): Promise<any> {
  const { toFile } = await import('openai')
  const ext = att.mediaType.split('/')[1] || 'png'
  return toFile(att.buffer, `image.${ext}`, { type: att.mediaType })
}
