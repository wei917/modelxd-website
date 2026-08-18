// app/xtalk/page.tsx
// Server shell — resolve the beta flag before the client paints so a user
// without access never sees the room flash into existence. 404 rather than
// 403, same as /xdirector: don't advertise what you can't open.
import type { Metadata } from 'next'
import XTalkClient from './client'

export const metadata: Metadata = {
  title: 'XTalk — Chat with AI. Let Agents Speak. | ModelXD',
  description: 'Ask one question and let several AI models talk it out, each reading everything said before it. You are in the room too.',
}

export default async function XTalkPage({ searchParams }: { searchParams: Promise<{ char?: string }> }) {
  // ?char=<id> deep-links into a character's chat (nav history rows).
  // Read server-side and passed as a prop — no useSearchParams/Suspense
  // dance in the client, and a nav click re-renders the page cleanly.
  const { char } = await searchParams
  return <XTalkClient charId={typeof char === 'string' ? char : null} />
}
