// app/api/xcreate/remake/examples/route.ts: 同款's "try a popular one" row
// (owner, Oct 13: "put some example popular links in the page? so people can
// try them", then "at least 10k likes in total" and "popular AI video with
// prompts"). Two sources, merged, most liked first:
//   - the hand-picked list (lib/remake/examples.ts): AI videos with 10k+
//     likes and the author's prompt, each checked with the X API;
//   - the trending feed's LIVE videos with 10k+ likes (published by the
//     owner in /admin/trending), from platforms a read takes by link (X).
// The bar is REMAKE_EXAMPLE_MIN_LIKES (10,000): the feed's own 1,000 let a
// 1,042-like post in. With nothing over it the page shows no row.
//
//   GET -> { examples: [{ url, handle, likes, models, prompt, summary }] }
//
// Unlike /api/trending it does not ask whether XCreate runs the model the
// post credits: a remake is made with our models whatever the original used.
// `trending_posts` is service-key only (supabase/108). A failed read of it
// still serves the hand-picked list.

import { createClient } from '@supabase/supabase-js'
import { REMAKE_EXAMPLE_MIN_LIKES } from '@/lib/remake/config'
import { CURATED_EXAMPLES, type RemakeExample } from '@/lib/remake/examples'

/** Platforms the read takes by link. YouTube rows would join here. */
const READABLE = ['x']
const MAX = 8
const postId = (url: string) => url.match(/\/status(?:es)?\/(\d{5,25})/)?.[1] ?? url

export async function GET() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data, error } = await sb.from('trending_posts')
    .select('platform, post_id, handle, url, likes, models, prompt, summary')
    .eq('status', 'live').eq('kind', 'video').in('platform', READABLE)
    .gte('likes', REMAKE_EXAMPLE_MIN_LIKES)
    .order('likes', { ascending: false })
    .limit(MAX * 2)
  if (error) console.warn(`[remake:examples] ${error.message}`)
  const fromFeed: RemakeExample[] = (data ?? []).map(r => ({
    url: r.url as string, handle: r.handle as string, likes: r.likes as number,
    models: (r.models ?? []) as string[], prompt: (r.prompt ?? '') as string, summary: (r.summary ?? {}) as RemakeExample['summary'],
  }))
  // Once each (a post can be live in more than one week, or on both lists).
  const seen = new Set<string>()
  const examples = [...CURATED_EXAMPLES, ...fromFeed]
    .filter(e => e.likes >= REMAKE_EXAMPLE_MIN_LIKES)
    .sort((a, b) => b.likes - a.likes)
    .filter(e => { const k = postId(e.url); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, MAX)
  return Response.json({ examples }, { headers: { 'Cache-Control': error ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=3600' } })
}
