// app/xtalk/c/[id]/page.tsx — a character's own page (owner, Aug 13: "a
// character page should go to a dedicated page, not stay in the XTalk
// landing"). Same gate discipline as every other room: resolve the beta
// flag server-side, 404 rather than 403.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CharacterPageClient from './client'

export const metadata: Metadata = {
  title: 'Your character — XTalk | ModelXD',
  description: 'Talk with a character you created — they remember.',
}

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CharacterPageClient charId={id} />
}
