// app/api/xcreate/remake/examples/route.ts: 同款's "try a popular one" row
// (owner, Oct 13: "put some example popular links in the page? so people can
// try them"). The trending feed's LIVE videos, which the owner published in
// /admin/trending and which have 1,000+ likes (the feed's bar), most liked
// first, from the platforms a read takes by link (X today).
//
//   GET -> { examples: [{ url, handle, likes, summary }] }
//
// Unlike /api/trending it does not ask whether XCreate runs the model the
// post credits: a remake is made with our models whatever the original used.
// `trending_posts` is service-key only (supabase/108). A failed read answers
// an empty list, so the page just shows no row.

import { createClient } from '@supabase/supabase-js'
import { TRENDING_MIN_LIKES } from '@/app/xcreate/trending'

/** Platforms the read takes by link. YouTube rows would join here. */
const READABLE = ['x']
const MAX = 8

export async function GET() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data, error } = await sb.from('trending_posts')
    .select('platform, post_id, handle, url, likes, summary')
    .eq('status', 'live').eq('kind', 'video').in('platform', READABLE)
    .gte('likes', TRENDING_MIN_LIKES)
    .order('likes', { ascending: false })
    .limit(MAX * 2)
  if (error) {
    console.warn(`[remake:examples] ${error.message}`)
    return Response.json({ examples: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
  // A post can be live in more than one week: once each.
  const seen = new Set<string>()
  const examples = (data ?? []).filter(r => {
    const key = `${r.platform}:${r.post_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX).map(r => ({ url: r.url as string, handle: r.handle as string, likes: r.likes as number, summary: (r.summary ?? {}) as Record<string, string> }))
  return Response.json({ examples }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } })
}
