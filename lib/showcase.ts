// lib/showcase.ts — the museum wall's read.
//
// SERVER-ONLY. Lives here rather than only behind /api/showcase so the XCreate
// page can render the wall on the server: a public gallery that waits for a
// client fetch pays a waterfall on first paint, and — found the hard way —
// renders NOTHING at all wherever React defers passive effects, which includes
// any background or hidden tab. Server-render it and the pictures are in the
// HTML.
//
// Reads with the SERVICE ROLE because xcreates is owner-read under RLS, and
// loosening that policy to build a gallery would open every user's private
// work.
//
// It does NOT sign anything. Each piece carries the path of our own
// /api/showcase/img/{id} route, which signs at request time and redirects.
// Signing here was the first version and it broke on dev: /xcreate is
// prerendered as STATIC content, so "sign at read time" meant "sign once at
// build time", and every picture 404'd two hours after each deploy with a
// token that had expired 20 hours earlier. A signature must never be baked
// into markup that outlives it (CLAUDE.md pitfall 11).

import { createClient } from '@supabase/supabase-js'

/**
 * Where a video piece's derived files live. scripts/showcase-video-assets.ts
 * writes them and the img route serves them. The paths are fixed per showcase
 * id, so nothing has to be stored to find them.
 *
 *   poster      one JPEG frame for the tile, so the wall never loads a clip
 *               just to paint a still
 *   fast-start  the same streams with the MP4 index moved to the front, made
 *               only for files that had it at the end (13 of 19 on Sep 11);
 *               those cannot show a frame until the whole file has arrived
 */
export const SHOWCASE_POSTER = { bucket: 'xcreate-ai-images', path: (id: string) => `showcase/posters/${id}.jpg` }
export const SHOWCASE_FASTSTART = { bucket: 'xcreate-ai-videos', path: (id: string) => `showcase/video/${id}.mp4` }

export type ShowcasePiece = {
  id: string; url: string; model: string; provider: string; name: string
  cost: number | null; sort: number; title: string; prompt: string
  /** Milliseconds this exact picture took. One sample, not a benchmark. */
  ms: number | null
  /** Actual pixel size, read from the file by the backfill script. */
  width: number | null
  height: number | null
  /** 'image' or 'video' — a tile has to know whether to render a <video>. */
  kind: 'image' | 'video'
  /** Video pieces only: the still the tile shows until it is hovered. */
  poster: string | null
}

/**
 * A FLAT list, deliberately. The wall is a Pinterest board, not a comparison:
 * one picture per brief, many briefs, packed together. The same brief rendered
 * by six models side by side is XDuel's job, and it turns a gallery into a
 * test — which is what the first version of this got wrong.
 */
export async function readShowcase(): Promise<ShowcasePiece[]> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })

  const { data: hung, error } = await sb.from('showcase')
    .select('id, xcreate_id, slot_index, room, title, sort_order, width, height')
    .eq('published', true)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[showcase] read failed:', error.message)
    return []
  }
  if (!hung?.length) return []

  const { data: runs } = await sb.from('xcreates')
    .select('id, prompt, slots, deleted_at, mode')
    .in('id', [...new Set(hung.map(h => h.xcreate_id))])
  const runById = new Map((runs ?? []).map(r => [r.id, r]))

  const pieces = await Promise.all(hung.map(async h => {
    const run: any = runById.get(h.xcreate_id)
    if (!run || run.deleted_at) return null            // a deleted run leaves the wall
    const slot = (run.slots as any[])?.[h.slot_index]
    if (!slot?.text || slot.error) return null

    return {
      id: h.id,
      url: `/api/showcase/img/${h.id}`,
      // The name card. Every field comes off the slot that made the picture,
      // so a card cannot drift from the work it labels.
      model: slot.model_name,
      provider: slot.provider,
      name: slot.name,
      cost: typeof slot.cost === 'number' ? slot.cost : null,
      ms: typeof slot.responseTime === 'number' ? slot.responseTime : null,
      width: h.width ?? null,
      height: h.height ?? null,
      // The RUN's mode, not a guess from the slot: a slot carries isVideo but
      // an image run and a video run are different walls and should not be
      // distinguished by sniffing a boolean that only some providers set.
      kind: run.mode === 'video' ? 'video' : 'image',
      poster: run.mode === 'video' ? `/api/showcase/img/${h.id}?poster=1` : null,
      sort: h.sort_order,
      title: h.title ?? '',
      prompt: run.prompt ?? '',
    } as ShowcasePiece
  }))

  return pieces.filter((p): p is ShowcasePiece => p !== null).sort((a, b) => a.sort - b.sort)
}
