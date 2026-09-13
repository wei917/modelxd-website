// app/api/xarch/_shared.ts — helpers for the XArch routes (underscore folder:
// not a route). Ownership, signing on demand (stored signed URLs die in 24h —
// Common Pitfall #11), and a uniform error answer.

import { createSupabaseServer } from '@/lib/supabase-server'
import { service, NotEnoughCredits } from '@/lib/xarch-ai'
import { sanitizeProviderError } from '@/lib/provider-errors'
import type { Media } from '@/lib/xarch'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const USER_BUCKETS = new Set(['xcreate-user-images', 'xcreate-user-videos'])
export const HISTORY_CAP = 30

export async function currentUser() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function owned(id: string): Promise<{ row: any; userId: string } | Response> {
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await service().from('xarch_projects').select('*')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (error && /xarch_projects/.test(error.message)) return Response.json({ error: 'XArch is not set up yet (run supabase/100_xarch.sql).' }, { status: 503 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return { row: data, userId: user.id }
}

export async function signMedia(items: Media[]): Promise<(Media & { url: string | null })[]> {
  const svc = service()
  return Promise.all(items.map(async m => {
    if (m.public_url) return { ...m, url: m.public_url }
    if (!m.bucket || !m.path) return { ...m, url: null }
    const { data } = await svc.storage.from(m.bucket).createSignedUrl(m.path, 60 * 60)
    return { ...m, url: data?.signedUrl ?? null }
  }))
}

export async function sourceUrl(source: any): Promise<string | null> {
  if (source?.public_url) return source.public_url
  if (!source?.bucket || !source?.path) return null
  const { data } = await service().storage.from(source.bucket).createSignedUrl(source.path, 60 * 60)
  return data?.signedUrl ?? null
}

/** The client view of a project: signed links, never storage internals. */
export async function view(row: any) {
  return {
    id: row.id, title: row.title, status: row.status, error: row.error, architect: row.architect,
    plan: row.plan, can_undo: Array.isArray(row.history) && row.history.length > 0,
    media: await signMedia(row.media ?? []), chat: row.chat ?? [],
    plan_image_url: await sourceUrl(row.source), spent_cents: row.spent_cents, is_sample: row.is_sample,
    created_at: row.created_at, updated_at: row.updated_at,
  }
}

export function fail(e: unknown, fallback = 'Something went wrong') {
  if (e instanceof NotEnoughCredits) return Response.json({ error: 'insufficient_credits', need_cents: e.needCents }, { status: 402 })
  const msg = e instanceof Error ? e.message : String(e)
  console.error('[xarch]', msg)
  return Response.json({ error: sanitizeProviderError(msg) || fallback }, { status: 500 })
}
