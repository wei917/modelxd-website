// lib/providers/call-log.ts
//
// Thin Next.js-side client for the `log-provider-call` Supabase Edge
// Function. Three-event model: each provider request gets a 'start' row
// (with estimated cost), an 'end' row (with real cost + token usage +
// raw usage_metadata), and optionally a 'media' row (post-upload
// annotation with the storage URL). All correlated by `request_id`.
//
// All helpers are FIRE-AND-FORGET — they return synchronously, never
// block the provider call, and swallow any HTTP error to stdout. If
// the end POST is dropped (e.g. Vercel freezes a non-streaming Lambda
// after the response closes), the start row is still in the table as
// a breadcrumb that the request was attempted.

interface CallDescriptor {
  provider:   string
  model_name: string
  model_id?:  string | null
  mode:       'text' | 'image' | 'video'
  user_id?:   string | null
  /** Effort the call ran at, in the PROVIDER's own vocabulary (openai
   *  none|low|…|max, google minimal|…|high, alibaba thinking_true/false).
   *  Null when the caller picked no level. Migration 88. */
  thinking_level?: string | null
}

interface StartOptions {
  estimated_cost_usd?: number | null
}

interface EndOutcome {
  status:               'success' | 'failed'
  error_message?:        string | null
  latency_ms?:           number | null
  input_tokens?:         number | null
  output_tokens?:        number | null
  input_image_tokens?:   number | null
  cached_input_tokens?:  number | null
  cost_usd?:             number | null
  usage_metadata?:       unknown
}

function endpoint(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/functions/v1/log-provider-call`
}

function authToken(): string | null {
  return process.env.SUPABASE_SECRET_KEY ?? null
}

function fireAndForget(body: object, label: string): void {
  const url = endpoint()
  const tok = authToken()
  if (!url || !tok) return
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      'Authorization': `Bearer ${tok}`,
    },
    body: JSON.stringify(body),
  })
    .then(async r => {
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        console.warn(`[call-log] ${label} ${r.status}: ${txt.slice(0, 200)}`)
      }
    })
    .catch(e => {
      console.warn(`[call-log] ${label} exception: ${(e as Error).message}`)
    })
}

/**
 * Log the start of a provider call. Generates a request_id client-side,
 * fires the start INSERT in the background (with optional pre-call cost
 * estimate), and returns the id immediately so the caller can pair the
 * end / media rows to the same request.
 *
 * Returns null only if SUPABASE env vars are missing (logging entirely
 * disabled). Provider calls should still proceed in that case.
 */
export function startCall(d: CallDescriptor, opts: StartOptions = {}): string | null {
  const url = endpoint()
  const tok = authToken()
  if (!url || !tok) return null
  const requestId = crypto.randomUUID()
  fireAndForget(
    {
      action:             'start',
      request_id:         requestId,
      provider:           d.provider,
      model_name:         d.model_name,
      model_id:           d.model_id ?? null,
      mode:               d.mode,
      user_id:            d.user_id ?? null,
      thinking_level:     d.thinking_level ?? null,
      estimated_cost_usd: opts.estimated_cost_usd ?? null,
    },
    'start',
  )
  return requestId
}

/**
 * Log the end of a provider call as a separate row. No-op if requestId
 * is null (logging was disabled). The end row repeats the request
 * descriptors so it stands alone in queries.
 */
export function endCall(
  requestId: string | null,
  d: CallDescriptor,
  outcome: EndOutcome,
): void {
  if (!requestId) return
  fireAndForget(
    {
      action:               'end',
      request_id:           requestId,
      provider:             d.provider,
      model_name:           d.model_name,
      model_id:             d.model_id ?? null,
      mode:                 d.mode,
      user_id:              d.user_id ?? null,
      thinking_level:       d.thinking_level ?? null,
      status:               outcome.status,
      error_message:        outcome.error_message       ?? null,
      latency_ms:           outcome.latency_ms          ?? null,
      input_tokens:         outcome.input_tokens        ?? null,
      output_tokens:        outcome.output_tokens       ?? null,
      input_image_tokens:   outcome.input_image_tokens  ?? null,
      cached_input_tokens:  outcome.cached_input_tokens ?? null,
      cost_usd:             outcome.cost_usd            ?? null,
      usage_metadata:       outcome.usage_metadata      ?? null,
    },
    'end',
  )
}

/**
 * Log a 'media' event after the route handler uploads the generated
 * media to Supabase storage. Append-only: separate row, joinable by
 * request_id. No-op if requestId is null.
 */
export function logMediaUrl(
  requestId: string | null,
  d: CallDescriptor,
  mediaUrl: string,
): void {
  if (!requestId) return
  fireAndForget(
    {
      action:     'media',
      request_id: requestId,
      provider:   d.provider,
      model_name: d.model_name,
      model_id:   d.model_id ?? null,
      mode:       d.mode,
      user_id:    d.user_id ?? null,
      media_url:  mediaUrl,
    },
    'media',
  )
}
