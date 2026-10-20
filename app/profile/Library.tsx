'use client'
// app/profile/Library.tsx — the Library view of /profile (Oct 15; the
// approved design library-designs-20261014/03-*-xtell-layout): your work,
// one section per app, each drawn the way that app's work looks (A/B
// duels, an image grid, conversation rows, 3D and plan thumbnails), never
// one mixed feed.
//
// Only X Duel and XCreate are on by default. Every other section is added
// from the closed section picker and fetches nothing until it is on: a
// section that is off is not mounted, so it never queries, signs a URL or
// counts anything. Each section asks for a small preview first (3 duels, 4
// cards), "View all" pages through 12 at a time, and its type filter is its
// own. Sort applies to every section that is on (owner, Oct 15: no search
// box, no page title, no Favorite until bookmarks exist).
//
// Data comes through one `Loader` (makeLoader below), so a local preview
// can hand the same components sample rows without signing in.

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../lib/i18n'
import { describeVisit, notAskedKey, firstAsk, cleanTitle } from '../../lib/xtell-history'
import { TitleEditor } from '../components/xtell/TitleEditor'
import { TempleArtwork, TEMPLE_ART, type TempleKey } from '../components/xtell/TempleArtwork'

export type SectionKey =
  | 'duels' | 'xcreates' | 'xdirects' | 'xcuts' | 'xworlds' | 'xarchs'
  | 'xpersonas' | 'xtalks' | 'xgames' | 'xtell' | 'votes'
export type Mode = 'all' | 'text' | 'image' | 'video'
export type Sort = 'newest' | 'oldest'

export type Media = { kind: 'image' | 'video' | 'text'; src?: string; text?: string }
export type Item = {
  id: string
  title: string
  created: string
  href?: string
  mode?: string
  a?: Media              // duel sides
  b?: Media
  media?: Media          // XCreate card
  thumb?: string | null  // XWorld / XArch picture, XPersona avatar
  meta?: string          // a short line under the title (already in words)
  metaKey?: string       // …or an i18n key for it
  badge?: 'live' | 'mp4' | 'voted' | 'tie' | '3d' | 'pending'
  raw?: unknown          // the row itself, for the XCreate preview modal
}
export type LoadParams = { q: string; sort: Sort; mode: Mode; offset: number; limit: number }
export type LoadResult = { items: Item[]; total: number | null }
export type Loader = (key: SectionKey, p: LoadParams) => Promise<LoadResult>

type View = 'duel' | 'media' | 'list' | 'thumb' | 'persona' | 'xtell'
type SectionDef = { key: SectionKey; nameKey: string; icon: string; view: View; modes?: boolean; preview: number; previewPhone: number; isPublic?: boolean }

// The product rule (profile.privacy): your duels are public, they appear in
// XDuel's vote feed; everything else is private.
const SECTIONS: SectionDef[] = [
  { key: 'duels',     nameKey: 'nav.xduel',    icon: 'duel',     view: 'duel',    modes: true, preview: 3, previewPhone: 1, isPublic: true },
  { key: 'xcreates',  nameKey: 'nav.xcreate',  icon: 'create',   view: 'media',   modes: true, preview: 4, previewPhone: 2 },
  { key: 'xdirects',  nameKey: 'nav.xdirect',  icon: 'director', view: 'list',    preview: 4, previewPhone: 3 },
  { key: 'xcuts',     nameKey: 'nav.xcut',     icon: 'cut',      view: 'list',    preview: 4, previewPhone: 3 },
  { key: 'xworlds',   nameKey: 'nav.xworld',   icon: 'world',    view: 'thumb',   preview: 4, previewPhone: 2 },
  { key: 'xarchs',    nameKey: 'nav.xarch',    icon: 'arch',     view: 'thumb',   preview: 4, previewPhone: 2 },
  { key: 'xpersonas', nameKey: 'nav.xpersona', icon: 'persona',  view: 'persona', preview: 4, previewPhone: 2 },
  { key: 'xtalks',    nameKey: 'nav.xtalk',    icon: 'talk',     view: 'list',    preview: 4, previewPhone: 3 },
  { key: 'xgames',    nameKey: 'nav.xgame',    icon: 'game',     view: 'list',    preview: 4, previewPhone: 3 },
  { key: 'xtell',     nameKey: 'nav.xtell',    icon: 'tell',     view: 'xtell',   preview: 4, previewPhone: 3 },
  { key: 'votes',     nameKey: 'lib.votes',    icon: 'vote',     view: 'list',    modes: true, preview: 4, previewPhone: 3 },
]
export const DEFAULT_SECTIONS: SectionKey[] = ['duels', 'xcreates']
const PAGE = 12
const STORE_KEY = 'modelxd.library.sections'
// null until the browser has answered, so the server and the first client
// render agree, and a section waits for it: one fetch, at the right size.
const PHONE = '(max-width: 760px)'
function useIsPhone(): boolean | null {
  const [phone, setPhone] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = () => setPhone(mq.matches)
    on()
    // Both: some emulated viewports (a browser's device toolbar) change the
    // width without a media-query change event, but always fire resize.
    mq.addEventListener('change', on)
    window.addEventListener('resize', on)
    return () => { mq.removeEventListener('change', on); window.removeEventListener('resize', on) }
  }, [])
  return phone
}

// ── The real loader ─────────────────────────────────────────────────────
// Owner-read RLS through the browser client, or the app's own list API,
// exactly as the old profile tabs read them; never the service key.

const sb = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
// PostgREST pattern characters in a search are matched literally.
const like = (q: string) => `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`
const firstLine = (s: unknown) => (typeof s === 'string' ? s.split('\n')[0] : '')
const toMedia = (slot: any): Media | undefined => {
  if (!slot) return undefined
  if (slot.isVideo) return { kind: 'video', src: firstLine(slot.text) }
  if (slot.isImage) return { kind: 'image', src: firstLine(slot.text) }
  return { kind: 'text', text: typeof slot.text === 'string' ? slot.text.slice(0, 240) : '' }
}
const byDate = (sort: Sort) => (a: Item, b: Item) => sort === 'oldest' ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created)
// The app APIs that return a whole list (XCut, XWorld, XArch) are searched,
// sorted and paged here, after one fetch per section. The cache belongs to
// one loader, so one per signed-in account (the page makes a loader per user).
type ListCache = Map<string, Promise<Item[]>>
const fromWholeList = async (cache: ListCache, cacheKey: string, fetchAll: () => Promise<Item[]>, p: LoadParams): Promise<LoadResult> => {
  if (!cache.has(cacheKey)) cache.set(cacheKey, fetchAll().catch(e => { cache.delete(cacheKey); throw e }))
  const all = await cache.get(cacheKey)!
  const q = p.q.toLowerCase()
  const hit = (q ? all.filter(i => i.title.toLowerCase().includes(q)) : all).slice().sort(byDate(p.sort))
  return { items: hit.slice(p.offset, p.offset + p.limit), total: hit.length }
}
const okJson = async (r: Response) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }

export function makeLoader(userId: string): Loader {
  const listCache: ListCache = new Map()
  return async (key, p) => {
    const client = sb()
    const asc = p.sort === 'oldest'
    const to = p.offset + p.limit - 1
    switch (key) {
      case 'duels': {
        let q = client.from('duels').select('id, prompt, mode, slots, created_at', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null)
        if (p.mode !== 'all') q = q.eq('mode', p.mode)
        if (p.q) q = q.ilike('prompt', like(p.q))
        const { data, count, error } = await q.order('created_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((d: any) => {
          const slots = (d.slots ?? []).filter(Boolean)
          return { id: d.id, title: d.prompt ?? '', created: d.created_at, href: `/xduel/${d.id}`, mode: d.mode, a: toMedia(slots[0]), b: toMedia(slots[1]) }
        }) }
      }
      case 'xcreates': {
        const params = new URLSearchParams({ offset: String(p.offset), size: String(p.limit), filter: p.mode, sort: p.sort })
        if (p.q) params.set('q', p.q)
        const j = await okJson(await fetch(`/api/profile/xcreates?${params}`))
        return { total: j.total ?? null, items: (j.rows ?? []).map((x: any) => {
          const slots = (x.slots ?? []).filter(Boolean)
          const chosen = slots.find((s: any) => s.id === x.chosen_model_id) ?? slots[0]
          return { id: x.id, title: x.title || x.prompt || '', created: x.created_at, mode: x.mode, media: toMedia(chosen), raw: x }
        }) }
      }
      case 'votes': {
        let q = client.from('duel_votes').select('id, duel_id, vote_choice, created_at, duels!inner(id, prompt, mode)', { count: 'exact' }).eq('user_id', userId)
        if (p.mode !== 'all') q = q.eq('duels.mode', p.mode)
        if (p.q) q = q.ilike('duels.prompt', like(p.q))
        const { data, count, error } = await q.order('created_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((v: any) => ({ id: v.id, title: v.duels?.prompt ?? '', created: v.created_at, href: `/xduel/${v.duel_id}`, mode: v.duels?.mode, metaKey: 'mode.' + (v.duels?.mode ?? 'text'), badge: v.vote_choice === 'T' ? 'tie' : 'voted' })) }
      }
      case 'xdirects': {
        let q = client.from('xdirector_conversations').select('id, title, created_at, updated_at', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null)
        if (p.q) q = q.ilike('title', like(p.q))
        const { data, count, error } = await q.order('updated_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((c: any) => ({ id: c.id, title: c.title ?? '', created: c.updated_at ?? c.created_at, href: `/xdirect?c=${c.id}`, metaKey: 'nav.xdirect' })) }
      }
      case 'xtalks': {
        let q = client.from('xtalk_sessions').select('id, title, created_at, updated_at', { count: 'exact' }).eq('user_id', userId).eq('game', 'discussion')
        if (p.q) q = q.ilike('title', like(p.q))
        const { data, count, error } = await q.order('updated_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((c: any) => ({ id: c.id, title: c.title ?? '', created: c.updated_at ?? c.created_at, href: `/xtalk/${c.id}`, metaKey: 'xt.tpl.discussion.name' })) }
      }
      case 'xgames': {
        let q = client.from('xtalk_sessions').select('id, title, status, game, created_at', { count: 'exact' }).eq('user_id', userId).neq('game', 'discussion')
        if (p.q) q = q.ilike('title', like(p.q))
        const { data, count, error } = await q.order('created_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((g: any) => ({ id: g.id, title: g.title ?? '', created: g.created_at, href: `/xgame/${g.id}`, metaKey: g.game === 'gomoku' ? 'xg.game.gomoku' : g.game === 'chess' ? 'xg.game.chess' : g.game === 'draw' ? 'xg.game.draw' : 'xt.tpl.werewolf.name', badge: g.status === 'active' ? 'live' : undefined })) }
      }
      case 'xpersonas': {
        let q = client.from('x_characters').select('id, name, avatar_path, msg_count, created_at', { count: 'exact' }).eq('user_id', userId)
        if (p.q) q = q.ilike('name', like(p.q))
        const { data, count, error } = await q.order('created_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((c: any) => ({ id: c.id, title: c.name ?? '', created: c.created_at, href: `/xpersona?c=${c.id}`,
          thumb: c.avatar_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/x-characters/${c.avatar_path}` : null,
          meta: c.msg_count > 0 ? String(c.msg_count) : undefined })) }
      }
      case 'xcuts':
        return fromWholeList(listCache, 'xcuts', async () => {
          const d = await okJson(await fetch('/api/xcut/projects'))
          return (d.projects ?? []).map((c: any) => ({ id: c.id, title: c.title ?? '', created: c.updated_at ?? c.created_at, href: `/xcut?p=${c.id}`, meta: `${Math.round(c.duration_s ?? 0)}s`, badge: c.render?.url ? 'mp4' : undefined }))
        }, p)
      case 'xworlds':
        return fromWholeList(listCache, 'xworlds', async () => {
          const d = await okJson(await fetch('/api/xworld'))
          // A picture only: the 3D viewer loads on the world's own page.
          return (d.items ?? []).map((w: any) => ({ id: w.id, title: w.prompt ?? '', created: w.created_at, href: `/xworld?w=${w.id}`,
            thumb: w.status === 'done' ? (w.thumbnail_url ?? `/api/xworld/${w.id}/model?asset=preview`) : null,
            badge: w.status === 'done' ? '3d' : 'pending', meta: w.status === 'done' ? undefined : w.status }))
        }, p)
      case 'xarchs':
        return fromWholeList(listCache, 'xarchs', async () => {
          const d = await okJson(await fetch('/api/xarch/projects'))
          return (d.projects ?? []).map((a: any) => ({ id: a.id, title: a.title ?? '', created: a.updated_at ?? a.created_at, href: `/xarch?p=${a.id}`, thumb: a.thumb_url ?? null }))
        }, p)
      case 'xtell': {
        // Saved readings (supabase/105), owner-read RLS. Searched by the
        // title the visitor gave a reading; untitled ones are named by their
        // first question, which lives in `turns` and is not searchable here.
        let q = client.from('xtell_readings').select('id, temple, title, subject, cost_cents, created_at, turns', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null)
        if (p.q) q = q.ilike('title', like(p.q))
        const { data, count, error } = await q.order('created_at', { ascending: asc }).range(p.offset, to)
        if (error) throw error
        return { total: count, items: (data ?? []).map((r: any) => ({ id: r.id, title: r.title ?? '', created: r.created_at, href: `/xoracle?reading=${r.id}`, raw: r })) }
      }
      default:
        return { items: [], total: 0 }
    }
  }
}

// ── Icons (the nav's own strokes, so a section reads like its nav item) ──

export function LibIcon({ name, size = 22 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } }
  switch (name) {
    case 'duel':     return <svg {...p}><path d="M21 3v5l-11 9l-4 4l-3-3l4-4l9-11z"/><path d="M5 13l6 6"/><path d="M14.32 17.32l3.68 3.68l3-3l-3.68-3.68"/><path d="M10 5.5l-2-2.5h-5v5l3 2.5"/></svg>
    case 'create':   return <svg {...p}><path d="M12 3c.4 4.6 4.4 8.6 9 9c-4.6.4-8.6 4.4-9 9c-.4-4.6-4.4-8.6-9-9c4.6-.4 8.6-4.4 9-9z"/></svg>
    case 'director': return <svg {...p}><path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z"/><path d="M4 11l-1-4l16-4l1 4z"/><path d="M8 10l2-4"/><path d="M13 9l2-4"/></svg>
    case 'cut':      return <svg {...p}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>
    case 'world':    return <svg {...p}><path d="M12 3l7 4v8l-7 4l-7-4V7z"/><path d="M5 7l7 4l7-4"/><path d="M12 11v8"/></svg>
    case 'arch':     return <svg {...p}><path d="M3 11l9-7l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>
    case 'persona':  return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>
    case 'talk':     return <svg {...p}><path d="M8 13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M6 13v3l3-3"/><path d="M19 20h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z"/><path d="M18 20v3l-3-3"/></svg>
    case 'game':     return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="0.8" fill="currentColor"/><circle cx="15" cy="15" r="0.8" fill="currentColor"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>
    case 'tell':     return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3a4.5 4.5 0 0 1 0 9a4.5 4.5 0 0 0 0 9"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor"/><circle cx="12" cy="16.5" r="0.9"/></svg>
    case 'vote':     return <svg {...p}><path d="M7 11v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3a4 4 0 0 0 4-4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1-2 2h-7a3 3 0 0 1-3-3"/></svg>
    case 'grid':     return <svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>
    case 'search':   return <svg {...p}><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
    case 'sort':     return <svg {...p}><path d="M8 4v16"/><path d="M4.5 7.5L8 4l3.5 3.5"/><path d="M16 20V4"/><path d="M12.5 16.5L16 20l3.5-3.5"/></svg>
    case 'chevron':  return <svg {...p}><path d="M6 9l6 6l6-6"/></svg>
    case 'arrow':    return <svg {...p}><path d="M5 12h14"/><path d="M13 6l6 6l-6 6"/></svg>
    case 'globe':    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>
    case 'lock':     return <svg {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
    case 'play':     return <svg {...p}><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
    case 'link':     return <svg {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>
    case 'trash':    return <svg {...p}><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>
    case 'open':     return <svg {...p}><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
    case 'check':    return <svg {...p}><path d="M5 12l5 5l9-10"/></svg>
    case 'user':     return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>
    case 'image':    return <svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5l4 4l3-3l4 4"/></svg>
    case 'heart':    return <svg {...p}><path d="M12 20s-7.5-4.6-9-9.2C1.9 7.4 4.1 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7c1.1-1.6 2.7-2.7 4.7-2.7c3.2 0 5.4 2.9 4.3 6.3C19.5 15.4 12 20 12 20z"/></svg>
    default:         return null
  }
}

// ── What the page lends the Library (share, delete, the XCreate preview) ──

export type LibraryActions = {
  share: (id: string) => void
  copiedId: string | null
  deletingId: string | null
  requestDelete: (type: 'duel' | 'xcreate', id: string, prompt: string, onDone: () => void) => void
  openXcreate: (row: unknown) => void
  // X先知 readings: rename in place, erase after a yes in the row itself.
  renameReading: (id: string, title: string) => Promise<boolean>
  eraseReading: (id: string) => Promise<boolean>
}

const useDate = () => {
  const { lang } = useLang()
  return (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(lang, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  }
}

// ── The Library ─────────────────────────────────────────────────────────

export default function ProfileLibrary({ loader, actions }: { loader: Loader; actions: LibraryActions }) {
  const { t } = useLang()
  const [on, setOn] = useState<SectionKey[]>(DEFAULT_SECTIONS)
  // The chosen sections are a per-browser convenience (localStorage may be
  // missing or blocked; the default two still render).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
      if (Array.isArray(saved)) setOn(SECTIONS.map(s => s.key).filter(k => saved.includes(k)))
    } catch { /* keep the default */ }
  }, [])
  const save = (next: SectionKey[]) => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* fine */ }
    return next
  }
  const toggle = (k: SectionKey) => setOn(prev =>
    save(prev.includes(k) ? prev.filter(x => x !== k) : SECTIONS.map(s => s.key).filter(x => x === k || prev.includes(x))))
  const setAll = (all: boolean) => setOn(save(all ? SECTIONS.map(s => s.key) : []))

  // The loaders still take a search (q); the page offers none for now.
  const q = ''
  const [sort, setSort] = useState<Sort>('newest')

  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pickerOpen) return
    const close = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [pickerOpen])

  const shown = SECTIONS.filter(s => on.includes(s.key))
  return (
    <div className="plib">
      <div className="plib-toolbar">
        <div className="plib-picker" ref={pickerRef}>
          <button type="button" className="plib-field plib-picker-btn" aria-haspopup="true" aria-expanded={pickerOpen} onClick={() => setPickerOpen(v => !v)}>
            <LibIcon name="grid" size={20} />
            <span>{t('lib.sections').replace('{n}', String(shown.length))}</span>
            <LibIcon name="chevron" size={18} />
          </button>
          {pickerOpen && (
            <div className="plib-picker-pop" role="group" aria-label={t('lib.sections.pick')}>
              <div className="plib-picker-head">
                <span>{t('lib.sections.pick')}</span>
                <span className="plib-picker-all">
                  <button type="button" onClick={() => setAll(true)} disabled={on.length === SECTIONS.length}>{t('lib.pick.all')}</button>
                  <button type="button" onClick={() => setAll(false)} disabled={on.length === 0}>{t('lib.pick.none')}</button>
                </span>
              </div>
              {SECTIONS.map(s => (
                <label key={s.key} className="plib-picker-row">
                  <input type="checkbox" checked={on.includes(s.key)} onChange={() => toggle(s.key)} />
                  <LibIcon name={s.icon} size={18} />
                  <span>{t(s.nameKey)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {/* The menu itself is see-through over its label: a phone zooms into
            any form field under 16px, so the words shown are a span. */}
        <label className="plib-field plib-sort">
          <LibIcon name="sort" size={20} />
          <span className="plib-sort-label" aria-hidden="true">{t('lib.sort.' + sort)}</span>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label={t('lib.sort')}>
            <option value="newest">{t('lib.sort.newest')}</option>
            <option value="oldest">{t('lib.sort.oldest')}</option>
          </select>
          <LibIcon name="chevron" size={18} />
        </label>
      </div>

      {shown.length === 0
        ? <div className="plib-empty plib-empty-all">{t('lib.none')}</div>
        : shown.map(s => <Section key={s.key} def={s} q={q} sort={sort} loader={loader} actions={actions} />)}

      <p className="plib-privacy">{t('profile.privacy')}</p>
    </div>
  )
}

// ── One app's section ───────────────────────────────────────────────────

function Section({ def, q, sort, loader, actions }: { def: SectionDef; q: string; sort: Sort; loader: Loader; actions: LibraryActions }) {
  const { t } = useLang()
  // Image first, as the old tabs did (CC, July 17-19).
  const [mode, setMode] = useState<Mode>(def.modes ? 'image' : 'all')
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  // "View all" pages through the app's work, one page of PAGE at a time
  // (owner, Oct 16: pagination, not "load more").
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  // A small first look per app, smaller on a phone (one duel, two cards) so
  // the next app is in reach; the rows are asked for, not fetched and hidden.
  const phone = useIsPhone()
  const limit = expanded ? PAGE : phone ? def.previewPhone : def.preview
  // Every load starts a new generation; an answer from an older one (a page
  // clicked past, a type changed) is dropped.
  const gen = useRef(0)
  // A new search, sort, type or size starts again at page 1.
  useEffect(() => { setPage(1) }, [q, sort, mode, expanded])

  useEffect(() => {
    if (phone === null) return
    const mine = ++gen.current
    setState('loading')
    loader(def.key, { q, sort, mode, offset: expanded ? (page - 1) * PAGE : 0, limit })
      .then(r => {
        if (gen.current !== mine) return
        // A page past the end (the last card on it was deleted elsewhere):
        // step back to the last page that has any.
        if (expanded && page > 1 && r.items.length === 0 && r.total != null) { setPage(Math.max(1, Math.ceil(r.total / PAGE))); return }
        setItems(r.items); setTotal(r.total); setState('ready')
      })
      .catch(() => { if (gen.current === mine) setState('error') })
  }, [def.key, q, sort, mode, limit, loader, retry, phone, expanded, page])

  const goPage = (n: number) => {
    setPage(n)
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  // A deleted card leaves the page one short; the last one on a page takes
  // the reader to the page before it.
  const removeItem = (id: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id)
      if (next.length === 0 && expanded && page > 1) setPage(page - 1)
      return next
    })
    setTotal(n => (n == null ? n : Math.max(0, n - 1)))
  }

  // A phone has no collapse arrow (as in the design), so folding is CSS that
  // only applies at desktop width (.plib-section.is-shut): a section folded
  // there is open again on a phone, with no resize event needed.
  const count = total ?? items.length
  const pages = expanded && total != null ? Math.ceil(total / PAGE) : 1
  // On the title row with the type filter, on a phone too (owner, Oct 16).
  const viewAll = state === 'ready' && (expanded
    ? <button type="button" className="plib-viewall" onClick={() => setExpanded(false)}>{t('lib.showless')}</button>
    : count > items.length && <button type="button" className="plib-viewall" onClick={() => setExpanded(true)}>{t('lib.viewall').replace('{n}', String(count))}<LibIcon name="arrow" size={14} /></button>)
  const bodyId = `plib-body-${def.key}`
  return (
    <section ref={sectionRef} className={`plib-section plib-view-${def.view}${collapsed ? ' is-shut' : ''}`} aria-labelledby={`plib-h-${def.key}`}>
      <header className="plib-head">
        <span className="plib-head-icon"><LibIcon name={def.icon} size={18} /></span>
        <h2 id={`plib-h-${def.key}`} className="plib-head-name">{t(def.nameKey)}</h2>
        <span className="plib-vis" title={t(def.isPublic ? 'lib.public' : 'lib.private')}>
          <LibIcon name={def.isPublic ? 'globe' : 'lock'} size={12} /><span className="plib-vis-word">{t(def.isPublic ? 'lib.public' : 'lib.private')}</span>
        </span>
        {/* The type filter is the site's own segmented control (.mode-seg, as on
            X對決 and XBoard), beside the badge (owner, Oct 16). */}
        {def.modes && (
          <span className="mode-seg plib-seg" role="group" aria-label={t('lib.type')}>
            {(['all', 'text', 'image', 'video'] as Mode[]).map(m => (
              <button key={m} type="button" className={`mode-seg-btn${mode === m ? ' active' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m !== 'all' && <span className={`mode-dot${mode === m ? ' active' : ''}`} />}
                {t(m === 'all' ? 'common.all' : 'mode.' + m)}
              </button>
            ))}
          </span>
        )}
        <span className="plib-head-end">
          {viewAll}
          <button type="button" className={collapsed ? 'plib-collapse is-collapsed' : 'plib-collapse'} aria-expanded={!collapsed} aria-controls={bodyId}
            aria-label={t(collapsed ? 'lib.expand' : 'lib.collapse')} onClick={() => setCollapsed(c => !c)}>
            <LibIcon name="chevron" size={16} />
          </button>
        </span>
      </header>

      {<div id={bodyId} className="plib-body">
        {/* Turning a page keeps the old page, dimmed, until the new one is in. */}
        {state === 'loading' && !(expanded && items.length > 0)
          ? <SkeletonRow view={def.view} n={Math.min(limit, 4)} />
          : state === 'error'
          ? <div className="plib-empty plib-error" role="alert">{t('lib.error')} <button type="button" onClick={() => setRetry(n => n + 1)}>{t('lib.retry')}</button></div>
          : items.length === 0
          ? <div className="plib-empty">
              {q ? t('lib.nomatch') : t('lib.empty')}
              {mode !== 'all' && <button type="button" onClick={() => setMode('all')}>{t('lib.showall')}</button>}
            </div>
          : <div className={state === 'loading' ? 'plib-paging' : undefined} aria-busy={state === 'loading' || undefined}>
              <Items def={def} items={items} actions={actions} onRemoved={removeItem} expanded={expanded} />
            </div>}
        {/* Stays put while the next page loads, so the numbers never jump. */}
        {pages > 1 && state !== 'error' && <Pager page={page} pages={pages} onGo={goPage} />}
      </div>}
    </section>
  )
}

// Page numbers: the first, the last, and the two either side of this one,
// with a gap mark between runs (1 … 4 5 6 … 24).
function pageList(page: number, pages: number): (number | 'gap')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages))
  const out: (number | 'gap')[] = []
  let last = 0
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last === 2) out.push(last + 1)
    else if (n - last > 2) out.push('gap')
    out.push(n); last = n
  }
  return out
}

function Pager({ page, pages, onGo }: { page: number; pages: number; onGo: (n: number) => void }) {
  const { t } = useLang()
  return (
    <nav className="plib-pager" aria-label={t('lib.pages')}>
      <button type="button" className="plib-page is-step" disabled={page <= 1} onClick={() => onGo(page - 1)} aria-label={t('lib.prev')}>
        <LibIcon name="chevron" size={14} />
      </button>
      {pageList(page, pages).map((n, i) => n === 'gap'
        ? <span key={`g${i}`} className="plib-page-gap" aria-hidden="true">…</span>
        : <button key={n} type="button" className={n === page ? 'plib-page is-on' : 'plib-page'} aria-current={n === page ? 'page' : undefined} onClick={() => n !== page && onGo(n)}>{n}</button>)}
      <button type="button" className="plib-page is-step is-next" disabled={page >= pages} onClick={() => onGo(page + 1)} aria-label={t('lib.next')}>
        <LibIcon name="chevron" size={14} />
      </button>
    </nav>
  )
}

function SkeletonRow({ view, n }: { view: View; n: number }) {
  const { t } = useLang()
  return (
    <div className={`plib-grid plib-grid-${view} plib-skeleton`} aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: n }, (_, i) => <div key={i} className="plib-card plib-skel" />)}
    </div>
  )
}

// ── The renderers ───────────────────────────────────────────────────────

function Items({ def, items, actions, onRemoved, expanded }: { def: SectionDef; items: Item[]; actions: LibraryActions; onRemoved: (id: string) => void; expanded: boolean }) {
  const { t } = useLang()
  const date = useDate()
  const cls = `plib-grid plib-grid-${def.view}${expanded ? ' is-expanded' : ''}`
  if (def.view === 'duel') return (
    <div className={cls}>
      {items.map(it => (
        <article key={it.id} className={actions.deletingId === it.id ? 'plib-card plib-duel is-busy' : 'plib-card plib-duel'}>
          <a href={it.href} className="plib-duel-stage" aria-label={it.title}>
            <Half m={it.a} side="A" />
            <Half m={it.b} side="B" />
            <span className="plib-vs" aria-hidden>VS</span>
          </a>
          <div className="plib-card-body">
            <a href={it.href} className="plib-card-title">{it.title || t('profile.untitled')}</a>
            <div className="plib-card-foot">
              <time dateTime={it.created}>{date(it.created)}</time>
              <span className="plib-card-acts">
                <button type="button" onClick={() => actions.share(it.id)} aria-label={t('common.share')} title={t('common.share')}>
                  <LibIcon name={actions.copiedId === it.id ? 'check' : 'link'} size={15} />
                </button>
                <button type="button" onClick={() => actions.requestDelete('duel', it.id, it.title, () => onRemoved(it.id))} aria-label={t('common.delete')} title={t('common.delete')}>
                  <LibIcon name="trash" size={15} />
                </button>
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
  if (def.view === 'media') return (
    <div className={cls}>
      {items.map(it => (
        <article key={it.id} className={actions.deletingId === it.id ? 'plib-card plib-media is-busy' : 'plib-card plib-media'}>
          <button type="button" className="plib-media-stage" onClick={() => actions.openXcreate(it.raw)} aria-label={it.title || t('profile.untitled')}>
            <MediaBox m={it.media} />
          </button>
          {/* On the picture's corner, so a two-column phone card keeps its
              date on one line as in the design. */}
          <span className="plib-card-acts is-overlay">
            <a href={`/xcreate?id=${it.id}`} target="_blank" rel="noopener" aria-label={t('lib.open')} title={t('lib.open')}><LibIcon name="open" size={16} /></a>
            <button type="button" onClick={() => actions.requestDelete('xcreate', it.id, it.title, () => onRemoved(it.id))} aria-label={t('common.delete')} title={t('common.delete')}>
              <LibIcon name="trash" size={16} />
            </button>
          </span>
          <div className="plib-card-body">
            <button type="button" className="plib-card-title" onClick={() => actions.openXcreate(it.raw)}>{it.title || t('profile.untitled')}</button>
            <time dateTime={it.created}>{date(it.created)}</time>
          </div>
        </article>
      ))}
    </div>
  )
  if (def.view === 'thumb') return (
    <div className={cls}>
      {items.map(it => (
        <a key={it.id} href={it.href} className="plib-card plib-thumb">
          <span className="plib-thumb-stage">
            {it.thumb
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={it.thumb} alt="" loading="lazy" />
              : <span className="plib-thumb-none"><LibIcon name={def.icon} size={30} />{it.meta && <small>{it.meta}</small>}</span>}
            {it.badge === '3d' && <span className="plib-tag">3D</span>}
          </span>
          <span className="plib-card-body">
            <span className="plib-card-title">{it.title || t(def.nameKey)}</span>
            <time dateTime={it.created}>{date(it.created)}</time>
          </span>
        </a>
      ))}
    </div>
  )
  if (def.view === 'persona') return (
    <div className={cls}>
      {items.map(it => (
        <a key={it.id} href={it.href} className="plib-card plib-persona">
          {it.thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={it.thumb} alt="" loading="lazy" />
            : <span className="plib-persona-none">{(it.title || '?').slice(0, 1)}</span>}
          <span className="plib-card-body">
            <span className="plib-card-title">{it.title}</span>
            <span className="plib-card-meta">{it.meta ? t('xc.msgs').replace('{n}', it.meta) : t('xc.fresh')}</span>
          </span>
        </a>
      ))}
    </div>
  )
  if (def.view === 'xtell') return <XTellRows items={items} actions={actions} onRemoved={onRemoved} expanded={expanded} />
  // Conversation and session rows: XDirect, XCut, XTalk, XGame, XVote.
  return (
    <ul className={`${cls} plib-rows`}>
      {items.map(it => (
        <li key={it.id}>
          <a href={it.href} className="plib-row">
            <span className="plib-row-main">
              <span className="plib-card-title">{it.title || t(def.nameKey)}</span>
              <span className="plib-card-meta">
                {[it.metaKey ? t(it.metaKey) : null, it.meta, date(it.created)].filter(Boolean).join(' · ')}
              </span>
            </span>
            {it.badge && <span className={`plib-row-badge is-${it.badge}`}>{t('lib.badge.' + it.badge)}</span>}
          </a>
        </li>
      ))}
    </ul>
  )
}

// X先知's saved readings, one row each: named by its title or first
// question, what it was about, when, and Continue / Rename / Delete exactly
// as XTellActivity offers them (delete asks once, in the row).
function XTellRows({ items, actions, onRemoved, expanded }: { items: Item[]; actions: LibraryActions; onRemoved: (id: string) => void; expanded: boolean }) {
  const { t } = useLang()
  const date = useDate()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  return (
    <ul className={`plib-grid plib-grid-list plib-rows plib-xtell${expanded ? ' is-expanded' : ''}`}>
      {items.map(it => {
        const r = it.raw as { temple: string; title: string | null; subject: unknown; turns?: Array<{ role: string }> }
        const title = titles[it.id] ?? r.title ?? ''
        const named = title || firstAsk(r.turns)
        const what = describeVisit(t, r.temple, r.subject)
        const asked = (r.turns ?? []).filter(x => x.role === 'user').length
        if (renaming === it.id) return (
          <li key={it.id} className="plib-row plib-row-edit">
            <TitleEditor value={title} onSave={async text => {
              if (!(await actions.renameReading(it.id, text))) return false
              setTitles(m => ({ ...m, [it.id]: cleanTitle(text) ?? '' })); setRenaming(null); return true
            }} onCancel={() => setRenaming(null)} />
          </li>
        )
        return (
          <li key={it.id} className="plib-row">
            {r.temple in TEMPLE_ART && <span className="plib-row-icon"><TempleArtwork temple={r.temple as TempleKey} kind="icon" clear /></span>}
            <span className="plib-row-main">
              <span className="plib-card-title">{named || what || t(notAskedKey(r.temple))}</span>
              <span className="plib-card-meta">
                {[t(`xtell.site.focus.${r.temple}.name`), named ? what : null, asked ? `${asked} ${t('xtell.saved.turns')}` : t(notAskedKey(r.temple)), date(it.created)].filter(Boolean).join(' · ')}
              </span>
              {failed === it.id && <span role="alert" className="plib-row-error">{t('xtell.saved.deleteFailed')}</span>}
            </span>
            <span className="plib-row-acts">
              {confirming === it.id ? <>
                <span className="plib-row-confirm">{t('xtell.saved.deleteConfirm')}</span>
                <button type="button" className="is-danger" onClick={async () => {
                  setConfirming(null)
                  if (await actions.eraseReading(it.id)) { setFailed(null); onRemoved(it.id) } else setFailed(it.id)
                }}>{t('xtell.saved.deleteYes')}</button>
                <button type="button" onClick={() => setConfirming(null)}>{t('xtell.saved.deleteNo')}</button>
              </> : <>
                <a href={it.href} className="is-primary">{t('xtell.saved.continue')}</a>
                {r.temple !== 'daily' && <button type="button" onClick={() => { setConfirming(null); setRenaming(it.id) }}>{t('xtell.saved.rename')}</button>}
                <button type="button" onClick={() => { setFailed(null); setConfirming(it.id) }}>{t('xtell.saved.delete')}</button>
              </>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// One side of a duel: the picture, a still frame stand-in for a video (the
// video itself only plays on the duel's page), or the start of the text.
function Half({ m, side }: { m?: Media; side: 'A' | 'B' }) {
  return (
    <span className={`plib-half plib-half-${side.toLowerCase()}`}>
      <MediaBox m={m} />
      <span className="plib-ab" aria-hidden>{side}</span>
    </span>
  )
}

function MediaBox({ m }: { m?: Media }) {
  const { t } = useLang()
  if (!m) return <span className="plib-mediabox plib-mediabox-none" />
  if (m.kind === 'image' && m.src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="plib-mediabox" src={m.src} alt="" loading="lazy" decoding="async" />
  }
  // Video waits until asked for: no <video> element, no download, here.
  if (m.kind === 'video') return <span className="plib-mediabox plib-mediabox-video"><span className="plib-play"><LibIcon name="play" size={22} /></span><small>{t('mode.video')}</small></span>
  return <span className="plib-mediabox plib-mediabox-text"><span>{m.text}</span></span>
}

// ── The top bar: Profile, Library ───────────────────────────────────────
// X先知's own top bar on www (XTellNav embedded: .xtell-embedded-bar and its
// temple row), with two items: the same white strip across the content
// area, icon over a 12px label, centred, sticky under the phone's top bar
// (owner, Oct 15: "top bar should match XTell's"). Favorite returns when
// bookmarks exist.

export type ProfileView = 'profile' | 'library'

export function ProfileViewTabs({ view, onChange }: { view: ProfileView; onChange: (v: ProfileView) => void }) {
  const { t } = useLang()
  const tabs: [ProfileView, string, string][] = [['profile', 'user', 'profile.view.profile'], ['library', 'image', 'profile.view.library']]
  return (
    <div className="xtell-embedded-bar pview-bar">
      <div className="xtell-embedded-inner">
        <div className="xtell-temple-wrap">
          <nav className="xtell-temple-nav" aria-label={t('profile.view.label')}>
            {tabs.map(([v, icon, key]) => (
              <a key={v} href={`/profile?view=${v}`} aria-current={view === v ? 'page' : undefined}
                onClick={e => { e.preventDefault(); onChange(v) }}>
                <span className="xtell-nav-icon pview-icon"><LibIcon name={icon} size={30} /></span>
                <span>{t(key)}</span>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
