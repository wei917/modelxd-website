// scripts/test-trending-cursor.ts — keyset pagination for /api/trending, no I/O.
//
//   npx tsx scripts/test-trending-cursor.ts
//
// Pages a synthetic live set (> 1000 rows, null ranks and likes, ties, three
// weeks, two platforms) the way the route does: DB order, the cursor's
// predicate, limit + 1. Every page must follow the full sort, and the pages
// together must hold every row exactly once. Cursor decoding must refuse
// anything malformed or made for another kind.

import assert from 'node:assert/strict'
import { afterBranches, compareRows, decodeCursor, encodeCursor, keyOf, matchesBranches, toPostgrestOr, type CursorKey } from '../lib/trending-cursor'

type Row = { week: string; rank: number | null; likes: number | null; platform: string; post_id: string }
const rows: Row[] = Array.from({ length: 1234 }, (_, i) => ({
  week: ['2026-09-28', '2026-09-21', '2026-09-14'][i % 3],
  rank: i % 5 === 0 ? null : (i % 20) + 1,
  likes: i % 7 === 0 ? null : (i % 13) * 100,
  platform: i % 4 ? 'x' : 'threads',
  post_id: String(100000 + ((i * 7919) % 1234)),   // unique, not in insertion order
}))
const sorted = [...rows].sort(compareRows)

for (const limit of [1, 10, 20]) {
  const seen: Row[] = []
  let cursor: string | null = null
  for (let page = 0; ; page++) {
    assert.ok(page < 2000, 'pagination never ends')
    const after: CursorKey | null = cursor ? decodeCursor(cursor, 'all') : null
    if (cursor) assert.ok(after, 'our own cursor must decode')
    const pool: Row[] = after ? rows.filter(r => matchesBranches(r, afterBranches(after))) : rows
    const got: Row[] = [...pool].sort(compareRows).slice(0, limit + 1)
    const pageRows = got.slice(0, limit)
    seen.push(...pageRows)
    cursor = got.length > limit ? encodeCursor(keyOf(pageRows[pageRows.length - 1]), 'all') : null
    if (!cursor) break
  }
  assert.equal(seen.length, rows.length, `limit ${limit}: every row once`)
  seen.forEach((r, i) => assert.equal(compareRows(r, sorted[i]), 0, `limit ${limit}: order at ${i}`))
}

// The predicate text PostgREST receives, for a key with nulls and without.
const withNulls = afterBranches({ week: '2026-09-21', rank: null, likes: null, platform: 'x', postId: '100001' })
assert.equal(toPostgrestOr(withNulls), 'week.lt.2026-09-21,and(week.eq.2026-09-21,rank.is.null,likes.is.null,platform.gt.x),and(week.eq.2026-09-21,rank.is.null,likes.is.null,platform.eq.x,post_id.gt.100001)')
const full = afterBranches({ week: '2026-09-21', rank: 3, likes: 500, platform: 'x', postId: '100001' })
assert.equal(full.length, 7)   // week, rank > or null, likes < or null, platform, post_id

// Cursor validation.
const good = encodeCursor({ week: '2026-09-21', rank: 3, likes: 500, platform: 'x', postId: '100001' }, 'video')
assert.ok(decodeCursor(good, 'video'))
assert.equal(decodeCursor(good, 'image'), null, 'cursor for another kind')
assert.equal(decodeCursor('not-a-cursor', 'video'), null)
const forge = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
assert.equal(decodeCursor(forge({ k: 'video', w: '2026-09-21', r: 3, l: 500, p: 'x', i: '1),or(status.eq.pending' }), 'video'), null, 'injection in post id')
assert.equal(decodeCursor(forge({ k: 'video', w: '2026-9-1', r: 3, l: 500, p: 'x', i: '1' }), 'video'), null, 'bad week')
assert.equal(decodeCursor(forge({ k: 'video', w: '2026-09-21', r: 1.5, l: 500, p: 'x', i: '1' }), 'video'), null, 'non-integer rank')
assert.equal(decodeCursor(forge({ k: 'video', w: '2026-09-21', r: 3, l: 500, p: 'X,', i: '1' }), 'video'), null, 'bad platform')

console.log(`PASS: ${rows.length} rows paged at 1/10/20 with nulls and ties, predicate text, cursor validation`)
