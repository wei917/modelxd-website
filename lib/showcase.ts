// lib/showcase.ts — the museum wall's read.
//
// SERVER-ONLY. Lives here rather than only behind /api/showcase so the XCreate
// page can render the wall on the server: a public gallery that waits for a
// client fetch pays a waterfall on first paint, and — found the hard way —
// renders NOTHING at all wherever React defers passive effects, which includes
// any background or hidden tab. Server-render it and the pictures are in the
// HTML.
//
// Reads with the SERVICE ROLE for two reasons, neither of them laziness:
// xcreates is owner-read under RLS (loosening that policy to build a gallery
// would open every user's private work), and every picture needs a storage URL
// signed HERE, at read time. The URL persisted on the slot expires 24h after
// the run, so serving it verbatim gives a wall that works today and shows
// broken images tomorrow (CLAUDE.md pitfall 11).

import { createClient } from '@supabase/supabase-js'

const SIGN_TTL_SECONDS = 60 * 60 * 2

/** The bucket + object path out of a stored Supabase signed URL. */
function parseStored(url: string): { bucket: string; path: string } | null {
  const m = String(url).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

export type ShowcasePiece = {
  id: string; url: string; model: string; provider: string; name: string
  cost: number | null; sort: number; title: string; prompt: string
  /** Milliseconds this exact picture took. One sample, not a benchmark. */
  ms: number | null
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
    .select('id, xcreate_id, slot_index, room, title, sort_order')
    .eq('published', true)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[showcase] read failed:', error.message)
    return []
  }
  if (!hung?.length) return []

  const { data: runs } = await sb.from('xcreates')
    .select('id, prompt, slots, deleted_at')
    .in('id', [...new Set(hung.map(h => h.xcreate_id))])
  const runById = new Map((runs ?? []).map(r => [r.id, r]))

  const pieces = await Promise.all(hung.map(async h => {
    const run: any = runById.get(h.xcreate_id)
    if (!run || run.deleted_at) return null            // a deleted run leaves the wall
    const slot = (run.slots as any[])?.[h.slot_index]
    if (!slot?.text || slot.error) return null

    const loc = parseStored(slot.text)
    if (!loc) return null
    const { data: signed } = await sb.storage.from(loc.bucket).createSignedUrl(loc.path, SIGN_TTL_SECONDS)
    if (!signed?.signedUrl) return null

    return {
      id: h.id,
      url: signed.signedUrl,
      // The name card. Every field comes off the slot that made the picture,
      // so a card cannot drift from the work it labels.
      model: slot.model_name,
      provider: slot.provider,
      name: slot.name,
      cost: typeof slot.cost === 'number' ? slot.cost : null,
      ms: typeof slot.responseTime === 'number' ? slot.responseTime : null,
      sort: h.sort_order,
      title: h.title ?? '',
      prompt: run.prompt ?? '',
    } as ShowcasePiece
  }))

  return pieces.filter((p): p is ShowcasePiece => p !== null).sort((a, b) => a.sort - b.sort)
}
