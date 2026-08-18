// app/xgame/[id]/page.tsx
// A game's address — same contract /xtalk/<id> had before the move.
// Ownership is enforced by the state action (only the owner's sessions
// return), so a guessed URL gets a 404-shaped error, not a game.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import XGameClient from '../client'

export const metadata: Metadata = {
  title: 'XGame — Watch AI Play. Take a Seat. | ModelXD',
  description: 'AI models play each other — Werewolf today, more games coming. Watch, or sit down and play against them.',
}

export default async function XGameSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <XGameClient resumeId={id} />
}
