// app/api/xduel/route.ts
// XDuel: randomly pick N models, run in parallel, stream results via SSE

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelsByMode, type ModelInfo } from '@/lib/models'
import { processAttachment }              from '@/lib/attachment'
import { sanitizeProviderError, ACCOUNT_LIMIT } from '@/lib/provider-errors'
import * as providers                     from '@/lib/providers'
import { modePriceLabel }                 from '@/lib/providers/pricing'

const LOG = '[duel]'

// ── search is deliberately absent here ──────────────────────────────────────
//
// XDuel had a match-level web-search toggle for about an hour. It came out
// again, and not because of the raw cost — that was already solved by
// charging it to credits. It came out because XDuel is the free front door.
// A search duel measured $0.6405 against a $0.0039 median for a normal text
// duel (164x), so it can never be part of the free quota, and a control that
// answers "not enough credits" to most first-time visitors is a bad first
// impression on the one surface that has to make a good one.
//
// Search lives in XCreate and XTalk, where the user is already paying and
// chose the models on purpose. duels.search and the text_search rating pool
// (supabase/61, 62) stay in place: the column is still correct for the rows
// that have it, and re-adding the toggle is a small change if this is ever
// reconsidered. (CC, Aug 2)

// Models that REQUIRE an attachment to function.
// input_modalities only lists 'image'/'video'/'audio' when REQUIRED (not optional).
// Text-output vision models and pure text-to-image models have input_modalities: ['text'].
function requiresAttachment(m: ModelInfo): boolean {
  // A model can run without an attachment iff one of its declared `modes`
  // is a text-only entry (`text_to_text`, `text_to_image`, `text_to_video`).
  // input_modalities alone is too permissive — a Reference-to-Video model
  // declares both text and image as inputs, but it actually *requires* the
  // image to run; "text" just means it also takes a text prompt.
  const modes = m.modes ?? []
  if (modes.length > 0) {
    return !modes.some(mode => mode.startsWith('text_to_'))
  }
  // Legacy fallback for rows without `modes` declared. A pure text-only
  // model (input_modalities = ['text']) works without an attachment.
  // Anything else, conservatively assume it needs one — this keeps the
  // duel pool clean even if the catalog row is incomplete.
  const inputs = m.input_modalities ?? []
  if (inputs.length === 1 && inputs[0] === 'text') return false
  return inputs.includes('image') || inputs.includes('video') || inputs.includes('audio')
}

// requiresAttachment() answers "does this model need SOMETHING?" but never
// "can it read THIS?". That gap meant a video upload still matched every
// image_to_video model in the pool (Runway Gen-4 Turbo, Grok Imagine Video
// 1.5, HappyHorse 1.0 I2V), which then failed at the provider with a type
// error the user never asked for. Match the upload to what a model actually
// consumes instead. (CC, July 25)
type AttachmentKind = 'image' | 'video' | 'document'

function attachmentKind(mediaType: string): AttachmentKind {
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('image/')) return 'image'
  return 'document'
}

// Which declared modes actually CONSUME each kind of upload:
//   image → image_to_*, image_edit, reference_frames, start_end_frames
//   video → video_to_*, video_edit
//   doc   → pdf_to_*
const CONSUMES: Record<AttachmentKind, (mode: string) => boolean> = {
  image:    mode => mode.startsWith('image_') || mode === 'reference_frames' || mode === 'start_end_frames',
  video:    mode => mode.startsWith('video_'),
  document: mode => mode.startsWith('pdf_'),
}

function acceptsAttachment(m: ModelInfo, kind: AttachmentKind): boolean {
  const modes = m.modes ?? []
  if (modes.length > 0) return modes.some(CONSUMES[kind])
  // Legacy rows with no declared modes: fall back to the coarse list.
  const inputs = m.input_modalities ?? []
  return kind === 'document' ? inputs.includes('text') : inputs.includes(kind)
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Run one slot ──────────────────────────────────────────────────────────────

type SlotOutput = {
  text: string; isImage: boolean; isVideo: boolean
  responseTime: number; cost: number; searches: number
}
type SlotFailure = { failed: true; message: string; ref: string | null }

async function runSlot(
  index:       number,
  model:       ModelInfo,
  mode:        string,
  prompt:      string,
  attachments: providers.Attachment[],
  duelId:      string,
  controller:  ReadableStreamDefaultController,
  userId:      string,
): Promise<SlotOutput | SlotFailure> {
  const callContext: providers.CallContext = { userId }
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} mode=${mode}`)

  try {
    if (mode === 'text') {
      let fullText = ''
      let doneResult: { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; searchCount?: number } = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }

      await providers.streamText(
        model,
        [{ role: 'user', content: prompt }],
        {
          onDelta: (text) => {
            fullText += text
            controller.enqueue(sse(`delta:${index}`, { index, text }))
          },
          onDone: (r) => { doneResult = r },
          onError: (msg) => { throw new Error(msg) },
        },
        attachments,
        callContext,
      )

      const responseTime = Date.now() - start
      const searches = doneResult.searchCount ?? 0
      console.log(`${LOG} Slot[${index}] text done in ${responseTime}ms cost=${doneResult.cost} searches=${searches}`)
      controller.enqueue(sse(`done:${index}`, {
        index,
        responseTime,
        cost:         doneResult.cost,
        inputTokens:  doneResult.inputTokens,
        outputTokens: doneResult.outputTokens,
        searches,
      }))
      return { text: fullText, isImage: false, isVideo: false, responseTime, cost: doneResult.cost, searches }

    } else if (mode === 'image') {
      controller.enqueue(sse(`delta:${index}`, { index, isImage: true, generating: true }))

      const result = await providers.generateImage(model, prompt, 'medium', '1024x1024', attachments, null, null, callContext)

      // Upload to Supabase. Wrap in retry with backoff — undici's `fetch
      // failed` (DNS / connection drops on the dev machine, brief Supabase
      // hiccups) is the most common reason an otherwise-good image dies on
      // the home stretch. Three attempts at 0.5s / 1s / 2s eats almost no
      // time on success and recovers the case we just hit during testing.
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const rawExt = result.mediaType.split('/')[1] ?? 'png'
      const ext    = rawExt === 'jpeg' ? 'jpg' : rawExt
      const path = `${duelId}_slot${index}.${ext}`

      const attempts = 3
      let lastErr: any = null
      let succeeded = false
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const { error } = await sb.storage.from('xduel-ai-images').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
          if (error) {
            lastErr = error
            console.warn(`${LOG} Slot[${index}] IMAGE UPLOAD attempt ${attempt}/${attempts} returned error: ${error.message}`)
          } else {
            succeeded = true
            break
          }
        } catch (uploadEx: any) {
          lastErr = uploadEx
          console.warn(`${LOG} Slot[${index}] IMAGE UPLOAD attempt ${attempt}/${attempts} threw: ${uploadEx?.message ?? uploadEx} cause=${uploadEx?.cause?.message ?? ''}`)
        }
        if (attempt < attempts) {
          const backoff = 500 * Math.pow(2, attempt - 1) // 500ms, 1s, 2s
          await new Promise(r => setTimeout(r, backoff))
        }
      }
      if (!succeeded) {
        const detail = lastErr?.message ?? String(lastErr ?? 'unknown')
        const cause  = lastErr?.cause?.message ? ` (cause: ${lastErr.cause.message})` : ''
        throw new Error(`Upload failed after ${attempts} attempts: ${detail}${cause} [path=${path} bytes=${result.buffer.length} mime=${result.mediaType}]`)
      }

      const { data: urlData } = sb.storage.from('xduel-ai-images').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xduel-ai-images/${path}`
      console.log(`${LOG} Slot[${index}] image uploaded, publicUrl=${publicUrl}`)

      providers.logMediaUrl(result.requestId, {
        provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
        mode: 'image', user_id: callContext?.userId ?? null,
      }, `xduel-ai-images/${path}`)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isImage: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: true, isVideo: false, responseTime, cost: result.cost, searches: 0 }

    } else if (mode === 'video') {
      console.log(`${LOG} Slot[${index}] VIDEO START model=${model.provider}/${model.model_name}`)
      controller.enqueue(sse(`delta:${index}`, { index, isVideo: true, generating: true }))

      let result
      try {
        result = await providers.generateVideo(
          model, prompt, '1280x720', 8, attachments,
          (pct) => controller.enqueue(sse(`progress:${index}`, { index, pct })),
          callContext,
          // Default watermark off in duels — we want models judged on their
          // actual output, and a vendor watermark stamped on the video would
          // both leak the model identity (defeating the blind vote) and
          // distract from the comparison. Matches XCreate's default.
          { watermark: false },
        )
      } catch (genErr: any) {
        console.error(`${LOG} Slot[${index}] VIDEO GEN FAILED model=${model.model_name} err=${genErr?.message ?? genErr}`)
        throw new Error(`Video generation failed: ${genErr?.message ?? genErr}`)
      }
      console.log(`${LOG} Slot[${index}] VIDEO GEN OK bytes=${result.buffer.length} mime=${result.mediaType}`)

      // Upload to Supabase
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_slot${index}.${ext}`

      let uploadError: any = null
      try {
        const { error } = await sb.storage.from('xduel-ai-videos').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
        uploadError = error
      } catch (uploadEx: any) {
        // Some upload failures throw instead of returning { error } (e.g.
        // network-level fetch failures from undici).
        console.error(`${LOG} Slot[${index}] VIDEO UPLOAD THREW path=${path} err=${uploadEx?.message ?? uploadEx} cause=${uploadEx?.cause?.message ?? ''}`)
        throw new Error(`Video upload failed (threw): ${uploadEx?.message ?? uploadEx}`)
      }
      if (uploadError) {
        console.error(`${LOG} Slot[${index}] VIDEO UPLOAD ERROR path=${path} err=${uploadError.message}`)
        throw new Error(`Video upload failed: ${uploadError.message}`)
      }

      const { data: urlData } = sb.storage.from('xduel-ai-videos').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xduel-ai-videos/${path}`
      console.log(`${LOG} Slot[${index}] VIDEO UPLOADED publicUrl=${publicUrl}`)

      providers.logMediaUrl(result.requestId, {
        provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
        mode: 'video', user_id: callContext?.userId ?? null,
      }, `xduel-ai-videos/${path}`)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isVideo: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: false, isVideo: true, responseTime, cost: result.cost, searches: 0 }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // provider_calls request id - shown to the user as a report reference
    // and searchable in the provider_calls table for debugging.
    const ref = (err as any)?.requestId ?? null
    console.warn(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} failed (ref=${ref}): ${msg}`)
    // The RAW message goes back to the caller, not to the user: only the
    // caller can tell whether this failure is worth redrawing a different
    // model for, and it is the one that sanitizes and emits `error:` when
    // it decides to give up.
    return { failed: true, message: msg, ref }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verified-user gate: block anyone whose email isn't confirmed.
  // Google OAuth (the only sign-in path today) auto-confirms email at
  // login, so this is effectively a no-op now — but it guards against
  // any future email/password / magic-link flow we add.
  if (!user.email_confirmed_at) {
    return Response.json(
      { error: 'email_not_verified', message: 'Please verify your email before using XDuel.' },
      { status: 403 },
    )
  }


  const { prompt, mode = 'text', count = 2, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} count=${count}`)

  // Same rule as XCreate: an attached file in video/image mode is enough
  // to drive generation, so the prompt-length check is relaxed when an
  // attachment is present.
  const promptTooShort = !prompt?.trim() || prompt.trim().length < 3
  const promptIsOptional = (mode === 'video' || mode === 'image') && !!attachmentInput?.storagePath
  if (promptTooShort && !promptIsOptional) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }
  // Cap prompt size (client enforces maxLength=8000; this is the backstop).
  // Long text belongs in a .txt attachment — folded server-side with a 200k-char guardrail.
  if (typeof prompt === 'string' && prompt.length > 8000) {
    return Response.json({ error: 'Prompt too long (max 8,000 characters) — attach long text as a .txt file instead.' }, { status: 400 })
  }

  // Quota gate — XDuel is free for the user but ModelXD pays the bill,
  // so each mode has its own daily cap (see DUEL_LIMITS).
  // Atomic check-and-increment: if the user is over their cap for this
  // mode, returns -1 and we 429 immediately. On any post-quota failure
  // below we refund the slot so the user isn't penalized.
  if (mode !== 'text' && mode !== 'image' && mode !== 'video') {
    return Response.json({ error: `Invalid mode: ${mode}` }, { status: 400 })
  }
  const { consumeDuelQuota, refundDuelQuota, DUEL_LIMITS } = await import('@/lib/duel-quota')
  // Multi-model duels cost proportionally more (house pays per model):
  // one slot per extra model — 2 models = 1, 3 = 2, 4 = 3 (CC, July 19).
  const n = Math.min(Math.max(count, 2), 4)
  const quotaCost = n - 1
  // Paid duels were tried and removed (CC, July 19) — free quota only.
  // The XCreate studio is the paid path; the 429 message points there.
  const usedAfter = await consumeDuelQuota(user.id, mode as 'text' | 'image' | 'video', quotaCost)
  if (usedAfter < 0) {
    return Response.json(
      {
        error:   'daily_limit_reached',
        mode,
        limit:   DUEL_LIMITS[mode as 'text' | 'image' | 'video'],
        message: `You've used today's free ${mode} XDuel${DUEL_LIMITS[mode as 'text' | 'image' | 'video'] === 1 ? '' : 's'} — resets at UTC midnight. Want to keep creating? Pick your favorite models in XCreate.`,
      },
      { status: 429 },
    )
  }
  const refundQuota = () => refundDuelQuota(user.id, mode as 'text' | 'image' | 'video', quotaCost).catch(() => {})

  // Load + pick models
  let pool: ModelInfo[]
  try { pool = await getModelsByMode(mode) }
  catch (err) { refundQuota(); return Response.json({ error: String(err) }, { status: 400 }) }
  if (pool.length < 2) { refundQuota(); return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 }) }

  // Match the pool to the attachment the user actually sent.
  const hasAttachment = !!attachmentInput?.storagePath
  const attKind = hasAttachment ? attachmentKind(attachmentInput.mediaType ?? '') : null
  if (!hasAttachment) {
    pool = pool.filter(m => !requiresAttachment(m))
  } else {
    pool = pool.filter(m => acceptsAttachment(m, attKind!))
  }
  if (pool.length < 2) {
    refundQuota()
    return Response.json({
      error: attKind
        ? `Not enough ${mode} models accept a ${attKind} attachment. Try a different file, or run without one.`
        : `Not enough models for mode: ${mode}`,
    }, { status: 400 })
  }


  // The draw and its reserve come from ONE shuffle: the first n are the
  // duel, the tail is the (already random) replacement list. A model that
  // turns out to be unusable is swapped for the next one down — the user
  // never chose these, so a redraw is just a different draw, not a
  // substitution. (That is why this belongs here and NOT on XCreate or the
  // API, where the user picked the model and pays its list price.)
  const shuffled = shuffle(pool)
  const models   = shuffled.slice(0, n)
  const reserve  = shuffled.slice(n)
  let reserveAt  = 0
  /** Next reserve model that isn't on the provider that just failed —
   *  replacing Claude with more Claude fails identically. */
  const takeReplacement = (badProvider: string): ModelInfo | null => {
    while (reserveAt < reserve.length) {
      const m = reserve[reserveAt++]
      if (m.provider !== badProvider) return m
    }
    return null
  }
  const duelId = crypto.randomUUID()


  // Process attachment (duel still uses single attachment from client)
  const attachments: providers.Attachment[] = []
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath) {
    try {
      const result = await processAttachment(user.id, attachmentInput.bucket, attachmentInput.storagePath, attachmentInput.mediaType, attachmentInput.fileName, attachmentInput.fileSize)
      const attach: providers.Attachment = { buffer: result.buffer, mediaType: result.mediaType }
      // Providers get the RESIZED copy's signed URL — capped at 1920px
      // server-side, so oversized uploads never hit the model raw.
      if (result.mediaType.startsWith('image/')) {
        attach.url = result.resizedUrl
      }
      attachments.push(attach)
      attachmentId = result.attachmentId
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }
  // Public URL of the input for XVote / replay display (July 19). XDuel
  // user buckets are public (duels are public by design), so this URL is
  // stable — unlike the 1h signed URL above.
  let inputMedia: { url: string; mediaType: string; fileName: string | null } | null = null
  if (attachmentInput?.storagePath) {
    // Public-bucket URL is deterministic — no client/signing needed.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    inputMedia = {
      url:       `${base}/storage/v1/object/public/${attachmentInput.bucket}/${attachmentInput.storagePath}`,
      mediaType: attachmentInput.mediaType,
      fileName:  attachmentInput.fileName ?? null,
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // BLIND MEANS BLIND ON THE WIRE (Aug 29). This used to ship every
      // slot's id, provider, model_name, display_name AND price before a
      // single token had streamed — the UI hid them, DevTools did not, so
      // the "blind" vote in step 2 and the price reveal in step 3 were both
      // sitting in the browser the whole time. Nothing renders them before
      // vote 1 (every price block is gated on showPrices, the names appear
      // only on the reveal card), so nothing needs them here.
      //
      // They arrive in the RESPONSE to the vote-1 POST instead — which makes
      // the guarantee structural rather than cosmetic: identities and prices
      // are unobtainable until a vote is recorded, not merely unrendered.
      controller.enqueue(sse('meta', { count: n, mode, duelId }))

      // One redraw per slot, and ONLY for an account-level failure — our
      // spending cap, a disabled org, a dead key. A safety refusal or an
      // oversized prompt fails on every model alike, so redrawing there
      // would burn a second call and turn "your prompt was refused" into a
      // baffling swap.
      const runWithRedraw = async (i: number, drawn: ModelInfo): Promise<SlotOutput | null> => {
        let current = drawn
        for (let attempt = 0; ; attempt++) {
          const r = await runSlot(i, current, mode, prompt, attachments, duelId, controller, user.id)
          if (!('failed' in r)) return r
          const replacement = attempt === 0 && ACCOUNT_LIMIT.test(r.message)
            ? takeReplacement(current.provider)
            : null
          if (!replacement) {
            controller.enqueue(sse(`error:${i}`, { index: i, message: sanitizeProviderError(r.message), ref: r.ref }))
            return null
          }
          // ATTRIBUTION. `slots`, `slotPrices` and the reveal are all built
          // from `models` AFTER this settles, so this write-back is the one
          // thing keeping the duel row honest: without it the row would
          // carry the drawn model's name over the replacement's output, and
          // the vote would credit a model that never ran.
          current   = replacement
          models[i] = replacement
          console.log(`${LOG} Slot[${i}] redrawn → ${replacement.provider}/${replacement.model_name}`)
          // Reset the slot, and NOTHING else: the replacement's identity and
          // price go the same way as the original's — out with the vote-1
          // response. A redraw must not become the one event that leaks.
          controller.enqueue(sse(`trying:${i}`, { index: i }))
        }
      }

      const results = await Promise.all(models.map((model, i) => runWithRedraw(i, model)))

      // Broken duel = free duel (CC, July 19): if ANY slot failed, the
      // duel can't be voted on fairly (and XVote hides it), so give the
      // user their quota back. The duel row is still saved for the
      // owner's history/debugging.
      const failedSlots = results.filter(r => r === null).length
      if (failedSlots > 0) {
        await refundQuota()
        console.log(`${LOG} ${failedSlots}/${models.length} slots failed — quota refunded (cost ${quotaCost})`)
      }

      // Save to DB
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      // Build price label per model (matches what the SSE meta event sends)
      const slotPrices = models.map(m => {
        const { label, rate } = modePriceLabel(m, mode as 'text'|'image'|'video')
        return { priceLabel: label, outputPrice: rate }
      })

      const slots = models.map((m, i) => ({
        model_id:     m.id,
        provider:     m.provider,
        model_name:   m.model_name,
        name:         m.display_name,
        text:         results[i]?.text ?? null,
        isImage:      results[i]?.isImage ?? false,
        isVideo:      results[i]?.isVideo ?? false,
        cost:         results[i]?.cost ?? 0,
        responseTime: results[i]?.responseTime ?? 0,
        // Per-model tally. Zero WITH search allowed is a real datum — it
        // means the model judged the question didn't need the web — so this
        // is always written, never omitted when it happens to be 0.
        searches:     results[i]?.searches ?? 0,
        priceLabel:   slotPrices[i].priceLabel,
        outputPrice:  slotPrices[i].outputPrice,
      }))

      await sb.from('duels').insert({
        id: duelId, user_id: user.id, mode, prompt,
        slots, attachment_id: attachmentId,
        input_media: inputMedia,
      })

      const duelCostCents = Math.round(slots.reduce((sum, sl) => sum + (sl.cost ?? 0), 0) * 100)

      if (duelCostCents > 0) {
        // Giveaway ledger (July 19): XDuel is house-paid, so record what
        // this duel actually cost us. Fire-and-forget — reporting must
        // never fail a duel.
        sb.rpc('bump_giveaway', { p_kind: `xduel_${mode}`, p_cents: duelCostCents })
          .then(({ error: gErr }) => { if (gErr) console.warn(`${LOG} bump_giveaway failed: ${gErr.message}`) })
      }

      controller.enqueue(sse('end', { duelId, refunded: failedSlots > 0 }))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
