// app/api/admin/test-model/route.ts
//
// Admin-only playground. Lets an admin run a single model against a
// prompt to verify it works the way the catalog row says it does.
// Reuses the same lib/providers router that XDuel and XCreate use, so
// what's tested here is what gets shipped.
//
// Request:
//   POST /api/admin/test-model
//   { "model_id": "<uuid>", "prompt": "..." }
//
// Response by mode:
//   text   → SSE stream  (event: delta { text } / event: done { ... } / event: error)
//   image  → JSON        { mediaType, dataUrl, cost, latency_ms }
//   video  → JSON        { mediaType, dataUrl, cost, latency_ms, durationSeconds }
//
// For image/video the buffer is returned inline as a data URL so the
// admin UI can render it without needing a public bucket. Fine for the
// modest sizes admin tests produce.

export const runtime     = 'nodejs'
export const maxDuration = 300

import { createClient } from '@supabase/supabase-js'
import * as providers   from '@/lib/providers'
import { assertAdmin, getAdminUser } from '@/lib/admin'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request): Promise<Response> {
  const guard = await assertAdmin()
  if (guard) return guard
  const admin = await getAdminUser() // already non-null past assertAdmin

  let body: { model_id?: string; prompt?: string }
  try { body = await req.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  const modelId = body.model_id
  const prompt  = (body.prompt ?? '').trim()
  if (!modelId)             return Response.json({ error: 'model_id required' }, { status: 400 })
  if (prompt.length < 1)    return Response.json({ error: 'prompt required' },   { status: 400 })

  // Load the model row using the same shape the runtime providers expect.
  const sb = serviceClient()
  const { data: model, error: loadErr } = await sb
    .from('ai_models')
    .select('*')
    .eq('id', modelId)
    .single()
  if (loadErr || !model) {
    return Response.json({ error: `model not found: ${loadErr?.message ?? 'unknown'}` }, { status: 404 })
  }

  const out: string[] = (model.output_modalities ?? []) as string[]
  const isImage = out.includes('image') && !out.includes('text') ? true : out.includes('image') && out.length === 1
  const isVideo = out.includes('video')
  const isText  = out.includes('text') && !out.includes('image') && !out.includes('video')
  // For models with mixed text+image output (e.g. Nano Banana), default to image.
  const mode: 'text' | 'image' | 'video' =
    isVideo ? 'video' :
    out.includes('image') ? 'image' :
    'text'

  const ctx = { userId: admin?.id ?? null }
  const t0  = Date.now()

  // ── Text: stream via SSE ──────────────────────────────────────────────────
  if (mode === 'text') {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await providers.streamText(
            model as providers.ModelInfo,
            [{ role: 'user', content: prompt }],
            {
              onDelta: (text) => controller.enqueue(sse('delta', { text })),
              onDone:  (r)    => {
                controller.enqueue(sse('done', {
                  inputTokens:  r.inputTokens,
                  outputTokens: r.outputTokens,
                  cost:         r.cost,
                  latency_ms:   Date.now() - t0,
                }))
                controller.close()
              },
              onError: (msg) => {
                controller.enqueue(sse('error', { message: msg }))
                controller.close()
              },
            },
            [],
            ctx,
          )
        } catch (err) {
          controller.enqueue(sse('error', { message: (err as Error).message }))
          controller.close()
        }
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      }
    })
  }

  // ── Image: single-shot, return as data URL ───────────────────────────────
  if (mode === 'image') {
    try {
      const result = await providers.generateImage(
        model as providers.ModelInfo,
        prompt,
        'medium',
        '1024x1024',
        [],
        null,
        null,
        ctx,
      )
      const dataUrl = `data:${result.mediaType};base64,${result.buffer.toString('base64')}`
      return Response.json({
        mediaType:  result.mediaType,
        dataUrl,
        cost:       result.cost,
        latency_ms: Date.now() - t0,
      })
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 })
    }
  }

  // ── Video: single-shot, return as data URL ───────────────────────────────
  // Admin tests are short clips; data URL is fine even at a few MB. If it
  // ever balloons, swap to uploading to xduel-ai-videos and returning the
  // signed URL.
  try {
    const result = await providers.generateVideo(
      model as providers.ModelInfo,
      prompt,
      '1280x720',
      8,
      [],
      undefined,
      ctx,
    )
    const dataUrl = `data:${result.mediaType};base64,${result.buffer.toString('base64')}`
    return Response.json({
      mediaType:       result.mediaType,
      dataUrl,
      durationSeconds: result.durationSeconds,
      cost:            result.cost,
      latency_ms:      Date.now() - t0,
    })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
