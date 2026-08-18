// app/xdirect/page.tsx
// XDirect — the director's stage: chat rail + canvas board, one screen.
// Open to every account since Aug 18 (beta gate removed). A signed-out
// visitor gets the page shell + auth modal — the landing agent routes
// strangers here with their request in ?q=, and the auth redirect keeps
// the query string so OAuth lands them back with the request intact.

import XDirectClient from './client'

export default async function XDirectPage() {
  return <XDirectClient />
}
