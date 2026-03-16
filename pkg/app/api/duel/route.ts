// app/api/duel/route.ts
// XDuel: randomly pick N models, run in parallel, stream results via SSE

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelsByMode, type ModelInfo } from '@/lib/models'
import { processAttachment }              from '@/lib/attachment'
import * as providers                     from '@/lib/providers'

const LOG = '[duel]'

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

async function runSlot(
  index:      number,
  model:      ModelInfo,
  mode:       string,
  prompt:     string,
  attachment: providers.Attachment | null,
  duelId:     string,
  controller: ReadableStreamDefaultController
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} mode=${mode}`)

  try {
    if (mode === 'text') {
      let fullText = ''
      let doneResult: { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number } = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }

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
        attachment
      )

      const responseTime = Date.now() - start
      controller.enqueue(sse(`done:${index}`, {
        index,
        responseTime,
        cost:         doneResult.cost,
        inputTokens:  doneResult.inputTokens,
        outputTokens: doneResult.outputTokens,
      }))
      return { text: fullText, isImage: false, isVideo: false, responseTime, cost: doneResult.cost }

    } else if (mode === 'image') {
      controller.enqueue(sse(`delta:${index}`, { index, isImage: true, generating: true }))

      const result = await providers.generateImage(model, prompt, 'medium', '1024x1024', attachment)

      // Upload to Supabase
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'png'
      const path = `${duelId}_slot${index}.${ext}`
      const { error } = await sb.storage.from('xduel-ai-images').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const { data: { publicUrl } } = sb.storage.from('xduel-ai-images').getPublicUrl(path)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isImage: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: true, isVideo: false, responseTime, cost: result.cost }

    } else if (mode === 'video') {
      controller.enqueue(sse(`delta:${index}`, { index, isVideo: true, generating: true }))

      const result = await providers.generateVideo(
        model, prompt, '1280x720', 16, attachment,
        (pct) => controller.enqueue(sse(`progress:${index}`, { index, pct }))
      )

      // Upload to Supabase
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_slot${index}.${ext}`
      const { error } = await sb.storage.from('xduel-ai-videos').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const { data: { publicUrl } } = sb.storage.from('xduel-ai-videos').getPublicUrl(path)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isVideo: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: false, isVideo: true, responseTime, cost: result.cost }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} failed: ${msg}`)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, mode = 'text', count = 2, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} count=${count}`)

  if (!prompt?.trim() || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })

  const n = Math.min(Math.max(count, 2), 4)

  // Load + pick models
  let pool: ModelInfo[]
  try { pool = await getModelsByMode(mode) }
  catch (err) { return Response.json({ error: String(err) }, { status: 400 }) }
  if (pool.length < 2) return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })

  const models = shuffle(pool).slice(0, n)
  const duelId = crypto.randomUUID()

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
      controller.enqueue(sse('meta', { count: n, mode, duelId, models: models.map(m => ({ id: m.id, provider: m.provider, model_name: m.model_name, name: m.name })) }))

      const results = await Promise.all(
        models.map((model, i) => runSlot(i, model, mode, prompt, attachment, duelId, controller))
      )

      // Save to DB
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

      await sb.from('duels').insert({
        id: duelId, user_id: user.id, mode, prompt,
        slots, attachment_id: attachmentId,
      })

      controller.enqueue(sse('end', { duelId }))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
