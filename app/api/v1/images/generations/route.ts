// POST /api/v1/images/generations — REST image generation.
//
// OpenAI-named so `client.images.generate()` finds it, but ASYNC: we return a
// job id, not a finished image. OpenAI's own endpoint blocks; ours cannot,
// because a ModelXD image run can take a minute and a blocking REST call dies
// at some proxy timeout. Poll GET /api/v1/jobs/{id} — the same pattern the
// Tripo routes use, so one polling loop serves images, video and 3D.

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
  try { model = await resolveGenModel(body?.model, 'image') } catch (e) { return e as Response }

  // OpenAI's own names where they exist (`size`, `quality`, `n`), ModelXD's
  // where they don't (`aspect_ratio`). `size` is accepted and mapped so an
  // OpenAI client works unchanged.
  const options: Record<string, unknown> = {}
  if (typeof body.aspect_ratio === 'string') options.aspect_ratio = body.aspect_ratio
  else if (typeof body.size === 'string' && /^\d+x\d+$/.test(body.size)) options.size = body.size
  if (typeof body.quality === 'string') options.quality = body.quality
  if (Number.isInteger(body.n) && body.n > 1) options.n = Math.min(4, body.n)

  const started = await startJob(caller, req, 'image', model.id, prompt, options)
  if (started instanceof Response) return started

  return Response.json({
    id: started.jobId,
    object: 'image.generation.job',
    status: 'running',
    model: `${model.provider}/${model.model_name}`,
    created: Math.floor(Date.now() / 1000),
    poll: `/api/v1/jobs/${started.jobId}`,
    hint: 'Generation continues server-side. Poll the `poll` URL until status is succeeded or failed.',
  }, { status: 202 })
}
