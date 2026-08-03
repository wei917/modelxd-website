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
import { VARIATION_DIRECTIVES } from './types'

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
  thinking: string | null = null,
  search: boolean = false,
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
    return streamTextBackground(model, input, callbacks, TAG, thinking, search)
  }

  try {
    const requestBody: any = {
      model: model.model_name,
      input,
      stream: true,
      // Reasoning effort (thinking level) - validated live July 22:
      // none / minimal / low / medium / high / xhigh / max.
      ...(thinking ? { reasoning: { effort: thinking } } : {}),
      // Built-in web search (Responses API). `web_search` is the current
      // tool type; `web_search_2025_08_26` is the pinned older snapshot.
      ...(search ? { tools: [{ type: 'web_search' }] } : {}),
    }
    console.log(`${TAG} request body:`, JSON.stringify({ ...requestBody, input: `[${input.length} message(s)]` }))

    const stream = await client().responses.create(requestBody)

    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0
    let reasoningTokens = 0
    let responseModel: string | null = null
    let responseId: string | null = null
    // OpenAI does not report a search tally in `usage`, so we count the
    // per-call completion events as they stream past.
    let searchCount = 0

    for await (const event of stream as any) {
      // Log non-delta events in full so we can see exactly what OpenAI returned
      if (event.type === 'response.output_text.delta') {
        callbacks.onDelta(event.delta)
      } else if (event.type === 'response.created') {
        responseModel = (event as any).response?.model ?? null
        responseId    = (event as any).response?.id ?? null
        console.log(`${TAG} response.created id=${responseId} model=${responseModel}`)
      } else if (event.type === 'response.web_search_call.completed') {
        searchCount++
        console.log(`${TAG} web_search_call completed (#${searchCount})`)
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

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking, searchCount })
    console.log(`${TAG} done sent_model=${model.model_name} returned_model=${responseModel} in=${inputTokens} out=${outputTokens} cached=${cachedTokens} reasoning=${reasoningTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
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
  thinking: string | null = null,
  search: boolean = false,
): Promise<void> {
  console.log(`${TAG} background mode (pro model detected)`)
  try {
    // Kick off in background mode — returns immediately with a response ID.
    const initial: any = await client().responses.create({
      model: model.model_name,
      input,
      background: true,
      ...(search ? { tools: [{ type: 'web_search' }] } : {}),
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

    // No stream to count events on here — tally the search calls the
    // completed response actually contains.
    const searchCount = (resp.output ?? []).filter((o: any) => o?.type === 'web_search_call').length
    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking, searchCount })
    console.log(`${TAG} background done sent_model=${model.model_name} returned_model=${resp.model} in=${inputTokens} out=${outputTokens} cached=${cachedTokens} reasoning=${reasoningTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
  } catch (err: any) {
    console.error(`${TAG} background ERROR`, err?.message ?? err, err?.response?.data ?? err)
    callbacks.onError(`OpenAI: ${err?.message ?? err}`)
  }
}

function buildMultimodalInput(text: string, attachments: Attachment[]) {
  const images = attachments.filter(a => a.mediaType.startsWith('image/'))
  // PDFs are passed natively via `input_file` (base64 data URL). The
  // Responses API extracts both the text layer and a rendered image of each
  // page for vision-capable models. The router (lib/providers/index.ts)
  // only forwards a PDF here when the model declares `pdf_to_text`; plain
  // text files are folded into the prompt upstream, so they don't reach
  // this function as attachments.
  const pdfs   = attachments.filter(a => a.mediaType === 'application/pdf')

  if (images.length === 0 && pdfs.length === 0) {
    return { role: 'user' as const, content: text }
  }

  const content: any[] = []
  for (const img of images) {
    content.push({
      type: 'input_image',
      image_url: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`,
    })
  }
  for (let i = 0; i < pdfs.length; i++) {
    content.push({
      type: 'input_file',
      filename: `document-${i + 1}.pdf`,
      file_data: `data:application/pdf;base64,${pdfs[i].buffer.toString('base64')}`,
    })
  }
  content.push({ type: 'input_text', text })
  return { role: 'user' as const, content }
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
  options?: { count?: number | null } | null,
): Promise<ImageResult & { responseId?: string }> {
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} generateImage quality=${quality} size=${size} attachments=${attachments.length} prevId=${previousResponseId ?? 'none'} count=${options?.count ?? 1}`)

  const images = attachments.filter(a => a.mediaType.startsWith('image/'))

  // ── Direct Images API (gpt-image-*) ────────────────────────────────────────
  if (isDirectImageModel(model.model_name)) {
    return generateImageDirect(model, prompt, quality, size, images, TAG, options)
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
  options?: { count?: number | null } | null,
): Promise<ImageResult & { responseId?: string }> {
  // All current gpt-image-* models accept `quality` (low/medium/high). Even
  // though gpt-image-2 is token-billed, the field still controls how much
  // compute the model uses, so we pass it through.

  // n (image count): only when the row declares max_count > 1 — mirrors the
  // qwen pattern in alibaba.ts. The API allows n 1..10 for generations AND
  // edits on gpt-image-* (the n=1 restriction was dall-e-3 only).
  const maxCount = model.output_config?.image?.max_count ?? 1
  const n = (maxCount > 1 && typeof options?.count === 'number' && options.count >= 1)
    ? Math.min(options.count, maxCount)
    : 1

  // Multi-output diversity: n>1 as a single API call means n independent
  // samples of IDENTICAL conditioning — GPT image models have low sample
  // variance, so all n come out near-identical (verified July 2026 with
  // the Product Shots prompt: 8 near-clones). ChatGPT gets variety by
  // rewriting the prompt per image; we do the same cheaply — n parallel
  // n:1 calls, each with a numbered variation hint appended. Input tokens
  // are billed per sample either way, so this costs the same.
  const variantPrompt = (vi: number) => n <= 1 ? prompt :
    `${prompt}\n\n(Variation ${vi + 1} of ${n} — this take must use ${VARIATION_DIRECTIVES[vi % VARIATION_DIRECTIVES.length]}.)`

  const files = images.length > 0 ? await Promise.all(images.map(toUploadable)) : null

  const callOnce = async (vi: number): Promise<any> => {
    if (files) {
      // ── Edit path ── The SDK accepts a Blob/File-like or an ARRAY for
      // `image` — gpt-image-* edits take multiple reference images
      // (order preserved, prompts say "first image" / "second image").
      const params: any = {
        model:   model.model_name,
        prompt:  variantPrompt(vi),
        image:   files.length === 1 ? files[0] : files,
        size,
        quality,
        n:       1,
      }
      if (vi === 0) console.log(`${TAG} images.edit body:`, JSON.stringify({ ...params, image: images.map(im => `<${im.mediaType} ${im.buffer.length}B>`).join(',') }))
      return (client().images as any).edit(params)
    }
    // ── Generate path ──
    const params: any = {
      model:   model.model_name,
      prompt:  variantPrompt(vi),
      size,
      quality,
      n:       1,
    }
    if (vi === 0) console.log(`${TAG} images.generate body:`, JSON.stringify(params))
    return client().images.generate(params)
  }

  const resps: any[] = await Promise.all(Array.from({ length: n }, (_, vi) => callOnce(vi)))

  console.log(`${TAG} responses=${resps.length}`, JSON.stringify({
    data_counts: resps.map(r => (r.data ?? []).length),
    usage_first: resps[0]?.usage,
  }))

  // Decode EVERY returned image across all calls. Primary buffer is the
  // first; the rest ride in `extras` — same contract as qwen / Gemini.
  const decoded: Buffer[] = []
  for (const r of resps) {
    for (const item of (r.data ?? []) as any[]) {
      if (item?.b64_json) {
        decoded.push(Buffer.from(item.b64_json, 'base64'))
      } else if (item?.url) {
        // Some models return a hosted URL — fetch and bufferize.
        const res = await fetch(item.url)
        const ab  = await res.arrayBuffer()
        decoded.push(Buffer.from(ab))
      }
    }
  }
  if (decoded.length === 0) {
    throw new Error(`OpenAI Images API returned no image. Response: ${JSON.stringify(resps[0]).slice(0, 500)}`)
  }
  const buffer = decoded[0]
  const respAny: any = resps[0]  // responseId/metadata source

  const mediaType = 'image/png'

  // Cost: GPT Image 2 (and other token-billed image models) returns a usage
  // block per call — SUM across all parallel calls so billing stays exact.
  let inputTextTokens = 0, inputImageTokens = 0, outputImageTokens = 0
  for (const r of resps) {
    inputTextTokens   += r.usage?.input_tokens_details?.text_tokens  ?? 0
    inputImageTokens  += r.usage?.input_tokens_details?.image_tokens ?? 0
    outputImageTokens += r.usage?.output_tokens ?? 0
  }
  const cost = calcImageCost(model, quality, size, {
    inputTextTokens,
    inputImageTokens,
    outputImageTokens,
  })

  console.log(`${TAG} image ok (direct) sent_model=${model.model_name} count=${decoded.length} bytes=[${decoded.map(b => b.length).join(',')}] in_text=${inputTextTokens} in_img=${inputImageTokens} out_img=${outputImageTokens} cost=$${cost.toFixed(6)}`)
  return {
    buffer,
    mediaType,
    cost,
    extras: decoded.slice(1).map(b => ({ buffer: b, mediaType })),
  }
}

// Convert an Attachment buffer into something the OpenAI SDK accepts as a
// file upload. The SDK's `toFile()` helper does the right thing in both
// Node 18+ and Edge runtimes.
async function toUploadable(att: Attachment): Promise<any> {
  const { toFile } = await import('openai')
  const ext = att.mediaType.split('/')[1] || 'png'
  return toFile(att.buffer, `image.${ext}`, { type: att.mediaType })
}
