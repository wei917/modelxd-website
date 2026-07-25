// app/api/cron/sweep-orphans/route.ts
//
// Deletes orphaned user uploads from storage.
//
// Why this exists: this is now a backstop, not the primary defence.
// Uploads are deferred to submit (commitAttachments in AttachmentButton),
// so a removed or abandoned pick never reaches storage in the first
// place. What's left is the residue: objects uploaded by a submit whose
// run then failed before `processAttachment` wrote the row, plus the
// pre-July-25 orphans from when every pick uploaded eagerly. Paths carry
// no user id, so account deletion can't find those either — reachability
// is the only way to identify them.
//
// Why a sweep rather than deleting on remove: one original_path is
// referenced by MANY attachments rows (each re-run inserts another row
// against the same upload), so "user clicked ×, delete the object" would
// break history for every earlier run that used it. Reachability is the
// only safe test, and it also cleans up after account deletion for free —
// once the rows are gone the objects simply read as unreferenced.
//
// Scope is deliberately narrow: originals/ in the four user buckets. AI
// output buckets are written only by completed runs, so sweeping them
// would add risk without fixing anything.
//
// Schedule: daily via vercel.json. Manual dry run:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        "https://modelxd.com/api/cron/sweep-orphans?dry=1"

export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKETS = [
  'xcreate-user-images',
  'xcreate-user-videos',
  'xduel-user-images',
  'xduel-user-videos',
]

const PREFIX = 'originals/'

// Grace period. An object younger than this is left alone even if nothing
// references it yet — the user may still be composing a prompt around it.
// Generous on purpose: the cost of waiting a day is a few MB, the cost of
// being wrong is a broken run.
const MIN_AGE_HOURS = 24

const PAGE = 1000        // storage list page size
const DELETE_BATCH = 100

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Every originals/ path currently reachable from the database, per bucket. */
async function referencedPaths(sb: SupabaseClient): Promise<Map<string, Set<string>>> {
  const refs = new Map<string, Set<string>>()
  const add = (bucket?: string | null, path?: string | null) => {
    if (!bucket || !path) return
    if (!refs.has(bucket)) refs.set(bucket, new Set())
    refs.get(bucket)!.add(path)
  }

  // 1. attachments — the canonical record written by processAttachment.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('attachments')
      .select('bucket, original_path')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`attachments read failed: ${error.message}`)
    for (const r of data ?? []) add(r.bucket, r.original_path)
    if (!data || data.length < PAGE) break
  }

  // 2 + 3. Run rows keep their own copy of the input descriptor. Belt and
  // braces: if an attachments row is ever deleted while the run survives,
  // the upload is still reachable and must not be swept.
  for (const [table, col] of [['xcreates', 'input_attachments'], ['duels', 'input_media']] as const) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(col).range(from, from + PAGE - 1)
      if (error) throw new Error(`${table} read failed: ${error.message}`)
      for (const row of data ?? []) {
        const v = (row as any)[col]
        for (const a of Array.isArray(v) ? v : [v]) add(a?.bucket, a?.storagePath)
      }
      if (!data || data.length < PAGE) break
    }
  }

  return refs
}

async function handle(req: NextRequest) {
  // Fail closed. This endpoint deletes; it never runs without a secret.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const sb  = serviceClient()
  const LOG = `[sweep-orphans${dry ? ' DRY' : ''}]`

  let refs: Map<string, Set<string>>
  try {
    refs = await referencedPaths(sb)
  } catch (err) {
    // Never delete on a partial view of the database — a failed read here
    // would make every object look unreferenced.
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} aborting, could not build reference set:`, msg)
    return NextResponse.json({ swept: false, error: msg }, { status: 200 })
  }

  const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000
  const report: Record<string, { scanned: number; referenced: number; tooNew: number; orphans: number; deleted: number }> = {}
  const samples: string[] = []

  for (const bucket of BUCKETS) {
    const seen = refs.get(bucket) ?? new Set<string>()
    const stat = { scanned: 0, referenced: 0, tooNew: 0, orphans: 0, deleted: 0 }
    const doomed: string[] = []

    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await sb.storage.from(bucket).list(PREFIX.replace(/\/$/, ''), {
        limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' },
      })
      if (error) { console.warn(`${LOG} list ${bucket} failed:`, error.message); break }
      for (const obj of data ?? []) {
        if (!obj.name || obj.id === null) continue   // sub-folder placeholder
        stat.scanned++
        const path = `${PREFIX}${obj.name}`
        if (seen.has(path)) { stat.referenced++; continue }
        const created = Date.parse(obj.created_at ?? '')
        if (Number.isFinite(created) && created > cutoff) { stat.tooNew++; continue }
        stat.orphans++
        doomed.push(path)
        if (samples.length < 10) samples.push(`${bucket}/${path}`)
      }
      if (!data || data.length < PAGE) break
    }

    if (!dry) {
      for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
        const chunk = doomed.slice(i, i + DELETE_BATCH)
        const { error } = await sb.storage.from(bucket).remove(chunk)
        if (error) console.warn(`${LOG} remove ${bucket} failed:`, error.message)
        else stat.deleted += chunk.length
      }
    }

    report[bucket] = stat
  }

  const totals = Object.values(report).reduce(
    (a, s) => ({ scanned: a.scanned + s.scanned, orphans: a.orphans + s.orphans, deleted: a.deleted + s.deleted }),
    { scanned: 0, orphans: 0, deleted: 0 },
  )
  console.log(`${LOG} scanned=${totals.scanned} orphans=${totals.orphans} deleted=${totals.deleted}`)

  return NextResponse.json({ swept: true, dry, minAgeHours: MIN_AGE_HOURS, totals, report, samples })
}

export async function GET(req: NextRequest)  { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
