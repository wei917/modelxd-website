// app/api/xduel/quota/route.ts
//
// Returns the signed-in user's XDuel quota usage for today (UTC) along
// with the configured per-mode caps, so the UI can show "1 / 3 image
// XDuels used today" near the prompt input. Read-only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createSupabaseServer } from '@/lib/supabase-server'
import { DUEL_LIMITS } from '@/lib/duel-quota'

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS on duel_quotas allows owner-read, so the browser-client query
  // would also work — but doing it server-side keeps the page payload
  // smaller and avoids a second round trip from Nav etc.
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const { data, error } = await sb
    .from('duel_quotas')
    .select('text_used, image_used, video_used, quota_date')
    .eq('user_id', user.id)
    .eq('quota_date', today)
    .maybeSingle()

  if (error) {
    console.warn('[api/xduel/quota] read failed:', error.message)
    // Don't 500 — return zeros so the UI degrades gracefully.
  }

  return Response.json({
    limits: DUEL_LIMITS,
    used: {
      text:  data?.text_used  ?? 0,
      image: data?.image_used ?? 0,
      video: data?.video_used ?? 0,
    },
    date: today,
  })
}
