// app/xcreate/page.tsx
// Server shell for XCreate. Its only job is to resolve the beta feature
// flags before the client renders, so gated entrances (Agent Mode, the
// canvas board) are correct on the first paint instead of popping in after
// a fetch — and never flash for a user who isn't entitled.
//
// Same split /xdirector already uses: server page, client component.

import { getFeatures } from '@/lib/features'
import CreateClient from './client'

export default async function XCreatePage() {
  const features = await getFeatures()
  return <CreateClient features={features} />
}
