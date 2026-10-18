// app/api/xcreate/remake/fan/[id]/route.ts: one 風扇變裝 run's progress, and
// the video once it exists (lib/fan-template/job.ts). A run whose lease ran
// out is picked up again here, so the open page keeps it moving.

export const runtime = 'nodejs'
export const maxDuration = 800

import { after, type NextRequest } from 'next/server'
import { driveFan, fanView, isFanActive, loadFanJob } from '@/lib/fan-template/job'
import { service } from '@/lib/remake/store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const { data: { user } } = await (await createSupabaseServer()).auth.getUser()
  if (!user) return Response.json({ code: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return Response.json({ code: 'not_found' }, { status: 404 })
  const sb = service()
  const job = await loadFanJob(sb, user.id, id)
  if (!job) return Response.json({ code: 'not_found' }, { status: 404 })
  if (isFanActive(job.status) && job.leaseUntil < Date.now()) after(() => driveFan(user.id, id))
  return Response.json({ job: await fanView(sb, job), request: { title: job.request.title, outfits: job.request.outfits.map(o => o.text), music: job.request.music } })
}
