// app/api/create/chat/route.ts
// Multi-turn chat continuation with a chosen model

export const runtime     = 'edge'
export const maxDuration = 120

import { streamText } from 'ai'
import { createGateway } from '@ai-sdk/gateway'

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! })

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const { modelId, messages } = await req.json()

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!modelId || !messages?.length) return Response.json({ error: 'Missing params' }, { status: 400 })

  // Only pass text messages to the model (skip image/video content)
  const chatMessages = messages
    .filter((m: any) => !m.isImage && !m.isVideo)
    .map((m: any) => ({ role: m.role, content: m.content }))

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model: gateway(modelId),
          messages: chatMessages,
          maxOutputTokens: 1024,
        })
        for await (const chunk of result.textStream) {
          controller.enqueue(sse('delta', { text: chunk }))
        }
        controller.enqueue(sse('done', {}))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        controller.enqueue(sse('error', { message: msg }))
      }
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
