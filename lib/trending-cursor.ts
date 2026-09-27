// lib/trending-cursor.ts — keyset pagination for /api/trending.
//
// The feed's order is total and lives in the database:
//
//   week DESC, rank ASC NULLS LAST, likes DESC NULLS LAST, platform ASC, post_id ASC
//
// (platform, post_id) is unique (supabase/108), so it breaks every tie. A
// cursor names the last row a page examined; the next page is every row that
// comes strictly after it in that order, read with `.order()` calls, this
// module's PostgREST `or` predicate and bounded batches (pageFiltered). No
// offsets: a page never repeats or skips a row when rows are published
// between calls (Codex review, Sep 27). Pure: no I/O of its own, so the
// predicate and the paging are tested on their own
// (scripts/test-trending-cursor.ts).

export type FeedKind = 'video' | 'image' | 'all'

export type CursorKey = {
  week: string            // YYYY-MM-DD
  rank: number | null
  likes: number | null
  platform: string
  postId: string
}

type Cond = { col: 'week' | 'rank' | 'likes' | 'platform' | 'post_id'; op: 'lt' | 'gt' | 'eq' | 'isnull'; val?: string | number }

const WEEK = /^\d{4}-\d{2}-\d{2}$/
const PLATFORM = /^[a-z]{1,20}$/
const POST_ID = /^\d{1,25}$/
const intOrNull = (v: unknown): v is number | null => v === null || (Number.isInteger(v) && (v as number) >= 0)

export function keyOf(r: { week: string; rank: number | null; likes: number | null; platform: string; post_id: string }): CursorKey {
  return { week: String(r.week).slice(0, 10), rank: r.rank ?? null, likes: r.likes ?? null, platform: r.platform, postId: r.post_id }
}

export function encodeCursor(k: CursorKey, kind: FeedKind): string {
  return Buffer.from(JSON.stringify({ k: kind, w: k.week, r: k.rank, l: k.likes, p: k.platform, i: k.postId })).toString('base64url')
}

/** The cursor's key, or null when it is not a valid cursor of ours for this
 *  kind. Every field is checked before it can reach a query string. */
export function decodeCursor(raw: string, kind: FeedKind): CursorKey | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (c?.k !== kind) return null
    if (typeof c.w !== 'string' || !WEEK.test(c.w)) return null
    if (!intOrNull(c.r) || !intOrNull(c.l)) return null
    if (typeof c.p !== 'string' || !PLATFORM.test(c.p)) return null
    if (typeof c.i !== 'string' || !POST_ID.test(c.i)) return null
    return { week: c.w, rank: c.r, likes: c.l, platform: c.p, postId: c.i }
  } catch { return null }
}

/** Rows strictly after `k`, as OR-ed branches of AND-ed conditions. */
export function afterBranches(k: CursorKey): Cond[][] {
  const wk: Cond = { col: 'week', op: 'eq', val: k.week }
  const rankEq: Cond = k.rank === null ? { col: 'rank', op: 'isnull' } : { col: 'rank', op: 'eq', val: k.rank }
  const likesEq: Cond = k.likes === null ? { col: 'likes', op: 'isnull' } : { col: 'likes', op: 'eq', val: k.likes }
  const out: Cond[][] = [[{ col: 'week', op: 'lt', val: k.week }]]
  // rank ASC NULLS LAST: after a number come larger numbers, then the nulls;
  // after a null only other nulls (decided by the columns that follow).
  if (k.rank !== null) out.push([wk, { col: 'rank', op: 'gt', val: k.rank }], [wk, { col: 'rank', op: 'isnull' }])
  // likes DESC NULLS LAST: after a number come smaller numbers, then the nulls.
  if (k.likes !== null) out.push([wk, rankEq, { col: 'likes', op: 'lt', val: k.likes }], [wk, rankEq, { col: 'likes', op: 'isnull' }])
  out.push([wk, rankEq, likesEq, { col: 'platform', op: 'gt', val: k.platform }])
  out.push([wk, rankEq, likesEq, { col: 'platform', op: 'eq', val: k.platform }, { col: 'post_id', op: 'gt', val: k.postId }])
  return out
}

/** PostgREST `or=(...)` text. Values are validated (decodeCursor), and none
 *  of them can contain the syntax characters `,.()`, except the week's dashes
 *  and a date, which PostgREST reads as one value. */
export function toPostgrestOr(branches: Cond[][]): string {
  const one = (c: Cond) => c.op === 'isnull' ? `${c.col}.is.null` : `${c.col}.${c.op}.${c.val}`
  return branches.map(b => b.length === 1 ? one(b[0]) : `and(${b.map(one).join(',')})`).join(',')
}

type Row = { week: string; rank: number | null; likes: number | null; platform: string; post_id: string }

// ── Pages of the rows that pass a filter ─────────────────────────────────────

/** Up to `limit` rows that pass `ok`, read along the feed order `scan` rows
 *  at a time, at most `maxScans` times (Sep 27: a post whose models XCreate
 *  doesn't offer stays in the table and is skipped). `next` is the key of the
 *  last row EXAMINED, so the cursor moves past skipped rows as well as shown
 *  ones; it is null only when no row is left. Out of scans, the page is what
 *  was found so far, possibly nothing, and `next` carries on from there.
 *  `read` returns the first `n` rows after a key and throws on failure. */
export async function pageFiltered<R extends Row>(opts: {
  after: CursorKey | null
  limit: number
  scan: number
  maxScans: number
  ok: (r: R) => boolean
  read: (after: CursorKey | null, n: number) => Promise<R[]>
}): Promise<{ rows: R[]; next: CursorKey | null }> {
  const { limit, scan, maxScans, ok, read } = opts
  const rows: R[] = []
  let key = opts.after
  let last: R | null = null
  for (let i = 0; i < maxScans; i++) {
    const batch = await read(key, scan)
    for (const r of batch) {
      // A full page and one more row to show: the next page starts there.
      if (rows.length === limit && ok(r)) return { rows, next: last && keyOf(last) }
      last = r
      if (rows.length < limit && ok(r)) rows.push(r)
    }
    if (batch.length < scan) return { rows, next: null }
    key = keyOf(batch[batch.length - 1])
  }
  return { rows, next: last && keyOf(last) }
}

// ── For tests: the same order and predicate in JS ────────────────────────────

/** The database's ORDER BY, for checking pages against a full sort. */
export function compareRows(a: Row, b: Row): number {
  if (a.week !== b.week) return a.week < b.week ? 1 : -1
  if (a.rank !== b.rank) { if (a.rank === null) return 1; if (b.rank === null) return -1; return a.rank - b.rank }
  if (a.likes !== b.likes) { if (a.likes === null) return 1; if (b.likes === null) return -1; return b.likes - a.likes }
  if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1
  return a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : 0
}

/** Does `r` pass the branches (what PostgREST would return)? */
export function matchesBranches(r: Row, branches: Cond[][]): boolean {
  const colVal = (c: Cond) => c.col === 'post_id' ? r.post_id : (r as any)[c.col]
  const test = (c: Cond) => {
    const v = colVal(c)
    if (c.op === 'isnull') return v === null
    if (v === null) return false      // SQL: comparisons with NULL are not true
    if (c.op === 'eq') return v === c.val
    return c.op === 'lt' ? v < (c.val as any) : v > (c.val as any)
  }
  return branches.some(b => b.every(test))
}
