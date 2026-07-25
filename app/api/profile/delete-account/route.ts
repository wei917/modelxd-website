// app/api/profile/delete-account/route.ts
//
// Permanently deletes the calling user's account and data (GDPR/CCPA
// self-serve deletion; Privacy Policy §5):
//   1. Collect the user's duels + xcreates and every storage object they
//      reference (AI outputs + uploaded inputs).
//   2. Delete dependent rows (votes, job slots), then the content rows,
//      then credits/quotas/profile.
//   3. Best-effort remove the storage objects.
//   4. Delete the auth user (service role).
//
// Public XDuels are removed too — "delete my data" wins over the feed;
// the ratings pipeline is rebuilt from the remaining aggregates on the
// next refit.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const PUBLIC_PREFIX = '/storage/v1/object/public/'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Parse a Supabase public-storage URL into { bucket, path }. */
function parsePublicUrl(url: unknown): { bucket: string; path: string } | null {
  if (typeof url !== 'string') return null
  const i = url.indexOf(PUBLIC_PREFIX)
  if (i === -1) return null
  const rest = url.slice(i + PUBLIC_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1).split('?')[0]) }
}

export async function POST() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = serviceClient()
  const LOG = `[delete-account ${user.id.slice(0, 8)}]`

  // ── 1. Collect content rows + referenced storage objects ──
  const files = new Map<string, Set<string>>()
  const addFile = (bucket?: string | null, path?: string | null) => {
    if (!bucket || !path) return
    if (!files.has(bucket)) files.set(bucket, new Set())
    files.get(bucket)!.add(path)
  }
  const addUrl = (url: unknown) => {
    const p = parsePublicUrl(url)
    if (p) addFile(p.bucket, p.path)
  }

  const { data: duels } = await sb.from('duels')
    .select('id, slots, input_media').eq('user_id', user.id)
  const { data: xcreates } = await sb.from('xcreates')
    .select('id, slots, input_attachments').eq('user_id', user.id)

  for (const d of duels ?? []) {
    for (const sl of (d.slots as any[]) ?? []) addUrl(sl?.text)
    const im = d.input_media as any
    if (im) { addUrl(im.url); addFile(im.bucket, im.storagePath) }
  }
  for (const x of xcreates ?? []) {
    for (const sl of (x.slots as any[]) ?? []) { addUrl((sl as any)?.text); addUrl((sl as any)?.url) }
    for (const a of (x.input_attachments as any[]) ?? []) {
      addFile(a?.bucket, a?.storagePath); addUrl(a?.url)
    }
  }
  const duelIds = (duels ?? []).map(d => d.id)
  console.log(`${LOG} duels=${duelIds.length} xcreates=${(xcreates ?? []).length} buckets=${files.size}`)

  // ── 2. Delete rows (dependents first; each step tolerant) ──
  const del = async (table: string, col: string, val: string) => {
    const { error } = await sb.from(table).delete().eq(col, val)
    if (error) console.warn(`${LOG} ${table} delete failed:`, error.message)
  }
  // Votes cast BY the user, and votes ON the user's duels.
  await del('duel_votes', 'user_id', user.id)
  for (let i = 0; i < duelIds.length; i += 100) {
    const chunk = duelIds.slice(i, i + 100)
    const { error } = await sb.from('duel_votes').delete().in('duel_id', chunk)
    if (error) console.warn(`${LOG} duel_votes by duel failed:`, error.message)
  }
  // XCreate job rows (job slots cascade from jobs where declared; delete both).
  const { data: jobs } = await sb.from('xcreate_jobs').select('id').eq('user_id', user.id)
  const jobIds = (jobs ?? []).map(j => j.id)
  for (let i = 0; i < jobIds.length; i += 100) {
    const chunk = jobIds.slice(i, i + 100)
    await sb.from('xcreate_job_slots').delete().in('job_id', chunk)
  }
  await del('xcreate_jobs', 'user_id', user.id)
  await del('xcreates', 'user_id', user.id)
  await del('duels', 'user_id', user.id)
  await del('attachments', 'user_id', user.id)
  await del('credit_holds', 'user_id', user.id)
  await del('credit_transactions', 'user_id', user.id)
  await del('user_credits', 'user_id', user.id)
  await del('duel_quotas', 'user_id', user.id)
  await del('profiles', 'id', user.id)
  // provider_calls: keep the rows (cost accounting) but detach the user.
  await sb.from('provider_calls').update({ user_id: null }).eq('user_id', user.id)

  // ── 3. Storage cleanup (best-effort, batched) ──
  for (const [bucket, paths] of files) {
    const list = [...paths]
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await sb.storage.from(bucket).remove(list.slice(i, i + 100))
      if (error) console.warn(`${LOG} storage ${bucket} remove failed:`, error.message)
    }
  }

  // ── 4. Delete the auth user ──
  const { error: userErr } = await sb.auth.admin.deleteUser(user.id)
  if (userErr) {
    console.error(`${LOG} auth delete failed:`, userErr.message)
    return Response.json({ error: 'Account data was removed but the sign-in record could not be deleted. Please contact founder@modelxd.com.' }, { status: 500 })
  }
  console.log(`${LOG} done`)
  return Response.json({ ok: true })
}
