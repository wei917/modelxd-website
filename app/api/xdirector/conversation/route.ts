// app/api/xdirector/conversation/route.ts
// Persist and reload an XDirector chat (CC, July 28).
//
// Before this, the whole conversation lived in React state: a reload wiped
// it and there was no URL to come back to or bookmark. GET loads one by id,
// POST upserts. Both go through the service client with an explicit owner
// check, so a guessed id returns 404 rather than someone else's chat.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'

const LOG = '[xdirector:convo]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CHARS = 600_000   // the agent route caps context at 400k

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

async function requireUser() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function GET(req: Request) {
  const gate = await assertFeature('xdirector')
  if (gate) return gate

  const user = await requireUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id || !UUID.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })

  // storyboard first, plain columns as the fallback — 71_xdirector_storyboard
  // may not have run yet, and PostgREST errors on unknown columns rather than
  // returning null for them. Same ladder the board loader uses.
  const svc = serviceClient()
  let data: any = null
  {
    const a = await svc.from('xdirector_conversations')
      .select('id, user_id, title, protocol, bubbles, skill, storyboard, updated_at, deleted_at')
      .eq('id', id).maybeSingle()
    if (!a.error) data = a.data
    else {
      const b = await svc.from('xdirector_conversations')
        .select('id, user_id, title, protocol, bubbles, skill, updated_at, deleted_at')
        .eq('id', id).maybeSingle()
      if (b.error) {
        // Most likely the base migration hasn't run yet — say so rather than
        // 500ing into a blank screen.
        console.warn(`${LOG} read failed:`, b.error.message)
        return Response.json({ error: 'Conversation storage unavailable' }, { status: 503 })
      }
      data = b.data
    }
  }
  if (!data || data.user_id !== user.id || data.deleted_at) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json({ conversation: {
    id: data.id, title: data.title, protocol: data.protocol, bubbles: data.bubbles,
    skill: data.skill ?? null, storyboard: Array.isArray(data.storyboard) ? data.storyboard : null,
  } })
}

export async function POST(req: Request) {
  const gate = await assertFeature('xdirector')
  if (gate) return gate

  const user = await requireUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { id, title, protocol, bubbles, skill, storyboard } = body ?? {}
  if (!Array.isArray(protocol) || !Array.isArray(bubbles)) {
    return Response.json({ error: 'protocol and bubbles must be arrays' }, { status: 400 })
  }
  const payloadSize = JSON.stringify(protocol).length + JSON.stringify(bubbles).length
  if (payloadSize > MAX_CHARS) {
    return Response.json({ error: 'Conversation too large to save' }, { status: 413 })
  }

  const sb = serviceClient()
  const now = new Date().toISOString()
  const row: any = {
    user_id: user.id,
    title: typeof title === 'string' ? title.slice(0, 120) : null,
    protocol, bubbles, updated_at: now,
    skill: typeof skill === 'string' && skill ? skill.slice(0, 64) : null,
  }
  // Bounded pass-through: the scenes were validated by the agent route (or
  // assembled by our own client); this route only keeps the column from
  // becoming a dumping ground.
  if (Array.isArray(storyboard) && storyboard.length > 0 && JSON.stringify(storyboard).length <= 100_000) {
    row.storyboard = storyboard.slice(0, 12)
  } else if (storyboard === null) {
    row.storyboard = null   // explicit clear
  }

  // If 71_xdirector_storyboard hasn't run, the storyboard key makes the whole
  // write fail — retry without it so the conversation itself still saves.
  const writeRow = async (r: any, op: 'update' | 'insert', rowId?: string) => {
    const run = (attempt: any) => op === 'update'
      ? sb.from('xdirector_conversations').update(attempt).eq('id', rowId!)
      : sb.from('xdirector_conversations').insert(attempt).select('id').single()
    let res: any = await run(r)
    if (res.error && 'storyboard' in r && /storyboard/i.test(res.error.message ?? '')) {
      const { storyboard: _drop, ...bare } = r
      console.warn(`${LOG} storyboard column missing — saving without it (run 71_xdirector_storyboard.sql)`)
      res = await run(bare)
    }
    return res
  }

  if (id && UUID.test(id)) {
    // Update in place, but only the owner's own row.
    const { data: existing } = await sb.from('xdirector_conversations')
      .select('id, user_id').eq('id', id).maybeSingle()
    if (existing && existing.user_id !== user.id) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing) {
      const { error } = await writeRow(row, 'update', id)
      if (error) {
        console.warn(`${LOG} update failed:`, error.message)
        return Response.json({ error: 'Save failed' }, { status: 503 })
      }
      return Response.json({ id })
    }
    row.id = id   // client pre-generated the id so it could set the URL first
  }

  const { data, error } = await writeRow(row, 'insert')
  if (error || !data) {
    console.warn(`${LOG} insert failed:`, error?.message)
    return Response.json({ error: 'Save failed' }, { status: 503 })
  }
  return Response.json({ id: data.id })
}
