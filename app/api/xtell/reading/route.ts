// app/api/xtell/reading/route.ts — the master reads the chart. SSE stream.
//
// The chart is RECOMPUTED here from the raw birth input — a client-supplied
// chart is never trusted, so the model can only ever see pillars the library
// produced. The user chose the model, so house rules apply: bill list price,
// never substitute (lib/provider-errors ACCOUNT branch surfaces our limits).

export const runtime = 'nodejs'
export const maxDuration = 300

import { createSupabaseServer } from '@/lib/supabase-server'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { baziChart, baziFacts, ziweiChart, ziweiFacts, validBirth, MASTERS, type Temple } from '@/lib/xtell'

const LOG = '[xtell/reading]'

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple: Temple = body?.temple === 'ziwei' ? 'ziwei' : 'bazi'
  const question = typeof body?.question === 'string' ? body.question.slice(0, 2000) : ''
  if (!validBirth(body?.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
  if (typeof body?.modelId !== 'string') return Response.json({ error: 'modelId required' }, { status: 400 })

  const model = await getModelById(body.modelId)
  if (!model || (model as any).enabled === false) return Response.json({ error: 'model not available' }, { status: 400 })
  if (((model as any).blocked_features ?? []).includes('xtell')) {
    return Response.json({ error: 'model not offered for XTell' }, { status: 400 })
  }

  // Search is opt-in AND gated on the model declaring the capability — the
  // same double gate every other surface uses.
  const canSearch = ((model as any).output_config?.text?.capabilities ?? []).includes('web_search')
  const search = canSearch && body?.search === true

  const facts = temple === 'ziwei'
    ? ziweiFacts(ziweiChart(body.birth), body.birth.gender)
    : baziFacts(baziChart(body.birth), body.birth.gender)

  // The chart rides in the SYSTEM slot with the master persona: every turn of
  // the conversation carries it natively, and the client can never overwrite
  // it — history is user/assistant turns only, capped so a long consultation
  // cannot smuggle an unbounded prompt.
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(body?.history)
    ? body.history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-20)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 8000) }))
    : []
  const messages = [...history, { role: 'user' as const, content: question || '請為信眾做一次完整的解讀。' }]

  const stream = new ReadableStream({
    async start(controller) {
      await providers.streamText(
        model as any,
        messages,
        {
          onDelta: (text) => controller.enqueue(sse('delta', { text })),
          onDone: (r) => {
            const cents = Math.round((r.cost ?? 0) * 100)
            if (cents > 0) {
              debitCredits({
                userId: user.id, amountCents: cents,
                referenceType: 'xtell', referenceId: (model as any).id ?? (model as any).model_name,
                description: `XTell ${temple} reading (${(model as any).model_name})`,
                metadata: { temple, modelName: (model as any).model_name, search },
              }).catch(err => {
                if (err instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits (${cents}¢)`)
                else console.warn(`${LOG} debit failed:`, err)
              })
            }
            controller.enqueue(sse('done', { cost: r.cost ?? 0, searches: r.searchCount ?? 0 }))
            controller.close()
          },
          onError: (msg) => {
            controller.enqueue(sse('error', { message: sanitizeProviderError(msg) }))
            controller.close()
          },
        },
        [],
        { userId: user.id },
        { system: `${MASTERS[temple]}\n\n信眾的命盤（系統排定，勿更動）：\n${facts}`, search },
      )
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
