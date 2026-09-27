// app/admin/trending/page.tsx
// Admin-only review of the "Trending on social media" list: the Monday
// search's candidates arrive as 'pending'; the owner picks up to 20 per kind
// and publishes them. Server-side gate, same as /admin/models.

import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin'
import { serviceClient } from '@/lib/trending-job'
import { eligibility, loadSupport } from '@/lib/trending-models'
import AdminTrendingClient, { type AdminTrendRow } from './AdminTrendingClient'

export const dynamic = 'force-dynamic'

/** Rows this page loads, newest week first. */
const ADMIN_ROWS = 1000

export default async function AdminTrendingPage() {
  const admin = await getAdminUser()
  if (!admin) redirect('/')

  const sb = serviceClient()
  const { data, error } = await sb.from('trending_posts')
    .select('id, platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank, status, created_at')
    .order('week', { ascending: false })
    .order('likes', { ascending: false, nullsFirst: false })
    .limit(ADMIN_ROWS + 1)
  if (error) {
    return <div style={{ padding: 32, color: 'var(--red)' }}>Failed to load: {error.message}</div>
  }
  // Newest weeks first: when the page can't hold every row, the oldest week
  // it shows may be cut short. Publishing a week hides every row of it that
  // isn't ticked, so that week must not be publishable from here (the
  // database refuses too: publish_trending_week checks `seen`).
  const truncated = (data?.length ?? 0) > ADMIN_ROWS
  const loaded = (data ?? []).slice(0, ADMIN_ROWS)
  const partialWeek = truncated ? loaded[loaded.length - 1]?.week ?? null : null

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const { data: calls } = await sb.from('provider_calls').select('cost_usd')
    .eq('event', 'end').eq('provider', 'xai').eq('usage_metadata->>job', 'trending').gte('created_at', monthStart)
  const spent = (calls ?? []).reduce((s, r: any) => s + (Number(r.cost_usd) || 0), 0)
  const budget = Number(process.env.TRENDING_MONTHLY_BUDGET_USD || 10)

  // Why a row can't show on XCreate, if it can't: /api/trending serves only
  // posts made with models XCreate offers, whatever their status here.
  const rows = loaded as AdminTrendRow[]
  const notShown: Record<string, string> = {}
  let catalogError: string | null = null
  try {
    const support = await loadSupport(sb)
    for (const r of rows) {
      const v = eligibility(r.kind, r.models ?? [], support)
      if (!v.ok) notShown[r.id] = v.reason
    }
  } catch (err) {
    catalogError = (err as Error).message
  }

  return <AdminTrendingClient rows={rows} spent={spent} budget={budget} notShown={notShown} catalogError={catalogError} partialWeek={partialWeek} />
}
