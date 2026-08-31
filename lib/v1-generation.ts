// lib/v1-generation.ts — shared plumbing for the REST generation endpoints.
//
// /v1/images and /v1/videos are thin wrappers over the SAME /api/xcreate path
// the MCP tools call, so pixels behave identically whichever front door a key
// holder uses: same models, same billing, same job records. What REST adds is
// an HTTP shape a game engine can call without speaking JSON-RPC.
//
// Model resolution deliberately accepts the SAME `provider/model_name` slugs
// /v1/models publishes and /v1/chat/completions accepts. A developer should
// never have to learn that one surface wants a uuid.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveApiToken } from './api-token'
import { createSupabaseServer } from './supabase-server'
import { getModelByProviderName, getModelById } from './models'
import { isBlockedFor } from './model-features'

export const API_FEATURE = 'api'

export type Caller = { userId: string; bearer: string }

/** API key or signed-in session — the same two doors as the rest of /v1. */
export async function v1Caller(req: Request): Promise<Caller | null> {
  const authz = req.headers.get('authorization')
  const tok = await resolveApiToken(authz)
  if (tok) return { userId: tok.userId, bearer: authz! }
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user ? { userId: user.id, bearer: '' } : null
}

export function err(message: string, status = 400, type = 'invalid_request_error') {
  return Response.json({ error: { message, type } }, { status })
}

/**
 * `provider/model_name` (published by /v1/models) or a raw catalog uuid.
 * Enforces the same gates the chat endpoint does, so a model that answers
 * here is one the catalog actually offers through the API.
 */
export async function resolveGenModel(spec: string, want: 'image' | 'video') {
  const raw = String(spec ?? '').trim()
  if (!raw) throw err(`\`model\` is required. Use a model id from GET /api/v1/models.`, 400)
  const model = raw.includes('/')
    ? await getModelByProviderName(raw.slice(0, raw.indexOf('/')), raw.slice(raw.indexOf('/') + 1))
    : await getModelById(raw)
  if (!model) throw err(`The model \`${raw}\` does not exist. Use an id from GET /api/v1/models.`, 404, 'model_not_found')
  if (!(model as any).enabled) throw err(`The model \`${raw}\` is not currently available.`, 404, 'model_unavailable')
  if (isBlockedFor(model as any, API_FEATURE)) throw err(`The model \`${raw}\` is not available through the API.`, 404, 'model_blocked')
  if (!((model as any).output_modalities ?? []).includes(want)) {
    throw err(`\`${raw}\` does not generate ${want}. GET /api/v1/models lists what each model can do.`, 400, 'model_wrong_modality')
  }
  return model as any
}

/**
 * Service-role reader. The wrapper has to see a job row that /api/xcreate
 * wrote in a different invocation, and an API-key caller has no session for
 * RLS to key off. Every read below filters on the caller's own user id.
 */
function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

// How long to wait for PROOF THAT THE RUN STARTED — not for the pixels.
// /api/xcreate inserts the job row only after auth, the model gates, the key's
// spend cap and the credit reserve, so the row appearing means every
// synchronous check a caller could act on has already passed. Those are a
// handful of DB round trips, ~1s in practice; 20s is slack, not a budget.
const START_TIMEOUT_MS = 20_000
const START_POLL_MS = 300

type Upstream =
  | { kind: 'ok' }
  | { kind: 'redirect'; location: string | null }
  | { kind: 'error'; status: number; body: any }
  | { kind: 'network'; message: string }

/**
 * Resolves when the job row lands, or at the deadline. `cancel` stops the loop
 * once the other side of the race has already answered — an upstream that
 * fails in 200ms should not leave this polling the table for another 20s.
 */
async function waitForStart(jobId: string, userId: string, cancel: { done: boolean }): Promise<'started' | 'timeout'> {
  const sb = service()
  const until = Date.now() + START_TIMEOUT_MS
  for (;;) {
    const { data } = await sb.from('xcreate_jobs')
      .select('id').eq('id', jobId).eq('user_id', userId).maybeSingle()
    if (data) return 'started'
    if (cancel.done || Date.now() >= until) return 'timeout'
    await new Promise(r => setTimeout(r, START_POLL_MS))
  }
}

/**
 * Start a generation and return its job id. ALWAYS async — image runs take
 * seconds and video minutes, and a blocking REST call dies at some proxy
 * timeout (the same reasoning as the Tripo routes, learned from that spec).
 *
 * This route used to AWAIT the internal /api/xcreate response, which does not
 * return until the generation is finished. That made the time-to-202 track the
 * cost of the image instead of the cost of accepting it: 6s for a Gemini Flash
 * job, 61s for gpt-image-2, and a FUNCTION_INVOCATION_TIMEOUT for anything past
 * this route's 60s ceiling (reported 2026-08-31, gpt-image-2 unusable on both
 * hosts, qwen-image-3.0-pro 6s away from the same fate). Raising the ceiling
 * would only move the cliff; the shape was the bug.
 *
 * So: fire the POST, do NOT read its body, and wait only until the job row
 * exists. That is exactly what the browser client does — it POSTs with a
 * pre-generated jobId and polls /api/xcreate/job/{id} — and it is why leaving
 * the studio page does not kill a run. /api/xcreate holds its OWN invocation
 * open for the whole generation (maxDuration 800) whether or not anybody is
 * reading, so freezing this one after the 202 costs the run nothing.
 */
export async function startJob(caller: Caller, req: Request, mode: 'image' | 'video', modelUuid: string, prompt: string, options: Record<string, unknown>) {
  const jobId = globalThis.crypto.randomUUID()
  const origin = new URL(req.url).origin
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (caller.bearer) headers.Authorization = caller.bearer
  else {
    // Session caller: forward the cookie so /api/xcreate authenticates the
    // same person rather than rejecting an anonymous internal call.
    const cookie = req.headers.get('cookie')
    if (cookie) headers.cookie = cookie
  }

  // redirect:'manual' so a gate or rewrite can never turn this into a
  // mystery 405 again — a redirect here is a configuration bug and must say so.
  const upstream: Promise<Upstream> = fetch(`${origin}/api/xcreate`, {
    method: 'POST', headers, redirect: 'manual',
    body: JSON.stringify({ prompt, mode, modelIds: [modelUuid], modelOptions: [options], jobId }),
  }).then(async res => {
    if (res.status >= 300 && res.status < 400) return { kind: 'redirect' as const, location: res.headers.get('location') }
    if (!res.ok) return { kind: 'error' as const, status: res.status, body: await res.json().catch(() => ({})) }
    return { kind: 'ok' as const }
  }).catch(e => ({ kind: 'network' as const, message: e instanceof Error ? e.message : String(e) }))

  // Whichever comes first: the run is under way, or it failed fast for a
  // reason worth passing through (insufficient credits, spend cap, a safety
  // refusal). A laundered 500 is not actionable; those are.
  const cancel = { done: false }
  upstream.then(() => { cancel.done = true })
  const outcome = await Promise.race([waitForStart(jobId, caller.userId, cancel), upstream])

  if (typeof outcome === 'object') {
    if (outcome.kind === 'redirect') {
      console.error(`[v1] internal /api/xcreate call was redirected to ${outcome.location} — check proxy.ts bypass list`)
      return err('Generation is misconfigured on this deployment (internal call redirected).', 500, 'server_error')
    }
    if (outcome.kind === 'network') {
      console.error(`[v1] internal /api/xcreate call failed: ${outcome.message}`)
      return err('Generation could not be started.', 502, 'server_error')
    }
    if (outcome.kind === 'error') {
      const b = outcome.body
      return err(b?.message ?? b?.error ?? `generation failed (${outcome.status})`, outcome.status, 'generation_failed')
    }
    // kind === 'ok' — finished before we even saw the row (mock mode, or a
    // very fast model). Started is started.
    return { jobId, status: 'running' as const }
  }

  if (outcome === 'timeout') {
    // No row and no answer in 20s. The run is probably still starting, so the
    // id is still the caller's handle — but we have no proof the request was
    // fully delivered, so hold this invocation open briefly to be sure it was.
    console.warn(`[v1] job ${jobId} not visible after ${START_TIMEOUT_MS}ms; returning 202 as queued`)
    after(async () => { await Promise.race([upstream, new Promise(r => setTimeout(r, 3000))]) })
    return { jobId, status: 'queued' as const }
  }

  return { jobId, status: 'running' as const }
}
