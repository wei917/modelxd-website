// app/api/xarch/projects/[id]/photo/route.ts — interior edit of a room
// photo ("replace the sofa with a grey L-shaped one"). GPT Image 2, with an
// optional painted mask (transparent = repaint, as in XCreate region edit).
// The result is a NEW media item on the same room; the original stays.

export const runtime = 'nodejs'
export const maxDuration = 300

import { service } from '@/lib/xarch-ai'
import { runPhotoEdit } from '../../../_photo'
import { owned, view, fail } from '../../../_shared'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const body = await req.json().catch(() => ({}))
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  if (!prompt) return Response.json({ error: 'Describe the change.' }, { status: 400 })
  try {
    const { item, cents } = await runPhotoEdit(req, o.row, o.userId, String(body?.media_id ?? ''), prompt, body?.mask ?? null)
    // Re-read: a photo edit takes ~30-60s and the user may have edited the plan meanwhile.
    const { data: fresh } = await service().from('xarch_projects').select('media, spent_cents, chat').eq('id', o.row.id).single()
    const at = new Date().toISOString()
    // Logged in the conversation like every other action, so the agent
    // column shows what was redesigned and links to it.
    const chat = [...(fresh?.chat ?? o.row.chat ?? []),
      { role: 'user', text: `[photo] ${prompt}`, at, via: 'photo' },
      { role: 'assistant', text: 'Here is the redesigned photo. The original is kept.', at, via: 'photo', action: { type: 'edit_photo', media_id: item.id, room_id: item.room_id, prompt, cost_cents: cents } },
    ].slice(-80)
    const { data } = await service().from('xarch_projects').update({
      media: [...(fresh?.media ?? o.row.media ?? []), item], chat, spent_cents: (fresh?.spent_cents ?? 0) + cents, updated_at: at,
    }).eq('id', o.row.id).select('*').single()
    return Response.json({ project: await view(data ?? o.row), media_id: item.id, cost_cents: cents })
  } catch (e) {
    return fail(e, 'The photo edit failed')
  }
}
