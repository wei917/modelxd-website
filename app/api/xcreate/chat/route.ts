// app/api/xcreate/chat/route.ts
// Continue conversation with chosen model after picking.
// mode=text  → SSE stream of text deltas
// mode=image → generates a new image, returns SSE with image data URL
// mode=video → generates a new video, returns SSE with video URL

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelById } from '@/lib/models'
import * as providers   from '@/lib/providers'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'

const LOG = '[xcreate/chat]'

/**
 * Debit `cost` from the user's balance for one chat-continuation turn.
 * Same rounding rule as the initial /api/xcreate route (cents = round($)).
 * Fire-and-forget — never blocks the SSE response, but logs failures.
 */
function debitChatTurn(opts: {
  userId:   string
  cost:     number
  modelId:  string | null | undefined
  modelName: string
  mode:     'text' | 'image' | 'video'
  refId?:    string | null
}): void {
  const cents = Math.round(opts.cost * 100)
  if (cents <= 0) return
  debitCredits({
    userId:        opts.userId,
    amountCents:   cents,
    referenceType: 'xcreate_chat',
    referenceId:   opts.refId ?? opts.modelId ?? opts.modelName,
    description:   `XCreate chat ${opts.mode} continuation (${opts.modelName})`,
    metadata:      { mode: opts.mode, modelName: opts.modelName },
  })
    .then(newBalance => console.log(`${LOG} Debited ${cents}¢ for ${opts.mode} chat turn (${opts.modelName}); new balance: ${newBalance}¢`))
    .catch(err => {
      if (err instanceof InsufficientCreditsError) {
        console.warn(`${LOG} insufficient credits for ${opts.mode} chat turn (${opts.modelName}, ${cents}¢)`)
      } else {
        console.warn(`${LOG} debit failed for ${opts.mode} chat turn:`, err)
      }
    })
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { modelId, messages, mode, attachment, previousResponseId, conversationHistory: clientConvHistory, xcreateId } = await req.json()
  if (!modelId || !messages?.length) return Response.json({ error: 'Missing params' }, { status: 400 })

  const model = await getModelById(modelId)
  if (!model) return Response.json({ error: 'Model not found' }, { status: 404 })

  // The latest user message is the new prompt
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user')
  const prompt = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''

  // Find the most recent assistant image (for image-mode continuations).
  // The client stores assistant images as { role:'assistant', content:<url>, isImage:true }
  // where <url> is either a data URL (fresh generation) or a Supabase signed URL
  // (loaded from gallery). We treat follow-up prompts as edits of that prior image
  // so the model keeps generating images instead of drifting to text replies.
  const lastAssistantImage = [...messages]
    .reverse()
    .find((m: any) => m.role === 'assistant' && m.isImage && typeof m.content === 'string')

  // Parse a Supabase signed URL into { bucket, path }
  function parseSignedUrl(url: string): { bucket: string; path: string } | null {
    try {
      const u = new URL(url)
      const m = u.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
      if (!m) return null
      return { bucket: m[1], path: decodeURIComponent(m[2]) }
    } catch { return null }
  }

  // Load an assistant-image url (data URL or signed URL) into a buffer+mediaType
  async function loadAssistantImage(url: string): Promise<{ buffer: Buffer; mediaType: string } | null> {
    try {
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.*)$/)
        if (!match) return null
        return { mediaType: match[1], buffer: Buffer.from(match[2], 'base64') }
      }
      const parsed = parseSignedUrl(url)
      if (parsed) {
        const { createClient } = await import('@supabase/supabase-js')
        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SECRET_KEY!,
          { auth: { persistSession: false } },
        )
        const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.path)
        if (error || !data) return null
        const buffer = Buffer.from(await data.arrayBuffer())
        // Infer media type from extension
        const ext = parsed.path.split('.').pop()?.toLowerCase() ?? 'png'
        const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : ext === 'gif' ? 'image/gif'
          : 'image/png'
        return { buffer, mediaType }
      }
      // Plain https — fetch directly
      const res = await fetch(url)
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      const mediaType = res.headers.get('content-type') ?? 'image/png'
      return { buffer: Buffer.from(ab), mediaType }
    } catch {
      return null
    }
  }

  // ── Image mode ──────────────────────────────────────────────────────────────
  if (mode === 'image') {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // For OpenAI models with previous_response_id, we don't need to
          // re-upload the image — the API handles multi-turn natively.
          const isOpenAI = model.provider === 'openai'
          const isGoogle = model.provider === 'google'

          // Priority: explicit user attachments > previous assistant image > none
          // (skip for OpenAI with previousResponseId — the API handles context)
          const resolvedAttachments: { buffer: Buffer; mediaType: string }[] = []
          if (attachment?.storagePath) {
            const { fetchAttachmentBuffer } = await import('@/lib/attachment')
            const att = await fetchAttachmentBuffer(attachment)
            resolvedAttachments.push(att)
          } else if (!isOpenAI || !previousResponseId) {
            // Only load previous image for non-OpenAI providers or first turn
            if (lastAssistantImage?.content && !isGoogle) {
              const loaded = await loadAssistantImage(lastAssistantImage.content)
              if (loaded) resolvedAttachments.push(loaded)
            }
          }

          // When continuing from a prior image without native multi-turn,
          // nudge the model toward image output by framing as an edit.
          const hasNativeMultiTurn = (isOpenAI && previousResponseId) || (isGoogle && clientConvHistory)
          const effectivePrompt = !hasNativeMultiTurn && resolvedAttachments.length > 0 && lastAssistantImage && !attachment?.storagePath
            ? `Edit the provided image based on this instruction: ${prompt}`
            : prompt

          const result = await providers.generateImage(
            model, effectivePrompt,
            attachment?.quality ?? 'medium',
            attachment?.size ?? '1024x1024',
            resolvedAttachments,
            previousResponseId ?? null,         // OpenAI multi-turn
            clientConvHistory ?? null,           // Google multi-turn
            { userId: user.id },
          )

          const b64 = result.buffer.toString('base64')
          const dataUrl = `data:${result.mediaType};base64,${b64}`
          debitChatTurn({ userId: user.id, cost: result.cost ?? 0, modelId: model.id, modelName: model.model_name, mode: 'image', refId: xcreateId })
          controller.enqueue(sse('image', {
            url: dataUrl,
            cost: result.cost,
            responseId: result.responseId ?? null,
            conversationHistory: result.conversationHistory ?? null,
          }))
        } catch (err) {
          controller.enqueue(sse('error', { message: err instanceof Error ? err.message : String(err) }))
        } finally {
          controller.close()
        }
      }
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    })
  }

  // ── Video mode ──────────────────────────────────────────────────────────────
  if (mode === 'video') {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const videoAttachments: providers.Attachment[] = []
          if (attachment?.storagePath) {
            const { fetchAttachmentBuffer } = await import('@/lib/attachment')
            const buf = await fetchAttachmentBuffer(attachment)
            const att: providers.Attachment = { buffer: buf.buffer, mediaType: buf.mediaType }
            // Sign a HTTP(S) URL for image attachments (Alibaba I2V needs it).
            if (buf.mediaType.startsWith('image/') && attachment.bucket && attachment.storagePath) {
              try {
                const { createClient: cc } = await import('@supabase/supabase-js')
                const sbSign = cc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
                const { data: signed } = await sbSign.storage.from(attachment.bucket).createSignedUrl(attachment.storagePath, 60 * 60)
                if (signed?.signedUrl) att.url = signed.signedUrl
              } catch { /* fall back to base64 */ }
            }
            videoAttachments.push(att)
          }

          const result = await providers.generateVideo(
            model, prompt,
            attachment?.aspectRatio ?? '16:9',
            attachment?.durationSeconds ?? 8,
            videoAttachments,
            (pct) => controller.enqueue(sse('progress', { pct })),
            { userId: user.id },
          )

          // Upload video to Supabase storage and return a public URL
          const fileName = `chat-video-${Date.now()}.mp4`
          const { createSupabaseServer: sb } = await import('@/lib/supabase-server')
          const supabaseStorage = await sb()
          await supabaseStorage.storage.from('generations').upload(
            `${user.id}/${fileName}`, result.buffer, { contentType: 'video/mp4', upsert: true }
          )
          const { data: urlData } = supabaseStorage.storage.from('generations').getPublicUrl(`${user.id}/${fileName}`)
          const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/generations/${user.id}/${fileName}`

          providers.logMediaUrl(result.requestId, {
            provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
            mode: 'video', user_id: user.id,
          }, `generations/${user.id}/${fileName}`)

          debitChatTurn({ userId: user.id, cost: result.cost ?? 0, modelId: model.id, modelName: model.model_name, mode: 'video', refId: xcreateId })
          controller.enqueue(sse('video', { url: publicUrl, cost: result.cost }))
        } catch (err) {
          controller.enqueue(sse('error', { message: err instanceof Error ? err.message : String(err) }))
        } finally {
          controller.close()
        }
      }
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    })
  }

  // ── Text mode (default) ─────────────────────────────────────────────────────
  const chatMessages = messages
    .filter((m: any) => !m.isImage && !m.isVideo)
    .map((m: any) => ({ role: m.role, content: m.content }))

  const stream = new ReadableStream({
    async start(controller) {
      await providers.streamText(
        model,
        chatMessages,
        {
          onDelta: (text) => controller.enqueue(sse('delta', { text })),
          onDone:  (r)    => {
            debitChatTurn({ userId: user.id, cost: r.cost ?? 0, modelId: model.id, modelName: model.model_name, mode: 'text', refId: xcreateId })
            controller.enqueue(sse('done', { cost: r.cost, inputTokens: r.inputTokens, outputTokens: r.outputTokens }))
            controller.close()
          },
          onError: (msg)  => {
            controller.enqueue(sse('error', { message: msg }))
            controller.close()
          },
        },
        [],
        { userId: user.id },
      )
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
