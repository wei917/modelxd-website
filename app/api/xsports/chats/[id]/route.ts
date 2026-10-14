// app/api/xsports/chats/[id]/route.ts — one of the caller's chats.
//   GET     the chat and its messages, in order
//   DELETE  the chat and its messages (cascade)

import { createSupabaseServer } from '@/lib/supabase-server'
import { deleteChat, getChat, getMessages } from '@/lib/xsports-store'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const chat = await getChat(user.id, id)
  if (!chat) return Response.json({ error: 'not found' }, { status: 404 })
  // The cue is what the model was told; the page has no use for it.
  const messages = (await getMessages(chat.id)).map(({ cue: _cue, ...m }) => m)
  return Response.json({ chat, messages })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return (await deleteChat(user.id, id)) ? Response.json({ ok: true }) : Response.json({ error: 'not found' }, { status: 404 })
}
