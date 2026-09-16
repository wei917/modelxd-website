// app/api/xcreate/job/[id]/route.ts
// Polling endpoint for an in-progress xcreate_jobs row.
// Returns the job + all its slots in the shape the /xcreate page expects.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { resolveApiToken } from '@/lib/api-token'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Session cookie OR API key (MCP check_job, Aug 17). The token path uses
  // the service client — RLS has no auth context there — with the explicit
  // job.user_id ownership check below doing the guarding for both paths.
  let sb: any = await createSupabaseServer()
  let userId: string | null = (await sb.auth.getUser()).data.user?.id ?? null
  if (!userId) {
    const tok = await resolveApiToken(req.headers.get('authorization'))
    if (tok) {
      userId = tok.userId
      sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
    }
  }
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job, error: jobErr } = await sb
    .from('xcreate_jobs')
    .select('id, user_id, mode, prompt, status, xcreate_id, error, created_at, updated_at, completed_at')
    .eq('id', id)
    .single()

  // "No rows" (PGRST116) is the only answer that means not found. Anything
  // else — a database outage, a timeout — is a server error, and answering
  // 404 for it let the client mistake an outage for a vanished run (Sep 16).
  if (jobErr && jobErr.code !== 'PGRST116') {
    console.error('[xcreate/job] lookup failed:', jobErr.message)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
  if (!job) return Response.json({ error: 'Not found' }, { status: 404 })
  if (job.user_id !== userId) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { data: slots, error: slotErr } = await sb
    .from('xcreate_job_slots')
    .select('slot_index, model_id, provider, model_name, name, options, text, is_image, is_video, streaming, done, cost, response_time, progress, error, error_ref')
    .eq('job_id', job.id)
    .order('slot_index', { ascending: true })
  // A slot read that failed is not "no slots yet": say so, or the client
  // paints an empty run over a live one.
  if (slotErr) {
    console.error('[xcreate/job] slot lookup failed:', slotErr.message)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }

  return Response.json({
    job: {
      id: job.id,
      mode: job.mode,
      prompt: job.prompt,
      status: job.status,
      xcreateId: job.xcreate_id,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
    },
    slots: (slots ?? []).map((s: any) => ({
      slotIndex:    s.slot_index,
      modelId:      s.model_id,
      provider:     s.provider,
      modelName:    s.model_name,
      name:         s.name,
      options:      s.options,
      text:         s.text,
      isImage:      s.is_image,
      isVideo:      s.is_video,
      streaming:    s.streaming,
      done:         s.done,
      cost:         Number(s.cost),
      responseTime: s.response_time,
      progress:     s.progress,
      error:        s.error,
      errorRef:     s.error_ref ?? null,
    })),
  })
}
