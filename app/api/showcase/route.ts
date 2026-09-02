// GET /api/showcase — the museum wall, for anything that wants it over HTTP.
//
// The XCreate page does NOT use this: it calls readShowcase() directly on the
// server so the pictures ship in the HTML. This route exists for clients that
// genuinely need the JSON. The read, the service-role rationale and the
// sign-on-demand rule all live in lib/showcase.ts.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { readShowcase } from '@/lib/showcase'

export async function GET() {
  const rooms = await readShowcase()
  return Response.json({ rooms }, {
    // Shorter than the signing TTL, so a cached payload can never outlive its
    // own URLs.
    headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' },
  })
}
