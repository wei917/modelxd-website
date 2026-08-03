// app/xtalk/[id]/page.tsx
// A game's address. Same gate and shell as /xtalk — the id in the URL is
// handed to the client, which reopens that server-held session read-only
// and lets the game continue from wherever it was. Ownership is enforced
// where it matters: the state action only returns sessions whose user_id
// matches the caller, so a guessed URL gets a 404-shaped error, not a game.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasFeature } from '@/lib/features'
import XTalkClient from '../client'

export const metadata: Metadata = {
  title: 'XTalk — Chat with AI. Let Agents Speak. | ModelXD',
  description: 'Ask one question and let several AI models talk it out, each reading everything said before it. You are in the room too.',
}

export default async function XTalkSessionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('xtalk'))) notFound()
  const { id } = await params
  return <XTalkClient resumeId={id} />
}
