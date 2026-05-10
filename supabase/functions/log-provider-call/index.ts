// supabase/functions/log-provider-call/index.ts
//
// Supabase Edge Function (Deno) that records AI provider calls into the
// `provider_calls` table. Three-event log: start, end, media. All three
// are independent INSERTs that share a `request_id`.
//
//   { action: 'start', request_id, provider, model_name, model_id?,
//     mode, user_id?, estimated_cost_usd? }
//     → inserts an event='start' row
//
//   { action: 'end',   request_id, provider, model_name, model_id?,
//     mode, user_id?, status, latency_ms?, error_message?,
//     input_tokens?, output_tokens?, input_image_tokens?,
//     cached_input_tokens?, cost_usd?, usage_metadata? }
//     → inserts an event='end' row
//
//   { action: 'media', request_id, provider, model_name, model_id?,
//     mode, user_id?, media_url }
//     → inserts an event='media' row (post-upload annotation)
//
// There is no UPDATE path. If end never arrives, the start row stays as
// a debugging breadcrumb. If media never arrives, the end row stands.
//
// Auth: caller sends SUPABASE_SERVICE_ROLE_KEY as a Bearer token. The
// function uses the same key to bypass RLS.
//
// Deploy:
//   supabase functions deploy log-provider-call

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ALLOWED_PROVIDERS = new Set(['openai', 'google', 'alibaba', 'anthropic'])
const ALLOWED_MODES     = new Set(['text', 'image', 'video'])
const ALLOWED_STATUS    = new Set(['success', 'failed'])

interface CommonFields {
  request_id: string
  provider:   string
  model_name: string
  model_id?:  string | null
  mode:       string
  user_id?:   string | null
}

interface StartBody extends CommonFields {
  action:               'start'
  estimated_cost_usd?:  number | null
}

interface EndBody extends CommonFields {
  action:              'end'
  status:              string                 // 'success' | 'failed'
  error_message?:       string | null
  latency_ms?:          number | null
  input_tokens?:        number | null
  output_tokens?:       number | null
  input_image_tokens?:  number | null
  cached_input_tokens?: number | null
  cost_usd?:            number | null
  usage_metadata?:      unknown               // raw JSON-safe object
}

interface MediaBody extends CommonFields {
  action:    'media'
  media_url: string
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function validateCommon(b: CommonFields): string | null {
  if (!b.request_id)                       return 'request_id required'
  if (!ALLOWED_PROVIDERS.has(b.provider))  return `unknown provider: ${b.provider}`
  if (!ALLOWED_MODES.has(b.mode))          return `unknown mode: ${b.mode}`
  if (!b.model_name)                       return 'model_name required'
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, { status: 405 })
  }

  let body: StartBody | EndBody | MediaBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid json' }, { status: 400 })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const commonRow = {
    request_id: body.request_id,
    provider:   body.provider,
    model_name: body.model_name,
    model_id:   body.model_id ?? null,
    mode:       body.mode,
    user_id:    body.user_id ?? null,
  }

  // ── start ──────────────────────────────────────────────────────────────
  if (body.action === 'start') {
    const err = validateCommon(body)
    if (err) return jsonResponse({ error: err }, { status: 400 })

    const { error } = await sb.from('provider_calls').insert({
      ...commonRow,
      event:              'start',
      estimated_cost_usd: body.estimated_cost_usd ?? null,
    })
    if (error) return jsonResponse({ error: error.message }, { status: 500 })
    return jsonResponse({ ok: true })
  }

  // ── end ────────────────────────────────────────────────────────────────
  if (body.action === 'end') {
    const err = validateCommon(body)
    if (err) return jsonResponse({ error: err }, { status: 400 })
    if (!ALLOWED_STATUS.has(body.status)) {
      return jsonResponse({ error: 'status must be success|failed' }, { status: 400 })
    }

    const { error } = await sb.from('provider_calls').insert({
      ...commonRow,
      event:               'end',
      status:              body.status,
      error_message:       body.error_message       ?? null,
      latency_ms:          body.latency_ms          ?? null,
      input_tokens:        body.input_tokens        ?? null,
      output_tokens:       body.output_tokens       ?? null,
      input_image_tokens:  body.input_image_tokens  ?? null,
      cached_input_tokens: body.cached_input_tokens ?? null,
      cost_usd:            body.cost_usd            ?? null,
      usage_metadata:      body.usage_metadata      ?? null,
    })
    if (error) return jsonResponse({ error: error.message }, { status: 500 })
    return jsonResponse({ ok: true })
  }

  // ── media ──────────────────────────────────────────────────────────────
  if (body.action === 'media') {
    const err = validateCommon(body)
    if (err) return jsonResponse({ error: err }, { status: 400 })
    if (!body.media_url) return jsonResponse({ error: 'media_url required' }, { status: 400 })

    const { error } = await sb.from('provider_calls').insert({
      ...commonRow,
      event:     'media',
      media_url: body.media_url,
    })
    if (error) return jsonResponse({ error: error.message }, { status: 500 })
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'unknown action' }, { status: 400 })
})
