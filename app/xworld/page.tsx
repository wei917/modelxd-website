// app/xworld/page.tsx — XWorld: walkable 3D worlds (World Labs Marble) and
// photo → 3D objects (Tripo). Signed-in only (the client pops the auth modal
// for strangers). ?w=<id> opens one item in the viewer.

import { Suspense } from 'react'
import XWorldClient from './client'

// useSearchParams() in the client needs a Suspense boundary or the static
// prerender aborts the whole build (XCut, Aug 23).
export default function XWorldPage() {
  return (
    <Suspense fallback={null}>
      <XWorldClient />
    </Suspense>
  )
}
