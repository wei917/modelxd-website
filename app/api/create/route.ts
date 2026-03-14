// app/api/create/route.ts
// Like /api/duel but user-specified models, saved to `creates` table (private)
// Node runtime required for Sharp (image resizing via lib/attachment.ts)

export const runtime     = 'nodejs'
export const maxDuration = 300

import { streamText, experimental_generateImage as generateImage, experimental_generateVideo as generateVideo } from 'ai'
import { createGateway } from '@ai-sdk/gateway'

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! })
const LOG      = '[create]'


async function signedUrl(sb: any, bucket: string, path: string): Promise<string> {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24) // 24h
  if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`)
  return data.signedUrl
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

type r = Result
type Result          = { text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null
type AttachmentInput = { buffer: Buffer; mediaType: string } | null

function buildUserContent(prompt: string, attachment: AttachmentInput): any {
  if (!attachment) return prompt
  const { buffer, mediaType } = attachment
  const base64 = buffer.toString('base64')
  const parts: any[] = []
  if (mediaType.startsWith('image/')) {
    parts.push({ type: 'image', image: base64, mimeType: mediaType })
  } else if (mediaType === 'application/pdf') {
    parts.push({ type: 'file', data: base64, mimeType: 'application/pdf' })
  } else if (mediaType === 'text/plain') {
    return `File content:\n${buffer.toString('utf-8')}\n\n${prompt}`
  } else if (mediaType.startsWith('video/')) {
    parts.push({ type: 'file', data: base64, mimeType: mediaType })
  }
  parts.push({ type: 'text', text: prompt })
  return parts
}

async function runText(
  modelId: string, index: number, prompt: string,
  controller: ReadableStreamDefaultController, duelId: string,
  attachment: AttachmentInput = null
): Promise<Result> {
  const start = Date.now()
  try {
    const userContent = buildUserContent(prompt, attachment)
    console.log(`${LOG} [${index}] runText model=${modelId} contentType=${typeof userContent === 'string' ? 'string' : 'parts:'+userContent.length} hasAttachment=${!!attachment}`)
    const result = streamText({
      model: gateway(modelId),
      messages: [{ role: 'user', content: userContent }],
      maxOutputTokens: 512,
    })
    let fullText = ''
    for await (const chunk of result.textStream) {
      fullText += chunk
      controller.enqueue(sse(`delta:${index}`, { index, text: chunk, isImage: false, isVideo: false }))
    }
    const usage = await result.usage
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

async function runImage(
  modelId: string, index: number, prompt: string,
  controller: ReadableStreamDefaultController, duelId: string,
  attachment: AttachmentInput = null
): Promise<Result> {
  const start = Date.now()
  try {
    const imgOpts: any = { model: gateway.imageModel(modelId), prompt }
    if (attachment?.mediaType.startsWith('image/')) {
      imgOpts.providerOptions = {
        gateway: { image: attachment.buffer.toString('base64'), mimeType: attachment.mediaType }
      }
    }
    const logOpts = {
      model: modelId,
      prompt: prompt.slice(0, 80),
      hasAttachment: !!attachment,
      attachmentMediaType: attachment?.mediaType ?? null,
      attachmentBytes: attachment?.buffer?.length ?? 0,
      providerOptions: imgOpts.providerOptions
        ? JSON.parse(JSON.stringify(imgOpts.providerOptions, (k, v) =>
            k === 'image' && typeof v === 'string' && v.length > 50 ? `[base64 ${v.length} chars]` : v))
        : null,
    }
    console.log(`${LOG} [${index}] runImage CALL:`, JSON.stringify(logOpts))
    const result = await generateImage(imgOpts)
    console.log(`${LOG} [${index}] runImage result: images=${result.images?.length ?? 0} mediaType=${result.images?.[0]?.mediaType ?? 'none'}`)
    const image  = result.images?.[0]
    if (!image) throw new Error('No image returned')

    const { createClient } = await import('@supabase/supabase-js')
    const sb  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const ext  = image.mediaType?.split('/')[1] ?? 'png'
    const path = `${duelId}_model${index}.${ext}`
    const { error } = await sb.storage.from('create-ai-images').upload(path, image.uint8Array, {
      contentType: image.mediaType ?? 'image/png', upsert: false,
    })
    if (error) throw new Error(`Upload failed: ${error.message}`)

    const publicUrl = await signedUrl(sb, 'create-ai-images', path)
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

async function runVideo(
  modelId: string, index: number, prompt: string,
  controller: ReadableStreamDefaultController, duelId: string,
  attachment: AttachmentInput = null
): Promise<Result> {
  const start = Date.now()
  try {
    const vidOpts: any = attachment?.mediaType.startsWith('image/')
      ? { model: gateway.videoModel(modelId), prompt: { image: attachment.buffer, text: prompt } }
      : { model: gateway.videoModel(modelId), prompt }
    console.log(`${LOG} [${index}] runVideo model=${modelId} prompt="${prompt.slice(0,60)}" hasAttachment=${!!attachment} i2v=${attachment?.mediaType.startsWith('image/') ?? false}`)
    const result = await generateVideo(vidOpts)
    console.log(`${LOG} [${index}] runVideo result: videos=${result.videos?.length ?? 0}`)
    const video  = result.videos?.[0]
    if (!video) throw new Error('No video returned')

    const { createClient } = await import('@supabase/supabase-js')
    const sb     = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const bucket = 'create-ai-videos'

    let publicUrl: string
    if (video.uint8Array) {
      const mediaType = (video as any).mediaType ?? 'video/mp4'
      const ext  = mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const { error } = await sb.storage.from(bucket).upload(path, video.uint8Array, { contentType: mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      publicUrl = await signedUrl(sb, bucket, path)
    } else {
      const providerUrl = (video as any).url
      const fetchRes    = await fetch(providerUrl)
      if (!fetchRes.ok) throw new Error(`Fetch failed: ${fetchRes.status}`)
      const contentType = fetchRes.headers.get('content-type') ?? 'video/mp4'
      const ext  = contentType.split('/')[1]?.split(';')[0] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const bytes = new Uint8Array(await fetchRes.arrayBuffer())
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      publicUrl = await signedUrl(sb, bucket, path)
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
  console.log(`${LOG} POST /api/create received`)
  // Auth check first — user must be available before attachment processing
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  console.log(`${LOG} auth: user=${user?.id ?? 'none'} error=${authError?.message ?? 'none'}`)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, mode = 'text', models: modelIds, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} prompt=${prompt?.slice(0,40)} mode=${mode} models=${JSON.stringify(modelIds)} attachment=${attachmentInput?.storagePath ?? 'none'}`)

  if (!prompt || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) return Response.json({ error: 'No models specified' }, { status: 400 })

  // Process attachment: fetch from private bucket, resize, store in DB
  let processedAttachment: AttachmentInput = null
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath) {
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
      controller.enqueue(sse('end', { attachmentId }))
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
