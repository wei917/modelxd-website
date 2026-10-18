// lib/remake/engine/director.ts: the director's turn (Claude Opus 5.5) that
// writes a remake plan, then the code checks; one repair round when the
// checks fail. Billed at list price and logged against the user like every
// other call (startCall/endCall).

import Anthropic from '@anthropic-ai/sdk'
import { startCall, endCall } from '../../providers/call-log'
import { calcTextCost } from '../../providers/pricing'
import { workspaceHeader } from '../../providers/anthropic'
import type { ModelInfo } from '../../providers/types'
import { checkPlan, plannerPrompt, type RemakePlan, type RemakeRequest } from './plan'

function parse(text: string): RemakePlan | null {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    const p = JSON.parse(text.slice(s, e + 1))
    if (!Array.isArray(p?.shots) || !Array.isArray(p?.characters)) return null
    p.voices = Array.isArray(p.voices) ? p.voices : []
    p.world = typeof p.world === 'string' ? p.world : ''
    for (const sh of p.shots) {
      sh.refs = Array.isArray(sh.refs) ? sh.refs : []
      sh.text = typeof sh.text === 'string' ? sh.text : ''
      sh.keyframe = typeof sh.keyframe === 'string' ? sh.keyframe : ''
      sh.clip_seconds = Math.round(Number(sh.clip_seconds))
      sh.continues = !!sh.continues
      sh.product = !!sh.product
      sh.sound = typeof sh.sound === 'string' ? sh.sound : ''
      sh.change = typeof sh.change === 'string' ? sh.change : ''
      sh.still = !!sh.still
    }
    return p as RemakePlan
  } catch { return null }
}

export async function planRemake(req: RemakeRequest, model: ModelInfo, userId: string | null): Promise<{ plan: RemakePlan; issues: string[]; cost: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders: workspaceHeader() })
  const { system, user } = plannerPrompt(req)
  const messages: any[] = [{ role: 'user', content: user }]
  let cost = 0, plan: RemakePlan | null = null, issues: string[] = ['no plan']
  for (let round = 0; round < 2; round++) {
    const desc = { provider: model.provider, model_name: model.model_name, model_id: model.id ?? null, mode: 'text' as const, user_id: userId, thinking_level: 'high' }
    const requestId = startCall(desc, {})
    const t0 = Date.now()
    try {
      const msg: any = await client.messages.stream({
        model: model.model_name, max_tokens: 32000, thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
        system, messages,
      } as any).finalMessage()
      const u = msg.usage ?? {}
      const c = calcTextCost(model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0)
      cost += c
      endCall(requestId, desc, { status: 'success', latency_ms: Date.now() - t0, input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, cost_usd: c })
      const text = (msg.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      plan = parse(text)
      issues = plan ? checkPlan(plan, req) : ['the reply was not a plan']
      if (!issues.length) break
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `The plan fails these checks:\n- ${issues.join('\n- ')}\nFix them and return the whole JSON again.` })
    } catch (err) {
      endCall(requestId, desc, { status: 'failed', latency_ms: Date.now() - t0, error_message: (err as Error).message?.slice(0, 1000) })
      throw err
    }
  }
  if (!plan) throw new Error(`The director returned no plan (${issues.join('; ')})`)
  return { plan, issues, cost }
}
