// lib/providers/google.ts
//
// Direct Google Gemini provider using the official @google/genai SDK.
//   - Text:  generateContentStream for streaming text
//   - Image: generateContent with responseModalities=['IMAGE','TEXT']
//            Multi-turn supported by passing full conversation history
//   - Video: Veo via models.generateVideos (async operation + polling)

import { GoogleGenAI, type Content, type Part } from '@google/genai'
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
} from './types'
import { calcTextCost, calcImageCost, calcVideoCost } from './pricing'
import { logResponse } from './log'
import { VARIATION_DIRECTIVES } from './types'

let _ai: GoogleGenAI | null = null
function ai(): GoogleGenAI {
  if (!_ai) {
    const key = process.env.GOOGLE_AI_API_KEY
    if (!key) throw new Error('GOOGLE_AI_API_KEY is not set')
    _ai = new GoogleGenAI({ apiKey: key })
  }
  return _ai
}

// ── Transient-error retry (July 19) ─────────────────────────────────────
// Google surfaces rate limits as 429 RESOURCE_EXHAUSTED and brief
// capacity blips as 500/503 UNAVAILABLE. Those deserve a short backoff
// retry instead of instantly failing the slot (which in a duel burns the
// user's daily quota on a transient). Anything else (400s, safety
// blocks, NOT_FOUND) re-throws immediately — retrying those wastes money.
const RETRYABLE = /\b(429|500|502|503|529)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate limit/i
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3, baseDelayMs = 2000): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try { return await fn() } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const status = (err as any)?.status
      const retryable = RETRYABLE.test(msg) || [429, 500, 502, 503, 529].includes(status)
      if (!retryable || i === attempts) throw err
      const delay = baseDelayMs * Math.pow(3, i - 1) // 2s, 6s
      console.warn(`[google] ${label}: transient error (attempt ${i}/${attempts}), retrying in ${delay}ms — ${msg.slice(0, 140)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// ── text (streaming) ──────────────────────────────────────────────────────────

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachments: Attachment[] = [],
  thinking: string | null = null,
  search: boolean = false,
): Promise<void> {
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length} thinking=${thinking ?? 'auto'}`)

  // Convert to Gemini format
  const contents: Content[] = messages.map((m, i) => {
    const parts: Part[] = []

    // Add attachments to last user message. Gemini ingests both images and
    // PDFs as inlineData (native document understanding for PDFs). The
    // router only forwards a PDF here when the model declares `pdf_to_text`;
    // plain-text files are folded into the prompt upstream.
    if (i === messages.length - 1 && m.role === 'user' && attachments.length > 0) {
      for (const att of attachments) {
        if (att.mediaType.startsWith('image/') || att.mediaType === 'application/pdf') {
          parts.push({
            inlineData: {
              mimeType: att.mediaType,
              data: att.buffer.toString('base64'),
            },
          })
        }
      }
    }

    parts.push({ text: String(m.content) })

    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    }
  })

  try {
    // One config object: thinking and grounding both live here, so they
    // cannot be spread over each other the way two conditional spreads would.
    const config: any = {}
    // Thinking level (validated live July 22: MINIMAL/LOW/MEDIUM/HIGH).
    if (thinking) config.thinkingConfig = { thinkingLevel: thinking.toUpperCase() as any }
    // Grounding with Google Search.
    if (search) config.tools = [{ googleSearch: {} }]

    const stream = await withRetry(() => ai().models.generateContentStream({
      model: model.model_name,
      contents,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    }), 'text generateContentStream')

    let inputTokens = 0
    let cachedTokens = 0
    let outputTokens = 0
    let searchCount = 0

    for await (const chunk of stream) {
      const text = chunk.text
      if (text) {
        callbacks.onDelta(text)
      }

      // Usage metadata on the last chunk. cachedContentTokenCount is the
      // subset of promptTokenCount Gemini served from its implicit cache and
      // billed at a discount — passing 0 here billed users full price for
      // tokens Google charged us less for (CC, Aug 6). calcTextCost only
      // applies a discount when the model has a cached_input rate on file,
      // so this stays a no-op until the catalog rows carry one.
      if (chunk.usageMetadata) {
        inputTokens  = chunk.usageMetadata.promptTokenCount ?? 0
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0
        cachedTokens = (chunk.usageMetadata as any).cachedContentTokenCount ?? 0
      }

      // Grounding metadata arrives on whichever chunk carries the citations.
      // `webSearchQueries` is the list of queries Google actually ran; a
      // grounded answer with the list omitted still cost at least one.
      const gm = (chunk as any).candidates?.[0]?.groundingMetadata
      if (gm) searchCount = Math.max(searchCount, gm.webSearchQueries?.length || 1)
    }

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { thinkingLevel: thinking, searchCount })
    console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
  } catch (err: any) {
    callbacks.onError(`Google: ${err?.message ?? err}`)
  }
}

// ── image generation ──────────────────────────────────────────────────────────
//
// Gemini image generation uses generateContent with
// responseModalities: ['IMAGE', 'TEXT']. Multi-turn editing is achieved by
// passing the full conversation history including previous image parts.

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  quality: 'low' | 'medium' | 'high' = 'medium',
  size: string = '1024x1024',
  attachments: Attachment[] = [],
  conversationHistory: Array<{ role: string; parts: any[] }> | null = null,
  options?: { count?: number | null; aspect_ratio?: string | null } | null,
): Promise<ImageResult & { conversationHistory?: any[] }> {
  const TAG = `[google/${model.model_name}]`

  // Output count: Gemini's API has NO n/candidateCount for image output —
  // one request = one generation. We deliver multi-output the way image
  // aggregators do: N PARALLEL requests, merged into primary + extras.
  // Each request bills its own usage tokens, so cost scales linearly and
  // stays exact. Gated on output_config.image.max_count like other
  // providers. Multi-turn continuation always follows the FIRST image.
  const maxCount = model.output_config?.image?.max_count ?? 1
  const n = (maxCount > 1 && typeof options?.count === 'number' && options.count >= 1)
    ? Math.min(options.count, maxCount)
    : 1

  console.log(`${TAG} generateImage size=${size} attachments=${attachments.length} historyLen=${conversationHistory?.length ?? 0} count=${n}`)

  let contents: Content[]

  if (conversationHistory && conversationHistory.length > 0) {
    // Multi-turn: use provided history + new user prompt
    contents = [
      ...conversationHistory.map(h => ({
        role: h.role === 'assistant' ? 'model' : h.role,
        parts: h.parts,
      } as Content)),
      { role: 'user', parts: [{ text: prompt }] },
    ]
  } else {
    // First turn — include all image attachments
    const parts: Part[] = []
    for (const att of attachments) {
      if (att.mediaType.startsWith('image/')) {
        parts.push({
          inlineData: {
            mimeType: att.mediaType,
            data: att.buffer.toString('base64'),
          },
        })
      }
    }
    parts.push({ text: prompt })
    contents = [{ role: 'user', parts }]
  }

  // Map the UI size ("1024x1024", "1024x1536", ...) to Gemini's image
  // config — both an aspect ratio and an imageSize tier. Without these,
  // the model picks its own shape regardless of what we asked for.
  // Per docs (https://ai.google.dev/gemini-api/docs/image-generation):
  //   responseFormat.image.aspectRatio: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5,
  //                                    5:4, 9:16, 16:9, 21:9
  //   responseFormat.image.imageSize:   "1K" | "2K" | "4K"
  //
  // `size` arrives in one of TWO shapes, and that broke this badly:
  //   • "1024x1536" — most catalogue rows
  //   • "2048"      — the Gemini 3 image rows (gemini-3.1-flash-image,
  //                   gemini-3-pro-image, gemini-3.1-flash-lite-image),
  //                   which declare bare long-edge tiers because Google
  //                   takes a tier + a ratio rather than dimensions.
  //
  // The old code did `size.includes('x') ? split : []` then `parts[0] || 1024`,
  // so a bare size fell through to 1024x1024 -> ratio 1:1 and tier 1K. Every
  // request to those three models came out SQUARE at 1K no matter which
  // aspect ratio the user picked, because the picked ratio was never read
  // here at all (CC, July 25).
  //
  // Fix: trust options.aspect_ratio — it's what the user actually chose —
  // and only fall back to inferring from dimensions when it's absent.
  const { aspectRatio, imageSize } = (() => {
    const SUPPORTED = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
    const hasDims = size.includes('x')
    const dims = hasDims ? size.split('x').map(s => parseInt(s, 10)) : []
    const w = hasDims ? (dims[0] || 1024) : 0
    const h = hasDims ? (dims[1] || 1024) : 0

    let bestLabel = options?.aspect_ratio && SUPPORTED.includes(options.aspect_ratio)
      ? options.aspect_ratio
      : ''
    if (!bestLabel) {
      if (hasDims) {
        const target = w / h
        const choices: Array<[string, number]> = [
          ['1:1', 1],     ['2:3', 2/3],   ['3:2', 3/2],
          ['3:4', 3/4],   ['4:3', 4/3],   ['4:5', 4/5],   ['5:4', 5/4],
          ['9:16', 9/16], ['16:9', 16/9], ['21:9', 21/9],
        ]
        let bestDelta = Infinity
        bestLabel = choices[0][0]
        for (const [label, ratio] of choices) {
          const d = Math.abs(Math.log(target) - Math.log(ratio))
          if (d < bestDelta) { bestDelta = d; bestLabel = label }
        }
      } else {
        bestLabel = '1:1'
      }
    }

    // Long edge -> Google's tier name. For a bare size the number IS the
    // long edge; previously this always resolved to 1K.
    const longEdge = hasDims ? Math.max(w, h) : (parseInt(size, 10) || 1024)
    const tier = longEdge >= 3840 ? '4K' : longEdge >= 1536 ? '2K' : '1K'
    return { aspectRatio: bestLabel, imageSize: tier }
  })()

  // NB: the SDK's GenerateContentConfig has a typed `imageConfig` field
  // with `aspectRatio` and `imageSize` (see ImageConfig in node.d.ts).
  // Some doc snippets show `responseFormat: { image: {...} }` but that
  // path isn't in the SDK's typed surface, so it gets dropped before
  // serialization. `imageConfig` is the field that actually reaches the
  // wire as `image_config` in the REST payload.
  const requestPayload: any = {
    model: model.model_name,
    contents,
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: { aspectRatio, imageSize },
    },
  }
  console.log(`${TAG} requesting aspectRatio=${aspectRatio} imageSize=${imageSize} for size=${size} picked=${options?.aspect_ratio ?? 'none'}`)
  logResponse(TAG, 'REQUEST', requestPayload)

  // n parallel generations (n=1 → a single call, exactly as before).
  // Same-prompt parallel samples come out near-identical (low sample
  // variance — same failure ChatGPT avoids by rewriting the prompt per
  // image), so each call past the first gets a numbered variation hint
  // appended to the user prompt.
  const payloadFor = (vi: number) => {
    if (n <= 1) return requestPayload
    const hint = `\n\n(Variation ${vi + 1} of ${n} — this take must use ${VARIATION_DIRECTIVES[vi % VARIATION_DIRECTIVES.length]}.)`
    const varied = contents.map((c, ci) => ci === contents.length - 1
      ? { ...c, parts: (c.parts ?? []).map(p => (p as any).text ? { text: (p as any).text + hint } : p) }
      : c)
    return { ...requestPayload, contents: varied }
  }
  let responses = await Promise.all(
    Array.from({ length: n }, (_, vi) => withRetry(() => ai().models.generateContent(payloadFor(vi)), `image generateContent[${vi}]`))
  )

  // Extract EVERY image from EVERY response. Two multi-image sources:
  // n > 1 parallel calls, and a single response containing multiple image
  // parts (storytelling-style prompts). First image = primary, the rest
  // ride in `extras` (same contract as qwen / gpt-image-2 multi-output).
  // responseParts (→ conversation history) come from the FIRST response
  // only, so multi-turn edits continue from the primary image.
  const collect = (resps: typeof responses) => {
    const found: Array<{ buffer: Buffer; mediaType: string }> = []
    const responseParts: Part[] = []
    for (let ri = 0; ri < resps.length; ri++) {
      const candidates = resps[ri].candidates
      if (!candidates || candidates.length === 0) continue
      const parts = candidates[0].content?.parts ?? []
      for (const part of parts) {
        if (ri === 0) responseParts.push(part as Part)
        if ((part as any).inlineData) {
          const data = (part as any).inlineData
          found.push({
            buffer:    Buffer.from(data.data, 'base64'),
            mediaType: data.mimeType ?? 'image/png',
          })
        }
      }
    }
    return { found, responseParts }
  }

  let { found, responseParts } = collect(responses)

  // These models are multimodal, so a question-shaped prompt ("Explain why
  // the sky is blue in two sentences") gets ANSWERED IN TEXT instead of
  // drawn, and the slot comes back empty — an XDuel image duel then has one
  // dead side and can't be voted on. The surface asked for a picture, so ask
  // again and say so. Fires only when nothing was drawn AND nothing was
  // blocked, so ordinary prompts never pay for the extra call.
  //
  // Measured against all three Nano Banana models (Aug 24), same prompt:
  //   responseModalities ['IMAGE','TEXT'] → 0 images + the essay
  //   responseModalities ['IMAGE']        → 0 images, finishReason NO_IMAGE
  //   either + the directive below        → 1 image
  // So restricting the output type only gags the essay; rewriting the
  // prompt is what actually produces a picture. We keep TEXT on the first
  // call because that text is how we explain refusals to the user, and
  // treat NO_IMAGE as retryable rather than blocked in case Google starts
  // returning it here too.
  if (found.length === 0) {
    const cand0        = (responses[0] as any)?.candidates?.[0]
    const answeredText = (cand0?.content?.parts ?? []).map((p: any) => p.text).filter(Boolean).join(' ').trim()
    const finish       = cand0?.finishReason
    const blocked      = (finish && finish !== 'STOP' && finish !== 'NO_IMAGE')
                      || (responses[0] as any)?.promptFeedback?.blockReason
    if ((answeredText || finish === 'NO_IMAGE') && !blocked) {
      console.warn(`${TAG} model answered in text instead of drawing — retrying with an explicit image directive`)
      const draw = (t: string) => `Draw this as an image. Output only the image, never a written answer. If it reads like a question, illustrate the answer.\n\n${t}`
      const retryContents = contents.map((c, ci) => ci === contents.length - 1
        ? { ...c, parts: (c.parts ?? []).map(p => (p as any).text ? { text: draw((p as any).text) } : p) }
        : c)
      responses = await Promise.all(
        Array.from({ length: n }, (_, vi) => withRetry(
          () => ai().models.generateContent({ ...payloadFor(vi), contents: retryContents }),
          `image retry-as-image[${vi}]`)),
      )
      ;({ found, responseParts } = collect(responses))
      console.log(`${TAG} retry produced ${found.length} image(s)`)
    }
  }

  const response = responses[0]

  // ── debug: dump everything Google sent back so we can map usage → cost ──
  try {
    console.log(`${TAG} response.keys=${JSON.stringify(Object.keys(response ?? {}))}`)
  } catch { /* ignore */ }
  try {
    console.log(`${TAG} response.usageMetadata=${JSON.stringify((response as any)?.usageMetadata)}`)
  } catch { /* ignore */ }
  try {
    // Strip the actual image bytes from candidates so the log isn't 5MB.
    const lite = JSON.parse(JSON.stringify(response, (k, v) => k === 'data' ? '<bytes>' : v))
    console.log(`${TAG} response=${JSON.stringify(lite).slice(0, 1500)}`)
  } catch (e) {
    console.log(`${TAG} response (stringify failed): ${(e as Error).message}`)
  }


  const imageBuffer = found[0]?.buffer ?? null
  const mimeType    = found[0]?.mediaType ?? 'image/png'

  if (!imageBuffer) {
    // Surface WHY instead of dumping raw JSON (which truncates before the
    // useful bits). Two common causes: (1) the model answered with TEXT
    // (a refusal or a clarifying question) — show that text; (2) the
    // candidate was blocked — show finishReason (e.g. IMAGE_SAFETY,
    // PROHIBITED_CONTENT) and any promptFeedback.blockReason.
    const cand         = (response as any)?.candidates?.[0]
    const textPart     = (cand?.content?.parts ?? []).map((p: any) => p.text).filter(Boolean).join(' ').trim()
    const finishReason = cand?.finishReason
    const blockReason  = (response as any)?.promptFeedback?.blockReason
    const why = [
      finishReason && finishReason !== 'STOP' ? `finishReason=${finishReason}` : null,
      blockReason ? `blockReason=${blockReason}` : null,
      textPart ? `model said: "${textPart.slice(0, 300)}"` : null,
    ].filter(Boolean).join(' — ')
    const hint = (textPart || finishReason === 'NO_IMAGE') && finishReason !== 'IMAGE_SAFETY'
      ? ' This prompt reads like a question — describe a picture instead (e.g. "a diagram of sunlight scattering in the sky").'
      : ' Try again, rephrase the prompt, or switch models.'
    throw new Error(`Gemini returned no image${why ? ` (${why})` : ''}.${hint}`)
  }

  // Build updated conversation history for multi-turn
  const updatedHistory = [
    ...(conversationHistory ?? contents.map(c => ({
      role: c.role === 'model' ? 'assistant' : c.role,
      parts: c.parts,
    }))),
    // If we used the first-turn path, history was built from contents above.
    // Only add the assistant response if we had existing history.
    ...(conversationHistory ? [{
      role: 'user',
      parts: [{ text: prompt }],
    }] : []),
    {
      role: 'assistant',
      parts: responseParts,
    },
  ]

  // Cost — split out per-modality token counts from usageMetadata, SUMMED
  // across all n responses (each parallel call bills independently), so
  // calcImageCost can apply per-modality rates if the model is token-billed.
  const usage = response.usageMetadata as any
  type TokenDetail = { modality?: string; tokenCount?: number }
  const findTokens = (arr: TokenDetail[], mod: string): number =>
    arr.find(d => d.modality === mod)?.tokenCount ?? 0

  let inputTextTokens = 0, inputImageTokens = 0, outputImageTokens = 0, outputTextTokens = 0
  for (const r of responses) {
    const u = r.usageMetadata as any
    const promptTokensDetails:     TokenDetail[] = u?.promptTokensDetails     ?? []
    const candidatesTokensDetails: TokenDetail[] = u?.candidatesTokensDetails ?? []
    inputTextTokens   += findTokens(promptTokensDetails, 'TEXT')
    inputImageTokens  += findTokens(promptTokensDetails, 'IMAGE')
    outputImageTokens += findTokens(candidatesTokensDetails, 'IMAGE')
    outputTextTokens  += findTokens(candidatesTokensDetails, 'TEXT')
  }

  // Token-based cost via calcImageCost (uses model_pricing.tokens.{text_input,
  // image_input, text_output, image_output}); falls back to per-image flat
  // (model_pricing.per_image[quality]) when no token rates are configured.
  // We pass outputTextTokens too so any "Okay, here's…" preamble in the
  // response gets billed at text_output rate.
  const cost = calcImageCost(model, quality, undefined, {
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens,
  })

  console.log(`${TAG} image ok count=${found.length} bytes=[${found.map(f => f.buffer.length).join(',')}] historyLen=${updatedHistory.length} cost=$${cost.toFixed(6)} tokens(in_text=${inputTextTokens}, in_image=${inputImageTokens}, out_image=${outputImageTokens}, out_text=${outputTextTokens})`)
  return {
    buffer:             imageBuffer,
    mediaType:          mimeType,
    cost,
    extras:             found.slice(1),
    conversationHistory: updatedHistory,
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens,
    usageMetadata:      usage ?? null,
  }
}

// ── video (Veo, async operation) ─────────────────────────────────────────────
//
// Veo follows a long-running-operation pattern:
//   1. ai.models.generateVideos({ model, prompt, image?, config }) → operation
//   2. while (!operation.done) operation = ai.operations.getVideosOperation({ operation })
//   3. operation.response.generatedVideos[0].video has a `.uri` we can fetch
//      with the API key appended.
//
// How image attachments map to the Veo request depends on the recipe
// (options.mode):
//   • reference_frames → config.referenceImages (max 3, type 'asset',
//     duration must be 8s): subjects/products to PRESERVE in a new scene.
//   • start_end_frames  → image (start) + config.lastFrame (end)
//     interpolation.
//   • image_to_video / unset → image[0] as the conditioning frame; a 2nd
//     image still falls back to lastFrame for backward compatibility.
// Getting this wrong is not cosmetic: sending person+product as
// start/end frames asks Veo to MORPH one into the other, which the
// safety filter rejects ("prompt conflicted with our safety policies").

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 8,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?:    { mode?: string | null; extend_video_ref?: string | null; aspect_ratio?: string | null },
): Promise<VideoResult> {
  const TAG = `[google/${model.model_name}]`

  // Map our flat size string → Veo's resolution + aspect ratio inputs.
  // Veo currently accepts '720p' / '1080p' / '4k' for resolution and a small
  // set of aspectRatio strings ('16:9', '9:16', etc.).
  // The user's explicit ⚙ choice WINS over the size-derived guess: XCreate
  // sends size as a bare tier ("720p", no dimensions), which parsed to
  // 1280×720 → 16:9 unconditionally, making the aspect option a placebo
  // for every Google video model (owner, Aug 20: square input cropped to
  // widescreen). The catalog's output_config gates which ratios the UI
  // offers per model, so what arrives here is already model-appropriate.
  const [wStr, hStr] = size.includes('x') ? size.split('x') : ['1280', '720']
  const w = parseInt(wStr, 10) || 1280
  const h = parseInt(hStr, 10) || 720
  const minDim = Math.min(w, h)
  const resolution = minDim >= 2160 ? '4k' : minDim >= 1080 ? '1080p' : '720p'
  const aspectRatio = options?.aspect_ratio ?? (w === h ? '1:1' : (w >= h ? '16:9' : '9:16'))

  // ── Gemini Omni Flash (July 19) — the Interactions API, not Veo's
  // generateVideos. Synchronous call; video comes back as inline base64
  // (≤4MB) or a file URI we poll + download. Tasks: text_to_video /
  // image_to_video / reference_to_video / edit. Resolution (360p-4k) and
  // duration (3-10s) rides in response_format (verified live, July 20).
  // Resolution is NOT settable on flash-preview - output is 720p; we bill
  // from actual usage tokens (5,792/s of 720p).
  if (model.model_name.startsWith('gemini-omni')) {
    return generateOmniVideo(model, prompt, aspectRatio, seconds, attachments, onProgress, options)
  }

  console.log(`${TAG} generateVideos start aspect=${aspectRatio} resolution=${resolution} duration=${seconds}s attachments=${attachments.length}`)

  // Build the request. Cast to `any` because the SDK's TS surface for
  // generateVideos is still in flux and several fields (durationSeconds,
  // image) aren't guaranteed to be in the published types.
  const request: any = {
    model:  model.model_name,
    prompt,
    config: {
      aspectRatio,
      resolution,
      numberOfVideos:  1,
      durationSeconds: seconds,
    },
  }

  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const recipe = options?.mode ?? null

  if (recipe === 'extend_video') {
    // Veo extension (docs → "Extending Veo videos"): input is a PRIOR VEO
    // OUTPUT referenced by URI (top-level `video`), never our stored MP4.
    // +7s per pass, chainable to 148s total; 720p only; durationSeconds
    // must be 8. The route resolves the ref from the source slot and
    // enforces the ~2-day validity window before we get here.
    const ref = options?.extend_video_ref
    if (!ref) {
      throw new Error('Veo can only extend videos it generated in the last 2 days — wire a Veo output as the source video.')
    }
    request.video = { uri: ref }
    if (request.config.resolution !== '720p') {
      console.log(`${TAG} extension is 720p-only (was ${request.config.resolution}); overriding`)
      request.config.resolution = '720p'
    }
    if (request.config.durationSeconds !== 8) {
      console.log(`${TAG} extension requires durationSeconds=8 (was ${request.config.durationSeconds}); overriding`)
      request.config.durationSeconds = 8
    }
    console.log(`${TAG} extending prior Veo video ref=${String(ref).slice(0, 90)}…`)
  } else if (recipe === 'reference_frames' && imageAtts.length >= 1) {
    // Reference images: preserve these subjects/products in a NEW scene
    // described by the prompt. Docs: up to 3 images, referenceType
    // 'asset', durationSeconds must be 8.
    const refs = imageAtts.slice(0, 3)
    if (imageAtts.length > 3) {
      console.warn(`${TAG} ${imageAtts.length} reference images attached; Veo accepts 3 — extras dropped`)
    }
    request.config.referenceImages = refs.map(a => ({
      image: {
        imageBytes: a.buffer.toString('base64'),
        mimeType:   a.mediaType,
      },
      referenceType: 'asset',
    }))
    if (request.config.durationSeconds !== 8) {
      console.log(`${TAG} referenceImages require durationSeconds=8 (was ${request.config.durationSeconds}); overriding`)
      request.config.durationSeconds = 8
    }
    console.log(`${TAG} using ${refs.length} referenceImages (asset)`)
  } else {
    if (imageAtts.length >= 1) {
      request.image = {
        imageBytes: imageAtts[0].buffer.toString('base64'),
        mimeType:   imageAtts[0].mediaType,
      }
      console.log(`${TAG} using image[0] as conditioning frame (mime=${imageAtts[0].mediaType}, ${imageAtts[0].buffer.length}b)`)
    }
    // Veo 3.1 supports start+end frame interpolation via `config.lastFrame`.
    // When the user attaches a second image, treat it as the end frame so
    // start_end_frames mode actually consumes both. Older Veo versions ignore
    // the field — that's fine, they just fall back to start-frame-only.
    //
    // Veo 3.1's lastFrame ONLY works with durationSeconds=8 — any other value
    // returns a generic 400 "use case not supported". Force-override the
    // duration here so the request actually succeeds. (This is documented in
    // a Google AI Forum thread, not the official docs.)
    if (imageAtts.length >= 2) {
      request.config.lastFrame = {
        imageBytes: imageAtts[1].buffer.toString('base64'),
        mimeType:   imageAtts[1].mediaType,
      }
      if (request.config.durationSeconds !== 8) {
        console.log(`${TAG} lastFrame requires durationSeconds=8 (was ${request.config.durationSeconds}); overriding`)
        request.config.durationSeconds = 8
      }
      console.log(`${TAG} using image[1] as lastFrame (mime=${imageAtts[1].mediaType}, ${imageAtts[1].buffer.length}b)`)
    }
  }

  if (onProgress) onProgress(2)

  let operation: any = await withRetry(() => (ai().models as any).generateVideos(request), 'video generateVideos')
  console.log(`${TAG} operation submitted name=${operation?.name ?? '(unknown)'}`)

  // Poll. Veo typically takes 1–3 minutes; we cap at 10 minutes total.
  const POLL_INTERVAL_MS  = 10_000
  const MAX_POLLS         = 60        // 10 min
  let polls = 0
  while (!operation?.done) {
    if (polls >= MAX_POLLS) {
      throw new Error(`Veo operation timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    operation = await (ai().operations as any).getVideosOperation({ operation })
    polls++
    if (onProgress) onProgress(Math.min(90, 5 + polls * 5))
  }

  if (operation.error) {
    throw new Error(`Veo operation failed: ${operation.error.message ?? JSON.stringify(operation.error).slice(0, 500)}`)
  }

  // Drill into response. Shape: response.generatedVideos[0].video.{uri,mimeType}
  const resp: any = operation?.response ?? {}

  // Veo's RAI (Responsible AI) filter rejects inputs that violate policy
  // (celebrity likeness, sexual content, violence, etc.) by returning
  // `raiMediaFilteredCount > 0` with `raiMediaFilteredReasons` instead of
  // generated videos. Surface that cleanly so the UI can show the real
  // reason instead of "missing video URI".
  if (resp.raiMediaFilteredCount > 0 || (Array.isArray(resp.raiMediaFilteredReasons) && resp.raiMediaFilteredReasons.length > 0)) {
    const reason = (resp.raiMediaFilteredReasons ?? []).join(' | ') || 'Content blocked by safety filter'
    throw new Error(`Veo blocked: ${reason}`)
  }

  const video = resp?.generatedVideos?.[0]?.video
  if (!video?.uri) {
    throw new Error(`Veo response missing video URI: ${JSON.stringify(resp).slice(0, 500)}`)
  }

  // Real billed duration — Veo returns the actual generated clip length on
  // operation.metadata (the long-running-operation pattern uses
  // `metadata` for service-specific info, separate from `response`).
  // Common keys observed: usageMetadata.videoDurationSeconds, totalBilledSeconds,
  // videoDuration (string like "8s"). We probe several and fall back to the
  // user-requested duration if none are present.
  const meta: any = operation?.metadata ?? {}
  const um:   any = meta?.usageMetadata ?? meta?.usage_metadata ?? {}
  const billedSeconds: number = (() => {
    const candidates = [
      um?.videoDurationSeconds,
      um?.video_duration_seconds,
      um?.videoSecondsBilled,
      meta?.videoDurationSeconds,
      meta?.video_duration_seconds,
      meta?.totalBilledSeconds,
      // 'videoDuration' in protobuf duration form e.g. "8s" or "8.0s"
      typeof meta?.videoDuration === 'string' ? parseFloat(meta.videoDuration) : undefined,
      typeof meta?.video_duration === 'string' ? parseFloat(meta.video_duration) : undefined,
    ]
    for (const v of candidates) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
      if (Number.isFinite(n) && n > 0) return n
    }
    // Extension generates +7s regardless of the requested duration — bill
    // the new content, not the combined output, when metadata is silent.
    return recipe === 'extend_video' ? 7 : seconds
  })()
  if (billedSeconds !== seconds) {
    console.log(`${TAG} billed duration ${billedSeconds}s differs from requested ${seconds}s (using billed for cost)`)
  } else {
    console.log(`${TAG} billed duration metadata not surfaced; using requested ${seconds}s for cost`)
  }

  // Dump everything Google sent back so we can refine the candidate-key
  // list. We log:
  //   - top-level keys of the operation (so we know what fields exist)
  //   - the metadata object (often {} but worth confirming)
  //   - the full response object (sometimes carries usageMetadata even though
  //     the typed schema doesn't show it)
  //   - sdkHttpResponse if the SDK populated it
  try {
    console.log(`${TAG} operation.keys=${JSON.stringify(Object.keys(operation ?? {}))}`)
  } catch { /* ignore */ }
  console.log(`${TAG} operation.metadata=${JSON.stringify(meta).slice(0, 800)}`)
  try {
    console.log(`${TAG} operation.response=${JSON.stringify(operation?.response).slice(0, 1500)}`)
  } catch { /* ignore */ }
  const sdkHttp: any = (operation as any)?.sdkHttpResponse
  if (sdkHttp) {
    let bodyStr = ''
    try {
      const body = sdkHttp.body ?? sdkHttp
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
    } catch { /* ignore */ }
    console.log(`${TAG} operation.sdkHttpResponse=${bodyStr.slice(0, 1500)}`)
  } else {
    console.log(`${TAG} operation.sdkHttpResponse=null (not populated by SDK)`)
  }

  // Download the file. Generative-language file URIs require the API key
  // appended as a query parameter (not a Bearer header).
  const apiKey = process.env.GOOGLE_AI_API_KEY!
  const sep = video.uri.includes('?') ? '&' : '?'
  const dlUrl = `${video.uri}${sep}key=${apiKey}`

  const dlRes = await fetch(dlUrl)
  if (!dlRes.ok) {
    throw new Error(`Failed to download Veo video: ${dlRes.status} ${dlRes.statusText}`)
  }
  const buffer    = Buffer.from(await dlRes.arrayBuffer())
  const mediaType = dlRes.headers.get('content-type') ?? video.mimeType ?? 'video/mp4'

  // Cost: video_pricing.rates[resolution] × billed seconds.
  const cost = calcVideoCost(model, resolution, billedSeconds)

  if (onProgress) onProgress(100)
  console.log(`${TAG} video ok bytes=${buffer.length} duration=${billedSeconds}s cost=$${cost.toFixed(4)}`)

  return {
    buffer,
    mediaType,
    durationSeconds: billedSeconds,
    cost,
    usageMetadata:   meta && Object.keys(meta).length > 0 ? meta : null,
    // Handle for future extension calls — valid on Google's side ~2 days.
    providerVideoRef: video.uri ?? null,
  }
}


// ── Gemini Omni Flash (Interactions API) ────────────────────────────────────
async function generateOmniVideo(
  model:       ModelInfo,
  prompt:      string,
  aspectRatio: string,
  seconds:     number,
  attachments: Attachment[],
  onProgress?: (pct: number) => void,
  options?:    { mode?: string | null },
): Promise<VideoResult> {
  const TAG = `[google/${model.model_name}]`
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const videoAtts = attachments.filter(a => a.mediaType.startsWith('video/'))
  const isEdit    = videoAtts.length > 0

  // Task selection: a video input forces 'edit'; otherwise explicit sub-mode
  // wins and we fall back to inferring from the attachments.
  const task =
    isEdit                               ? 'edit' :
    options?.mode === 'reference_frames' ? 'reference_to_video' :
    options?.mode === 'image_to_video'   ? 'image_to_video' :
    options?.mode === 'text_to_video'    ? 'text_to_video' :
    imageAtts.length >= 2 ? 'reference_to_video' :
    imageAtts.length === 1 ? 'image_to_video' : 'text_to_video'

  // A video input has to go through the Files API, then rides as a `video`
  // part pointing at the returned uri. Live-probed July 25: a `document` part
  // is rejected with "Exactly one input video is required for edit task", and
  // `file_uri` is not a recognised key — it must be `{ type:'video', uri }`.
  // Inline `{ type:'video', data, mime_type }` also works but Google
  // discourages base64 for clips. (ai.google.dev/gemini-api/docs/omni)
  //
  // Caveat worth knowing when this errors: editing an UPLOADED video is not
  // available to users in the EEA, Switzerland or the UK. Google enforces that
  // server-side, so it surfaces as a provider error rather than something we
  // can pre-empt. Editing a model-GENERATED video still works in those regions.
  let videoUri: string | null = null
  if (isEdit) {
    const v = videoAtts[0]
    console.log(`${TAG} uploading video to Files API (${v.buffer.length}b ${v.mediaType})`)
    const uploaded: any = await withRetry(() => (ai() as any).files.upload({
      file:   new Blob([new Uint8Array(v.buffer)], { type: v.mediaType }),
      config: { mimeType: v.mediaType },
    }), 'omni files.upload')
    videoUri = uploaded?.uri ?? null
    if (!videoUri) throw new Error('Files API upload returned no uri for the video attachment')
    // The file must reach ACTIVE before the model can read it — same poll the
    // output-download path below uses.
    const fileId = String(uploaded?.name ?? '').match(/files\/(.+)$/)?.[1]
    if (fileId) {
      const key = process.env.GOOGLE_AI_API_KEY!
      for (let i = 0; i < 30; i++) {
        const st: any = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${key}`)
          .then(r => r.json()).catch(() => null)
        if (st?.state === 'ACTIVE') break
        if (st?.state === 'FAILED') throw new Error('Omni could not process the uploaded video')
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    console.log(`${TAG} video uploaded uri=${videoUri}`)
    if (onProgress) onProgress(15)
  }

  // Omni's image_to_video takes EXACTLY one image — live 400, Aug 9:
  // "Image-to-video does not support more than 1 image." But its
  // reference_to_video takes several, and the docs' own idiom anchors a
  // first frame among the references (owner's correction, Aug 9 — see
  // ai.google.dev/gemini-api/docs/omni). So a chained scene arriving as
  // [chain frame, ...product refs] UPGRADES to reference_to_video with
  // every image kept, and the prompt pins image 1 as the opening state.
  // Nothing is dropped.
  let effTask = task
  let effPrompt = prompt
  if (task === 'image_to_video' && imageAtts.length > 1) {
    console.warn(`${TAG} image_to_video takes 1 image; ${imageAtts.length} attached — upgrading to reference_to_video, all images kept`)
    effTask = 'reference_to_video'
    effPrompt = 'Open the video exactly on the state shown in the FIRST input image — it is the previous shot\'s final frame. Use the remaining input images as subject references whose appearance must be preserved.\n'
      + prompt
  }

  const input: any = (imageAtts.length === 0 && !isEdit) ? prompt : [
    ...(videoUri ? [{ type: 'video', uri: videoUri }] : []),
    ...imageAtts.map(a => ({ type: 'image', data: a.buffer.toString('base64'), mime_type: a.mediaType })),
    { type: 'text', text: effPrompt },
  ]

  // Duration is a "Ns" string, clamped to the API's 3-10s window.
  const duration = `${Math.max(3, Math.min(10, Math.round(seconds || 8)))}s`
  console.log(`${TAG} interactions.create task=${effTask} aspect=${aspectRatio} dur=${duration} images=${imageAtts.length} videos=${videoAtts.length}`)
  if (onProgress) onProgress(5)

  const interaction: any = await withRetry(() => (ai() as any).interactions.create({
    model: model.model_name,
    input,
    generation_config: {
      video_config: { task: effTask },
    },
    // aspect_ratio moved INTO response_format: the July 19 placement at
    // generation_config level now 400s with "Unknown parameter
    // 'aspect_ratio'" (owner's run, Aug 21), and the current SDK types
    // (VideoResponseFormat: { type:'video', aspect_ratio?, duration? })
    // put it beside duration. Omit for the 16:9 default; the catalog's
    // output_config gates what the UI can pick for this model.
    // Duration lives in response_format (verified live July 20: 3s-10s).
    // 'resolution' is rejected by flash-preview - 720p only, don't send it.
    // The edit task rejects duration outright ("Duration cannot be set in
    // response format for edit task", live-probed July 25) — an edit keeps
    // the input clip's geometry, so aspect_ratio stays out of edit too.
    response_format: isEdit
      ? { type: 'video' }
      : { type: 'video', duration, ...(aspectRatio && aspectRatio !== '16:9' ? { aspect_ratio: aspectRatio } : {}) },
  }), 'omni interactions.create')

  if (onProgress) onProgress(70)
  console.log(`${TAG} interaction id=${interaction?.id} status=${interaction?.status}`)

  // Locate the video part: SDK convenience wrapper first, then steps[].
  let videoPart: any = interaction?.output_video ?? null
  if (!videoPart) {
    for (const step of interaction?.steps ?? []) {
      if (step?.type !== 'model_output') continue
      videoPart = (step.content ?? []).find((c: any) => c?.type === 'video') ?? videoPart
    }
  }
  if (!videoPart) {
    throw new Error(`Omni returned no video (status=${interaction?.status ?? 'unknown'}). Try again or rephrase the prompt.`)
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY!
  let buffer: Buffer
  if (videoPart.data) {
    buffer = Buffer.from(videoPart.data, 'base64')
  } else if (videoPart.uri) {
    // Poll the file until ACTIVE, then download with the key appended.
    const fileId = String(videoPart.uri).match(/files\/([^:?]+)/)?.[1]
    if (fileId) {
      for (let i = 0; i < 30; i++) {
        const st: any = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`).then(r => r.json()).catch(() => null)
        if (st?.state === 'ACTIVE') break
        if (st?.state === 'FAILED') throw new Error('Omni video file processing failed')
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    const sep = String(videoPart.uri).includes('?') ? '&' : '?'
    const dl = await fetch(`${videoPart.uri}${sep}key=${apiKey}`)
    if (!dl.ok) throw new Error(`Failed to download Omni video: ${dl.status}`)
    buffer = Buffer.from(await dl.arrayBuffer())
  } else {
    throw new Error('Omni video part had neither data nor uri')
  }

  // Cost: prefer usage tokens (5,792 output tokens ≈ 1s of 720p video ≈
  // $0.10/s effective). Fall back to an 8s assumption.
  const usage: any = interaction?.usage ?? interaction?.usage_metadata ?? null
  // Prefer the video-modality token count (verified shape July 19:
  // usage.output_tokens_by_modality[{modality:'video',tokens:57920}] for
  // a 10s clip — exactly 5,792 tokens/s).
  const videoTokens = (usage?.output_tokens_by_modality ?? []).find((m: any) => m?.modality === 'video')?.tokens ?? null
  const outTokens = videoTokens ?? usage?.total_output_tokens ?? usage?.output_tokens ?? null
  const secondsOut = outTokens ? outTokens / 5792 : 8
  const rate = (model.model_pricing as any)?.per_video_second?.['720p'] ?? 0.10
  // Output tokens cover the generated clip. Google publishes no input-video
  // price for Omni Flash, so an edit's input is currently uncosted rather than
  // guessed — revisit if they publish one. Measured July 25 on a 4s 720p edit:
  // 22,080 input video tokens vs 23,168 output, i.e. input is roughly the same
  // order as output, so an edit's true cost is close to 2x what we report.
  // (Runway resells Omni v2v at roughly $0.11/s of input, for reference.)
  const cost = rate * secondsOut
  try { console.log(`${TAG} usage=${JSON.stringify(usage).slice(0, 300)} → ${secondsOut.toFixed(1)}s $${cost.toFixed(3)}`) } catch { /* ignore */ }

  if (onProgress) onProgress(100)
  console.log(`${TAG} omni video ok bytes=${buffer.length} task=${task}`)
  return { buffer, mediaType: videoPart.mime_type ?? 'video/mp4', durationSeconds: Math.round(secondsOut), cost }
}
