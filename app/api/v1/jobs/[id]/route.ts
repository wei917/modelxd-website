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

  // /api/xcreate/job/[id] answers { job, slots } in the studio's camelCase.
  // Reading `mode` and `model_name` off the wrong level is why every video job
  // used to report itself as an `image.generation.job` with no `model` at all.
  const job = body?.job ?? {}
  const slots: any[] = Array.isArray(body?.slots) ? body.slots : []
  const cost = slots.reduce((sum, s) => sum + (Number(s.cost) || 0), 0)

  // The job row is the authority on failure — a run that dies before its slots
  // are seeded has no slot to carry the error, and scanning an empty array
  // would report it as running for ever.
  const failed = job.status === 'failed' || (slots.length > 0 && slots.every(s => s.error))
  const done = !failed && slots.length > 0 && slots.every(s => s.done)

  return Response.json({
    id,
    object: `${job.mode ?? 'image'}.generation.job`,
    status: failed ? 'failed' : done ? 'succeeded' : 'running',
    model: slots[0]?.modelName ? `${slots[0].provider}/${slots[0].modelName}` : undefined,
    // The generated files. For image and video slots the URL arrives in `text`
    // (that column carries a slot's output whatever its shape). It is a signed
    // Supabase URL — fetch it promptly, they expire in 24h (CLAUDE.md #11).
    data: slots.filter(s => s.text).map(s => ({
      url: s.text,
      error: s.error ?? undefined,
    })),
    usage: { cost_usd: cost },
    error: failed ? (slots.find(s => s.error)?.error ?? job.error ?? 'generation failed') : undefined,
  })
}
