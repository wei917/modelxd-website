// app/api/xcreate/job/[id]/route.ts
// Polling endpoint for an in-progress xcreate_jobs row.
// Returns the job + all its slots in the shape the /xcreate page expects.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job, error: jobErr } = await sb
    .from('xcreate_jobs')
    .select('id, user_id, mode, prompt, status, xcreate_id, error, created_at, updated_at, completed_at')
    .eq('id', id)
    .single()

  if (jobErr || !job) return Response.json({ error: 'Not found' }, { status: 404 })
  if (job.user_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { data: slots } = await sb
    .from('xcreate_job_slots')
    .select('slot_index, model_id, provider, model_name, name, options, text, is_image, is_video, streaming, done, cost, response_time, progress, error, error_ref')
    .eq('job_id', job.id)
    .order('slot_index', { ascending: true })

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
    slots: (slots ?? []).map(s => ({
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
