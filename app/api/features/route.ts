// app/api/features/route.ts
// Which beta features the signed-in user may see. Advisory only — the UI
// uses this to avoid showing doors that the server would slam.

export const runtime = 'nodejs'

import { getFeatures } from '@/lib/features'

export async function GET() {
  return Response.json(await getFeatures(), {
    // Per-user answer; never let a CDN or the browser share it.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
