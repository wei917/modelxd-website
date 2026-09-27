// lib/trending-publish.ts — the rule "Publish this week" at /admin/trending follows.
//
// The chosen rows of ONE week go live, ranked per kind by likes (most first,
// unknown likes last, then post id, so a tie always ranks the same way); every
// other row of that week is hidden. Rows of other weeks are not touched: their
// live posts stay live on purpose, because the feed shows every live week,
// newest first (/api/trending, Sep 27). A week holds up to TRENDING_LIVE_MAX
// per kind; until migration 110 the database capped rank at 20.
//
// The writes happen in the database, in one transaction
// (publish_trending_week, supabase/110). This is the same rule in TypeScript:
// the spec it is tested against (scripts/test-trending-publish.ts, and the
// PGlite proof that runs the SQL on the same rows).

export type PublishRow = { id: string; kind: 'video' | 'image'; likes: number | null; post_id: string }
export type PublishUpdate = { id: string; status: 'live' | 'hidden'; rank: number | null }

export function publishPlan(weekRows: readonly PublishRow[], chosenIds: readonly string[], maxLive: number):
  { updates: PublishUpdate[] } | { error: string } {
  const chosen = new Set(chosenIds)
  const updates: PublishUpdate[] = []
  for (const kind of ['video', 'image'] as const) {
    const ofKind = weekRows.filter(r => r.kind === kind)
    const live = ofKind.filter(r => chosen.has(r.id))
      .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || (a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : 0))
    if (live.length > maxLive) return { error: `${live.length} ${kind} posts chosen; a week holds ${maxLive}.` }
    live.forEach((r, i) => updates.push({ id: r.id, status: 'live', rank: i + 1 }))
    for (const r of ofKind) if (!chosen.has(r.id)) updates.push({ id: r.id, status: 'hidden', rank: null })
  }
  return { updates }
}
