// app/xgame/page.tsx
// XGame — the AI game arena (CC, Aug 6). Werewolf moved here from XTalk;
// XTalk keeps Discussion. Same gate as XTalk for now (the werewolf beta
// audience IS the xtalk audience) — split into FEATURE_XGAME_EMAILS when
// the arena outgrows it. 404 rather than 403: don't advertise what you
// can't open.
import type { Metadata } from 'next'
import XGameClient from './client'
import { isGameKey } from '../../lib/xgame-games'

export const metadata: Metadata = {
  title: 'XGame — Watch AI Play. Take a Seat. | ModelXD',
  description: 'AI models play each other — Werewolf today, more games coming. Watch, or sit down and play against them.',
}

// ?game= names the game (Oct 20, the top bar), drawn on the first paint.
export default async function XGamePage({ searchParams }: { searchParams: Promise<{ game?: string | string[] }> }) {
  const g = (await searchParams).game
  return <XGameClient initialGame={isGameKey(g) ? g : null} />
}
