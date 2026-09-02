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
import { baziChart, baziFacts, ziweiChart, ziweiFacts, yuelaoFacts, heMatch, liuNian, simianfoFacts, guandiFacts, qianOf, navagrahaChart, navagrahaFacts, validBirth, validQian, validWishes, validPlace, asTemple, MASTERS } from '@/lib/xtell'
import { classicsBlock } from '@/lib/classics'

const LOG = '[xtell/reading]'

// What the facts block is called, per temple: a 命盤 for the chart temples,
// a 籤 for 關帝廟, wishes plus a chart for 四面佛.
const FACTS_HEAD: Record<string, string> = {
  bazi:     '信眾的命盤（系統排定，勿更動）：',
  ziwei:    '信眾的命盤（系統排定，勿更動）：',
  yuelao:   '信眾的命盤（系統排定，勿更動）：',
  guandi:   '信眾求得的籤（系統從籤筒抽出、擲筊允准；籤文取自清刊本，勿更動）：',
  simianfo: '信眾的願文、命盤與流年（系統排定，勿更動）：',
  navagraha: '信眾的吠陀星盤（系統排定，勿更動）：',
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple = asTemple(body?.temple)
  const question = typeof body?.question === 'string' ? body.question.slice(0, 2000) : ''
  // 關帝廟's input is the stick number; everything else starts from a birth.
  if (temple === 'guandi') {
    if (!validQian(body?.n) || !qianOf(body.n)) return Response.json({ error: 'bad stick number' }, { status: 400 })
  } else {
    if (!validBirth(body?.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
    if (temple === 'yuelao' && !validBirth(body?.birth2)) return Response.json({ error: 'bad birth input (second person)' }, { status: 400 })
    if (temple === 'simianfo' && !validWishes(body?.wishes)) return Response.json({ error: 'write at least one wish' }, { status: 400 })
    if (temple === 'navagraha' && !validPlace(body?.place)) return Response.json({ error: 'bad place' }, { status: 400 })
  }
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
    : temple === 'yuelao'
      ? (() => {
        // Recomputed, not taken from the client: the score is a fact about two
        // birth moments, and a number that arrived over the wire is a number
        // someone could have chosen.
        const a = baziChart(body.birth), b = baziChart(body.birth2)
        return yuelaoFacts(a, body.birth.gender, b, body.birth2.gender, heMatch(a, b, new Date().getFullYear()))
      })()
      : temple === 'navagraha'
        ? navagrahaFacts(navagrahaChart(body.birth, body.place), body.birth.gender)
      : temple === 'guandi'
        // The poem comes from disk by number; the client's copy is never used.
        ? guandiFacts(qianOf(body.n)!, typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '')
        : temple === 'simianfo'
          ? (() => {
            const c = baziChart(body.birth)
            return simianfoFacts(c, body.birth.gender, body.birth?.hourUnknown === true, body.wishes, liuNian(c, body.birth.y, new Date().getFullYear()))
          })()
          : baziFacts(baziChart(body.birth), body.birth.gender, body.birth?.hourUnknown === true)

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
        { system: `${MASTERS[temple]}\n\n${FACTS_HEAD[temple]}\n${facts}${classicsBlock(temple, `${question} ${facts}`.slice(0, 2000))}`, search },
      )
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
