// app/models/page.tsx
// /models was merged into /leaderboard (May 2026). This page exists only
// to redirect old bookmarks and external links to the unified page.

import { redirect } from 'next/navigation'

export default function ModelsRedirect(): never {
  redirect('/xboard')
}
