// app/api/xtell/memory/route.ts — 「立即摘要」 (owner, Oct 3: "a button to
// force summarize now"). A press in a master's 「{name}的記憶」 summarizes
// that master's conversation now, whatever its size: everything but the
// latest question and answer, with its own model, billed to the visitor like
// an answer (docs/XTELL-MEMORY.md). The automatic summaries run in the
// reading route; both go through lib/xtell-memory.ts.
//
//   POST { readingId, modelId, lang?, thinking? }
//   → 200 { text, at }                     the new summary
//   → 409 { code: 'nothing_to_summarize' } nothing older than the latest exchange
//   → 402 { code: 'no_credits' }           an empty wallet: no call made
//   → 502 { code: 'summary_failed' }       the model wrote nothing; not charged

export const runtime = 'nodejs'
export const maxDuration = 300

import { createSupabaseServer } from '@/lib/supabase-server'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, accrueFraction } from '@/lib/credits'
import { xtellAdmin } from '@/lib/xtell-admin'
import { maybeSummarize, summaryRun, summaryCharge } from '@/lib/xtell-memory'

const LOG = '[xtell/memory]'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const readingId = typeof body?.readingId === 'string' ? body.readingId : null
  const modelId = typeof body?.modelId === 'string' ? body.modelId : null
  if (!readingId || !modelId) return Response.json({ error: 'readingId and modelId required' }, { status: 400 })

  // The visitor's own conversation, read with their own session.
  const { data: reading } = await sb.from('xtell_readings').select('id, temple')
    .eq('id', readingId).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!reading) return Response.json({ error: 'not found' }, { status: 404 })

  const model = await getModelById(modelId)
  if (!model || (model as any).enabled === false || ((model as any).blocked_features ?? []).includes('xtell')) {
    return Response.json({ error: 'model not available' }, { status: 400 })
  }

  // A press costs a model call: an empty wallet gets no call at all.
  const { data: wallet } = await sb.from('user_credits').select('balance_cents').eq('user_id', user.id).maybeSingle()
  if (!wallet || Number(wallet.balance_cents) < 1) return Response.json({ error: 'no credits', code: 'no_credits' }, { status: 402 })

  let admin: any
  try { admin = xtellAdmin() } catch { return Response.json({ error: 'memory unavailable' }, { status: 503 }) }

  // The seat's thinking setting, as for an answer (the reading route's rule).
  const levels: string[] = (model as any).output_config?.text?.thinking_levels ?? []
  const thinking: string | null = body?.thinking === undefined
    ? ((model as any).provider !== 'alibaba' ? null : 'thinking_false')
    : (typeof body.thinking === 'string' && levels.includes(body.thinking) ? body.thinking : null)

  const done = await maybeSummarize({
    admin, readingId, model, inputTokens: null, now: true,
    lang: typeof body?.lang === 'string' ? body.lang : 'zh-Hant', userId: user.id,
    run: summaryRun((...a: any[]) => (providers.streamText as any)(...a), model, user.id, thinking),
    charge: summaryCharge({ accrueFraction, debitCredits }, {
      userId: user.id, readingId, model, temple: String((reading as any).temple ?? ''),
      warn: m => console.warn(`${LOG} ${m}`),
    }),
  })
  if (done.saved) return Response.json({ text: done.text ?? '', at: new Date().toISOString() })
  console.warn(`${LOG} ${(model as any).model_name}: ${done.reason}`)
  if (done.reason === 'nothing old enough to fold' || done.reason === 'already summarized to that point') {
    return Response.json({ error: done.reason, code: 'nothing_to_summarize' }, { status: 409 })
  }
  if (done.reason === 'messages table missing') return Response.json({ error: done.reason }, { status: 503 })
  return Response.json({ error: done.reason, code: 'summary_failed' }, { status: 502 })
}
