// app/xcreate/page.tsx
// Server shell for XCreate. The beta flags it used to resolve are gone
// (canvas opened to everyone, Aug 18) — the shell survives as the
// server/client split point /xdirect also uses.

import CreateClient from './client'
import { readShowcase } from '@/lib/showcase'

// The gallery is read HERE, on the server, so its pictures are in the HTML
// rather than waiting on a client fetch. A client-side fetch renders nothing
// at all wherever React defers passive effects (any hidden or background tab),
// and costs a waterfall everywhere else.
export default async function XCreatePage() {
  const showcase = await readShowcase().catch(() => [])
  return <CreateClient showcase={showcase} />
}
