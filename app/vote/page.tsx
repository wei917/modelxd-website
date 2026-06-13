// app/vote/page.tsx
//
// Backward-compat 308 redirect: /vote was renamed to /xvote in the
// XDuel/XCreate/XVote naming alignment. Keep this server component
// around so old bookmarks and shared links still land on the new URL.

import { redirect } from 'next/navigation'

export default function VoteRedirect() {
  redirect('/xvote')
}
