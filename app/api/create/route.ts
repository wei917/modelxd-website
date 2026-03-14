// app/api/create/route.ts
// Private studio: user-specified models, saved to creates table

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelById, type ModelInfo } from '@/lib/models'
import { processAttachment }            from '@/lib/attachment'
import * as providers                   from '@/lib/providers'

const LOG = '[create]'

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function runSlot(
  index:      number,
  model:      ModelInfo,
  mode:       string,
  prompt:     string,
  attachment: providers.Attachment | null,
  sessionId:  string,
  controller: ReadableStreamDefaultController
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name}`)

  try {
    if (mode === 'text') {
      let fullText = ''
      let result: any = null

      await providers.streamText(
        model,
        [{ role: 'user', content: prompt }],
        {
          onDelta: (text) => {
            fullText += text
            controller.enqueue(sse(`delta:${index}`, { index, text }))
          },
          onDone:  (r) => { result = r },
          onError: (msg) => { throw new Error(msg) },
        },
        attachment
      )

      const responseTime = Date.now() - start
      controller.enqueue(sse(`done:${index}`, { index, responseTime, cost: result?.cost ?? 0 }))
      return { text: fullText, isImage: false, isVideo: false, responseTime, cost: result?.cost ?? 0 }

    } else if (mode === 'image') {
      controller.enqueue(sse(`delta:${index}`, { index, isImage: true, generating: true }))

      const result = await providers.generateImage(model, prompt, 'medium', '1024x1024', attachment)

      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'png'
      const path = `${sessionId}_slot${index}.${ext}`

      // create-ai-images is private, use signed URL
      const { error } = await sb.storage.from('create-ai-images').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const { data: signed, error: signErr } = await sb.storage.from('create-ai-images').createSignedUrl(path, 60 * 60 * 24)
      if (signErr || !signed) throw new Error('Failed to create signed URL')

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: signed.signedUrl, isImage: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: signed.signedUrl, isImage: true, isVideo: false, responseTime, cost: result.cost }

    } else if (mode === 'video') {
      controller.enqueue(sse(`delta:${index}`, { index, isVideo: true, generating: true }))

      const result = await providers.generateVideo(
        model, prompt, '1280x720', 16, attachment,
        (pct) => controller.enqueue(sse(`progress:${index}`, { index, pct }))
      )

      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${sessionId}_slot${index}.${ext}`

      const { error } = await sb.storage.from('create-ai-videos').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const { data: signed, error: signErr } = await sb.storage.from('create-ai-videos').createSignedUrl(path, 60 * 60 * 24)
      if (signErr || !signed) throw new Error('Failed to create signed URL')

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: signed.signedUrl, isVideo: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: signed.signedUrl, isImage: false, isVideo: true, responseTime, cost: result.cost }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`${LOG} Slot[${index}] failed: ${msg}`)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, mode = 'text', modelIds, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} models=${JSON.stringify(modelIds)}`)

  if (!prompt?.trim() || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })
  if (!Array.isArray(modelIds) || modelIds.length === 0) return Response.json({ error: 'No models specified' }, { status: 400 })

  // Load models by UUID
  const models = (await Promise.all(modelIds.map((id: string) => getModelById(id)))).filter(Boolean) as ModelInfo[]
  if (models.length === 0) return Response.json({ error: 'No valid models found' }, { status: 400 })

  const sessionId = crypto.randomUUID()

  // Process attachment
  let attachment: providers.Attachment | null = null
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath) {
    try {
      const result = await processAttachment(user.id, attachmentInput.bucket, attachmentInput.storagePath, attachmentInput.mediaType, attachmentInput.fileName, attachmentInput.fileSize)
      attachment   = { buffer: result.buffer, mediaType: result.mediaType }
      attachmentId = result.attachmentId
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: models.length, mode, sessionId }))

      const results = await Promise.all(
        models.map((model, i) => runSlot(i, model, mode, prompt, attachment, sessionId, controller))
      )

      // Save to creates table (without chosen_model_id yet — set when user picks)
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const slots = models.map((m, i) => ({
        model_id:   m.id,
        provider:   m.provider,
        model_name: m.model_name,
        name:       m.name,
        text:       results[i]?.text ?? null,
        isImage:    results[i]?.isImage ?? false,
        isVideo:    results[i]?.isVideo ?? false,
        cost:       results[i]?.cost ?? 0,
        responseTime: results[i]?.responseTime ?? 0,
      }))

      const { data: row } = await sb.from('creates').insert({
        user_id: user.id, mode, prompt,
        slots, attachment_id: attachmentId,
      }).select('id').single()

      controller.enqueue(sse('end', { sessionId, createId: row?.id ?? null }))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
