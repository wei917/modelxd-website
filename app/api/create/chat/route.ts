// app/api/create/chat/route.ts
// Continue conversation with chosen model after picking

export const runtime     = 'nodejs'
export const maxDuration = 120

import { getModelById } from '@/lib/models'
import * as providers   from '@/lib/providers'

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { modelId, messages } = await req.json()
  if (!modelId || !messages?.length) return Response.json({ error: 'Missing params' }, { status: 400 })

  const model = await getModelById(modelId)
  if (!model) return Response.json({ error: 'Model not found' }, { status: 404 })

  // Filter out image/video messages — only pass text turns to the model
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
