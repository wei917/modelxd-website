// app/api/xdirector/boards/route.ts — your boards for XFilm's 導演 tab
// (Oct 22; owner: "my projects should be inside Direct"): newest first, each
// with its template, scene count and one picture. Read through the user's
// own session (RLS owner read on xdirector_conversations).
//
// The picture is the first scene that has one (a shot's clip or key still,
// else a cast/prop sheet), signed HERE per request and never written back:
// the storyboard keeps the signed URL from the day it was made, and a stored
// signed URL is dead in 24 hours (CLAUDE.md pitfall 11). Only its path is
// used. The storyboard itself never leaves the server.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { parseStorageUrl } from '@/lib/xcut-media'

const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const PAGE = 60

type Poster = { bucket: string; path: string; mediaType: string }

function posterOf(storyboard: unknown): Poster | null {
  const scenes = (Array.isArray(storyboard) ? storyboard : []) as any[]
  // Shots before sheets: a board reads as its film, not its cast.
  const ordered = [...scenes.filter(s => s && !s.asset), ...scenes.filter(s => s?.asset)]
  for (const s of ordered) {
    for (const [url, video] of [[s?.url, true], [s?.still_url, false]] as const) {
      const p = parseStorageUrl(typeof url === 'string' ? url : null)
      if (!p) continue
      const isVideo = video && /\.(mp4|webm|mov)$/i.test(p.path)
      return { ...p, mediaType: isVideo ? 'video/mp4' : 'image/' + (/\.png$/i.test(p.path) ? 'png' : /\.webp$/i.test(p.path) ? 'webp' : 'jpeg') }
    }
  }
  return null
}

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const offset = Math.max(0, Number(new URL(req.url).searchParams.get('offset')) || 0)
  const { data, error } = await sb.from('xdirector_conversations')
    .select('id, title, skill, storyboard, created_at, updated_at')
    .eq('user_id', user.id).is('deleted_at', null)
    .order('updated_at', { ascending: false }).range(offset, offset + PAGE)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).slice(0, PAGE)
  const first = new Map<string, Poster>()
  for (const r of rows) { const p = posterOf((r as any).storyboard); if (p) first.set(r.id, p) }
  const byBucket = new Map<string, string[]>()
  for (const { bucket, path } of first.values()) byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path])
  const signed = new Map<string, string>()
  const svc = serviceClient()
  await Promise.all([...byBucket].map(async ([bucket, paths]) => {
    const { data: urls } = await svc.storage.from(bucket).createSignedUrls([...new Set(paths)], 60 * 60)
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(`${bucket}\n${u.path}`, u.signedUrl)
  }))

  const boards = rows.map((r: any) => {
    const scenes = Array.isArray(r.storyboard) ? r.storyboard.filter((s: any) => s && !s.asset).length : 0
    const f = first.get(r.id)
    const url = f ? signed.get(`${f.bucket}\n${f.path}`) : undefined
    return { id: r.id, title: r.title ?? null, skill: r.skill ?? null, scenes, created_at: r.created_at, updated_at: r.updated_at, ...(url ? { poster: { url, mediaType: f!.mediaType } } : {}) }
  })
  return Response.json({ boards, more: (data ?? []).length > PAGE })
}
