// app/api/create/route.ts
// Like /api/duel but user-specified models, saved to `creates` table (private)

// Node runtime required for Sharp (image resizing)
export const runtime    = 'nodejs'
export const maxDuration = 300

import { streamText, experimental_generateImage as generateImage, experimental_generateVideo as generateVideo } from 'ai'
import { createGateway } from '@ai-sdk/gateway'

type r = Result

type AttachmentInput = { base64: string; mediaType: string } | null

function buildUserContent(prompt: string, attachment: AttachmentInput): any {
  if (!attachment) return prompt
  const { base64, mediaType } = attachment
  const parts: any[] = []
  if (mediaType.startsWith('image/')) {
    parts.push({ type: 'image', image: base64, mimeType: mediaType })
  } else if (mediaType === 'application/pdf') {
    parts.push({ type: 'file', data: base64, mimeType: 'application/pdf' })
  } else if (mediaType === 'text/plain') {
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    return `File content:
${decoded}

${prompt}`
  } else if (mediaType.startsWith('video/')) {
    parts.push({ type: 'file', data: base64, mimeType: mediaType })
  }
  parts.push({ type: 'text', text: prompt })
  return parts
}

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! })

const LOG = '[create]'

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

type Result = { text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null

async function runText(modelId: string, index: number, prompt: string, controller: ReadableStreamDefaultController, duelId: string): Promise<Result> {
  const start = Date.now()
  try {
    const result = streamText({ model: gateway(modelId), messages: [{ role: 'user', content: prompt }], maxOutputTokens: 512 })
    let firstChunk = true, fullText = ''
    for await (const chunk of result.textStream) {
      if (firstChunk) { firstChunk = false }
      fullText += chunk
      controller.enqueue(sse(`delta:${index}`, { index, text: chunk, isImage: false, isVideo: false }))
    }
    const usage = (await result.usage)
    const meta  = await result.providerMetadata
    const cost  = Number((meta?.gateway as any)?.marketCost ?? 0)
    const responseTime = Date.now() - start
    controller.enqueue(sse(`done:${index}`, { index, tokens: usage?.outputTokens ?? 0, responseTime, cost }))
    return { text: fullText, isImage: false, isVideo: false, responseTime, cost }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`${LOG} [${index}] ${modelId} failed: ${msg}`)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

async function runImage(modelId: string, index: number, prompt: string, controller: ReadableStreamDefaultController, duelId: string): Promise<Result> {
  const start = Date.now()
  try {
    const imgOpts: any = { model: gateway.imageModel(modelId), prompt }
    if (attachment?.mediaType.startsWith('image/')) imgOpts.providerOptions = { openai: { image: attachment.buffer.toString('base64') } }
    const result = await generateImage(imgOpts)
    const image  = result.images?.[0]
    if (!image) throw new Error('No image returned')

    const { createClient } = await import('@supabase/supabase-js')
    const sb  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const ext = image.mediaType?.split('/')[1] ?? 'png'
    const path = `${duelId}_model${index}.${ext}`
    const { error } = await sb.storage.from('create-ai-images').upload(path, image.uint8Array, { contentType: image.mediaType ?? 'image/png', upsert: false })
    if (error) throw new Error(`Upload failed: ${error.message}`)

    const { data: { publicUrl } } = sb.storage.from('create-ai-images').getPublicUrl(path)
    const meta = result.providerMetadata
    const cost = Number((meta?.gateway as any)?.marketCost ?? 0)
    const responseTime = Date.now() - start
    controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isImage: true, isVideo: false }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return { text: publicUrl, isImage: true, isVideo: false, responseTime, cost }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

async function runVideo(modelId: string, index: number, prompt: string, controller: ReadableStreamDefaultController, duelId: string): Promise<Result> {
  const start = Date.now()
  try {
    const vidOpts: any = { model: gateway.videoModel(modelId), prompt }
    if (attachment?.mediaType.startsWith('image/')) vidOpts.providerOptions = { openai: { image: attachment.buffer.toString('base64') } }
    const result = await generateVideo(vidOpts)
    const video  = result.videos?.[0]
    if (!video) throw new Error('No video returned')

    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const bucket = 'create-ai-videos'

    let publicUrl: string
    if (video.uint8Array) {
      const mediaType = (video as any).mediaType ?? 'video/mp4'
      const ext  = mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const { error } = await sb.storage.from(bucket).upload(path, video.uint8Array, { contentType: mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      publicUrl = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl
    } else {
      const providerUrl = (video as any).url
      const fetchRes  = await fetch(providerUrl)
      if (!fetchRes.ok) throw new Error(`Fetch failed: ${fetchRes.status}`)
      const contentType = fetchRes.headers.get('content-type') ?? 'video/mp4'
      const ext  = contentType.split('/')[1]?.split(';')[0] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const bytes = new Uint8Array(await fetchRes.arrayBuffer())
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      publicUrl = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl
    }

    const meta = result.providerMetadata
    const cost = Number((meta?.gateway as any)?.marketCost ?? 0)
    const responseTime = Date.now() - start
    controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isImage: false, isVideo: true }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return { text: publicUrl, isImage: false, isVideo: true, responseTime, cost }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

export async function POST(req: Request) {
  const { prompt, mode = 'text', models: modelIds, attachment: attachmentInput = null } = await req.json()

  // Process attachment server-side
  let processedAttachment: AttachmentInput = null
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath && user) {
    try {
      const { processAttachment } = await import('@/lib/attachment')
      const result = await processAttachment(
        user.id,
        attachmentInput.bucket,
        attachmentInput.storagePath,
        attachmentInput.mediaType,
        attachmentInput.fileName,
        attachmentInput.fileSize,
      )
      processedAttachment = { buffer: result.buffer, mediaType: result.mediaType }
      attachmentId = result.attachmentId
    } catch (err) {
      console.warn('[create] attachment processing failed:', err)
    }
  }
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!prompt || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) return Response.json({ error: 'No models specified' }, { status: 400 })

  const duelId = crypto.randomUUID()

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: modelIds.length, mode, duelId }))
      await Promise.all(
        modelIds.map((modelId: string, i: number) =>
          mode === 'image' ? runImage(modelId, i, prompt, controller, duelId, processedAttachment)
          : mode === 'video' ? runVideo(modelId, i, prompt, controller, duelId, processedAttachment)
          : runText(modelId, i, prompt, controller, duelId, processedAttachment)
        )
      )
      controller.enqueue(sse('end', {}))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    }
  })
}
