// app/models/page.tsx
// /models was merged into the unified leaderboard (May 2026), which is now
// /xboard. This page exists only to redirect old bookmarks and external links.

import { redirect } from 'next/navigation'

export default function ModelsRedirect(): never {
  redirect('/xboard')
}
