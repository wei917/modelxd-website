// POST /api/v1/videos/generations — REST video generation. Async by
// necessity: video runs take minutes.

export const runtime = 'nodejs'
export const maxDuration = 60

import { v1Caller, err, resolveGenModel, startJob } from '@/lib/v1-generation'

export async function POST(req: Request) {
  const caller = await v1Caller(req)
  if (!caller) return err('Unauthorized', 401)
  const body = await req.json().catch(() => ({}))

  const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
  if (!prompt.trim()) return err('`prompt` is required.')

  let model: any
  try { model = await resolveGenModel(body?.model, 'video') } catch (e) { return e as Response }

  const options: Record<string, unknown> = {}
  if (typeof body.aspect_ratio === 'string') options.aspect_ratio = body.aspect_ratio
  if (body.duration !== undefined) {
    const d = Math.round(Number(body.duration))
    if (!Number.isFinite(d) || d < 1 || d > 60) return err('`duration` must be seconds between 1 and 60 (model-dependent).')
    options.duration = d
  }
  if (typeof body.resolution === 'string') options.resolution = body.resolution

  const started = await startJob(caller, req, 'video', model.id, prompt, options)
  if (started instanceof Response) return started

  return Response.json({
    id: started.jobId,
    object: 'video.generation.job',
    status: started.status,
    model: `${model.provider}/${model.model_name}`,
    created: Math.floor(Date.now() / 1000),
    poll: `/api/v1/jobs/${started.jobId}`,
    hint: 'Video takes minutes. Poll the `poll` URL every ~15s until status is succeeded or failed.',
  }, { status: 202 })
}
