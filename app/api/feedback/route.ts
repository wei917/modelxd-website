// app/api/feedback/route.ts — in-app bug reports (owner, Aug 7).
// Stores the report + optional screenshot in Supabase (table `feedback`,
// private bucket `feedback`) — no email delivery by design; the form
// offers the contact address as click-to-copy instead. Requires
// migration 74.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

// Modest in-memory rate limit, per instance — same floor-not-wall
// tradeoff as the site agent. A feedback form is a spam target.
const hits = new Map<string, { n: number; t: number }>()
const allow = (key: string) => {
  const now = Date.now()
  const h = hits.get(key)
  if (!h || now - h.t > 3_600_000) { hits.set(key, { n: 1, t: now }); return true }
  h.n++
  return h.n <= 6
}

const MAX_SHOT_BYTES = 4 * 1024 * 1024

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const description = String(body.description ?? '').trim().slice(0, 4000)
  if (!description) return Response.json({ error: 'Say what happened — the report is the text.' }, { status: 400 })

  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  if (!allow(user?.id ?? ip)) {
    return Response.json({ error: 'Too many reports — give it an hour.' }, { status: 429 })
  }

  // Screenshot: a data-URL PNG rendered client-side, previewed and
  // consented-to by the user before it was sent.
  let screenshotPath: string | null = null
  const shot = typeof body.screenshot === 'string' ? body.screenshot : null
  if (shot && shot.startsWith('data:image/png;base64,')) {
    const b64 = shot.slice('data:image/png;base64,'.length)
    const bytes = Buffer.from(b64, 'base64')
    if (bytes.length > 0 && bytes.length <= MAX_SHOT_BYTES) {
      const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.png`
      const { error } = await svc().storage.from('feedback').upload(path, bytes, { contentType: 'image/png' })
      if (!error) screenshotPath = path
      else console.warn('[feedback] screenshot upload failed:', error.message)
    }
  }

  const { error } = await svc().from('feedback').insert({
    user_id: user?.id ?? null,
    email: user?.email ?? null,
    page: String(body.page ?? '').slice(0, 300),
    description,
    context: {
      userAgent: String(body.context?.userAgent ?? '').slice(0, 300),
      viewport: String(body.context?.viewport ?? '').slice(0, 40),
      lang: String(body.context?.lang ?? '').slice(0, 12),
    },
    screenshot_path: screenshotPath,
  })
  if (error) {
    console.warn('[feedback] insert failed:', error.message)
    // The likeliest cause is migration 74 not applied yet.
    return Response.json({ error: 'Could not save the report — is migration 74 applied?' }, { status: 503 })
  }
  return Response.json({ ok: true })
}
