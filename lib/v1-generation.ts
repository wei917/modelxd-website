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
 * Start a generation and return its job id. ALWAYS async — image runs take
 * seconds and video minutes, and a blocking REST call dies at some proxy
 * timeout (the same reasoning as the Tripo routes, learned from that spec).
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
  const res = await fetch(`${origin}/api/xcreate`, {
    method: 'POST', headers, redirect: 'manual',
    body: JSON.stringify({ prompt, mode, modelIds: [modelUuid], modelOptions: [options], jobId }),
  })
  if (res.status >= 300 && res.status < 400) {
    console.error(`[v1] internal /api/xcreate call was redirected to ${res.headers.get('location')} — check proxy.ts bypass list`)
    return err('Generation is misconfigured on this deployment (internal call redirected).', 500, 'server_error')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Pass the real reason through — insufficient credits and safety refusals
    // are actionable; a laundered 500 is not.
    return err(body?.message ?? body?.error ?? `generation failed (${res.status})`, res.status, 'generation_failed')
  }
  return { jobId, body }
}
