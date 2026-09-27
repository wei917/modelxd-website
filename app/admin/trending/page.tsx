// app/admin/trending/page.tsx
// Admin-only review of the "Trending on social media" list: the Monday
// search's candidates arrive as 'pending'; the owner picks up to 20 per kind
// and publishes them. Server-side gate, same as /admin/models.

import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin'
import { serviceClient } from '@/lib/trending-job'
import AdminTrendingClient, { type AdminTrendRow } from './AdminTrendingClient'

export const dynamic = 'force-dynamic'

export default async function AdminTrendingPage() {
  const admin = await getAdminUser()
  if (!admin) redirect('/')

  const sb = serviceClient()
  const { data, error } = await sb.from('trending_posts')
    .select('id, platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank, status, created_at')
    .order('week', { ascending: false })
    .order('likes', { ascending: false, nullsFirst: false })
    .limit(300)
  if (error) {
    return <div style={{ padding: 32, color: 'var(--red)' }}>Failed to load: {error.message}</div>
  }

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const { data: calls } = await sb.from('provider_calls').select('cost_usd')
    .eq('event', 'end').eq('provider', 'xai').eq('usage_metadata->>job', 'trending').gte('created_at', monthStart)
  const spent = (calls ?? []).reduce((s, r: any) => s + (Number(r.cost_usd) || 0), 0)
  const budget = Number(process.env.TRENDING_MONTHLY_BUDGET_USD || 10)

  return <AdminTrendingClient rows={(data as AdminTrendRow[]) ?? []} spent={spent} budget={budget} />
}
