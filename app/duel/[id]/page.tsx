// app/duel/[id]/page.tsx
//
// Backward-compat 308 redirect: /duel/<id> was renamed to /xduel/<id>
// in the XDuel/XCreate/XVote naming alignment. Preserves old permalinks
// and shared XVote → duel links.

import { redirect } from 'next/navigation'

export default async function DuelPermalinkRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/xduel/${id}`)
}
