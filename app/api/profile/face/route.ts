// app/api/profile/face/route.ts — save the website name and/or profile
// picture a person chose (Oct 2; owner: "profile image and website name").
//
//   POST { name?: string,
//          handle?: string,
//          photo?: { from: 'signin', provider: string }
//                | { from: 'upload', data: 'data:image/jpeg;base64,...' } }
//   → { name, photo, handle, nextChangeAt } as saved, or { error } (codes below)
//
// Since migration 125 this is the only writer of profiles.display_name and
// avatar_url: the browser lost its insert/update on profiles. Both are
// checked with OpenAI's moderation (lib/moderation.ts) before anything is
// saved, because other people will see them (published work, online games);
// when the check cannot run the save is refused, never waved through, and
// when either is refused nothing is saved.
//
// The @ID (Oct 13, supabase/132; rules in lib/handle.ts) changes here too,
// once every 30 days, through change_profile_handle; it goes first, so an ID
// that is taken or too soon leaves the name and picture as they were.
//
// A picture becomes a 256 px WebP square in the public avatars bucket,
// <user id>/<stamp>.webp; older files there are removed. A sign-in photo is
// copied from the account's own identity (Google, LINE, X), never from a URL
// the browser sends: that would let anyone make this server fetch anything.

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkName } from '@/lib/face'
import { checkHandle } from '@/lib/handle'
import { changeHandle, ensureHandle, handleText, type HandleState } from '@/lib/profile-handle'
import { moderate, type ModerationVerdict } from '@/lib/moderation'
import { isAdminEmail } from '@/lib/admin'
import { isVerifiedAccount } from '@/lib/verified-account'
import { decodeDataUrl, signinPhoto, square } from '@/lib/face-picture'

export const runtime = 'nodejs'
export const maxDuration = 30

const BUCKET = 'avatars'

// Saves per person per 10 minutes, per server instance: a floor, not a wall.
const RECENT = new Map<string, number[]>()
function tooMany(id: string): boolean {
  const now = Date.now()
  const times = (RECENT.get(id) ?? []).filter(t => now - t < 10 * 60_000)
  times.push(now)
  RECENT.set(id, times)
  return times.length > 10
}

type PhotoInput = { from: 'signin'; provider: string } | { from: 'upload'; data: string }

const fail = (error: string, status: number) => Response.json({ error }, { status })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: unknown; handle?: unknown; photo?: unknown } | null
  if (!body || typeof body !== 'object') return fail('bad_request', 400)
  const rawName = typeof body.name === 'string' ? body.name : undefined
  const rawHandle = typeof body.handle === 'string' ? body.handle : undefined
  const photo = asPhotoInput(body.photo)
  if (rawName === undefined && rawHandle === undefined && !photo) return fail('bad_request', 400)
  if (body.photo !== undefined && !photo) return fail('bad_request', 400)

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('unauthorized', 401)
  if (!isVerifiedAccount(user)) return fail('unverified', 403)
  if (tooMany(user.id)) return fail('too_many', 429)

  let name: string | undefined
  if (rawName !== undefined) {
    const checked = checkName(rawName, { admin: isAdminEmail(user.email) })
    if (!checked.ok) return fail(checked.error, checked.error === 'name_reserved' ? 422 : 400)
    name = checked.name
  }

  let handle: string | undefined
  if (rawHandle !== undefined) {
    const checked = checkHandle(rawHandle, { admin: isAdminEmail(user.email) })
    if (!checked.ok) return fail(checked.error, 400)
    handle = checked.handle
  }

  let files: { webp: Buffer; jpeg: Buffer } | undefined
  if (photo) {
    const source = photo.from === 'upload' ? decodeDataUrl(photo.data) : await signinPhoto(user, photo.provider)
    if (!source) return fail(photo.from === 'upload' ? 'picture_bad' : 'no_signin_picture', 400)
    files = (await square(source)) ?? undefined
    if (!files) return fail('picture_bad', 400)
  }

  // All checks at once; one refusal stops the whole save.
  const [nameVerdict, pictureVerdict, handleVerdict] = await Promise.all([
    name !== undefined ? moderate({ text: name }) : Promise.resolve<ModerationVerdict>('ok'),
    files ? moderate({ image: files.jpeg, mime: 'image/jpeg' }) : Promise.resolve<ModerationVerdict>('ok'),
    handle !== undefined ? moderate({ text: handleText(handle) }) : Promise.resolve<ModerationVerdict>('ok'),
  ])
  const refused = nameVerdict === 'refused' ? 'name' : pictureVerdict === 'refused' ? 'picture' : handleVerdict === 'refused' ? 'handle' : null
  if (refused) {
    console.log('[profile/face] refused', refused, 'for', user.id.slice(0, 8))
    return fail(`${refused}_refused`, 422)
  }
  if (nameVerdict === 'unavailable' || pictureVerdict === 'unavailable' || handleVerdict === 'unavailable') return fail('check_unavailable', 503)

  // The ID first: taken or too soon, and nothing else changes.
  let handleState: HandleState | null = null
  if (handle !== undefined) {
    const changed = await changeHandle(user.id, handle, { moderated: true })
    if (!changed.ok) return Response.json({ error: changed.error, next: changed.next ?? null }, { status: changed.error === 'failed' ? 500 : 409 })
    handleState = changed.state
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })

  let photoUrl: string | undefined
  let fileName: string | undefined
  if (files) {
    fileName = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.webp`
    const { error } = await admin.storage.from(BUCKET).upload(`${user.id}/${fileName}`, files.webp,
      { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
    if (error) {
      console.error('[profile/face] upload failed:', error.message)
      return fail('failed', 500)
    }
    const { data } = admin.storage.from(BUCKET).getPublicUrl(`${user.id}/${fileName}`)
    photoUrl = data?.publicUrl
      ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${user.id}/${fileName}`
  }

  const patch: Record<string, string> = { id: user.id, updated_at: new Date().toISOString() }
  if (name !== undefined) patch.display_name = name
  if (photoUrl) patch.avatar_url = photoUrl
  const { data: row, error } = name === undefined && !photoUrl
    ? await admin.from('profiles').select('display_name, avatar_url').eq('id', user.id).single()
    : await admin.from('profiles').upsert(patch, { onConflict: 'id' }).select('display_name, avatar_url').single()
  if (error || !row) {
    console.error('[profile/face] save failed:', error?.message)
    if (fileName) await admin.storage.from(BUCKET).remove([`${user.id}/${fileName}`])
    return fail('failed', 500)
  }

  // The new picture is the only one kept.
  if (fileName) {
    const { data: old } = await admin.storage.from(BUCKET).list(user.id, { limit: 100 })
    const stale = (old ?? []).map(f => f.name).filter(n => n !== fileName).map(n => `${user.id}/${n}`)
    if (stale.length) await admin.storage.from(BUCKET).remove(stale)
  }

  handleState ??= await ensureHandle(user.id)
  return Response.json({ name: row.display_name ?? null, photo: row.avatar_url ?? null, handle: handleState?.handle ?? null, nextChangeAt: handleState?.nextChangeAt ?? null })
}

function asPhotoInput(v: unknown): PhotoInput | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.from === 'signin' && typeof o.provider === 'string' && o.provider.length <= 64) return { from: 'signin', provider: o.provider }
  if (o.from === 'upload' && typeof o.data === 'string') return { from: 'upload', data: o.data }
  return null
}
