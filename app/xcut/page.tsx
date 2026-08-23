// app/xcut/page.tsx — XCut, the cutting room. Signed-in only (the client
// shows the auth modal to strangers, like XDirect). ?p=<project> opens a
// cut; ?from=<board> makes the rough cut of an XDirect board and opens it.

import { Suspense } from 'react'
import XCutClient from './client'

// useSearchParams() in the client needs a Suspense boundary or the static
// prerender of /xcut aborts the WHOLE Vercel build (it did, Aug 23 — the
// dev deploy of the new hero failed on this page). Same pattern as XDirect.
export default async function XCutPage() {
  return (
    <Suspense fallback={null}>
      <XCutClient />
    </Suspense>
  )
}
