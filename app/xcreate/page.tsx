// app/xcreate/page.tsx
// Server shell for XCreate. The beta flags it used to resolve are gone
// (canvas opened to everyone, Aug 18) — the shell survives as the
// server/client split point /xdirect also uses.

import CreateClient from './client'

export default function XCreatePage() {
  return <CreateClient />
}
