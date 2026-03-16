// app/api/create/chat/route.ts
// Continue conversation with chosen model after picking.
// mode=text  → SSE stream of text deltas
// mode=image → generates a new image, returns SSE with image data URL
// mode=video → generates a new video, returns SSE with video URL

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelById } from '@/lib/models'
import * as providers   from '@/lib/providers'

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = createSupabaseServer()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { modelId, messages, mode, attachment } = await req.json()
  if (!modelId || !messages?.length) return Response.json({ error: 'Missing params' }, { status: 400 })

  const model = await getModelById(modelId)
  if (!model) return Response.json({ error: 'Model not found' }, { status: 404 })

  // The latest user message is the new prompt
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user')
  const prompt = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''

  // ── Image mode ──────────────────────────────────────────────────────────────
  if (mode === 'image') {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Resolve attachment if provided
          let resolvedAttachment = null
          if (attachment?.storagePath) {
            const { fetchAttachment } = await import('@/lib/attachment')
            resolvedAttachment = await fetchAttachment(attachment)
          }

          const result = await providers.generateImage(
            model, prompt,
            attachment?.quality ?? 'medium',
            attachment?.size ?? '1024x1024',
            resolvedAttachment
          )

          const b64 = result.buffer.toString('base64')
          const dataUrl = `data:${result.mediaType};base64,${b64}`
          controller.enqueue(sse('image', { url: dataUrl, cost: result.cost }))
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
          let resolvedAttachment = null
          if (attachment?.storagePath) {
            const { fetchAttachment } = await import('@/lib/attachment')
            resolvedAttachment = await fetchAttachment(attachment)
          }

          const result = await providers.generateVideo(
            model, prompt,
            attachment?.aspectRatio ?? '16:9',
            attachment?.durationSeconds ?? 8,
            resolvedAttachment,
            (pct) => controller.enqueue(sse('progress', { pct }))
          )

          // Upload video to Supabase storage and return a public URL
          const fileName = `chat-video-${Date.now()}.mp4`
          const { createSupabaseServer: sb } = await import('@/lib/supabase-server')
          const supabaseStorage = sb()
          await supabaseStorage.storage.from('generations').upload(
            `${user.id}/${fileName}`, result.buffer, { contentType: 'video/mp4', upsert: true }
          )
          const { data: { publicUrl } } = supabaseStorage.storage.from('generations').getPublicUrl(`${user.id}/${fileName}`)
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
            controller.enqueue(sse('done', { cost: r.cost, inputTokens: r.inputTokens, outputTokens: r.outputTokens }))
            controller.close()
          },
          onError: (msg)  => {
            controller.enqueue(sse('error', { message: msg }))
            controller.close()
          },
        }
      )
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
