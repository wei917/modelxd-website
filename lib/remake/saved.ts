// lib/remake/saved.ts: a 同款 read kept as a Library item (owner, Oct 17: "why I
// uploaded a video to remake tab but there is no uuid link to continue?" →
// "add link"). One xcreates row per read, the way a film is kept
// (lib/film/driver.ts): mode 'video', and the first slot names it
// (`options.remake`), so the row opens back into 同款 at /xcreate?remake=<id>
// and stays out of Video. No migration.
//
// The slot holds the read (shot list, materials) and the viewer's choices.
// Pictures cut from the viewer's OWN upload are kept in their image folder;
// pictures cut from an X post are not (the source is someone else's video and
// is not kept, docs/REMAKE-PLAN.md), so a reopened X read shows its cards
// without pictures. YouTube is never downloaded: its cards play the moment in
// YouTube's player, and its Library card uses YouTube's own thumbnail.
// An upload's read also remembers the upload itself (their video folder), so
// the page can play the original (Oct 17; owner: "add player"). Those files
// sit under <user>/originals/, which the orphan sweep never walks (it lists
// only the old root originals/): if it ever does, it must count `upload` on
// these rows as referenced.
// Server only (service key).

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnUpload, UPLOAD_BUCKETS } from '@/lib/platform-specs'
import { BREAKDOWN_MODEL, type BreakdownResult } from './config'

export type SavedRemake = {
  v: 1
  source: BreakdownResult['source']
  breakdown: BreakdownResult['breakdown']
  costUsd: number
  /** Material id → path in the viewer's image folder (uploads only). */
  previews?: Record<string, string>
  /** The upload the read came from, in the viewer's video folder (uploads
   *  only; reads before Oct 17 have none, so they show no player). */
  upload?: string
  /** The viewer's choices, as the page keeps them (photos and recordings never). */
  choices?: Record<string, unknown>
}

const PICTURE_BUCKET = UPLOAD_BUCKETS.image
const SIGN_SECONDS = 3600
/** The choices are short words and picks; anything larger is not a draft. */
const MAX_CHOICES_BYTES = 40_000

/** YouTube's own thumbnail for a watch link (public; the Library shows it). */
export function youtubeThumb(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const id = u.searchParams.get('v') ?? (u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : null)
    return id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
  } catch { return null }
}

/** The read's row: its Library card (a picture where there is one, else the
 *  read's summary) and everything needed to open it again. */
function slotFor(saved: SavedRemake, picture: string | null) {
  return {
    provider: 'google', model_name: BREAKDOWN_MODEL, name: 'Gemini',
    text: picture ?? saved.breakdown.summary.slice(0, 240),
    isImage: !!picture, isVideo: false, isAudio: false,
    cost: saved.costUsd, error: null, errorRef: null,
    options: { remake: saved },
  }
}

/** A link to play the viewer's own upload for an hour; null for anything
 *  outside their video folder. */
export async function signOriginal(admin: SupabaseClient, userId: string, upload: string | null | undefined): Promise<string | null> {
  if (!upload || !isOwnUpload(userId, upload)) return null
  const { data } = await admin.storage.from(UPLOAD_BUCKETS.video).createSignedUrl(upload, SIGN_SECONDS)
  return data?.signedUrl ?? null
}

/** Keeps a finished read: the upload's pictures go to the viewer's image
 *  folder, the read, its source and the upload's path to a new row. Returns
 *  the row id, or null if saving failed (the read itself still goes back to
 *  the page). */
export async function saveRead(admin: SupabaseClient, userId: string, result: BreakdownResult, upload?: string | null): Promise<string | null> {
  const rowId = crypto.randomUUID()
  const saved: SavedRemake = { v: 1, source: result.source, breakdown: result.breakdown, costUsd: result.costUsd }
  if (upload && isOwnUpload(userId, upload)) saved.upload = upload
  let picture: string | null = youtubeThumb(result.source.url)
  if (result.source.kind === 'upload' && result.previews) {
    const kept: Record<string, string> = {}
    for (const [id, dataUrl] of Object.entries(result.previews)) {
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
      if (!m || !/^[\w-]{1,40}$/.test(id)) continue
      const path = `${userId}/remake/${rowId}/${id}.jpg`
      const { error } = await admin.storage.from(PICTURE_BUCKET).upload(path, Buffer.from(m[1], 'base64'), { contentType: 'image/jpeg', upsert: true })
      if (!error) kept[id] = path
    }
    if (Object.keys(kept).length) {
      saved.previews = kept
      // The card's picture: the first person (or whatever came first), as a
      // signed link the Library re-signs whenever it lists the row.
      const firstId = result.breakdown.characters.find(ch => kept[ch.id])?.id ?? Object.keys(kept)[0]
      const { data } = await admin.storage.from(PICTURE_BUCKET).createSignedUrl(kept[firstId], SIGN_SECONDS)
      picture = data?.signedUrl ?? null
    }
  }
  const title = result.breakdown.title?.trim() || result.source.url || ''
  const { error } = await admin.from('xcreates').insert({
    id: rowId, user_id: userId, mode: 'video', prompt: title.slice(0, 500), title: title.slice(0, 120),
    slots: [slotFor(saved, picture)],
  })
  if (error) { console.warn(`[remake:saved] row insert failed: ${error.message}`); return null }
  return rowId
}

/** The viewer's own read, with its pictures signed for an hour; null if it is
 *  not theirs, was deleted, or is not a 同款 read. */
export async function loadRead(admin: SupabaseClient, userId: string, id: string): Promise<{ result: BreakdownResult; choices: Record<string, unknown> | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data: row } = await admin.from('xcreates').select('id, user_id, slots, deleted_at').eq('id', id).maybeSingle()
  if (!row || row.user_id !== userId || row.deleted_at) return null
  const saved = (row.slots as any[])?.[0]?.options?.remake as SavedRemake | undefined
  if (!saved?.breakdown || !saved.source) return null
  let previews: Record<string, string> | undefined
  if (saved.previews && Object.keys(saved.previews).length) {
    const entries = Object.entries(saved.previews).filter(([, p]) => typeof p === 'string' && p.startsWith(`${userId}/remake/`))
    const { data } = await admin.storage.from(PICTURE_BUCKET).createSignedUrls(entries.map(([, p]) => p), SIGN_SECONDS)
    previews = {}
    entries.forEach(([mid], i) => { const url = data?.[i]?.signedUrl; if (url) previews![mid] = url })
  }
  const original = await signOriginal(admin, userId, saved.upload)
  return {
    result: { breakdown: saved.breakdown, source: saved.source, costUsd: saved.costUsd, left: -1, previews, ...(original ? { original } : {}) },
    choices: saved.choices && typeof saved.choices === 'object' ? saved.choices : null,
  }
}

/** Keeps the viewer's latest choices on their read. False if it is not theirs
 *  or the choices are not a draft. */
export async function saveChoices(admin: SupabaseClient, userId: string, id: string, choices: unknown): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !choices || typeof choices !== 'object' || Array.isArray(choices)) return false
  if (JSON.stringify(choices).length > MAX_CHOICES_BYTES) return false
  const { data: row } = await admin.from('xcreates').select('id, user_id, slots, deleted_at').eq('id', id).maybeSingle()
  if (!row || row.user_id !== userId || row.deleted_at) return false
  const slots = (row.slots as any[]) ?? []
  if (!slots[0]?.options?.remake) return false
  const next = [{ ...slots[0], options: { ...slots[0].options, remake: { ...slots[0].options.remake, choices } } }, ...slots.slice(1)]
  const { error } = await admin.from('xcreates').update({ slots: next }).eq('id', id).eq('user_id', userId)
  return !error
}
