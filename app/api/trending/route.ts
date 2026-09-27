// app/api/trending/route.ts
// Public read of the "Trending on social media" list (XCreate Studio and
// Templates tabs): the latest week's live posts for one kind, in rank order.
// `trending_posts` is service-key only (supabase/108), so this route is the
// only way the list leaves the database. Until the owner runs 108, or if the
// read fails, it serves the compiled seed so the section never blanks.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FALLBACK_TRENDING, TRENDING_MAX, type TrendingKind, type TrendingPost } from '@/app/xcreate/trending'

export async function GET(req: NextRequest) {
  const kind: TrendingKind = req.nextUrl.searchParams.get('kind') === 'image' ? 'image' : 'video'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  })
  const { data, error } = await sb
    .from('trending_posts')
    .select('platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank')
    .eq('kind', kind)
    .eq('status', 'live')
    .order('week', { ascending: false })
    .order('rank', { ascending: true })
    .limit(50)

  let posts: TrendingPost[]
  if (error) {
    console.warn(`[trending] read failed, serving the seed: ${error.message}`)
    posts = FALLBACK_TRENDING.filter(p => p.kind === kind).slice(0, TRENDING_MAX)
  } else {
    // Only the newest week that has live posts of this kind; an older week
    // never tops up a short one.
    const week = data[0]?.week
    posts = data.filter(r => r.week === week).slice(0, TRENDING_MAX).map(r => ({
      platform: r.platform, postId: r.post_id, handle: r.handle, url: r.url, kind: r.kind,
      models: r.models ?? [], likes: r.likes, summary: r.summary ?? {},
      prompt: r.prompt ?? null, preset: r.preset ?? null,
    }))
  }

  return NextResponse.json({ posts }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
  })
}
