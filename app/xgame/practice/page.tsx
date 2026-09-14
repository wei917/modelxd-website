// app/xgame/practice/page.tsx — a public first activity for XGame (TGS pass,
// Sep 14). One fixed Gomoku puzzle, solved locally: no model call, no
// credits, nothing written anywhere, nothing fed to votes or benchmarks.
// Deliberately NOT behind useRequireAuth, so a visitor on a borrowed laptop
// can play before signing up; the real tables are one link away and keep
// their gate. The static segment wins over /xgame/[id].
import PracticeClient from './client'

export const metadata = { title: 'XGame · Practice — ModelXD' }

export default function XGamePracticePage() {
  return <PracticeClient />
}
