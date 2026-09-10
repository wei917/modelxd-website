// lib/worldlabs.ts — World Labs Marble: prompt → walkable 3D world (XWorld).
//
// API (docs.worldlabs.ai/api, read 2026-09-10): POST /marble/v1/worlds:generate
// returns an Operation; poll /marble/v1/operations/{id} until done. Auth is
// the `WLT-Api-Key` header. Verified live Sep 10:
//   * a Draft text world finished in 24s; standard models take ~5 min.
//   * the finished operation carries `cost.total_credits` with line items —
//     230 credits for a Draft text world, exactly the published table.
//   * assets live on cdn.marble.worldlabs.ai: UNSIGNED, `Access-Control-
//     Allow-Origin: *`, cache max-age 3600. The browser loads them directly;
//     nothing is copied into our storage. The world itself stays private
//     (permission.public defaults false) — world_marble_url is useless to a
//     user, so we never show it.
//   * video_prompt / image_prompt take { source: 'uri' | 'media_asset' |
//     'data_base64', ... } (from a 422 on a bogus source — free to probe).
//
// Billing: the user picked the model, so list price, never a substitute.
// Debited BEFORE the provider call at the model's CEILING for the input type
// (lib/xworld-models.ts; 1.1 Plus varies per world), refunded in full if the
// create fails, and reconciled ONCE to the operation's own
// `cost.total_credits` at the first terminal poll — same shape as
// lib/tripo.ts. The settle rounds to the nearest cent; the hold rounds up
// and is always reconciled down.
//
// Not logged to provider_calls: its `mode` CHECK allows only text/image/
// video. The xworlds row is the ledger, as tripo_tasks is for Tripo.

import { createClient } from '@supabase/supabase-js'
import { grantCredits, debitCredits } from './credits'
import { WORLD_MODELS, creditsToCents, worldCeilingCents, type WorldInput } from './xworld-models'

export type { WorldInput }
export const WL_BASE = 'https://api.worldlabs.ai/marble/v1'
const LOG = '[worldlabs]'

export function worldlabsKey(): string | null {
  return process.env.WORLDLABS_API_KEY || null
}

export function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

async function wl(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${WL_BASE}${path}`, {
    ...init,
    headers: { 'WLT-Api-Key': worldlabsKey() ?? '', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

/** Build the `world_prompt` for one input type. URIs are short-lived signed
 *  URLs to the user's own uploads — World Labs fetches them at create time. */
export function worldPrompt(input: WorldInput, opts: {
  text?: string; imageUrls?: string[]; azimuths?: number[]; videoUrl?: string
}): Record<string, unknown> {
  const text = opts.text?.trim() || undefined
  const uri = (u: string) => ({ source: 'uri', uri: u })
  switch (input) {
    case 'text':
      return { type: 'text', text_prompt: text }
    case 'image':
      return { type: 'image', image_prompt: uri(opts.imageUrls![0]), ...(text ? { text_prompt: text } : {}) }
    case 'multi-image':
      return {
        type: 'multi-image',
        multi_image_prompt: opts.imageUrls!.map((u, i) => ({ azimuth: opts.azimuths?.[i] ?? 0, content: uri(u) })),
        ...(text ? { text_prompt: text } : {}),
      }
    case 'video':
      return { type: 'video', video_prompt: uri(opts.videoUrl!), ...(text ? { text_prompt: text } : {}) }
  }
}

/**
 * Debit the ceiling, start the world, record the row. On a failed create the
 * hold is refunded before returning — a user is never charged for a world
 * that never started.
 */
export async function createWorld(opts: {
  userId: string; model: string; input: WorldInput; prompt: Record<string, unknown>
  displayName: string; promptText: string | null; inputRecord: Record<string, unknown>
}): Promise<{ row: any } | { error: string; status: number }> {
  const holdCents = worldCeilingCents(opts.model, opts.input)
  const holdRef = crypto.randomUUID()
  await debitCredits({
    userId: opts.userId, amountCents: holdCents,
    referenceType: 'xworld', referenceId: holdRef,
    description: `XWorld ${WORLD_MODELS[opts.model].label}`,
    metadata: { model: opts.model, input: opts.input, hold: true },
  })   // throws InsufficientCreditsError — the route turns that into a 402

  const { status, json } = await wl('/worlds:generate', {
    method: 'POST',
    body: JSON.stringify({
      display_name: opts.displayName.slice(0, 64),
      model: opts.model,
      world_prompt: opts.prompt,
      tags: ['modelxd'],
    }),
  })
  const opId = json?.operation_id
  if (status >= 300 || !opId) {
    await grantCredits({
      userId: opts.userId, amountCents: holdCents, kind: 'refund',
      referenceType: 'xworld', referenceId: holdRef, description: 'XWorld refund (world did not start)',
    }).catch(e => console.error(`${LOG} refund failed for hold ${holdRef}:`, e?.message ?? e))
    const msg = json?.detail ?? json?.message ?? json?.error?.message ?? `World Labs answered ${status}`
    console.error(`${LOG} create failed ${status}:`, JSON.stringify(json).slice(0, 400))
    return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), status: status === 429 ? 429 : 502 }
  }

  const { data: row, error } = await service().from('xworlds').insert({
    user_id: opts.userId, kind: 'world', provider: 'worldlabs', model: opts.model,
    prompt: opts.promptText, input: { ...opts.inputRecord, hold_ref: holdRef },
    task_id: opId, billed_cents: holdCents,
  }).select('*').single()
  if (error) console.error(`${LOG} ledger insert failed for ${opId}:`, error.message)
  return { row: row ?? { task_id: opId } }
}

/** Poll World Labs and fold the result into the row. Reconciles once. */
export async function refreshWorld(row: any): Promise<any> {
  if (row.status !== 'pending') return row
  const { status, json: op } = await wl(`/operations/${encodeURIComponent(row.task_id)}`)
  if (status !== 200) {
    console.warn(`${LOG} poll ${row.task_id} → ${status}`)
    return row
  }
  const sb = service()
  if (!op?.done) {
    const pct = Number(op?.metadata?.progress?.percentage ?? op?.metadata?.progress?.percent ?? NaN)
    return { ...row, progress: Number.isFinite(pct) ? pct : null, progress_text: op?.metadata?.progress?.description ?? null }
  }

  const failed = !!op.error || !op.response?.assets
  const credits = Number(op?.cost?.total_credits ?? NaN)
  // No figure: a success keeps the hold (never guess upward), a failure refunds.
  const actualCents = Number.isFinite(credits) ? Math.round(creditsToCents(credits)) : (failed ? 0 : row.billed_cents)
  const assets = op.response?.assets ?? null

  // Claim the settle first so two polls can't both refund.
  const { data: claimed } = await sb.from('xworlds').update({
    status: failed ? 'failed' : 'done',
    error: failed ? String(op.error?.message ?? 'World generation failed') : null,
    world_id: op.response?.world_id ?? op.metadata?.world_id ?? null,
    assets, caption: assets?.caption ?? null, thumbnail_url: assets?.thumbnail_url ?? null,
    progress: 100, billed_cents: actualCents, reconciled: true, updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('reconciled', false).select('*').maybeSingle()
  if (!claimed) {
    const { data: fresh } = await sb.from('xworlds').select('*').eq('id', row.id).maybeSingle()
    return fresh ?? row
  }

  const diff = actualCents - row.billed_cents
  const ref = row.input?.hold_ref ?? row.id
  if (diff < 0) {
    await grantCredits({
      userId: row.user_id, amountCents: -diff, kind: 'refund', referenceType: 'xworld', referenceId: ref,
      description: failed ? 'XWorld refund (generation failed)' : 'XWorld price reconciliation',
    }).catch(e => console.error(`${LOG} refund failed for ${row.id}:`, e?.message ?? e))
  } else if (diff > 0) {
    await debitCredits({
      userId: row.user_id, amountCents: diff, referenceType: 'xworld', referenceId: ref,
      description: 'XWorld price reconciliation',
    }).catch(e => console.error(`${LOG} extra debit failed for ${row.id}:`, e?.message ?? e))
  }
  console.log(`${LOG} settled ${row.task_id}: held ${row.billed_cents}c, actual ${actualCents}c (${failed ? 'failed' : 'done'}, ${credits} credits)`)
  return claimed
}
