// app/api/mcp/route.ts — the MCP server: ModelXD generation as agent-callable
// tools (owner, Aug 17: "I definitely want to use MCP").
//
// Stateless MCP Streamable HTTP, HAND-ROLLED on purpose (same reasoning as
// the skills parser): the stateless subset is one JSON-RPC POST handler —
// initialize / tools/list / tools/call — and owning it outright beats
// adopting an SDK dependency for ~200 lines. No session ids, no SSE push
// stream (GET answers 405, which the spec names as the no-stream answer);
// every request is authenticated by an API key from the XDev page.
//
// The tools are THIN. Generation goes through the real /api/xcreate route
// with the caller's bearer forwarded — billing, jobs, gallery, boards and
// the per-key spend cap all behave exactly as if the user clicked the site.
// Long generations return a job_id fast (the xcreate lambda keeps running
// after we abandon the internal fetch — that is its designed behavior for
// browser navigation, reused here) and check_job polls the same job API.

export const runtime = 'nodejs'
export const maxDuration = 60

import { resolveApiToken, type ApiTokenContext } from '@/lib/api-token'
import { getUserCredits } from '@/lib/credits'

const PROTOCOL = '2025-06-18'
const LOG = '[mcp]'

// ── JSON-RPC plumbing ────────────────────────────────────────────────────

type Rpc = { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: any }

const rpcResult = (id: any, result: any) =>
  Response.json({ jsonrpc: '2.0', id, result })
const rpcError = (id: any, code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_leaderboard',
    description:
      'The ModelXD leaderboard: AI models ranked by XD Score, which is computed from real blind human votes (quality voted before price is revealed, value voted after). Use it to see which models are genuinely good and what they cost. mode filters to text | image | video; omit for the overall board.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['all', 'text', 'image', 'video'], description: 'Which board to read. Default all.' },
      },
    },
  },
  {
    name: 'pick_model',
    description:
      'Recommend a model for a generation, backed by the vote-based leaderboard. Returns the top pick plus runners-up with scores and price labels. Use the returned model_id with generate_image / generate_video.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['text', 'image', 'video'], description: 'What you want to generate.' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate an image on ModelXD. Bills the API key owner\'s credits at the model\'s listed price. Returns output URLs when the model finishes quickly, otherwise a job_id to poll with check_job. Content is AI-generated — label it as such wherever you publish it.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to generate.' },
        model_id: { type: 'string', description: 'ai model id from get_leaderboard / pick_model.' },
        aspect_ratio: { type: 'string', description: 'e.g. 16:9, 9:16, 1:1, 4:5, 3:4. Optional.' },
        quality: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional, default medium.' },
      },
      required: ['prompt', 'model_id'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a video on ModelXD. Bills the API key owner\'s credits (typically $0.05-0.15 per second — check the leaderboard price label). Always returns a job_id immediately; poll check_job every ~15s until done. Content is AI-generated — label it as such wherever you publish it.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to generate.' },
        model_id: { type: 'string', description: 'ai model id from get_leaderboard / pick_model.' },
        duration: { type: 'number', description: 'Seconds (integer). Model-dependent range, commonly 4-15. Optional.' },
        aspect_ratio: { type: 'string', description: 'e.g. 16:9, 9:16. Optional.' },
      },
      required: ['prompt', 'model_id'],
    },
  },
  {
    name: 'check_job',
    description: 'Poll a generation job by job_id. Returns status and, when done, per-model outputs with URLs and actual cost.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
  },
  {
    name: 'get_balance',
    description: 'The API key owner\'s current ModelXD credit balance, plus this key\'s spend and cap.',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ── Tool implementations ─────────────────────────────────────────────────

type Ctx = { tok: ApiTokenContext; origin: string; bearer: string }

async function fetchBoard(origin: string, mode: string): Promise<any[]> {
  const res = await fetch(`${origin}/api/xboard?mode=${encodeURIComponent(mode)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`leaderboard read failed (${res.status})`)
  return res.json()
}

/** Wait for an internal fetch up to ms; on timeout abandon it (the target
 *  lambda keeps running — xcreate is built to survive client disconnect). */
async function fetchWithGrace(url: string, init: RequestInit, ms: number): Promise<Response | 'pending'> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    return res
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'pending'
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function startGeneration(ctx: Ctx, mode: 'image' | 'video', args: any, graceMs: number) {
  const jobId = globalThis.crypto.randomUUID()
  const options: any = {}
  if (args.aspect_ratio) options.aspect_ratio = String(args.aspect_ratio)
  if (mode === 'image' && args.quality) options.quality = String(args.quality)
  if (mode === 'video' && args.duration) options.duration = Math.round(Number(args.duration))

  const res = await fetchWithGrace(`${ctx.origin}/api/xcreate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ctx.bearer },
    body: JSON.stringify({
      prompt: String(args.prompt ?? ''),
      mode,
      modelIds: [String(args.model_id)],
      modelOptions: [options],
      jobId,
    }),
  }, graceMs)

  if (res === 'pending') {
    return { job_id: jobId, status: 'running', hint: `Generation continues server-side. Poll check_job with this job_id${mode === 'video' ? ' every ~15s' : ''}.` }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.message ?? body?.error ?? `generation failed (${res.status})`)
  }
  return { job_id: jobId, status: 'submitted', response: body, hint: 'Poll check_job for outputs if none are present in response.' }
}

async function checkJob(ctx: Ctx, jobId: string) {
  const res = await fetch(`${ctx.origin}/api/xcreate/job/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: ctx.bearer }, cache: 'no-store',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `job read failed (${res.status})`)
  const slots = (body.slots ?? []).map((s: any) => ({
    model: s.name ?? s.modelName,
    done: !!s.done,
    progress: s.progress ?? null,
    cost_usd: Number(s.cost ?? 0),
    error: s.error ?? null,
    output_urls: typeof s.text === 'string' && s.text.startsWith('http') ? s.text.split('\n') : [],
  }))
  return { job_id: jobId, status: body.job?.status, mode: body.job?.mode, slots }
}

async function callTool(name: string, args: any, ctx: Ctx): Promise<any> {
  switch (name) {
    case 'get_leaderboard': {
      const rows = await fetchBoard(ctx.origin, args?.mode ?? 'all')
      return rows.map((r: any) => ({
        model_id: r.modelId, name: r.name, provider: r.provider,
        xd_score: r.xdScore, votes: r.totalVotes, price: r.priceLabel,
      }))
    }
    case 'pick_model': {
      const rows = await fetchBoard(ctx.origin, String(args.mode))
      if (rows.length === 0) throw new Error(`no rated models for mode ${args.mode}`)
      const shaped = rows.slice(0, 5).map((r: any) => ({
        model_id: r.modelId, name: r.name, provider: r.provider,
        xd_score: r.xdScore, votes: r.totalVotes, price: r.priceLabel,
      }))
      return {
        pick: shaped[0],
        runners_up: shaped.slice(1),
        basis: 'XD Score from blind human votes (quality 40% + price-aware value 40% + retention 20%)',
      }
    }
    case 'generate_image':
      return startGeneration(ctx, 'image', args, 25_000)
    case 'generate_video':
      return startGeneration(ctx, 'video', args, 5_000)
    case 'check_job':
      return checkJob(ctx, String(args.job_id))
    case 'get_balance': {
      const credits = await getUserCredits(ctx.tok.userId)
      const cents = Number((credits as any)?.balance_cents ?? 0)
      return {
        balance_usd: (cents / 100).toFixed(2),
        key: ctx.tok.name,
        key_spent_usd: ctx.tok.spentUsd.toFixed(2),
        key_spend_cap_usd: ctx.tok.spendCapUsd === null ? 'uncapped' : ctx.tok.spendCapUsd.toFixed(2),
      }
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

// ── HTTP handlers ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const tok = await resolveApiToken(req.headers.get('authorization'))
  if (!tok) {
    return new Response(JSON.stringify({ error: 'invalid_token', message: 'Pass a ModelXD API key: Authorization: Bearer xd_… (mint one on /xdev).' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="ModelXD MCP"' },
    })
  }

  let msg: Rpc
  try { msg = await req.json() } catch { return rpcError(null, -32700, 'parse error') }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'batching is not supported')
  const { id, method, params } = msg ?? {}
  if (typeof method !== 'string') return rpcError(id, -32600, 'invalid request')

  // Notifications get a body-less 202 (stateless server, nothing to store).
  if (method.startsWith('notifications/')) return new Response(null, { status: 202 })

  const origin = new URL(req.url).origin
  const ctx: Ctx = { tok, origin, bearer: req.headers.get('authorization')! }

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        return rpcResult(id, {
          protocolVersion: requested === '2025-03-26' ? requested : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'modelxd', version: '1.0.0' },
          instructions:
            'ModelXD compares AI models with blind human votes and generates through 8 providers with honest pricing. ' +
            'Flow: pick_model (or get_leaderboard) → generate_image / generate_video → check_job until done. ' +
            'Generations bill the key owner\'s ModelXD credits; check get_balance first. All outputs are AI-generated — label them as such when publishing.',
        })
      }
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS })
      case 'tools/call': {
        const name = String(params?.name ?? '')
        console.log(`${LOG} ${tok.userId.slice(0, 8)} calls ${name}`)
        try {
          const data = await callTool(name, params?.arguments ?? {}, ctx)
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], isError: false })
        } catch (err: any) {
          // Tool failures are RESULTS with isError (the model should read
          // them), not protocol errors.
          return rpcResult(id, { content: [{ type: 'text', text: `Error: ${err?.message ?? 'tool failed'}` }], isError: true })
        }
      }
      default:
        return rpcError(id, -32601, `method not found: ${method}`)
    }
  } catch (err: any) {
    console.error(`${LOG} internal:`, err)
    return rpcError(id, -32603, 'internal error')
  }
}

// No server-push stream on this stateless server — 405 is the spec's answer.
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
