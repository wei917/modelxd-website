// scripts/test-trending-publish.ts — /admin/trending's "Publish this week", no I/O.
//
//   npx tsx scripts/test-trending-publish.ts
//
// A week can hold far more than 20 live posts per kind now (owner, Sep 27:
// 50+; migration 110 lifts the rank CHECK). Ranks are 1..N per kind by likes,
// unknown likes last, ties by post id; unchosen rows of the week are hidden;
// rows of other weeks are never in the plan (their live posts stay live); the
// per-kind limit still holds.

import assert from 'node:assert/strict'
import { publishPlan, type PublishRow, type PublishUpdate } from '../lib/trending-publish'
import { TRENDING_LIVE_MAX } from '../app/xcreate/trending'

const week: PublishRow[] = []
for (let i = 0; i < 90; i++) week.push({ id: `v${i}`, kind: 'video', likes: i % 9 === 0 ? null : (i * 37) % 500, post_id: `21000000000000${String(i).padStart(5, '0')}` })
for (let i = 0; i < 90; i++) week.push({ id: `i${i}`, kind: 'image', likes: i % 11 === 0 ? null : (i * 53) % 700, post_id: `22000000000000${String(i).padStart(5, '0')}` })
const chosen = [...week.filter(r => Number(r.id.slice(1)) < 60).map(r => r.id)]          // 60 of each kind

const result = publishPlan(week, chosen, TRENDING_LIVE_MAX)
if ('error' in result) throw new Error(`publishing 60 per kind failed: ${result.error}`)
const plan: { updates: PublishUpdate[] } = result
for (const kind of ['video', 'image'] as const) {
  const live = plan.updates.filter(u => u.status === 'live' && week.find(r => r.id === u.id)!.kind === kind)
  assert.equal(live.length, 60, `${kind}: 60 live`)
  assert.deepEqual(live.map(u => u.rank), Array.from({ length: 60 }, (_, i) => i + 1), `${kind}: ranks 1..60`)
  const rows = live.map(u => week.find(r => r.id === u.id)!)
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]
    const la = a.likes ?? -1, lb = b.likes ?? -1
    assert.ok(la > lb || (la === lb && a.post_id < b.post_id), `${kind}: order at ${i}`)
  }
  const hidden = plan.updates.filter(u => u.status === 'hidden' && week.find(r => r.id === u.id)!.kind === kind)
  assert.equal(hidden.length, 30, `${kind}: the 30 unchosen rows of the week are hidden`)
  assert.ok(hidden.every(u => u.rank === null))
}
assert.equal(plan.updates.length, week.length, 'every row of the week, and only those, is in the plan')

// Deterministic: the same input ranks the same way whatever order it arrives in.
const again = publishPlan([...week].reverse(), chosen, TRENDING_LIVE_MAX)
if ('error' in again) throw new Error(again.error)
const ranks = (p: { updates: PublishUpdate[] }) => Object.fromEntries(p.updates.map(u => [u.id, u.rank]))
assert.deepEqual(ranks(again), ranks(plan), 'ties break by post id, not by input order')

// The per-kind limit still holds.
const tooMany = publishPlan(week, week.map(r => r.id), 80)
assert.ok('error' in tooMany && /90 video posts chosen; a week holds 80/.test(tooMany.error))
assert.ok(TRENDING_LIVE_MAX >= 60, 'a week holds at least the 50+ the owner asked for')

console.log(`PASS: 60 live per kind ranked 1..60 by likes (unknown last, ties by post id), the rest of the week hidden, other weeks untouched, limit ${TRENDING_LIVE_MAX} per kind enforced`)
