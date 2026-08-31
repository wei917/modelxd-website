// GET /api/v1/jobs/{id} — poll an image or video generation.
//
// One polling shape for both, mirroring the Tripo routes so a developer
// writes ONE loop for every asynchronous thing ModelXD does. Ownership is
// enforced by the underlying job route (403 for someone else's job).

export const runtime = 'nodejs'

import { v1Caller, err } from '@/lib/v1-generation'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await v1Caller(req)
  if (!caller) return err('Unauthorized', 401)
  const { id } = await params

  const origin = new URL(req.url).origin
  const headers: Record<string, string> = {}
  if (caller.bearer) headers.Authorization = caller.bearer
  else { const c = req.headers.get('cookie'); if (c) headers.cookie = c }

  const res = await fetch(`${origin}/api/xcreate/job/${encodeURIComponent(id)}`, { headers, cache: 'no-store', redirect: 'manual' })
  if (res.status >= 300 && res.status < 400) {
    console.error(`[v1] internal job read was redirected to ${res.headers.get('location')} — check proxy.ts bypass list`)
    return err('Job polling is misconfigured on this deployment (internal call redirected).', 500, 'server_error')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return err(body?.error ?? `job read failed (${res.status})`, res.status, 'job_error')

  const slots: any[] = Array.isArray(body?.slots) ? body.slots : []
  const done = slots.length > 0 && slots.every(s => s.done)
  const failed = slots.some(s => s.error)
  const cost = slots.reduce((sum, s) => sum + (Number(s.cost) || 0), 0)

  return Response.json({
    id,
    object: `${body?.mode ?? 'image'}.generation.job`,
    status: failed ? 'failed' : done ? 'succeeded' : 'running',
    model: slots[0]?.model_name ? `${slots[0]?.provider}/${slots[0]?.model_name}` : undefined,
    // The generated files. `url` is a signed Supabase URL — fetch it promptly;
    // they expire in 24h (see CLAUDE.md pitfall 11).
    data: slots.filter(s => s.text || s.url).map(s => ({
      url: s.url ?? s.text,
      revised_prompt: s.revised_prompt ?? undefined,
      error: s.error ?? undefined,
    })),
    usage: { cost_usd: cost },
    error: failed ? slots.find(s => s.error)?.error : undefined,
  })
}
