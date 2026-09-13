// app/xarch/page.tsx — XArch (X建築設計): floor plans + interior design.
// Signed-in only (the client pops the auth modal). ?p=<project> opens a studio.

import { Suspense } from 'react'
import XArchClient from './client'

// useSearchParams() needs a Suspense boundary or the static prerender aborts
// the whole build (XCut, Aug 23).
export default function XArchPage() {
  return (
    <Suspense fallback={null}>
      <XArchClient />
    </Suspense>
  )
}
