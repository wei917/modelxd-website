'use client'
// 同款 (Remake), XCreate's sixth type (owner, Oct 10: "paste a link to do the
// same video。做同款。 但是換掉人物或主角 主題 背景"). Phase 1: paste a link or
// upload a video, read it into a shot list (/api/xcreate/remake/breakdown),
// pick the length and what to swap, then make it (Oct 17; owner: "build the
// entire tab page and let me try it"): the photos and tracks upload, the price
// is reserved, and the page follows the job (/api/xcreate/remake/<id>/make,
// lib/remake/make.ts) until the video is on the read's Library item. Plan:
// docs/REMAKE-PLAN.md.
//
// The page is drawn around the original's cut rhythm (Oct 11): the heading
// shows one edit twice (the original, then yours), the read shows the real
// one as a strip with the stretch to remake framed in red, the shots run as
// a timeline, and each material is a card from the original to yours.
//
// The materials (Oct 13; owner: "it should automatically break down the
// essential materials (input images, audio...etc) for users to replace"):
// the read names the people, things (product, props, logos) and places, and
// the page adds the music, each speaking voice and the on-screen text. A row
// of tiles shows them all at once; each card carries a picture of the
// original (cut from X and uploaded videos; YouTube plays the moment in its
// own player instead) and the ways to replace it. Photos and recordings stay
// in the tab until Make is pressed, and only the ones a choice uses go up.
//
// The music (Oct 17; owner: "keep the original style music or tune it with
// slider like more pop or country style"): a new track in the original's
// style, the same moved toward another style with sliders, the user's own
// track, or none. Never the original's recording.
//
// Each read is kept as a Library item (Oct 17; owner: "there is no uuid link
// to continue?"): the address becomes /xcreate?remake=<id>, the choices
// follow the read there a moment after each change, and the link (or the
// Library card) opens it again on any device (lib/remake/saved.ts).
//
// Under the paste box, "try a popular one" (Oct 13): the trending feed's
// published videos, most liked first (/api/xcreate/remake/examples). A tap
// fills the link; reading stays a tap of its own (reads are counted).

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useLang, type Lang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import ModeIcon from '../components/ModeIcon'
import {
  DEFAULT_TUNE, MUSIC_TARGETS, REMAKE_LENGTHS, REMAKE_LOOKS, estimateRemakeCents,
  type Breakdown, type BreakdownResult, type CastChoice, type Character, type MusicChoice, type MusicTune, type Place,
  type PlaceChoice, type RemakeLook, type Shot, type Thing, type ThingChoice, type VoiceChoice,
} from '@/lib/remake/config'
import type { MakeView } from '@/lib/remake/make'
import { remakeCopy, REMAKE_LANGUAGES } from './remake-copy'

const DRAFT_KEY = 'xcreate.remake-draft'
const MAX_VIDEO_BYTES = 300_000_000
const CAST_CHOICES: CastChoice[] = ['keep', 'photo', 'describe', 'famous']
const THING_CHOICES: ThingChoice[] = ['keep', 'photo', 'describe', 'remove']
/** A logo is never carried over, so it has no "keep". */
const LOGO_CHOICES: ThingChoice[] = ['remove', 'photo', 'describe']
const PLACE_CHOICES: PlaceChoice[] = ['keep', 'photo', 'describe']
const MUSIC_CHOICES: MusicChoice[] = ['keep', 'tune', 'mine', 'none']
const POLL_MS = 4000
const VOICE_CHOICES: VoiceChoice[] = ['ai', 'mine', 'none']
const SHOTS_FIRST = 6
const TEXTS_FIRST = 5
const money = (cents: number) => `$${(cents / 100).toFixed(cents >= 1000 ? 0 : 2)}`
/** Fast cuts are under a second, so times keep their tenths: 0:00.8. */
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
/** Whole seconds, for the strip's scale and the reading clock: 1:05. */
const tick = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const pct = (n: number) => `${(n * 100).toFixed(3)}%`
/** The heading's made-up edit, drawn twice: the original's cuts, then yours. */
const HERO_RHYTHM = [2.6, 1, 1.8, 0.7, 1.2, 3.4, 1.4, 0.8, 2.2, 1, 1.6, 2.4, 0.6, 2.8]
/** How tight a shot is, for the strip's shading: close-ups dark, wides light. */
const TIGHTNESS: Record<string, number> = {
  'extreme close-up': 1, 'close-up': 0.85, insert: 0.8, 'medium close-up': 0.7,
  medium: 0.55, 'medium wide': 0.4, wide: 0.25, 'extreme wide': 0.1,
}

type CastPick = { choice: CastChoice; text: string; consent: boolean }
type ThingPick = { choice: ThingChoice; text: string }
type PlacePick = { choice: PlaceChoice; text: string }
type VoicePick = { choice: VoiceChoice; consent: boolean }
type Draft = {
  link: string
  start: number
  result: BreakdownResult | null
  /** The read's Library item (lib/remake/saved.ts); its id is the page's link. */
  rowId: string | null
  length: number
  fromShot: number
  cast: Record<string, CastPick>
  things: Record<string, ThingPick>
  places: Record<string, PlacePick>
  music: MusicChoice
  /** The music sliders (MusicChoice 'tune'). */
  tune: MusicTune
  /** By speaker (a line's `who`). */
  voices: Record<string, VoicePick>
  /** On-screen text, original → the user's; empty = rewritten for the theme. */
  texts: Record<string, string>
  theme: string
  setting: string
  look: RemakeLook
  language: Lang
}
/** A photo or recording the user picked: kept in the tab only, never in the draft; uploaded when making starts. */
type Picked = { url: string; name: string; file: File }
/** A popular video to try (/api/xcreate/remake/examples). `summary` is our
 *  words; `prompt` is the author's, shown under the read of that video. */
type Example = { url: string; handle: string; likes: number; models: string[]; prompt: string; summary: Partial<Record<Lang, string>> }
/** An X post's id, to match an example with a read (the read's link is x.com/i/status/<id>). */
const statusId = (url: string | null | undefined) => url?.match(/\/status(?:es)?\/(\d{5,25})/)?.[1] ?? null

const thingDefault = (t: Thing): ThingChoice => t.kind === 'logo' ? 'remove' : 'keep'
const freshPicks = (b: Breakdown): Pick<Draft, 'cast' | 'things' | 'places' | 'music' | 'voices' | 'texts'> => ({
  cast: Object.fromEntries(b.characters.map(ch => [ch.id, { choice: 'keep', text: '', consent: false }])),
  things: Object.fromEntries((b.things ?? []).map(t => [t.id, { choice: thingDefault(t), text: '' }])),
  places: Object.fromEntries((b.places ?? []).map(x => [x.id, { choice: 'keep', text: '' }])),
  music: b.music.present ? 'keep' : 'none', voices: {}, texts: {},
})
/** What the viewer chose, as kept on their read (photos and recordings never). */
const CHOICE_KEYS = ['length', 'fromShot', 'cast', 'things', 'places', 'music', 'tune', 'voices', 'texts', 'theme', 'setting', 'look', 'language'] as const
type Choices = Pick<Draft, typeof CHOICE_KEYS[number]>
const choicesOf = (x: Draft): Choices => Object.fromEntries(CHOICE_KEYS.map(k => [k, x[k]])) as Choices
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
/** A kept read's choices over the fresh picks for its materials; anything
 *  malformed falls back to the fresh pick. */
function restoreChoices(b: Breakdown, saved: Record<string, unknown> | null): Partial<Draft> {
  const fresh = freshPicks(b)
  if (!saved) return fresh
  const merge = <T,>(base: Record<string, T>, over: unknown) => isRecord(over) ? { ...base, ...over } as Record<string, T> : base
  const str = (v: unknown, fallback: string) => typeof v === 'string' ? v : fallback
  const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    cast: merge(fresh.cast, saved.cast), things: merge(fresh.things, saved.things), places: merge(fresh.places, saved.places),
    voices: merge(fresh.voices, saved.voices), texts: merge(fresh.texts, saved.texts),
    music: (['keep', 'tune', 'mine', 'none'].includes(String(saved.music)) ? saved.music : fresh.music) as MusicChoice,
    ...(isRecord(saved.tune) ? { tune: { ...DEFAULT_TUNE, ...saved.tune } as MusicTune } : {}),
    ...(typeof saved.length === 'number' ? { length: num(saved.length, 30) } : {}),
    ...(typeof saved.fromShot === 'number' ? { fromShot: num(saved.fromShot, 0) } : {}),
    ...(typeof saved.theme === 'string' ? { theme: saved.theme } : {}),
    ...(typeof saved.setting === 'string' ? { setting: saved.setting } : {}),
    ...(typeof saved.look === 'string' && (REMAKE_LOOKS as readonly string[]).includes(saved.look) ? { look: saved.look as RemakeLook } : {}),
    ...(typeof saved.language === 'string' ? { language: saved.language as Lang } : {}),
  }
}
/** A speaker id made safe for an element id. */
const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')

const svg = (children: ReactNode, size = 18) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const LinkIcon = () => svg(<><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></>)
const UploadIcon = () => svg(<><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /></>)
const ICONS = {
  person: () => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, 24),
  thing: () => svg(<><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>, 24),
  logo: () => svg(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="8" cy="8" r="1.5" /></>, 24),
  place: () => svg(<><path d="m3 20 6-10 4 6 3-4 5 8z" /><circle cx="16" cy="6" r="2" /></>, 24),
  music: () => svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>, 24),
  voice: () => svg(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></>, 24),
  text: () => svg(<><path d="M5 5h14" /><path d="M12 5v14" /><path d="M9 19h6" /></>, 24),
}
const HeartIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4.5 6.1 4.5c2.2 0 3.6 1.2 4.4 2.4h3c.8-1.2 2.2-2.4 4.4-2.4 3.8 0 5.7 3.9 4.1 7.2C19.5 16.4 12 21 12 21z" /></svg>
const PlayIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>

export default function RemakeStudio({ signedIn, onSignIn, remakeId = null, onRemakeId }: {
  signedIn: boolean
  /** Opens sign-in; `next` is where to come back to. */
  onSignIn: (next?: string) => void
  /** A kept read to open (/xcreate?remake=<id>, Oct 17). */
  remakeId?: string | null
  /** The read on the page changed: its id goes in the address, or none. */
  onRemakeId?: (id: string | null) => void
}) {
  const { lang } = useLang()
  const c = remakeCopy(lang)
  const listSep = lang === 'en' || lang === 'ko' ? ', ' : '、'
  const colon = lang === 'en' || lang === 'ko' ? ': ' : '：'
  const quote = (t: string) => lang === 'en' || lang === 'ko' ? `“${t}”` : `「${t}」`
  // The read and the choices survive a sign-in round trip and a trip to
  // another type (per tab, like the film's brief). Read before the first
  // draw: restoring in an effect let the save below write the empty draft
  // over the stored one first. Photos and recordings are never stored, only
  // the choices (drafts before Oct 13 kept a photo link in the cast; dropped).
  const [d, setD] = useState<Draft>(() => {
    const base: Draft = {
      link: '', start: 0, result: null, rowId: null, length: 30, fromShot: 0,
      cast: {}, things: {}, places: {}, music: 'keep', tune: DEFAULT_TUNE, voices: {}, texts: {},
      theme: '', setting: '', look: 'keep', language: lang,
    }
    if (typeof window === 'undefined') return base
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        const cast = Object.fromEntries(Object.entries(saved.cast ?? {}).map(([k, v]: [string, any]) =>
          [k, { choice: v?.choice ?? 'keep', text: v?.text ?? '', consent: !!v?.consent }]))
        return { ...base, ...saved, cast, tune: { ...DEFAULT_TUNE, ...(saved.tune ?? {}) } }
      }
    } catch { /* storage unavailable */ }
    return base
  })
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }))
  const [stage, setStage] = useState<'idle' | 'uploading' | 'reading' | 'opening'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, Picked>>({})
  const [allShots, setAllShots] = useState(false)
  const [allTexts, setAllTexts] = useState(false)
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [peek, setPeek] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [since, setSince] = useState(0)
  const [now, setNow] = useState(0)
  const [examples, setExamples] = useState<Example[]>([])
  /** The read's remake (lib/remake/make.ts), followed while it is made. */
  const [make, setMake] = useState<MakeView | null>(null)
  const [starting, setStarting] = useState(false)
  const [makeError, setMakeError] = useState<{ text: string; topUp: boolean } | null>(null)
  /** Bumped when a remake starts, so the page follows it. */
  const [follow, setFollow] = useState(0)
  const [makeNow, setMakeNow] = useState(0)
  const makeRow = useRef<string | null>(null)
  const makeRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const readRef = useRef<HTMLDivElement>(null)
  /** Set by a read that just finished, so it scrolls into view; a draft restored on load does not. */
  const fresh = useRef(false)

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* storage unavailable */ }
  }, [d])

  /** Set when a kept read was just loaded, so loading it does not count as a change to save. */
  const skipSave = useRef(false)

  // A kept read opens from its link (Oct 17): /xcreate?remake=<id>. The read
  // that just finished already sits in the draft under the same id.
  useEffect(() => {
    if (!remakeId || remakeId === d.rowId) return
    // The request is the sign-in check: the page learns who is signed in only
    // after its first draw, so asking `signedIn` here would put the sign-in
    // dialog in front of a signed-in viewer for a moment.
    let live = true
    setStage('opening'); setError(null)
    fetch(`/api/xcreate/remake/${remakeId}`).then(async res => {
      if (!live) return
      if (res.status === 401) { onSignIn(`/xcreate?remake=${remakeId}`); return }
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.result?.breakdown) { setError(c.missingRead); return }
      const r = body.result as BreakdownResult
      setAllShots(false); setAllTexts(false); setExtrasOpen(false); setPeek(null)
      setFiles(prev => { for (const f of Object.values(prev)) URL.revokeObjectURL(f.url); return {} })
      skipSave.current = true
      setD(prev => ({ ...prev, link: r.source.url ?? '', start: r.source.start, result: r, rowId: remakeId, fromShot: 0, length: 30, ...restoreChoices(r.breakdown, body.choices ?? null) }))
    }).catch(() => { if (live) setError(c.missingRead) })
      .finally(() => { if (live) setStage('idle') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remakeId])

  // A read restored from the tab's draft gets its link back in the address.
  useEffect(() => {
    if (!remakeId && d.rowId && d.result) onRemakeId?.(d.rowId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The choices follow the read to its Library item, a moment after the last change.
  const choicesKey = JSON.stringify(choicesOf(d))
  useEffect(() => {
    if (!d.rowId || !d.result) return
    if (skipSave.current) { skipSave.current = false; return }
    const id = d.rowId
    const t = window.setTimeout(() => {
      void fetch(`/api/xcreate/remake/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choices: JSON.parse(choicesKey) }) }).catch(() => { /* kept in the tab anyway */ })
    }, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choicesKey, d.rowId])

  useEffect(() => {
    let live = true
    // Each field checked: a cached answer from before a deploy can lack the
    // newer ones (models and prompt came on Oct 13), and one missing array
    // took the whole page down.
    fetch('/api/xcreate/remake/examples').then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!live || !Array.isArray(j?.examples)) return
        setExamples(j.examples.filter((e: any) => typeof e?.url === 'string').map((e: any): Example => ({
          url: e.url, handle: String(e.handle ?? ''), likes: Number(e.likes) || 0,
          models: Array.isArray(e.models) ? e.models.map(String) : [],
          prompt: typeof e.prompt === 'string' ? e.prompt : '',
          summary: e.summary && typeof e.summary === 'object' ? e.summary : {},
        })))
      })
      .catch(() => { /* no row */ })
    return () => { live = false }
  }, [])

  // The read's remake, followed until it is done. The first look happens even
  // in a background tab; after that a hidden tab stops asking and asks again
  // the moment it is looked at. A look also restarts a pass whose lease ran
  // out (the route does that), so an open page keeps its remake moving.
  useEffect(() => {
    if (makeRow.current !== d.rowId) { makeRow.current = d.rowId; setMake(null); setMakeError(null) }
    const id = d.rowId
    if (!id) return
    let stopped = false, finished = false, first = true, asking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = async () => {
      if (stopped || finished || asking) return
      if (timer) { clearTimeout(timer); timer = undefined }
      if (first || !document.hidden) {
        first = false; asking = true
        try {
          const res = await fetch(`/api/xcreate/remake/${id}/make`)
          if (res.status === 401 || res.status === 404) finished = true
          else if (res.ok) {
            const v = ((await res.json()) as { job?: MakeView | null }).job ?? null
            if (!stopped) setMake(v)
            if (!v || v.status === 'done' || v.status === 'failed') finished = true
          }
        } catch { /* offline for a moment; the next look retries */ }
        asking = false
      }
      if (!stopped && !finished) timer = setTimeout(look, POLL_MS)
    }
    const onVisible = () => { if (!document.hidden) void look() }
    document.addEventListener('visibilitychange', onVisible)
    void look()
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [d.rowId, follow])

  const makeActive = !!make && make.status !== 'done' && make.status !== 'failed'
  useEffect(() => {
    if (!makeActive) return
    setMakeNow(Date.now())
    const t = window.setInterval(() => setMakeNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [makeActive])

  // The clock beside the reading reel: a long read takes up to two minutes.
  useEffect(() => {
    if (stage === 'idle') return
    const t = Date.now()
    setSince(t); setNow(t)
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [stage])

  useEffect(() => {
    if (!fresh.current || !d.result) return
    fresh.current = false
    readRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [d.result])

  const busy = stage !== 'idle'
  const errorText = (body: any): string => {
    const code = String(body?.code ?? '')
    if (code === 'upload_only') return c.uploadOnly(String(body?.platform ?? ''))
    if (code === 'daily_cap') return c.dailyCap(Number(body?.cap) || 10)
    return (c.errors as Record<string, string>)[code] ?? c.errors.read_failed
  }

  const read = async (payload: { url?: string; uploadPath?: string; seconds?: number }) => {
    setStage('reading'); setError(null)
    try {
      const res = await fetch('/api/xcreate/remake/breakdown', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, start: d.start || 0, lang }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) { onSignIn('/xcreate?type=remake'); return }
      if (!res.ok || !body?.breakdown) { setError(errorText(body)); return }
      const r = body as BreakdownResult
      const dur = r.breakdown.duration
      fresh.current = true
      setAllShots(false); setAllTexts(false); setExtrasOpen(false); setPeek(null)
      setFiles(prev => { for (const f of Object.values(prev)) URL.revokeObjectURL(f.url); return {} })
      // Kept as a Library item: its id becomes the page's link (none if saving failed).
      skipSave.current = true
      set({ result: r, rowId: r.id ?? null, fromShot: 0, length: dur <= 15 ? 0 : dur <= 30 ? 15 : 30, ...freshPicks(r.breakdown) })
      onRemakeId?.(r.id ?? null)
    } catch {
      setError(c.errors.read_failed)
    } finally {
      setStage('idle')
    }
  }

  const readLink = () => {
    if (!signedIn) { onSignIn('/xcreate?type=remake'); return }
    if (!d.link.trim() || busy) return
    void read({ url: d.link.trim() })
  }

  /** One tap instead of a long press on a phone; without clipboard access the field takes the paste. */
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (text) { set({ link: text }); setError(null); return }
    } catch { /* not allowed here */ }
    linkRef.current?.focus()
  }

  const uploadAndRead = async (file: File) => {
    const { data } = await createSupabaseBrowser().auth.getUser()
    if (!data.user) { onSignIn('/xcreate?type=remake'); return }
    if (file.size > MAX_VIDEO_BYTES) { setError(c.errors.too_large); return }
    setStage('uploading'); setError(null)
    try {
      // Its length plans the read's one-minute pieces on the server.
      const seconds = await new Promise<number>(resolve => {
        const v = document.createElement('video')
        const src = URL.createObjectURL(file)
        const done = (n: number) => { URL.revokeObjectURL(src); resolve(Number.isFinite(n) ? n : 0) }
        v.preload = 'metadata'; v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(0); v.src = src
      })
      const [att] = await commitAttachments([pendingAttachment(file, 'xcreate')])
      await read({ uploadPath: att.storagePath, seconds })
    } catch {
      setError(c.errors.read_failed); setStage('idle')
    }
  }

  const b = d.result?.breakdown ?? null
  const shots = b?.shots ?? []
  const things = b?.things ?? []
  const places = b?.places ?? []
  const previews = d.result?.previews ?? {}
  const roles = useMemo(() => new Map((b?.characters ?? []).map(ch => [ch.id, ch.role])), [b])
  /** The model writes "C1 grips his head"; the page says who C1 is. */
  const named = (text: string) => text.replace(/\b[cC](\d{1,2})\b/g, (m, n) => roles.get(`c${n}`) ?? m)
  // The main characters first (by shots they are in); one-shot extras, like
  // a crowd's faces, fold away so the people who matter are not buried.
  const castOrder = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of b?.shots ?? []) for (const w of s.who) count.set(w, (count.get(w) ?? 0) + 1)
    const sorted = [...(b?.characters ?? [])].sort((x, y) => (count.get(y.id) ?? 0) - (count.get(x.id) ?? 0))
    const main = sorted.filter((ch, i) => i < 2 || (count.get(ch.id) ?? 0) >= 2)
    return { main, extra: sorted.filter(ch => !main.includes(ch)), count }
  }, [b])
  /** Who speaks, in the order they first do, with their first line. */
  const speakers = useMemo(() => {
    const m = new Map<string, { who: string; first: string; n: number }>()
    for (const l of b?.lines ?? []) { const e = m.get(l.who); if (e) e.n++; else m.set(l.who, { who: l.who, first: l.text, n: 1 }) }
    return [...m.values()]
  }, [b])
  const texts = useMemo(() => [...new Set((b?.shots ?? []).map(s => s.text.trim()).filter(Boolean))], [b])
  /** YouTube is never downloaded, so its cards play the moment in YouTube's own player. */
  const ytId = useMemo(() => {
    if (d.result?.source.kind !== 'youtube' || !d.result.source.url) return null
    try { return new URL(d.result.source.url).searchParams.get('v') } catch { return null }
  }, [d.result])
  const srcStart = d.result?.source.start ?? 0
  /** The example this read came from, for its author's prompt. */
  const readExample = useMemo(() => {
    const id = statusId(d.result?.source.url)
    return id ? examples.find(e => statusId(e.url) === id) ?? null : null
  }, [d.result, examples])

  // The stretch to remake: from the chosen shot, for the chosen length.
  const total = Math.max(0.1, b?.duration ?? 0, shots.length ? shots[shots.length - 1].t1 : 0)
  const first = Math.min(d.fromShot, Math.max(0, shots.length - 1))
  const fromT = shots[first]?.t0 ?? 0
  const remaining = b ? Math.max(1, Math.round(b.duration - fromT)) : 0
  const lengths = b ? REMAKE_LENGTHS.filter(n => n === 0 || n < remaining) : []
  const chosenSeconds = d.length === 0 || d.length >= remaining ? remaining : d.length
  const endT = Math.min(total, fromT + chosenSeconds)
  const inStretch = (s: Shot) => s.t1 > fromT + 0.05 && s.t0 < endT - 0.05
  const stretchCount = shots.filter(inStretch).length
  const longest = Math.max(0.1, ...shots.map(s => s.t1 - s.t0))
  const shown = allShots
    ? shots.map((_, i) => i)
    : shots.map((_, i) => i).filter(i => inStretch(shots[i])).slice(0, SHOTS_FIRST)
  const step = total <= 20 ? 5 : total <= 60 ? 15 : total <= 120 ? 30 : 60
  const ticks: number[] = []
  for (let t = 0; t <= total - step * 0.45; t += step) ticks.push(t)
  const price = money(estimateRemakeCents(chosenSeconds))

  /** A tap on the strip starts the stretch at the shot under the finger. */
  const pickAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * total
    const i = shots.findIndex(s => t < s.t1)
    set({ fromShot: i < 0 ? shots.length - 1 : i })
  }

  // The choices, each built on the latest state (two taps in one tick both count).
  const castPick = (id: string): CastPick => d.cast[id] ?? { choice: 'keep', text: '', consent: false }
  const thingPick = (t: Thing): ThingPick => d.things[t.id] ?? { choice: thingDefault(t), text: '' }
  const placePick = (id: string): PlacePick => d.places[id] ?? { choice: 'keep', text: '' }
  const voicePick = (who: string): VoicePick => d.voices[who] ?? { choice: 'ai', consent: false }
  const setCast = (id: string, patch: Partial<CastPick>) =>
    setD(prev => ({ ...prev, cast: { ...prev.cast, [id]: { ...(prev.cast[id] ?? { choice: 'keep', text: '', consent: false }), ...patch } } }))
  const setThing = (t: Thing, patch: Partial<ThingPick>) =>
    setD(prev => ({ ...prev, things: { ...prev.things, [t.id]: { ...(prev.things[t.id] ?? { choice: thingDefault(t), text: '' }), ...patch } } }))
  const setPlace = (id: string, patch: Partial<PlacePick>) =>
    setD(prev => ({ ...prev, places: { ...prev.places, [id]: { ...(prev.places[id] ?? { choice: 'keep', text: '' }), ...patch } } }))
  const setVoice = (who: string, patch: Partial<VoicePick>) =>
    setD(prev => ({ ...prev, voices: { ...prev.voices, [who]: { ...(prev.voices[who] ?? { choice: 'ai', consent: false }), ...patch } } }))
  const setTune = (patch: Partial<MusicTune>) => setD(prev => ({ ...prev, tune: { ...prev.tune, ...patch } }))
  const pickFile = (key: string, file: File | undefined) => {
    if (!file) return
    setFiles(prev => {
      if (prev[key]) URL.revokeObjectURL(prev[key].url)
      return { ...prev, [key]: { url: URL.createObjectURL(file), name: file.name, file } }
    })
  }
  const inShots = (has: (s: Shot) => boolean) => { const n = shots.filter(has).length; return n ? c.inShots(n) : undefined }

  // Every material once, for the row of tiles at the top of 03: the main
  // people, then things, places, sound and text, and the one-shot extras
  // last so a crowd of faces does not push the rest off the row.
  type Tile = { key: string; label: string; pic: ReactNode; changed: boolean; extra?: boolean }
  const pictureOr = (id: string, icon: ReactNode) => previews[id] ? <img src={previews[id]} alt="" /> : icon
  const personTile = (ch: Character, extra: boolean): Tile =>
    ({ key: ch.id, label: ch.role, pic: pictureOr(ch.id, <ICONS.person />), changed: castPick(ch.id).choice !== 'keep', extra })
  const tiles: Tile[] = b ? [
    ...castOrder.main.map(ch => personTile(ch, false)),
    ...things.map(t => ({ key: t.id, label: t.name, pic: pictureOr(t.id, t.kind === 'logo' ? <ICONS.logo /> : <ICONS.thing />), changed: thingPick(t).choice !== thingDefault(t) })),
    ...places.map(x => ({ key: x.id, label: x.name, pic: pictureOr(x.id, <ICONS.place />), changed: placePick(x.id).choice !== 'keep' })),
    ...(b.music.present ? [{ key: 'music', label: c.music, pic: <ICONS.music />, changed: d.music !== 'keep' }] : []),
    ...speakers.map(sp => ({ key: `v-${safe(sp.who)}`, label: `${c.voiceLabel} ${roles.get(sp.who) ?? sp.who}`, pic: <ICONS.voice />, changed: voicePick(sp.who).choice !== 'ai' })),
    ...(texts.length ? [{ key: 'text', label: c.kinds.text, pic: <ICONS.text />, changed: texts.some(t => !!d.texts[t]?.trim()) }] : []),
    ...castOrder.extra.map(ch => personTile(ch, true)),
  ] : []
  const goTo = (tile: Tile) => {
    if (tile.extra) setExtrasOpen(true)
    setFlash(tile.key)
    window.setTimeout(() => document.getElementById(`xcs-m-${tile.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), tile.extra ? 80 : 0)
    window.setTimeout(() => setFlash(f => f === tile.key ? null : f), 1600)
  }

  /** The original's picture on a card: cut from the video, or YouTube's player at that moment, or an icon. */
  const cardPic = (key: string, id: string | null, best: number | undefined, icon: ReactNode) =>
    id && previews[id] ? <img src={previews[id]} alt="" />
      : ytId && best != null
        ? <button type="button" className="xcs-remake-watch" aria-label={c.watchHere} aria-expanded={peek === key}
          onClick={() => setPeek(p => p === key ? null : key)}><PlayIcon /><span>{tick(srcStart + best)}</span></button>
        : <span className="xcs-remake-icon">{icon}</span>
  const card = (o: { key: string; pic: ReactNode; wide?: boolean; tag: string; count?: string; name: string; look?: string; best?: number; children: ReactNode }) =>
    <div key={o.key} id={`xcs-m-${o.key}`} className={`xcs-remake-cast${flash === o.key ? ' is-flash' : ''}`} role="group" aria-labelledby={`xcs-m-${o.key}-name`}>
      <div className="xcs-remake-cast-was">
        <span className={`xcs-remake-pic${o.wide ? ' is-wide' : ''}`}>{o.pic}</span>
        <div className="xcs-remake-cast-text">
          <p className="xcs-remake-tag"><span>{o.tag}</span>{o.count && <span>{o.count}</span>}</p>
          <p className="xcs-remake-cast-role" id={`xcs-m-${o.key}-name`}>{o.name}</p>
          {o.look && <p className="xcs-remake-cast-look">{o.look}</p>}
        </div>
        {peek === o.key && ytId && o.best != null && <div className="xcs-remake-peek">
          <iframe src={`https://www.youtube-nocookie.com/embed/${ytId}?start=${Math.floor(srcStart + o.best)}&autoplay=1&mute=1&playsinline=1&rel=0`}
            title={o.name} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>}
      </div>
      <div className="xcs-remake-cast-now">
        <p className="xcs-remake-tag is-yours"><span>{c.yours}</span></p>
        {o.children}
      </div>
    </div>
  const seg = <T extends string>(options: T[], value: T, label: (o: T) => string, onPick: (o: T) => void) =>
    <div className="xcs-film-seg">
      {options.map(o => <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)}>{label(o)}</button>)}
    </div>
  const photoPicker = (key: string, label = c.photoPick) =>
    <label className="xcs-remake-photo-pick">
      <span className="xcs-remake-photo-tile">{files[key] ? <img src={files[key].url} alt="" /> : '+'}</span>
      <span>{label}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => pickFile(key, e.target.files?.[0])} />
    </label>
  const audioPicker = (key: string) =>
    <div className="xcs-remake-audio">
      <label className="xcs-remake-audio-pick">
        <ICONS.music /><span>{files[key]?.name ?? c.audioPick}</span>
        <input type="file" accept="audio/*" hidden onChange={e => pickFile(key, e.target.files?.[0])} />
      </label>
      {files[key] && <audio src={files[key].url} controls preload="none" />}
    </div>
  const consent = (checked: boolean, onChange: (v: boolean) => void) =>
    <label className="xcs-remake-consent">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{c.photoConsent}</span>
    </label>

  const castCard = (ch: Character) => {
    const p = castPick(ch.id)
    return card({
      key: ch.id, pic: cardPic(ch.id, ch.id, ch.best, <ICONS.person />), tag: c.original,
      count: c.inShots(castOrder.count.get(ch.id) ?? 0), name: ch.role, look: ch.look, best: ch.best,
      children: <>
        {seg(CAST_CHOICES, p.choice, o => c.cast[o], o => setCast(ch.id, { choice: o }))}
        {(p.choice === 'describe' || p.choice === 'famous') && <input className="xcs-remake-input" value={p.text} maxLength={200}
          aria-label={`${ch.role}${colon}${c.cast[p.choice]}`}
          placeholder={p.choice === 'describe' ? c.describePlaceholder : c.famousPlaceholder}
          onChange={e => setCast(ch.id, { text: e.target.value })} />}
        {p.choice === 'photo' && <div className="xcs-remake-photo">
          {photoPicker(`c:${ch.id}`)}
          {consent(p.consent, v => setCast(ch.id, { consent: v }))}
        </div>}
      </>,
    })
  }
  const thingCard = (t: Thing) => {
    const p = thingPick(t), logo = t.kind === 'logo'
    return card({
      key: t.id, pic: cardPic(t.id, t.id, t.best, logo ? <ICONS.logo /> : <ICONS.thing />), tag: `${c.original} · ${c.thingKinds[t.kind]}`,
      count: inShots(s => !!s.things?.includes(t.id)), name: t.name, look: t.look, best: t.best,
      children: <>
        {seg(logo ? LOGO_CHOICES : THING_CHOICES, p.choice, o => logo && o === 'photo' ? c.myLogo : c.thingChoices[o], o => setThing(t, { choice: o }))}
        {p.choice === 'describe' && <input className="xcs-remake-input" value={p.text} maxLength={200}
          aria-label={`${t.name}${colon}${c.thingChoices.describe}`} placeholder={c.thingPlaceholder}
          onChange={e => setThing(t, { text: e.target.value })} />}
        {p.choice === 'photo' && photoPicker(`t:${t.id}`)}
        {logo && <p className="xcs-film-note">{c.logoNote}</p>}
      </>,
    })
  }
  const placeCard = (x: Place) => {
    const p = placePick(x.id)
    return card({
      key: x.id, pic: cardPic(x.id, x.id, x.best, <ICONS.place />), wide: !!previews[x.id], tag: c.original,
      count: inShots(s => s.place === x.id), name: x.name, look: x.look, best: x.best,
      children: <>
        {seg(PLACE_CHOICES, p.choice, o => c.thingChoices[o], o => setPlace(x.id, { choice: o }))}
        {p.choice === 'describe' && <input className="xcs-remake-input" value={p.text} maxLength={200}
          aria-label={`${x.name}${colon}${c.thingChoices.describe}`} placeholder={c.settingPlaceholder}
          onChange={e => setPlace(x.id, { text: e.target.value })} />}
        {p.choice === 'photo' && photoPicker(`p:${x.id}`)}
      </>,
    })
  }
  const kindHeading = (label: string, n?: number) =>
    <h3 className="xcs-remake-kind"><span>{label}</span>{n ? <b>{n}</b> : null}</h3>
  const hasProduct = things.some(t => t.kind === 'product')
  const shownTexts = allTexts ? texts : texts.slice(0, TEXTS_FIRST)

  // The music's tuning (Oct 17): a style to move toward, how far, and the
  // tempo and energy against the original's. The tempo reads in BPM when the
  // read heard one (the same sum the music prompt makes: ±50 is ±25%).
  const slider = (key: 'amount' | 'tempo' | 'energy', label: string, ends: [string, string], value: string | null) => {
    // Red from the original's place to the thumb: the left end for how far,
    // the middle for tempo and energy.
    const min = key === 'amount' ? 0 : -50, max = key === 'amount' ? 100 : 50, v = d.tune[key]
    const at = ((v - min) / (max - min)) * 100, zero = ((0 - min) / (max - min)) * 100
    return <label className="xcs-remake-slider">
      <span className="xcs-remake-slider-head"><span>{label}</span>{value && <b>{value}</b>}</span>
      <input type="range" min={min} max={max} step={5} value={v}
        style={{ ['--lo' as string]: `${Math.min(at, zero)}%`, ['--hi' as string]: `${Math.max(at, zero)}%` }}
        onChange={e => setTune({ [key]: Number(e.target.value) })} />
      <span className="xcs-remake-slider-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></span>
    </label>
  }
  const bpm = b?.music.bpm ?? null
  const tuneControls = <div className="xcs-remake-tune">
    <p className="xcs-film-note">{c.musicTuneNote}</p>
    <div className="xcs-remake-tune-to" role="group" aria-label={c.tuneToward}>
      <span>{c.tuneToward}</span>
      <div className="xcs-remake-chips">
        {MUSIC_TARGETS.map(t => <button key={t} type="button" aria-pressed={d.tune.target === t} onClick={() => setTune({ target: t })}>{c.targets[t]}</button>)}
      </div>
    </div>
    {slider('amount', c.tuneAmount, c.tuneAmountEnds, `${d.tune.amount}%`)}
    {slider('tempo', c.tuneTempo, c.tuneTempoEnds, bpm ? `${Math.round(bpm * (1 + d.tune.tempo / 200))} BPM` : d.tune.tempo ? `${d.tune.tempo > 0 ? '+' : ''}${d.tune.tempo / 2}%` : null)}
    {slider('energy', c.tuneEnergy, c.tuneEnergyEnds, null)}
    <label className="xcs-remake-consent">
      <input type="checkbox" checked={d.tune.vocals} onChange={e => setTune({ vocals: e.target.checked })} />
      <span>{c.tuneVocals}</span>
    </label>
  </div>

  /** A failed start, in the viewer's words. */
  const makeErrorText = (body: any): { text: string; topUp: boolean } => {
    const code = String(body?.code ?? ''), e = c.makeErrors
    if (code === 'insufficient_credits') return { text: e.insufficient_credits(money(Number(body?.requiredCents) || 0), money(Number(body?.balanceCents) || 0)), topUp: true }
    const known = (e as Record<string, unknown>)[code]
    return { text: typeof known === 'string' ? known : e.start_failed, topUp: false }
  }
  /** Make it: every choice checked here first (a photo swap needs its photo,
   *  a person's photo or voice the tick), then only the files a choice uses
   *  go up, and the route reserves the price and starts the job. */
  const startMake = async () => {
    if (!d.rowId || !b || starting || makeActive) return
    if (!signedIn) { onSignIn(`/xcreate?remake=${d.rowId}`); return }
    if (d.music === 'mine' && !files.music) { setMakeError({ text: c.makeErrors.no_track, topUp: false }); return }
    const keys: string[] = []
    let missing = false
    const need = (key: string, ok = true) => { if (files[key] && ok) keys.push(key); else missing = true }
    for (const ch of b.characters) { const p = castPick(ch.id); if (p.choice === 'photo') need(`c:${ch.id}`, p.consent) }
    for (const t of things) if (thingPick(t).choice === 'photo') need(`t:${t.id}`)
    for (const x of places) if (placePick(x.id).choice === 'photo') need(`p:${x.id}`)
    for (const sp of speakers) { const p = voicePick(sp.who); if (p.choice === 'mine') need(`v:${sp.who}`, p.consent) }
    if (missing) { setMakeError({ text: c.makeErrors.missing_photo, topUp: false }); return }
    if (d.music === 'mine') keys.push('music')
    if (!hasProduct && files.product) keys.push('product')
    setStarting(true); setMakeError(null)
    try {
      const at: Record<string, string> = {}
      try {
        const up = await commitAttachments(keys.map(k => pendingAttachment(files[k].file, 'xcreate')))
        keys.forEach((k, i) => { at[k] = up[i].storagePath })
      } catch { setMakeError({ text: c.makeErrors.upload_failed, topUp: false }); return }
      const withFile = <T extends object>(o: Record<string, T>, prefix: string, field: string) =>
        Object.fromEntries(Object.entries(o).map(([id, p]) => [id, at[`${prefix}:${id}`] ? { ...p, [field]: at[`${prefix}:${id}`] } : p]))
      const choices = {
        from: fromT, seconds: chosenSeconds,
        cast: withFile(d.cast, 'c', 'photo'), things: withFile(d.things, 't', 'photo'), places: withFile(d.places, 'p', 'photo'),
        voices: withFile(Object.fromEntries(speakers.map(sp => [sp.who, voicePick(sp.who)])), 'v', 'recording'),
        texts: d.texts, theme: d.theme, setting: d.setting, look: d.look, language: d.language,
        ...(at.product ? { product: at.product } : {}),
        music: { choice: d.music, tune: d.tune, ...(at.music ? { track: at.music } : {}) },
      }
      const res = await fetch(`/api/xcreate/remake/${d.rowId}/make`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choices }) })
      if (res.status === 401) { onSignIn(`/xcreate?remake=${d.rowId}`); return }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.job) { setMakeError(makeErrorText(body)); return }
      setMake(body.job as MakeView)
      setFollow(n => n + 1)
      window.setTimeout(() => makeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    } catch {
      setMakeError({ text: c.makeErrors.start_failed, topUp: false })
    } finally {
      setStarting(false)
    }
  }

  // The remake as it is made: the stretch's shots as a strip that fills in
  // red, step by step, then the video.
  const madeShots = shots.filter(inStretch)
  const madeShare = make ? (make.status === 'done' ? 1 : Math.min(0.97, make.done / Math.max(1, make.total))) : 0
  const madePanel = make && <div ref={makeRef} className={`xcs-remake-made is-${make.status}`} aria-live="polite">
    <p className="xcs-remake-made-head">
      <span className="xcs-remake-made-state">{c.makeStages[make.status]}</span>
      {makeActive && <span className="xcs-film-clock">{tick(Math.max(0, (makeNow - Date.parse(make.createdAt)) / 1000))}</span>}
    </p>
    {makeActive && <div className="xcs-remake-made-strip" aria-hidden="true">
      {madeShots.map((s, i) => {
        const w = (Math.min(s.t1, endT) - Math.max(s.t0, fromT)) / Math.max(0.1, endT - fromT)
        return <i key={i} style={{ flexGrow: Math.max(0.02, w), ['--k' as string]: TIGHTNESS[s.framing] ?? 0.5 }} />
      })}
      <b style={{ width: pct(madeShare) }} />
    </div>}
    {makeActive && <p className="xcs-remake-made-meta">
      <span>{c.makeSteps(make.done, make.total)}</span>
      <span>{c.makeSpent(money(make.spentCents), money(make.reservedCents))}</span>
    </p>}
    {make.status === 'done' && make.video && <div className="xcs-remake-player">
      <video src={make.video} controls playsInline preload="metadata" style={{ aspectRatio: b?.aspect.replace(':', ' / ') }} />
    </div>}
    {make.status === 'done' && <>
      {make.download && <a className="xcs-primary xcs-remake-download" href={make.download}>{c.download}</a>}
      <p className="xcs-film-note">{[c.makeSaved, make.chargedCents != null ? c.makeCharged(money(make.chargedCents)) : ''].filter(Boolean).join(lang === 'en' || lang === 'ko' ? ' ' : '')}</p>
    </>}
    {make.status === 'failed' && <p className="xcs-film-note">{c.makeFailedNote}</p>}
  </div>

  return <section className="xcs-film xcs-remake" aria-labelledby="xcs-remake-title">
    <header className="xcs-heading">
      <h1 id="xcs-remake-title">{c.title}</h1>
      <p>{c.subtitle}</p>
      <div className="xcs-remake-hero" aria-hidden="true">
        {[c.original, c.yours].map((label, row) => <div key={row} className={row ? 'is-yours' : undefined}>
          <span>{label}</span>
          <i>{HERO_RHYTHM.map((w, k) => <b key={k} style={{ flexGrow: w, animationDelay: row ? `${250 + k * 70}ms` : undefined }} />)}</i>
        </div>)}
      </div>
    </header>

    <div className="xcs-remake-form">
      <label className="xcs-remake-step" htmlFor="xcs-remake-link"><b aria-hidden="true">01</b>{c.linkLabel}</label>
      <div className="xcs-remake-paste">
        <LinkIcon />
        <input ref={linkRef} id="xcs-remake-link" type="url" inputMode="url" enterKeyHint="go" autoComplete="off" value={d.link} disabled={busy}
          placeholder={c.placeholder} onChange={e => set({ link: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') readLink() }} />
        {d.link
          ? <button type="button" className="xcs-remake-clear" aria-label={c.clear} disabled={busy}
            onClick={() => { set({ link: '' }); setError(null); linkRef.current?.focus() }}>×</button>
          : <button type="button" className="xcs-remake-pastebtn" disabled={busy} onClick={() => void paste()}>{c.paste}</button>}
      </div>
      <details className="xcs-remake-start">
        <summary>{c.startAt}</summary>
        <input type="number" min={0} step={1} inputMode="numeric" value={d.start || ''} placeholder="0" disabled={busy}
          aria-label={c.startAt} onChange={e => set({ start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        <p className="xcs-film-note">{c.startHint}</p>
      </details>
      {busy
        ? <div className="xcs-remake-scan" role="status">
          <div className="xcs-remake-reel" aria-hidden="true">
            <div>{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ animationDelay: `${k * 110}ms` }} />)}</div>
          </div>
          <p><span>{stage === 'reading' ? c.reading : stage === 'opening' ? c.opening : c.uploading}</span><b className="xcs-film-clock">{tick(Math.max(0, (now - since) / 1000))}</b></p>
        </div>
        : <>
          <button className="xcs-primary xcs-remake-go" disabled={signedIn && !d.link.trim()} onClick={readLink}>
            {signedIn ? c.read : c.signIn}
          </button>
          <button type="button" className="xcs-remake-upload" onClick={() => signedIn ? fileRef.current?.click() : onSignIn('/xcreate?type=remake')}>
            <UploadIcon /><span>{c.upload}</span>
          </button>
          <p className="xcs-remake-note">{c.orUpload}</p>
          {examples.length > 0 && <div className="xcs-remake-try">
            <p className="xcs-remake-try-head">{c.tryHeading}</p>
            <div className="xcs-remake-try-row">
              {examples.map(ex => <button key={ex.url} type="button" className={`xcs-remake-try-card${d.link === ex.url ? ' is-on' : ''}`}
                aria-pressed={d.link === ex.url}
                onClick={() => { set({ link: ex.url }); setError(null); linkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>
                <span className="xcs-remake-try-top">
                  <b>𝕏</b><span className="xcs-remake-try-handle">@{ex.handle}</span>
                  <span className="xcs-remake-try-likes"><HeartIcon />{ex.likes.toLocaleString(lang)}</span>
                </span>
                <span className="xcs-remake-try-text">{ex.summary[lang] ?? ex.summary.en ?? ''}</span>
                {(ex.models.length > 0 || ex.prompt) && <span className="xcs-remake-try-tags">
                  {ex.models.slice(0, 2).map(m => <span key={m}>{m}</span>)}
                  {ex.prompt && <span className="is-prompt">{c.withPrompt}</span>}
                </span>}
              </button>)}
            </div>
          </div>}
        </>}
      <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadAndRead(f) }} />
      {error && <p className="xcs-film-error" role="alert">{error}</p>}
    </div>

    {b && d.result && <div ref={readRef} className="xcs-remake-read" aria-live="polite">
      <article className="xcs-remake-card">
        <p className="xcs-remake-eyebrow"><ModeIcon m="remake" /><span>{c.shots(shots.length, String(Math.round(b.duration)))} · {b.aspect}</span></p>
        <h2 className="xcs-remake-title">{b.title}</h2>
        <p className="xcs-remake-summary">{named(b.summary)}</p>
        <dl className="xcs-remake-facts">
          <div><dt>{c.look}</dt><dd>{[b.look.style, b.look.palette, b.look.light].filter(Boolean).join(' · ')}</dd></div>
          {b.characters.length > 0 && <div><dt>{c.characters}</dt><dd>
            {castOrder.main.map(ch => ch.role).join(listSep)}
            {castOrder.extra.length > 0 && <small>+{castOrder.extra.length}</small>}
          </dd></div>}
          {b.music.present && <div><dt>{c.music}</dt><dd>{c.musicLine(b.music.mood, b.music.bpm, b.music.cuts_on_beat)}</dd></div>}
        </dl>
        {readExample?.prompt && <details className="xcs-remake-prompt">
          <summary>{c.creatorPrompt} · @{readExample.handle}</summary>
          <p>{readExample.prompt}</p>
        </details>}
        <p className="xcs-remake-left">{c.left(d.result.left)}</p>
      </article>

      <section className="xcs-remake-sec" aria-labelledby="xcs-remake-s2">
        <h2 className="xcs-remake-step" id="xcs-remake-s2"><b aria-hidden="true">02</b>{c.lengthLabel}</h2>
        {shots.length > 0 && <div className="xcs-remake-cut">
          <p className="xcs-remake-cut-head"><b>{c.shots(stretchCount, String(chosenSeconds))}</b><span>{clock(fromT)} → {clock(endT)}</span></p>
          <div className="xcs-remake-strip" aria-hidden="true" onClick={pickAt}>
            <div className="xcs-remake-strip-shots">
              {shots.map((s, i) => <i key={i} className={inStretch(s) ? 'is-in' : undefined}
                style={{ left: pct(s.t0 / total), width: pct((s.t1 - s.t0) / total), ['--k' as string]: TIGHTNESS[s.framing] ?? 0.5 }} />)}
            </div>
            <span className="xcs-remake-strip-sel" style={{ left: pct(fromT / total), width: pct((endT - fromT) / total) }} />
          </div>
          <div className="xcs-remake-ticks" aria-hidden="true">
            {ticks.map(t => <span key={t} style={{ left: pct(t / total) }}>{tick(t)}</span>)}
            <span className="is-end">{tick(total)}</span>
          </div>
        </div>}
        <div className="xcs-film-seg xcs-remake-len" role="group" aria-label={c.lengthLabel}>
          {lengths.map(n => {
            const secs = n === 0 ? remaining : n
            return <button key={n} type="button" aria-pressed={chosenSeconds === secs} onClick={() => set({ length: n })}>
              <span>{n === 0 ? c.whole(remaining) : c.seconds(n)}</span>
              <small>{c.about(money(estimateRemakeCents(secs)))}</small>
            </button>
          })}
        </div>
        <label className="xcs-remake-from">
          <span>{c.fromShot}</span>
          <select className="xcs-remake-select" value={first} onChange={e => set({ fromShot: Number(e.target.value) })}>
            {shots.map((s, i) => <option key={i} value={i}>{i + 1} · {clock(s.t0)} · {named(s.action).slice(0, 28)}</option>)}
          </select>
        </label>

        <ol className="xcs-remake-shots">
          {shown.map(i => {
            const s = shots[i], len = s.t1 - s.t0
            return <li key={i} className={inStretch(s) ? undefined : 'is-out'}>
              <span className="xcs-remake-shot-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="xcs-remake-shot-body">
                <p className="xcs-remake-shot-meta">
                  <span>{clock(s.t0)}</span>
                  <span className="xcs-remake-shot-len"><i><b style={{ width: pct(Math.max(0.04, len / longest)) }} /></i>{c.seconds(Math.round(len * 10) / 10)}</span>
                  {s.transition_in && s.transition_in !== 'cut' && <span className="xcs-remake-shot-tr">{c.transitions[s.transition_in] ?? s.transition_in}</span>}
                </p>
                <p className="xcs-remake-shot-tags"><span>{c.framing[s.framing] ?? s.framing}</span>{s.camera && <span>{s.camera}</span>}</p>
                <p className="xcs-remake-shot-action">{named(s.action)}</p>
                {(s.who.length > 0 || s.where) && <p className="xcs-remake-shot-where">{[s.who.map(w => roles.get(w) ?? w).join(listSep), s.where].filter(Boolean).join(' · ')}</p>}
                {s.text && <p className="xcs-remake-shot-text"><span>{s.text}</span></p>}
              </div>
            </li>
          })}
        </ol>
        {shown.length < shots.length || allShots
          ? <button type="button" className="xcs-remake-moreshots" onClick={() => setAllShots(v => !v)}>
            {allShots ? c.showLess : c.showAll(shots.length)}
          </button>
          : null}

        {b.lines.length > 0 && <details className="xcs-film-more xcs-remake-linesbox">
          <summary>{c.lines} ({b.lines.length})</summary>
          <ul className="xcs-remake-lines">{b.lines.map((l, i) => <li key={i}><span>{clock(l.t)}</span> {roles.get(l.who) ?? l.who}{colon}{l.text}</li>)}</ul>
        </details>}
      </section>

      <section className="xcs-remake-sec" aria-labelledby="xcs-remake-s3">
        <h2 className="xcs-remake-step" id="xcs-remake-s3"><b aria-hidden="true">03</b>{c.swapHeading}</h2>
        {tiles.length > 0 && <>
          <p className="xcs-remake-found">{c.materials(tiles.length)}</p>
          <div className="xcs-remake-tray">
            {tiles.map(t => <button key={t.key} type="button" className={`xcs-remake-tile${t.changed ? ' is-changed' : ''}`} onClick={() => goTo(t)}>
              <span className="xcs-remake-tile-pic">{t.pic}</span>
              <span className="xcs-remake-tile-name">{t.label}</span>
            </button>)}
          </div>
        </>}

        {b.characters.length > 0 && <div className="xcs-remake-group">
          {kindHeading(c.kinds.people, b.characters.length)}
          <div className="xcs-remake-swaps">
            {castOrder.main.map(castCard)}
            {castOrder.extra.length > 0 && <details className="xcs-film-more xcs-remake-extra" open={extrasOpen}
              onToggle={e => setExtrasOpen(e.currentTarget.open)}>
              <summary>{c.otherCast(castOrder.extra.length)}</summary>
              <div className="xcs-remake-swaps">{castOrder.extra.map(castCard)}</div>
            </details>}
          </div>
        </div>}

        {things.length > 0 && <div className="xcs-remake-group">
          {kindHeading(c.kinds.things, things.length)}
          <div className="xcs-remake-swaps">{things.map(thingCard)}</div>
        </div>}

        {places.length > 0 && <div className="xcs-remake-group">
          {kindHeading(c.kinds.places, places.length)}
          <div className="xcs-remake-swaps">{places.map(placeCard)}</div>
        </div>}

        {(b.music.present || speakers.length > 0) && <div className="xcs-remake-group">
          {kindHeading(c.kinds.sound, (b.music.present ? 1 : 0) + speakers.length)}
          <div className="xcs-remake-swaps">
            {b.music.present && card({
              key: 'music', pic: <span className="xcs-remake-icon"><ICONS.music /></span>, tag: c.original,
              count: b.music.bpm ? `${b.music.bpm} BPM` : undefined, name: c.music,
              look: c.musicLine(b.music.mood, null, b.music.cuts_on_beat),
              children: <>
                {seg(MUSIC_CHOICES, d.music, o => c.musicChoices[o], o => set({ music: o }))}
                {d.music === 'keep' && <p className="xcs-film-note">{c.musicKeepNote}</p>}
                {d.music === 'tune' && tuneControls}
                {d.music === 'mine' && audioPicker('music')}
                {d.music === 'none' && <p className="xcs-film-note">{c.noMusicNote}</p>}
              </>,
            })}
            {speakers.map(sp => {
              const p = voicePick(sp.who), name = roles.get(sp.who) ?? sp.who
              return card({
                key: `v-${safe(sp.who)}`, pic: <span className="xcs-remake-icon"><ICONS.voice /></span>,
                tag: `${c.original} · ${c.voiceLabel}`, count: c.linesCount(sp.n), name, look: quote(sp.first),
                children: <>
                  {seg(VOICE_CHOICES, p.choice, o => c.voiceChoices[o], o => setVoice(sp.who, { choice: o }))}
                  {p.choice === 'mine' && <div className="xcs-remake-photo">
                    {audioPicker(`v:${sp.who}`)}
                    {consent(p.consent, v => setVoice(sp.who, { consent: v }))}
                  </div>}
                </>,
              })
            })}
          </div>
        </div>}

        {texts.length > 0 && <div className="xcs-remake-group">
          {kindHeading(c.kinds.text, texts.length)}
          {card({
            key: 'text', pic: <span className="xcs-remake-icon"><ICONS.text /></span>, tag: c.original,
            count: c.textsCount(texts.length), name: c.kinds.text,
            children: <>
              <ol className="xcs-remake-texts">
                {shownTexts.map(t => <li key={t}>
                  <span className="xcs-remake-caption">{t}</span>
                  <input className="xcs-remake-input" value={d.texts[t] ?? ''} maxLength={120} placeholder={c.textAuto} aria-label={t}
                    onChange={e => { const v = e.target.value; setD(prev => ({ ...prev, texts: { ...prev.texts, [t]: v } })) }} />
                </li>)}
              </ol>
              {texts.length > TEXTS_FIRST && <button type="button" className="xcs-remake-moreshots" onClick={() => setAllTexts(v => !v)}>
                {allTexts ? c.showLess : c.showAllTexts(texts.length)}
              </button>}
            </>,
          })}
        </div>}

        <div className="xcs-remake-group">
          {kindHeading(c.kinds.overall)}
          <div className="xcs-remake-set">
            <label className="xcs-remake-row">
              <span>{c.theme}</span>
              <input className="xcs-remake-input" value={d.theme} maxLength={300} placeholder={c.themePlaceholder} onChange={e => set({ theme: e.target.value })} />
            </label>
            {places.length === 0 && <label className="xcs-remake-row">
              <span>{c.setting}</span>
              <input className="xcs-remake-input" value={d.setting} maxLength={300} placeholder={c.settingPlaceholder} onChange={e => set({ setting: e.target.value })} />
            </label>}
            <div className="xcs-remake-row" role="group" aria-labelledby="xcs-remake-look">
              <span id="xcs-remake-look">{c.lookLabel}</span>
              {seg(REMAKE_LOOKS, d.look, l => c.looks[l], l => set({ look: l }))}
            </div>
            <label className="xcs-remake-row">
              <span>{c.language}</span>
              <select className="xcs-remake-select" value={d.language} onChange={e => set({ language: e.target.value as Lang })}>
                {REMAKE_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            {!hasProduct && <div className="xcs-remake-row">
              <span>{c.product}</span>
              {photoPicker('product')}
            </div>}
          </div>
        </div>
      </section>

      {madePanel}
      {makeError && <p className="xcs-film-error" role="alert">{makeError.text} {makeError.topUp && <a href="/profile">{c.topUp}</a>}</p>}
      {!make && <p className="xcs-film-note xcs-remake-makenote">{c.makeNote}</p>}
      <div className="xcs-remake-bar">
        <p className="xcs-remake-bar-sum"><b>{c.about(price)}</b><span>{c.shots(stretchCount, String(chosenSeconds))}</span></p>
        <button className={`xcs-primary${make?.status === 'done' ? ' is-again' : ''}`} disabled={starting || makeActive || !d.rowId} onClick={() => void startMake()}>
          {starting ? c.makeStarting : make && makeActive ? c.makeStages[make.status] : make ? c.makeAgain : c.make}
        </button>
      </div>
      <button type="button" className="xcs-remake-again" onClick={() => { set({ result: null, rowId: null, link: '', start: 0 }); onRemakeId?.(null); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{c.another}</button>
    </div>}
  </section>
}
