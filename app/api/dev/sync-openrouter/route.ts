// app/api/dev/sync-openrouter/route.ts
//
// DEV-ONLY endpoint that runs the OpenRouter -> Supabase catalog sync from
// inside the Next.js server process. We need this because our local dev
// sandbox can't reach openrouter.ai / Supabase directly, but Vercel /
// `next dev` can.
//
// Usage:
//   POST /api/dev/sync-openrouter            # full sync (text + image + video)
//   POST /api/dev/sync-openrouter?dry=1      # preview only, no writes
//   POST /api/dev/sync-openrouter?mode=image # restrict to one mode
//
// Returns a JSON summary from runSync() — fetched counts, builtByMode,
// skip counts, rows written, and a sample row so you can sanity check the
// shape before committing.

import { runSync, type ModelMode } from '@/lib/sync-openrouter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseMode(raw: string | null): ModelMode | null {
  if (raw === 'text' || raw === 'image' || raw === 'video') return raw
  return null
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true'
  const mode = parseMode(url.searchParams.get('mode'))

  try {
    const result = await runSync({ dryRun, mode })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
