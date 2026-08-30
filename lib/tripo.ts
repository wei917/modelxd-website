// lib/tripo.ts — the Tripo3D proxy: one ModelXD key instead of two.
//
// Built to a game developer's spec (docs/TRIPO-API.md). The rules that shape
// everything here:
//
//   * ASYNC, never wrapped: create returns Tripo's task_id verbatim; the
//     caller polls. Generation runs 10-120s and rigging adds more — a
//     blocking call would die at some proxy timeout, and a client timeout
//     against a job "stuck at 99%" is not a server failure; resubmitting
//     double-charges.
//   * Tripo's ids ARE our ids. rig-check/rig chain by {"input": task_id};
//     rewriting ids would mean a mapping that can be lost. We keep a ledger
//     row per task for ownership, recovery and billing — not for renaming.
//   * Errors pass through intact. riggable=false is actionable ("rewrite the
//     prompt"); a laundered 500 is not.
//
// Billing: the caller chose Tripo explicitly, so list price, never a
// substitute (house rule). Debited at create from Tripo's published table
// (docs.tripo3d.ai pricing, fetched 2026-08-30: $1 = 100 credits, 1 credit =
// 1 cent) — then reconciled ONCE against the task's own `consumed_credit`
// at the first terminal poll, so the final charge is Tripo's actual number,
// not our estimate. Unknown model strings are billed at the P1 (higher)
// rate up front and reconciled down.

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from './supabase-server'
import { resolveApiToken } from './api-token'
import { grantCredits, debitCredits } from './credits'

export const TRIPO_BASE = 'https://openapi.tripo3d.ai/v3'
const LOG = '[tripo]'

export type TripoKind = 'text_to_model' | 'image_to_model' | 'rig_check' | 'rig'

export function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

export function tripoKey(): string | null {
  return process.env.TRIPO_API_KEY || null
}

/** Session cookie or ModelXD API key — the same two doors XCreate answers. */
export async function callerId(req: Request): Promise<string | null> {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (user) return user.id
  const tok = await resolveApiToken(req.headers.get('authorization'))
  return tok ? tok.userId : null
}

/** Tripo's published per-task credits (1 credit = 1 cent). */
export function listPriceCents(kind: TripoKind, model: string | undefined, texture: boolean): number {
  const p1 = !model || /^P/i.test(model)   // unknown → bill high, reconcile down
  switch (kind) {
    case 'text_to_model':  return p1 ? (texture ? 40 : 30) : (texture ? 20 : 10)
    case 'image_to_model': return p1 ? (texture ? 50 : 40) : (texture ? 30 : 20)
    case 'rig':            return 25
    case 'rig_check':      return 0    // Tripo: "pre rig check: Free"
  }
}

export async function tripoPost(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${TRIPO_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tripoKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

export async function tripoGet(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${TRIPO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tripoKey()}` },
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

/** Record a created task; debit its list price. Returns billed cents. */
export async function recordTask(opts: {
  userId: string; taskId: string; kind: TripoKind; inputTaskId?: string | null
  params: Record<string, unknown>; billCents: number
}): Promise<void> {
  const sb = service()
  const { error } = await sb.from('tripo_tasks').insert({
    task_id: opts.taskId, user_id: opts.userId, kind: opts.kind,
    input_task_id: opts.inputTaskId ?? null, params: opts.params, billed_cents: opts.billCents,
  })
  if (error) console.error(`${LOG} ledger insert failed for ${opts.taskId}:`, error.message)
  if (opts.billCents > 0) {
    await debitCredits({
      userId: opts.userId, amountCents: opts.billCents,
      referenceType: 'tripo_task', referenceId: opts.taskId,
      description: `Tripo ${opts.kind}`,
      metadata: { kind: opts.kind, params: opts.params },
    })
  }
}

/** The chained-from task must exist and be YOURS. */
export async function ownsTask(userId: string, taskId: string) {
  const { data } = await service().from('tripo_tasks')
    .select('task_id, kind, billed_cents, reconciled').eq('task_id', taskId).eq('user_id', userId).maybeSingle()
  return data ?? null
}

/**
 * First terminal poll settles the difference between what we debited and what
 * Tripo actually consumed (`consumed_credit`, 1 credit = 1 cent). Failed
 * tasks that consumed nothing refund in full. Runs once per task.
 */
export async function reconcile(userId: string, taskId: string, tripoTask: any): Promise<number | null> {
  const status = String(tripoTask?.status ?? '')
  if (!['success', 'failed', 'cancelled', 'banned', 'expired'].includes(status)) return null
  const sb = service()
  const { data: row } = await sb.from('tripo_tasks')
    .select('billed_cents, reconciled').eq('task_id', taskId).eq('user_id', userId).maybeSingle()
  if (!row || row.reconciled) return null

  // Live API (verified Aug 30): the field is `credits_consumed` on data —
  // the docs' `consumed_credit` is kept as a fallback in case either name
  // appears. Observed in the same probe: Tripo silently FORCED texture:true
  // for a v2.5 task and charged 20 credits against our 10-credit estimate —
  // which is exactly why settling on their number, not ours, is the billing.
  const consumed = Number(
    tripoTask?.credits_consumed ?? tripoTask?.consumed_credit ?? tripoTask?.output?.credits_consumed ?? NaN,
  )
  // No consumption figure at all: a successful task keeps the estimate; a
  // failed one refunds in full rather than charging for nothing.
  const actualCents = Number.isFinite(consumed)
    ? Math.max(0, Math.round(consumed))
    : (status === 'success' ? row.billed_cents : 0)
  const diff = actualCents - row.billed_cents

  // Claim reconciliation first so a poll race cannot settle twice.
  const { data: claimed } = await sb.from('tripo_tasks')
    .update({ reconciled: true, status_cache: status, billed_cents: actualCents })
    .eq('task_id', taskId).eq('reconciled', false).select('task_id').maybeSingle()
  if (!claimed) return null

  if (diff < 0) {
    await grantCredits({
      userId, amountCents: -diff, kind: 'refund',
      referenceType: 'tripo_task', referenceId: taskId,
      description: `Tripo ${status === 'success' ? 'price reconciliation' : 'failed task refund'}`,
    }).catch(e => console.error(`${LOG} refund failed for ${taskId}:`, e?.message ?? e))
  } else if (diff > 0) {
    await debitCredits({
      userId, amountCents: diff,
      referenceType: 'tripo_task', referenceId: taskId,
      description: 'Tripo price reconciliation',
    }).catch(e => console.error(`${LOG} extra debit failed for ${taskId}:`, e?.message ?? e))
  }
  console.log(`${LOG} settled ${taskId}: billed ${row.billed_cents}c, actual ${actualCents}c (${status})`)
  return actualCents
}

/** Uniform guards for every route. */
export async function guard(req: Request): Promise<{ userId: string } | Response> {
  if (!tripoKey()) {
    return Response.json({ error: 'Tripo is not configured on this deployment (TRIPO_API_KEY not set).' }, { status: 503 })
  }
  const userId = await callerId(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return { userId }
}

/** Pass Tripo's own error body through, with our status mirroring theirs. */
export function passThrough(status: number, json: any): Response {
  return Response.json(json, { status })
}
