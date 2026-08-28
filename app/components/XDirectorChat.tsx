'use client'
// app/components/XDirectorChat.tsx
// The director — a personal video director you talk to (CC, July 26 2026).
// Lives on /xdirect as the chat rail beside the canvas (CC, Aug 5 — the
// "agent is a mode, not a destination" call from July was right until the
// agent owned a stage; now it owns one).
//
// The conversation loop lives here:
//   user text (+ photos) → POST /api/xdirector → agent replies, possibly
//   with a start_generation action → this page fires the NORMAL /api/xcreate
//   pipeline (reserve/settle billing, jobs table, gallery, lineage) and
//   polls it → the outcome goes back to the agent as a tool_result → the
//   agent comments and proposes the next step.
//
// The agent never bypasses billing: every generation is a regular XCreate
// run and shows up in Recent / the gallery like any other.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT, useLang } from '../../lib/i18n'
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { commitAttachments, type Attachment } from '../components/AttachmentButton'
import MusicVideoSetup from '../components/MusicVideoSetup'
import SocialPostSetup from '../components/SocialPostSetup'
import AnimationSetup from '../components/AnimationSetup'
import StorySetup, { type StoryExtra } from '../components/StorySetup'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import { isSubmitEnter } from '../../lib/ime'

// One bubble in the visible transcript. Generation bubbles update in place
// as the job progresses.
type Bubble = {
  role: 'user' | 'agent' | 'gen' | 'ask' | 'plan'
  text?: string
  /** The STORY BIBLE bubble (Story to Video) — gets the "open as a page ·
   *  save as PDF" link to /xdirect/bible/<id>. */
  bible?: boolean
  files?: string[]          // attachment names shown under a user bubble
  /** Committed attachment descriptors (storagePath etc.), persisted with the
   *  bubble so a RESTORED conversation can still generate with its reference
   *  photos. Before this, committedRef lived only in memory: a reload +
   *  scene ▶ fired a reference recipe with zero images and the provider
   *  failed (IMG_3776, Aug 6). */
  atts?: Array<{ storagePath: string; bucket?: string; mediaType: string; fileName: string; fileSize?: number
    /** Signed URL, set only for images the bubble should SHOW — the
     *  reference-video style frames. A look the user cannot see is a look
     *  they cannot correct, which is the same reason the lyric transcript
     *  goes on screen rather than straight to the director. */
    previewUrl?: string }>
  /** The SONG, kept apart from `atts` on purpose. committedRef filters audio
   *  out — it means "reference photos for generation", and a song passed as a
   *  visual reference is nonsense. But the song is what the finished film is
   *  FOR, and XCut had no way to find it: the board stored no link to it at
   *  all, so every music video ended with the user hunting their own upload
   *  in the library. Recorded here so the rough cut can lay it down itself. */
  songs?: Array<{ storagePath: string; bucket?: string; mediaType: string; fileName: string }>
  // gen bubbles:
  status?: 'generating' | 'done' | 'error'
  modelName?: string
  videoUrl?: string
  imageUrl?: string
  cost?: number
  error?: string
  // ask bubbles — clickable answers instead of making the user type.
  options?: string[]
  // plan bubbles — the one confirm step before anything is charged.
  plan?: { modelName: string; recipe: string; duration?: number; estimate: number | null; prompt: string }
  // set once an ask/plan bubble has been acted on, so it stops being live.
  resolved?: string
  // protocol context needed to resume the paused agent loop on click.
  pending?: { msgs: any[]; action: any; pendingToolResults: any[] }
}

const MAX_AUTO_GENS = 3     // per user turn — a runaway agent can't chain-spend

/**
 * The chat used to write `/xdirector?c=...` straight into the address bar.
 * It now lives inside /xcreate as Agent Mode, so hardcoding its old path
 * threw the user back to a route they had already been redirected off —
 * and silently dropped ?agent=1 with it. Only ever touch the query.
 */
function setConversationUrl(id: string | null) {
  if (typeof window === 'undefined') return
  const p = new URLSearchParams(window.location.search)
  if (id) p.set('c', id)
  else p.delete('c')
  const qs = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
}

export type SceneRunnerHandle = {
  /** Run one scene from its card. The click is the confirm step. */
  generateScene: (sceneId: string, sceneLabel: string, kind: 'still' | 'video') => void
  /** Run every draft scene, in order. One click authorizes the batch. */
  generateAll: (sceneIds: string[], kind: 'still' | 'video') => void
  /** Canvas rerun (owner, Aug 9): same prompt, different model — the new
   *  output lands as a SIBLING of the original so the two compare side by
   *  side. The plan bubble still gates the spend. */
  rerunNode: (node: { rowId?: string; prompt?: string; isVideo: boolean; kind?: string | null; parentRowIds?: string[] }, model: { id: string; display_name: string }, opts?: { duration?: number; resolution?: string; aspect_ratio?: string; refs?: Array<{ bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }> }) => void
  /** A board-side take switch, recorded in the transcript (owner, Aug 9)
   *  — a visible ★ line and a protocol note, no director turn spent. */
  noteTake: (sceneId: string, sceneLabel: string, modelName: string) => void
  /** THE BRAKE (owner, Aug 12: "is there a way to stop all the generation
   *  if I accidentally clicked ▶▶ Videos?"). Disarms every pending scene:
   *  the clip already at the provider finishes and is billed — providers
   *  give us no cancel — but nothing further starts. */
  stopGeneration: () => void
}

export default function XDirectorChat({ onConversationId, onMintedConversation, onActivity, storyboard, onStoryboard, runnerRef, onBusy, boardNodes, onBrief, initialTemplate }: {
  /** /xdirect listens here so its canvas can follow the conversation's
   *  board (board id === conversation id). Fired on restore and on the
   *  first message of a fresh chat. */
  onConversationId?: (id: string) => void
  /** Fired ONLY when this chat mints a brand-new id (never on restore) —
   *  the page uses it to keep the minted id from remounting the surface. */
  onMintedConversation?: (id: string) => void
  /** Fired whenever the board may have changed (a generation settled, a
   *  conversation restored) — the canvas refreshes on it. */
  onActivity?: () => void
  /** The storyboard lives on the PAGE (the strip edits it there); the chat
   *  reads it for context, merges the director's revisions into it, and
   *  persists it with the conversation. */
  storyboard?: any[]
  onStoryboard?: (scenes: any[]) => void
  /** The strip's generate buttons call through here. */
  runnerRef?: React.MutableRefObject<SceneRunnerHandle | null>
  /** Mirrors the chat's busy state up so the strip can pause its buttons. */
  onBusy?: (busy: boolean) => void
  /** The page's live board rows — the chat uses them to reconcile a
   *  generation that finished while the page was closed (see the
   *  orphaned-completion effect). */
  boardNodes?: any[]
  /** Arrived from /xdirect/<template> — this chat opens with that template
   *  already chosen and the gallery hidden, because the user picked it on the
   *  page before. 'scratch' means the freeform road: no template, no setup
   *  form, straight to the composer. */
  initialTemplate?: string | null
  /** The conversation's ORIGINAL brief (first user message) — the canvas
   *  shows it as the Prompt input node beside the references (owner,
   *  Aug 9: "the overall original input is not just 3 references"). */
  onBrief?: (text: string) => void
} = {}) {
  const t = useT()
  const { lang } = useLang()   // the digest writes the story bible in the reader's language

  const [bubbles,  setBubbles]  = useState<Bubble[]>([])
  const [protocol, setProtocol] = useState<any[]>([])   // verbatim Anthropic messages
  const [input,    setInput]    = useState('')
  // Composer grows with its content (owner, Aug 8: pasting a brief meant
  // scrolling inside a two-line box) — height follows scrollHeight up to a
  // cap, then scrolls internally.
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`
  }, [input])
  // Copy-whole-bubble (owner, Aug 8). Index of the bubble just copied — the
  // icon flashes ✓ for a beat.
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyBubble = (i: number, text: string) => {
    try { void navigator.clipboard.writeText(text) } catch { return }
    setCopiedIdx(i)
    setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1600)
  }

  // Handed here by the omnibox's "Ask XDirector" row. Prefilled, NOT sent:
  // the agent can start billable generations, so the keystroke that spends
  // money stays the user's. Consumed and stripped so a refresh does not
  // resurrect an old question. (CC, Aug 5)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const seeded = url.searchParams.get('q')
    if (!seeded) return
    setInput(seeded)
    url.searchParams.delete('q')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])
  const [atts,     setAtts]     = useState<Attachment[]>([])
  // The template setup form (owner, Aug 14): shown when the music-video
  // skill is armed on an EMPTY conversation. Its fields pre-answer the
  // skill's one permitted ask turn, so the first director turn is the plan.
  // 'scratch' has no form to open, so the composer must not be suppressed
  // waiting for one.
  const router = useRouter()
  const [setupDismissed, setSetupDismissed] = useState(initialTemplate === 'scratch')
  const [busy,     setBusy]     = useState<'idle' | 'thinking' | 'generating'>('idle')
  // What the chat is doing between Enter and the first reply — uploading,
  // transcribing, or waiting on the director. Shown as a live progress
  // line so a long song upload never looks like a frozen page.
  const [prep,     setPrep]     = useState<string | null>(null)
  // id -> { name, perSec }. Without this the transcript printed the raw
  // model UUID next to GENERATING, which read like an error code.
  const [models,   setModels]   = useState<Record<string, { name: string; perSec: number | null }>>({})
  // ── Skills (CC, July 28) ──────────────────────────────────────────────
  // The catalogue is the open Agent Skills format read off disk by
  // /api/skills. Selecting one sends its name with every agent turn; the
  // server loads the SKILL.md body and fences it behind ModelXD's own rules.
  const [skills,      setSkills]      = useState<Array<{ name: string; description: string; metadata: Record<string, string> }>>([])
  const [activeSkill, setActiveSkill] = useState<string | null>(
    initialTemplate && initialTemplate !== 'scratch' ? initialTemplate : null)
  // agentTurn is re-entered from chip clicks and generation results, so the
  // selection is read from a ref rather than a stale closure.
  const activeSkillRef = useRef<string | null>(null)

  // True while ANY template's setup form is on screen, so the composer can
  // hide behind it and leave exactly one place to type.
  const setupOpen = !setupDismissed && bubbles.length === 0
    && ['music-video', 'social-post', 'ai-animation', 'story-to-video'].includes(activeSkill ?? '')

  // True while the TEMPLATE GALLERY is the screen. The composer hides behind
  // it too (owner, Aug 27: "don't show prompt text in XDirect page"): a card
  // and a text box were two entrances to the same send, and the box silently
  // skipped every setup form. Removing it is only safe because the freeform
  // road is now its own card — /xdirect/scratch — which lands here with
  // initialTemplate set, so this is false and the composer is back.
  const galleryOpen = !initialTemplate && bubbles.length === 0 && skills.length > 0

  useEffect(() => { activeSkillRef.current = activeSkill }, [activeSkill])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const res = await fetch('/api/skills', { cache: 'no-store' })
        if (!res.ok) return
        const d = await res.json()
        if (!dead && Array.isArray(d?.skills)) setSkills(d.skills)
      } catch { /* the director works fine with no skills installed */ }
    })()
    return () => { dead = true }
  }, [])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const sb = createSupabaseBrowser()
        const { data } = await sb.from('ai_models').select('id, display_name, model_pricing').eq('enabled', true)
        if (dead || !data) return
        const map: Record<string, { name: string; perSec: number | null }> = {}
        for (const m of data as any[]) {
          const ps = m.model_pricing?.per_video_second
          // Cheapest listed resolution is what a default run bills at.
          const perSec = ps && typeof ps === 'object'
            ? Math.min(...Object.values(ps).map(Number).filter(n => Number.isFinite(n)))
            : null
          map[m.id] = { name: m.display_name, perSec: Number.isFinite(perSec as number) ? (perSec as number) : null }
        }
        setModels(map)
      } catch { /* names degrade to the id; not worth blocking the chat */ }
    })()
    return () => { dead = true }
  }, [])

  // ── Conversation persistence (CC, July 28) ────────────────────────────
  // The chat used to live only in React state: a reload lost everything and
  // there was no link to come back to. The id is generated client-side on
  // the first message so the URL can change immediately, before the save
  // round-trip finishes.
  const convIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = new URLSearchParams(window.location.search).get('c')
    if (!id) return
    convIdRef.current = id
    onConversationId?.(id)
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/xdirector/conversation?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
        const d = await res.json().catch(() => null)
        if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
        const c = d?.conversation
        if (c) {
          setProtocol(Array.isArray(c.protocol) ? c.protocol : [])
          setBubbles(Array.isArray(c.bubbles) ? c.bubbles : [])
          // Resume under the same skill the chat was produced with.
          if (typeof c.skill === 'string' && c.skill) setActiveSkill(c.skill)
          // Rehydrate the reference photos: the LAST user bubble that carried
          // committed attachments defines what use_attachments means now,
          // exactly as it would mid-session.
          const withAtts = [...(Array.isArray(c.bubbles) ? c.bubbles : [])]
            .reverse().find((b: any) => b.role === 'user' && Array.isArray(b.atts) && b.atts.length > 0)
          if (withAtts) committedRef.current = withAtts.atts as any
          if (Array.isArray(c.storyboard) && c.storyboard.length > 0) {
            storyboardRef.current = c.storyboard
            onStoryboard?.(c.storyboard)
          }
          onActivity?.()   // the restored board has nodes to draw
        }
      } catch {
        // A dead link shouldn't strand the user on a blank page — drop the
        // id and let them start fresh.
        convIdRef.current = null
        setConversationUrl(null)
      } finally { setLoading(false) }
    })()
  }, [])

  const saveConversation = async (proto: any[], bubs: Bubble[]) => {
    if (proto.length === 0) return
    ensureConvId()
    // `pending` carries a full copy of the message array per bubble — great
    // for resuming a click in-session, ruinous to store.
    const slim = bubs.map(({ pending, ...rest }) => rest)
    // Base64 photos are session context, not conversation history — storing
    // them made a single row half a megabyte and reloaded it on every open.
    const lean = proto.map(stripImages)
    const firstUser = bubs.find(b => b.role === 'user')?.text ?? 'Untitled'
    try {
      await fetch('/api/xdirector/conversation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: convIdRef.current, title: firstUser.slice(0, 120),
          protocol: lean, bubbles: slim,
          // Stored so reopening the link resumes with the same skill.
          skill: activeSkillRef.current,
          // The board rides with the conversation it belongs to. previewUrl
          // is a session-local blob: URL — dead on reload, so not stored.
          storyboard: storyboardRef.current.length > 0
            ? storyboardRef.current.map((s: any) => Array.isArray(s.refs) && s.refs.length > 0
                ? { ...s, refs: s.refs.map(({ previewUrl, ...r }: any) => r) }
                : s)
            : null,
        }),
      })
    } catch { /* a failed save must never break the chat */ }
  }

  const endRef      = useRef<HTMLDivElement>(null)
  // ── Board identity (CC, July 31) ──────────────────────────────────────
  // Everything the agent makes in one conversation belongs on ONE canvas
  // board, and the board IS the conversation — same uuid, so resuming a
  // ?c= link reopens the same board with no extra column to store. Without
  // this the agent's outputs were orphan rows that only ever existed as
  // chat bubbles.
  const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ensureConvId = () => {
    if (!convIdRef.current) {
      convIdRef.current = newId()
      // Order matters: the page must know this id is MINTED before the URL
      // write reaches the router, or the searchParams sync remounts the
      // surface out from under the send in progress.
      onMintedConversation?.(convIdRef.current)
      setConversationUrl(convIdRef.current)
      onConversationId?.(convIdRef.current)
    }
    return convIdRef.current
  }
  // The most recent generation on this board. The next one hangs off it, so
  // the canvas draws a lineage the user can follow instead of a scatter of
  // unconnected tiles.
  const lastGenIdRef = useRef<string | null>(null)

  const committedRef = useRef<Attachment[]>([])          // last committed uploads, reused across shots
  // Armed by a canvas ↻: the next generation inherits THESE parents so the
  // rerun lands beside the original instead of dangling off lastGen.
  const pendingRerunRef = useRef<{ parentRowIds: string[]; sceneId?: string; refs?: Array<{ bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }> } | null>(null)
  // The ↻ config step showed the price and the click was the confirm —
  // same rule as scene cards. One-shot: authorizes exactly one generation,
  // so the plan bubble never strands a fullscreen-canvas user in a chat
  // they cannot see (owner, Aug 9).
  const armedRerunRef = useRef(false)
  const genCountRef  = useRef(0)                          // auto-gens this user turn
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { onBusy?.(busy !== 'idle') }, [busy, onBusy])
  // The progress line belongs to an in-flight turn only.
  useEffect(() => { if (busy === 'idle') setPrep(null) }, [busy])

  // ── Storyboard plumbing (CC, Aug 6) ───────────────────────────────────
  // State lives on the page (the strip edits it); this ref mirrors it so
  // async paths (generation polling, agent turns) read the current value.
  const storyboardRef = useRef<any[]>(storyboard ?? [])
  useEffect(() => { storyboardRef.current = storyboard ?? [] }, [storyboard])

  // Scene ids the USER armed by clicking ▶ on a card. A start_generation
  // carrying an armed scene_id runs without the plan bubble — the card,
  // with its price showing, was the confirm step. Anything unarmed still
  // hits the gate, so the agent cannot spend spontaneously by tagging a
  // scene id onto a generation nobody asked for.
  const armedScenesRef = useRef<Set<string>>(new Set())
  // Set by the strip's ⏹ while a batch is running; checked before every
  // NEXT generation starts. Never aborts the one in flight — that money is
  // already spent and killing its poll would only orphan the row.
  const stopGenRef = useRef(false)
  /** Scenes re-armed after a PROVIDER failure — once per scene per user
   *  action. The ▶ click bought one generation; if that generation died
   *  upstream (nothing billed), the director's immediate retry is still the
   *  same purchase, and stalling it behind a plan card read as a hang three
   *  times on Aug 12. Once only, so a systematically failing scene still
   *  surfaces instead of looping. */
  const reArmedRef = useRef<Set<string>>(new Set())
  const reArmOnFailure = (sceneId: string | null) => {
    if (!sceneId || reArmedRef.current.has(sceneId)) return
    reArmedRef.current.add(sceneId)
    armedScenesRef.current.add(sceneId)
  }

  /** Every row a scene has ever produced — its active take plus every
   *  earlier/alternate one. THIS is what binds a take to its cut, not the
   *  prompt text: the director rewrites shot text between runs (owner bug,
   *  Aug 11 — a re-run of S1·C1 landed on the board belonging to no scene
   *  because its prompt no longer matched the original's). */
  const sceneTakes = (s: any): string[] =>
    [...new Set([
      ...(Array.isArray(s?.takes) ? s.takes : []),
      ...(s?.row_id ? [s.row_id] : []),
      ...(s?.still_row_id ? [s.still_row_id] : []),   // KEYFRAME mode's key still
    ])]

  /** The scene a row belongs to, by identity rather than prompt. */
  const sceneOfRow = (rowId?: string | null) =>
    rowId ? storyboardRef.current.find((s: any) => sceneTakes(s).includes(rowId)) : undefined

  const patchScene = (sceneId: string, p: Record<string, any>) => {
    const next = storyboardRef.current.map((s: any) => {
      if (s.id !== sceneId) return s
      // A scene never forgets a row it made: when the active take moves,
      // the outgoing one joins takes[] instead of being orphaned.
      const takes = (p.row_id && s.row_id && p.row_id !== s.row_id)
        ? [...new Set([...(s.takes ?? []), s.row_id])]
        : s.takes
      return { ...s, ...p, ...(takes ? { takes } : {}) }
    })
    storyboardRef.current = next
    onStoryboard?.(next)
  }

  /** Record a take that must NOT become the card's active clip — the ↻
   *  comparison path. The cut remembers it so the canvas can stack it. */
  const recordTake = (sceneId: string, rowId: string) => {
    const next = storyboardRef.current.map((s: any) => s.id === sceneId
      ? { ...s, takes: [...new Set([...(s.takes ?? []), rowId])] }
      : s)
    storyboardRef.current = next
    onStoryboard?.(next)
  }

  /** Merge the director's revised scene list into the board, preserving the
   *  generation linkage of any scene id that survived the revision. */
  const mergeStoryboard = (incoming: any[]) => {
    const prev = new Map(storyboardRef.current.map((s: any) => [s.id, s]))
    const next = incoming.map((s: any) => {
      const old: any = prev.get(s.id)
      // refs are BOARD-owned: the user uploaded them on the card and the
      // director never writes them — a redraw must not wash them away.
      return old
        ? { ...s, status: old.status ?? 'draft', row_id: old.row_id, url: old.url, cost: old.cost, ...(Array.isArray(old.refs) && old.refs.length > 0 ? { refs: old.refs } : {}) }
        : { ...s, status: 'draft' }
    })
    storyboardRef.current = next
    onStoryboard?.(next)
  }

  // The first user message IS the film's brief — surface it to the page
  // whenever it exists (restore or first send). Same-string updates bail
  // in React, so re-firing is free.
  useEffect(() => {
    const fu = bubbles.find(b => b.role === 'user' && b.text)
    if (fu?.text) onBrief?.(fu.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles])

  // block:'nearest' keeps the auto-scroll INSIDE the transcript's own
  // overflow container — the page itself must never move on a new bubble.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [bubbles])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ── Frame chaining (CC, Aug 6) ────────────────────────────────────────
  // Continuity between scenes is FRAME continuity: scene N+1 opens on the
  // exact image scene N closed on, or the model reinvents the room. This
  // grabs the last frame of a finished clip client-side — crossOrigin +
  // canvas, no server ffmpeg needed — so it can be committed through the
  // normal attachment pipeline and fed to an image_to_video recipe as the
  // next scene's starting state.
  const extractLastFrame = (url: string): Promise<File | null> => new Promise(resolve => {
    const v = document.createElement('video')
    let settled = false
    const done = (f: File | null) => { if (!settled) { settled = true; resolve(f) } }
    v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'
    v.onloadedmetadata = () => {
      // 50ms shy of the end: seeking to the exact duration can land on an
      // empty frame in some containers.
      v.currentTime = Math.max(0, v.duration - 0.05)
    }
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth; c.height = v.videoHeight
        c.getContext('2d')!.drawImage(v, 0, 0)
        c.toBlob(b => done(b ? new File([b], 'chain-frame.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.92)
      } catch { done(null) }   // tainted canvas = CORS said no
    }
    v.onerror = () => done(null)
    setTimeout(() => done(null), 15_000)
    v.src = url
  })

  // How big each reference photo is when the DIRECTOR looks at it, and how
  // many may ride in one turn. These are context-budget numbers, not
  // Reference photos reach the director as URLs, not bytes (owner, Aug 11:
  // "can they just take url instead of photo bytes?"). The Messages API
  // accepts source {type:"url"}, and a signed storage link is ~200 chars
  // where an inline base64 copy was 15k-100k — which is exactly what
  // overflowed the context cap. Two consequences worth having: the
  // director now sees each photo at FULL resolution instead of a shrunken
  // JPEG, and there is no longer any reason to ration how many ride along.
  const VISION_URL_TTL = 60 * 60 * 24 * 7   // a week: outlives any session
  const MAX_VISION = 12                     // token sanity, not size

  /** Sign committed photos for Anthropic to fetch. Server-side: uploads land
   *  at `originals/<uuid>`, which the bucket's owner-read policy does not
   *  match, so a browser createSignedUrl is denied and returns null — that
   *  silently sent the director text-only photos until it was caught live. */
  const signVisionUrls = async (atts: Attachment[]): Promise<Record<string, string>> => {
    const files = atts
      .filter(a => a.storagePath && a.bucket)
      .map(a => ({ bucket: a.bucket, storagePath: a.storagePath }))
    if (files.length === 0) return {}
    try {
      const res = await fetch('/api/xdirector/refs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      })
      const d = await res.json().catch(() => null)
      return (res.ok && d?.urls) ? d.urls : {}
    } catch { return {} }
  }

  const pushBubble = (b: Bubble) => setBubbles(prev => [...prev, b])
  const patchLastGen = (patch: Partial<Bubble>) =>
    setBubbles(prev => {
      const i = prev.map(b => b.role).lastIndexOf('gen')
      if (i < 0) return prev
      const next = [...prev]
      next[i] = { ...next[i], ...patch }
      return next
    })

  // Every tool_use must be answered by a tool_result in the NEXT message —
  // the API 400s the whole conversation otherwise. Clicking a chip or a plan
  // button satisfies that; TYPING a reply instead used to leave the call
  // dangling and poison the protocol permanently (owner hit the 400 live,
  // Aug 8). This walks the transcript and answers any orphaned call with a
  // synthetic "user moved on" result — healing old saved conversations too,
  // since every send passes through here.
  const healProtocol = (msgs: any[]): any[] => {
    const out: any[] = []
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      out.push(m)
      if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue
      const uses = m.content.filter((b: any) => b?.type === 'tool_use').map((b: any) => b.id)
      if (uses.length === 0) continue
      const next = msgs[i + 1]
      const answered = new Set(
        next?.role === 'user' && Array.isArray(next.content)
          ? next.content.filter((b: any) => b?.type === 'tool_result').map((b: any) => b.tool_use_id)
          : [],
      )
      const missing = uses.filter((id: string) => !answered.has(id))
      if (missing.length === 0) continue
      const synth = missing.map((id: string) => ({
        type: 'tool_result', tool_use_id: id,
        content: JSON.stringify({ ok: false, note: 'No result — the user replied in chat instead. Treat this call as declined/superseded and follow their message.' }),
      }))
      if (answered.size > 0 && next?.role === 'user' && Array.isArray(next.content)) {
        // Partial results exist: fold the synthetic ones into that same
        // message, keeping all tool_results ahead of any text blocks.
        out.push({ ...next, content: [...synth, ...next.content] })
        i += 1
      } else {
        out.push({ role: 'user', content: synth })
      }
    }
    return out
  }

  /** Replace image blocks with a one-line placeholder. The director keeps
   *  the FILE's identity (name, role, subject) without carrying its bytes
   *  a second time — it has already described what it saw, and the bytes
   *  are what overflow the context. */
  const stripImages = (m: any) => {
    if (!Array.isArray(m?.content)) return m
    if (!m.content.some((b: any) => b?.type === 'image')) return m
    return {
      ...m,
      content: m.content.map((b: any) =>
        b?.type === 'image' ? { type: 'text', text: '[reference photo shown earlier — see the file list above]' } : b),
    }
  }

  /** Keep photo BYTES only in the most recent message that carries them.
   *  Without this the protocol grows by a full image payload per upload
   *  turn and eventually 413s the whole conversation, which is exactly
   *  what happened (owner, Aug 11). */
  const boundVision = (msgs: any[]): any[] => {
    let last = -1
    for (let i = 0; i < msgs.length; i++) {
      if (Array.isArray(msgs[i]?.content) && msgs[i].content.some((b: any) => b?.type === 'image')) last = i
    }
    if (last < 0) return msgs
    return msgs.map((m, i) => (i === last ? m : stripImages(m)))
  }

  // ── Agent turn: POST the whole conversation, render what comes back ──────
  const agentTurn = async (rawMsgs: any[]) => {
    const msgs = boundVision(healProtocol(rawMsgs))
    setBusy('thinking')
    console.info('[xdirect:turn] POST /api/xdirector', { msgs: msgs.length, scenes: storyboardRef.current.length })
    let data: any
    try {
      const res = await fetch('/api/xdirector', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          ...(activeSkillRef.current ? { skill: activeSkillRef.current } : {}),
          // The live board state, edits included — the director revises the
          // user's text, never its own stale draft.
          ...(storyboardRef.current.length > 0 ? { storyboard: storyboardRef.current } : {}),
        }),
      })
      data = await res.json().catch(() => null)
      console.info('[xdirect:turn] response', {
        status: res.status, newMessages: data?.newMessages?.length ?? 0,
        action: data?.action?.kind ?? null,
        ...(data?.action?.input ? { model_id: data.action.input.model_id, scene_id: data.action.input.scene_id ?? null, recipe: data.action.input.recipe } : {}),
      })
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
    } catch (err: any) {
      console.warn('[xdirect:turn] FAILED:', err)
      setBusy('idle')
      pushBubble({ role: 'agent', text: `⚠ ${err?.message ?? 'The director is unreachable right now.'}` })
      return
    }

    const withNew = [...msgs, ...(data.newMessages ?? [])]
    setProtocol(withNew)

    // The director redrew the board — merge, keeping generation linkage for
    // scene ids that survived, and let the canvas know.
    if (Array.isArray(data.storyboard) && data.storyboard.length > 0) {
      mergeStoryboard(data.storyboard)
      onActivity?.()
    }

    // Render every text block from the new assistant messages.
    for (const m of data.newMessages ?? []) {
      if (m.role !== 'assistant') continue
      const text = (m.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
      if (text) pushBubble({ role: 'agent', text })
    }

    if (data.action?.kind === 'ask') {
      // Chips. The agent loop is paused mid-tool-call; clicking an option
      // resumes it with that answer as the tool result.
      pushBubble({
        role: 'ask',
        text: data.action.input?.question ?? '',
        options: Array.isArray(data.action.input?.options) ? data.action.input.options.slice(0, 4) : [],
        pending: { msgs: withNew, action: data.action, pendingToolResults: data.pendingToolResults ?? [] },
      })
      setBusy('idle')
      return
    }

    if (data.action?.kind === 'generate' || (data.action && !data.action.kind)) {
      // A generation for a scene the user ARMED (▶ on its card, price
      // showing) skips the plan bubble — that click was the confirm. The id
      // is consumed so it authorizes exactly one run, and unarmed scene ids
      // fall through to the normal gate.
      const sceneId = typeof data.action.input?.scene_id === 'string' ? data.action.input.scene_id : null
      console.info('[xdirect:turn] generate gate', { sceneId, sceneArmed: !!(sceneId && armedScenesRef.current.has(sceneId)), rerunArmed: armedRerunRef.current, autoGens: genCountRef.current, stopped: stopGenRef.current })
      if (stopGenRef.current) {
        // Answer the tool call honestly and end the turn — a dropped
        // tool_use 400s every later send.
        const toolMsg = {
          role: 'user',
          content: [...(data.pendingToolResults ?? []), {
            type: 'tool_result', tool_use_id: data.action.toolUseId,
            content: JSON.stringify({ ok: false, note: 'STOPPED: the user pressed Stop. Do not start any further generations. Every remaining scene stays a draft until they press play again.' }),
            is_error: true,
          }],
        }
        setProtocol([...withNew, toolMsg])
        pushBubble({ role: 'agent', text: t('xd.stopped') })
        setBusy('idle')
        return
      }
      if (sceneId && armedScenesRef.current.has(sceneId)) {
        armedScenesRef.current.delete(sceneId)
        await runGeneration(withNew, data.action, data.pendingToolResults ?? [])
        return
      }
      if (armedRerunRef.current) {
        armedRerunRef.current = false
        await runGeneration(withNew, data.action, data.pendingToolResults ?? [])
        return
      }
      console.info('[xdirect:turn] unarmed — showing plan card (the confirm gate)')
      if (genCountRef.current >= MAX_AUTO_GENS) {
        // Safety valve: acknowledge but don't run — the user can just say
        // "go". The tool call MUST still be answered in the protocol: a
        // dropped tool_use 400s every later send (owner hit it, Aug 8 —
        // "messages.14: tool_use ids without tool_result").
        const toolMsg = {
          role: 'user',
          content: [...(data.pendingToolResults ?? []), {
            type: 'tool_result', tool_use_id: data.action.toolUseId,
            content: JSON.stringify({ ok: false, note: 'Not run: auto-generation limit for this turn reached. The user can say "go" to continue.' }),
            is_error: true,
          }],
        }
        setProtocol([...withNew, toolMsg])
        pushBubble({ role: 'agent', text: '⚠ Generation limit for this turn reached — send another message to continue.' })
        setBusy('idle')
        return
      }
      // CONFIRM BEFORE CHARGING. The agent decides everything; the user
      // gets exactly one gate, and it is this card.
      const inp = data.action.input ?? {}
      const meta = models[inp.model_id]
      const dur = typeof inp.duration === 'number' ? inp.duration : null
      pushBubble({
        role: 'plan',
        plan: {
          modelName: meta?.name ?? inp.model_id,
          recipe:    inp.recipe ?? '',
          duration:  dur ?? undefined,
          estimate:  (meta?.perSec != null && dur != null) ? meta.perSec * dur : null,
          prompt:    inp.prompt ?? '',
        },
        pending: { msgs: withNew, action: data.action, pendingToolResults: data.pendingToolResults ?? [] },
      })
      setBusy('idle')
      return
    }

    setBusy('idle')
  }

  // Persist after every settled turn. Debounced by the natural rhythm of
  // the conversation rather than a timer — turns are seconds apart.
  useEffect(() => {
    if (busy !== 'idle') return
    if (protocol.length === 0) return
    void saveConversation(protocol, bubbles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, protocol, bubbles])

  // Strip edits change the storyboard without touching the transcript — give
  // them their own debounced save so a rewrite on a card can't be lost to a
  // reload. Timer-based because typing into a textarea has no "turn".
  useEffect(() => {
    if (!storyboard || storyboard.length === 0 || protocol.length === 0) return
    const h = setTimeout(() => { void saveConversation(protocol, bubbles) }, 900)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboard])

  // ── Orphaned-completion reconciliation (owner, Aug 9) ──────────────────
  // A generation SURVIVES the page: the server finishes and writes the row,
  // but the poll dies with the tab, so a reloaded conversation still shows
  // GENERATING and the transcript never hears the result ("why is there no
  // message saying it's done?"). When board rows arrive while no run is
  // live, claim them: flip the stale bubble to done with the real clip,
  // say so in the chat, and answer the dangling tool call so the director
  // stops believing the run never returned. Prompt matching is exact —
  // a ↻ re-runs its prompt verbatim, so newest-row-with-that-prompt IS
  // that run's output.
  useEffect(() => {
    if (busy !== 'idle' || !boardNodes || boardNodes.length === 0) return
    const staleIdx = bubbles
      .map((b, i) => (b.role === 'gen' && b.status === 'generating' ? i : -1))
      .filter(i => i >= 0)
    if (staleIdx.length === 0) return
    const claimed = new Set<string>()
    const patches = new Map<number, any>()
    for (const i of [...staleIdx].reverse()) {
      const b = bubbles[i]
      const match: any = boardNodes
        .filter((n: any) => n.rowId && n.thumb && n.prompt && !claimed.has(n.rowId) && n.prompt === b.text)
        .sort((a: any, z: any) => String(z.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
      if (!match) continue
      claimed.add(match.rowId)
      patches.set(i, match)
    }
    if (patches.size === 0) return
    console.info('[xdirect:heal] claiming finished run(s) for stale GENERATING bubbles:',
      [...patches.entries()].map(([i, n]) => ({ bubble: i, rowId: n.rowId, model: n.label })))
    setBubbles(prev => prev.map((b, i) => {
      const n = patches.get(i)
      if (!n) return b
      return { ...b, status: 'done' as const, ...(n.isVideo ? { videoUrl: n.thumb } : { imageUrl: n.thumb }), ...(typeof n.cost === 'number' ? { cost: n.cost } : {}) }
    }))
    // Heal the CARD too, not just the transcript. Claiming the row for the
    // bubble and stopping there left the storyboard believing nothing had
    // happened.
    let healedStill = false
    for (const [i, n] of patches.entries()) {
      const b: any = bubbles[i]
      if (!b?.forScene || !n.rowId) continue
      // n.label is the slot's model name — the same value the live completion
      // path writes. Healing the row and the picture but NOT the model left
      // the card offering "☰ Pick model" beside a finished image the user had
      // already paid for: a choice presented after it was spent. The card has
      // to report what RAN, and after a reload this is the only path that can.
      if (b.forKind === 'still') {
        healedStill = true
        patchScene(b.forScene, { still_row_id: n.rowId, still_url: n.thumb ?? undefined, status: 'draft', error: undefined, ...(n.label ? { still_model_name: n.label } : {}) })
      } else if (b.forKind === 'clip') {
        patchScene(b.forScene, { status: 'done', url: n.thumb ?? undefined, row_id: n.rowId, ...(typeof n.cost === 'number' ? { cost: n.cost } : {}), ...(n.label ? { model_name: n.label } : {}) })
      } else if (b.forKind === 'take') {
        recordTake(b.forScene, n.rowId)
      }
    }
    const first: any = [...patches.values()][0]
    const firstBubble: any = bubbles[[...patches.keys()][0]]
    const what = firstBubble?.forKind === 'still' || healedStill ? t('xd.heal.still') : t('xd.heal.clip')
    pushBubble({ role: 'agent', text: `✓ ${first.label ?? 'The generation'} finished while the page was away — ${what}${typeof first.cost === 'number' ? ` ($${first.cost.toFixed(2)})` : ''}.` })
    // Close the dangling start_generation honestly. Without this, the next
    // send heals it as "declined" and the director tells the user the run
    // "didn't come through" — about a clip that is sitting on their board.
    setProtocol(prev => {
      const last: any = prev[prev.length - 1]
      if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return prev
      const open = last.content.find((blk: any) => blk.type === 'tool_use' && blk.name === 'start_generation'
        && [...patches.values()].some((n: any) => n.prompt === blk.input?.prompt))
      if (!open) return prev
      const n: any = [...patches.values()].find((x: any) => x.prompt === open.input?.prompt)
      return [...prev, { role: 'user', content: [{
        type: 'tool_result', tool_use_id: open.id,
        content: JSON.stringify({ ok: true, note: 'This generation completed while the page was closed. The output is on the board.', row_id: n.rowId, ...(typeof n.cost === 'number' ? { cost: n.cost } : {}) }),
      }] }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardNodes, busy])

  // ── The strip's generate buttons come through here (CC, Aug 6) ─────────
  // A card click arms its scene id (the card showed the price — that IS the
  // confirm), then asks the director in a normal, visible user turn. The
  // director answers with start_generation(scene_id=...), which the armed
  // set lets straight through the gate. The transcript stays honest: every
  // spend has a user message behind it.
  useEffect(() => {
    if (!runnerRef) return
    runnerRef.current = {
      generateScene: (sceneId: string, sceneLabel: string, kind: 'still' | 'video') => {
        stopGenRef.current = false
        if (busy !== 'idle') return
        genCountRef.current = 0
        reArmedRef.current.clear()
        armedScenesRef.current.add(sceneId)
        // ARM THE WHOLE PREREQUISITE CHAIN (owner bug, Aug 11: "why can't I
        // generate the video?"). Clicking ▶ Still on a CUT authorized that
        // cut — but a cut cannot be shot without the frame it continues, so
        // the director correctly went to make the predecessor's still and
        // then stalled behind a confirm gate the click had already passed.
        // A ▶ on a cut is consent for the frames it is built on; anything
        // else is a dead button and an unread plan card.
        const chain: string[] = []
        if (kind === 'still') {
          const sbNow: any[] = storyboardRef.current
          let j = sbNow.findIndex((x: any) => x.id === sceneId)
          while (j > 0 && sbNow[j]?.continues && !sbNow[j - 1]?.still_row_id) {
            j -= 1
            armedScenesRef.current.add(sbNow[j].id)
            chain.unshift(sbNow[j].id)
          }
        }
        // The CARD says which step it is running — two buttons, two prices
        // (owner, Aug 11) — so the turn never has to guess, and the
        // director never attempts a video only to bounce off the server's
        // stills-first guard.
        const sc: any = storyboardRef.current.find((s: any) => s.id === sceneId)
        const hasStill = !!sc?.still_row_id
        pushBubble({ role: 'user', text: `▶ ${sceneLabel} · ${kind === 'still' ? t('xd.sb.genstill') : t('xd.sb.genvideo')}${chain.length > 0 ? ` (+ ${chain.length} ${t('xd.sb.prereq')})` : ''}` })
        // A 🔗 cut's still is an EDIT of the previous cut's still — same
        // room, same wardrobe, same light — never a fresh frame described
        // from scratch. Words cannot re-specify a face.
        const idx = storyboardRef.current.findIndex((s: any) => s.id === sceneId)
        const prev: any = idx > 0 ? storyboardRef.current[idx - 1] : null
        const chainStill = (kind === 'still' && sc?.continues && (prev?.still_row_id || (prev?.status === 'done' && prev?.url)))
          ? ` This cut CONTINUES ${prev.id}: pass chain_from_scene="${prev.id}" and an image_edit recipe so it is generated FROM that cut's frame — same place, same wardrobe, same light — and write the prompt as the CHANGE from it, not as a fresh description.`
          : ''
        // Say the prerequisite out loud so the run is one uninterrupted
        // sequence instead of a stall.
        const prereq = chain.length > 0
          ? ` FIRST generate the key still for ${chain.join(', then ')} — this cut continues from ${chain[chain.length - 1]} and cannot be shot without that frame — then generate this one chained from it. Do them in order in this turn without stopping to confirm.`
          : ''
        // PERFORMANCE ONLY: with no lip-sync on this product, any mouth
        // articulation the model invents is wrong — and follows the
        // prompt's language, not the song's.
        const silent = sc?.no_speech
          ? ' PERFORMANCE ONLY: the cast must NOT sing, speak, mouth words or part their lips to talk — closed or naturally relaxed lips, no articulation. Carry the moment with eyes, expression, hands, body and camera instead. Do not write any speech, singing or lip-sync verb into the prompt.'
          : ''
        const stillModel = sc?.still_model_id
          ? ` Use the still model the card names: model_id="${sc.still_model_id}"${sc.still_model_name ? ` (${sc.still_model_name})` : ''}.`
          : ''
        const msgs = [...protocol, { role: 'user', content: kind === 'still'
          ? `Generate the KEY STILL for storyboard scene ${sceneId} now: call start_generation with medium="image", scene_id="${sceneId}", an image recipe (image_edit when this scene has references, else text_to_image), every reference this scene should use, and this scene's shot text as the prompt.${stillModel}${chainStill}${silent}${prereq} This is the cheap look test — do NOT generate the video, do not re-plan, and do not re-confirm.`
          : hasStill
            ? (sc?.recipe === 'reference_frames'
              // The card's model cannot open on a still — it speaks only
              // reference_frames. Ask for what it CAN do and make the
              // trade visible, rather than demanding image_to_video from a
              // model that does not have it.
              ? `Generate storyboard scene ${sceneId} now: call start_generation with scene_id="${sceneId}", from_still=true and a reference_frames recipe, keeping the card's video model, duration and shot text.${silent} This model cannot open ON the still, so the still goes in as the reference — say in ONE short line that the likeness carries but the locked framing does not, and that an Image to Video model would keep it. Do not re-plan, do not re-confirm, and do not regenerate the still.`
              : `Generate storyboard scene ${sceneId} now from its approved KEY STILL: call start_generation with scene_id="${sceneId}", from_still=true and an image_to_video recipe, keeping the card's video model, duration and shot text.${silent} Do not re-plan, do not re-confirm, and do not regenerate the still.`)
            : `Generate storyboard scene ${sceneId} straight to video now, exactly as it appears on the board — the user chose direct mode for this cut. Use its current shot text, model, recipe and duration${silent ? ' — and ' + silent.trim() : ''}, pass scene_id="${sceneId}", set direct:true on it, and do not re-plan or re-confirm.` }]
        setProtocol(msgs)
        void agentTurn(msgs)
      },
      rerunNode: (node, model, opts) => {
        console.info('[xdirect:rerun] click', { rowId: node.rowId, model: model.display_name, opts, busy, hasPrompt: !!node.prompt })
        // Never fail silently: the user just picked a model and expects a
        // turn. (A silent return here read as "nothing happened", Aug 9.)
        if (busy !== 'idle' || !node.prompt) {
          console.warn('[xdirect:rerun] BLOCKED — no turn sent:', { busy, hasPrompt: !!node.prompt })
          pushBubble({ role: 'agent', text: busy !== 'idle' ? '⚠ The director is mid-turn — wait for it to finish, then hit ↻ again.' : '⚠ This node has no stored prompt to re-run.' })
          return
        }
        genCountRef.current = 0
        reArmedRef.current.clear()
        // Which cut this take belongs to, resolved BEFORE the run so the
        // result can be filed under it even though the prompt may have
        // been rewritten since the original (owner bug, Aug 11).
        const originScene = sceneOfRow(node.rowId)?.id
        pendingRerunRef.current = {
          parentRowIds: Array.isArray(node.parentRowIds) ? node.parentRowIds : [],
          ...(opts?.refs ? { refs: opts.refs } : {}),
          ...(originScene ? { sceneId: originScene } : {}),
        }
        armedRerunRef.current = true
        console.info('[xdirect:rerun] armed — sending director turn', { scene: originScene ?? null, refs: opts?.refs?.length ?? 0 })
        pushBubble({ role: 'user', text: `↻ ${model.display_name}${opts?.duration ? ` · ${opts.duration}s` : ''}${opts?.resolution ? ` · ${opts.resolution}` : ''}${opts?.aspect_ratio ? ` · ${opts.aspect_ratio}` : ''}` })
        const msgs = [...protocol, { role: 'user', content:
          `GENERATE NOW: call start_generation in THIS turn. Do not discuss, do not ask, do not summarize — the user already picked everything on the board. This is a RE-RUN of an earlier generation for side-by-side comparison, changing ONLY the model.\n`
          + `- model: ${model.display_name} (model_id ${model.id})\n`
          + `  This model_id comes from the LIVE model picker the user just clicked — it exists and is enabled RIGHT NOW, even if it is absent from a list_models result earlier in this conversation (that list may be stale). NEVER substitute a different model. If you must verify, call list_models fresh in THIS turn — the id will be there.\n`
          + `- medium: ${node.isVideo || node.kind === 'video' ? 'video' : 'image'}\n`
          + `- prompt, VERBATIM (do not rewrite a word): ${JSON.stringify(node.prompt)}\n`
          + (opts?.duration ? `- duration_s: ${opts.duration}\n` : `- duration: same as the original generation of this prompt.\n`)
          + (opts?.resolution ? `- resolution: ${opts.resolution} (pass this exact value as start_generation's resolution)\n` : '')
          + (opts?.aspect_ratio ? `- aspect_ratio: ${opts.aspect_ratio}\n` : '')
          + (opts?.refs
              ? (opts.refs.length > 0
                ? `- references: I selected ${opts.refs.length} of the original's source files for this run (already staged on my side — set use_attachments=true and pick a recipe that consumes them).\n`
                : `- references: NONE this time — I deselected them all. Use a text-only recipe and set use_attachments=false.\n`)
              : `- references: the same as the original generation of this prompt (set use_attachments accordingly).\n`)
          + `- recipe: the same as the original if this model supports it; otherwise silently use the closest recipe this model DOES support for the same inputs (image_to_video ↔ reference_frames are acceptable substitutes).` }]
        setProtocol(msgs)
        void agentTurn(msgs)
      },
      stopGeneration: () => {
        if (stopGenRef.current) return
        stopGenRef.current = true
        const armed = armedScenesRef.current.size
        armedScenesRef.current.clear()
        console.info('[xdirect:stop] user brake — disarmed', armed, 'scene(s)')
        pushBubble({ role: 'user', text: `⏹ ${t('xd.stop')}` })
      },
      noteTake: (sceneId, sceneLabel, modelName) => {
        // Record only — no agentTurn, so it costs nothing. The director
        // reads it (plus the updated CURRENT STORYBOARD) on its next turn.
        // Skipped while busy: an in-flight turn snapshots the protocol and
        // would silently drop a concurrent append when it settles.
        if (busy !== 'idle') return
        pushBubble({ role: 'user', text: `★ ${sceneLabel} → ${modelName}` })
        setProtocol(prev => [...prev, { role: 'user', content:
          `Board update: for scene ${sceneId} I picked the ${modelName} output as the take to use. The board already reflects this — no action needed, just keep it in mind.` }])
      },
      generateAll: (sceneIds: string[], kind: 'still' | 'video') => {
        stopGenRef.current = false
        if (busy !== 'idle' || sceneIds.length === 0) return
        genCountRef.current = 0
        reArmedRef.current.clear()
        for (const id of sceneIds) armedScenesRef.current.add(id)
        pushBubble({ role: 'user', text: `▶▶ ${kind === 'still' ? t('xd.sb.allstills') : t('xd.sb.allvideos')}` })
        const msgs = [...protocol, { role: 'user', content: kind === 'still'
          ? `Generate the KEY STILL for each of these storyboard scenes now, one at a time in board order (${sceneIds.join(', ')}): start_generation with medium="image", that scene_id, an image recipe (image_edit when the scene has references, else text_to_image), the scene's references and its shot text as the prompt, and the still model its card names when it names one. A scene marked as a CUT (continues) must pass chain_from_scene=<the previous scene id> with an image_edit recipe, so its still is generated FROM the previous cut's still and the place, wardrobe and face carry over — generate them in order so each has its predecessor to work from. These are the cheap look test — generate NO video, do not re-plan, and do not re-confirm between scenes.`
          : `Generate the VIDEO for every remaining draft storyboard scene now, one at a time in board order (${sceneIds.join(', ')}). Each scene that has an approved key still animates from it (from_still=true, image_to_video); a scene marked direct goes straight to video. Use each scene's current shot text, video model, recipe and duration, pass its scene_id, and do not re-plan or re-confirm between scenes.` }]
        setProtocol(msgs)
        void agentTurn(msgs)
      },
    }
    return () => { if (runnerRef) runnerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, protocol, bubbles])

  // ── Execute a start_generation action via the normal XCreate pipeline ────
  const runGeneration = async (msgs: any[], action: any, pendingToolResults: any[]) => {
    const inp = action.input ?? {}
    // When this generation IS a storyboard scene, its card mirrors the whole
    // lifecycle: generating → done (thumb + real cost) or error.
    const sceneId: string | null = typeof inp.scene_id === 'string' ? inp.scene_id : null
    // An armed ↻ rerun is a comparison TAKE: it lands on the canvas beside
    // the original and must never touch the scene card's lifecycle (owner
    // bug, Aug 9: the rerun marked s1 'generating', and a mid-run reload
    // then demoted the card to a blank draft). The protocol keeps scene_id
    // — the server's storyboard guard needs it — only the CARD binding is
    // dropped. The card changes takes only when the user picks one.
    const rerunCtx = pendingRerunRef.current
    let cardScene: string | null = rerunCtx ? null : sceneId

    console.info('[xdirect:gen] start', { model_id: inp.model_id, recipe: inp.recipe, sceneId, duration: inp.duration, resolution: inp.resolution ?? null, use_attachments: !!inp.use_attachments, committed: committedRef.current.length })

    // Fail FAST with an error the director can act on, instead of burning a
    // provider attempt that cannot succeed (Gemini charged us a real try on
    // images=0, Aug 6).
    const bail = async (err: string) => {
      console.warn('[xdirect:gen] BAIL:', err)
      pushBubble({ role: 'gen', status: 'error', modelName: models[inp.model_id]?.name ?? inp.model_id, error: err })
      if (cardScene) patchScene(cardScene,{ status: 'error', error: err })
      reArmOnFailure(cardScene)
      const toolMsg = {
        role: 'user',
        content: [...pendingToolResults, {
          type: 'tool_result', tool_use_id: action.toolUseId,
          content: JSON.stringify({ ok: false, error: err }), is_error: true,
        }],
      }
      const withResult = [...msgs, toolMsg]
      setProtocol(withResult)
      await agentTurn(withResult)
    }

    // Per-scene references (owner ask, Aug 8): a scene that carries its own
    // uploads generates with THOSE — they replace the conversation set for
    // this one run. Slot order is upload order.
    const genScene: any = sceneId ? storyboardRef.current.find((s: any) => s.id === sceneId) : null
    const sceneRefs: Attachment[] = (Array.isArray(genScene?.refs) ? genScene.refs : [])
      .filter((r: any) => r?.storagePath && r?.bucket)

    if ((inp.use_attachments || Array.isArray(inp.use_files)) && committedRef.current.length === 0 && sceneRefs.length === 0
        && !(rerunCtx?.refs && rerunCtx.refs.length > 0)) {
      return bail('No reference photos are available in this session — ask the user to re-attach the photo, then retry.')
    }

    // ── Frame chaining: this scene opens on another scene's closing frame ──
    let chainFrame: Attachment | null = null
    // A 🔗 cut continues the previous cut, and in stills-first there is no
    // clip yet to continue FROM — the previous cut's approved KEY STILL is
    // the frame (owner bug, Aug 11: "why does scene 1 cut 2's still not use
    // the image from cut 1?" — the director wrote "continuing from the
    // provided frame" and no frame was provided, because this branch only
    // knew how to read a finished video).
    //
    // The still case needs no extraction at all: /api/xcreate downloads a
    // parent row's output and inserts it AHEAD of fresh uploads, so naming
    // the still row as the parent puts that exact image in slot 0. Only a
    // video source needs a frame pulled out of it and re-uploaded.
    const chainSrc: any = typeof inp.chain_from_scene === 'string' && inp.chain_from_scene
      ? storyboardRef.current.find((s: any) => s.id === inp.chain_from_scene)
      : null
    const chainFromStillRow: string | null =
      (inp.chain_from_scene && chainSrc && !(chainSrc.status === 'done' && chainSrc.url))
        ? (chainSrc.still_row_id ?? null)
        : null
    if (typeof inp.chain_from_scene === 'string' && inp.chain_from_scene && !chainFromStillRow) {
      const src: any = chainSrc
      if (!src || src.status !== 'done' || !src.url) {
        return bail(`Scene ${inp.chain_from_scene} has nothing to continue from yet — it has neither an approved key still nor a finished clip. Generate its key still first, then retry this one.`)
      }
      const frame = await extractLastFrame(src.url)
      if (!frame) {
        return bail(`Could not read the final frame of scene ${inp.chain_from_scene} (the clip URL may have expired) — regenerate that scene or retry later.`)
      }
      try {
        // commitAttachments uploads to att.bucket — real picks get theirs
        // from getBucket() at pick time; this synthetic one must say where
        // it goes or the upload targets bucket "" and fails (live, Aug 6).
        // Named after its source scene so the board's input node reads as
        // "frame of s2", not an anonymous chain-frame.jpg.
        const committed = await commitAttachments([{
          storagePath: '', bucket: 'xcreate-user-images', mediaType: 'image/jpeg',
          fileName: `frame-of-${inp.chain_from_scene}.jpg`, fileSize: frame.size, file: frame,
        } as Attachment])
        chainFrame = committed.find(a => a.storagePath) ?? null
      } catch (err) { console.warn('[xdirect] chain frame upload failed:', err) }
      if (!chainFrame) return bail('Uploading the continuation frame failed — retry in a moment.')
    }

    // The agent now directs stills as well as motion. Trust the declared
    // medium but fall back to reading the recipe, because a recipe and a
    // medium that disagree would bill against the wrong pipeline.
    const medium: 'image' | 'video' =
      inp.medium === 'image' || inp.medium === 'video'
        ? inp.medium
        : (typeof inp.recipe === 'string' && inp.recipe.includes('video') ? 'video' : 'image')

    // A STILL made for a scene is that scene's key frame, not its clip —
    // it must not claim the card's video slot (owner design, Aug 11:
    // KEYFRAME mode — image first, then animate it).
    const isSceneStill = medium === 'image' && !!sceneId
    if (isSceneStill) cardScene = null

    setBusy('generating')
    // The bubble carries its scene binding, because reconciliation is the
    // only thing that will know it later (owner bug, Aug 11: "why can't I
    // generate video at S1·C1?"). A still that finished while the tab was
    // away got claimed for the transcript but never written back to the
    // card, so still_row_id stayed null and the VIDEO button — gated on
    // exactly that — was locked forever, with the still sitting on the
    // board in plain sight.
    pushBubble({
      role: 'gen', status: 'generating', text: inp.prompt,
      modelName: models[inp.model_id]?.name ?? inp.model_id,
      ...(isSceneStill && sceneId ? { forScene: sceneId, forKind: 'still' as const }
        : cardScene ? { forScene: cardScene, forKind: 'clip' as const }
        : rerunCtx?.sceneId ? { forScene: rerunCtx.sceneId, forKind: 'take' as const } : {}),
    })
    if (cardScene) patchScene(cardScene,{ status: 'generating', error: undefined })

    const finish = async (result: any) => {
      console.info('[xdirect:gen] finish', { ok: !!result.ok, error: result.error ?? null, cost: result.cost ?? null })
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      const toolMsg = {
        role: 'user',
        content: [...pendingToolResults, {
          type: 'tool_result', tool_use_id: action.toolUseId,
          content: JSON.stringify(result), ...(result.ok ? {} : { is_error: true }),
        }],
      }
      const withResult = [...msgs, toolMsg]
      setProtocol(withResult)
      await agentTurn(withResult)
    }

    const jobId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const board = ensureConvId()

    const payload: any = {
      jobId,
      prompt: inp.prompt,
      mode: medium,
      boardId: board,
      nodeKind: medium,
      // HONEST lineage (owner, Aug 9): a chained scene descends from its
      // source scene's row; an unchained scene descends from nothing (its
      // wires come from its input attachments). Only free-chat iteration
      // keeps the previous-generation link. Linking every scene to
      // "whatever ran last" stacked reloaded boards into one parentless
      // column and drew derivations that never happened.
      ...((): Record<string, any> => {
        if (rerunCtx) {
          pendingRerunRef.current = null
          return rerunCtx.parentRowIds.length > 0 ? { parentIds: rerunCtx.parentRowIds } : {}
        }
        if (sceneId) {
          // KEY-STILL FIRST (owner, Aug 11): the scene's approved still
          // becomes this video's opening frame. /api/xcreate resolves a
          // parent row's output into the run's input attachments at slot
          // 0 — so the likeness AND the look baked into the still travel
          // into the motion, instead of being re-argued in words.
          if (inp.from_still) {
            const still = (storyboardRef.current.find((s: any) => s.id === sceneId) as any)?.still_row_id
            if (still) return { parentIds: [still] }
          }
          // Chaining from a still: that row is both the honest lineage and
          // the input image — one parentIds does both jobs.
          if (chainFromStillRow) return { parentIds: [chainFromStillRow] }
          const srcRow = typeof inp.chain_from_scene === 'string'
            ? (storyboardRef.current.find((s: any) => s.id === inp.chain_from_scene) as any)?.row_id
            : null
          return srcRow ? { parentIds: [srcRow] } : {}
        }
        return lastGenIdRef.current ? { parentIds: [lastGenIdRef.current] } : {}
      })(),
      modelIds: [inp.model_id],
      modelOptions: [{
        mode: inp.recipe,
        ...(typeof inp.duration === 'number' ? { duration: inp.duration } : {}),
        ...(typeof inp.aspect_ratio === 'string' ? { aspect_ratio: inp.aspect_ratio } : {}),
        ...(typeof inp.resolution === 'string' ? { resolution: inp.resolution } : {}),
        // A PERFORMANCE-ONLY scene is one whose sound gets replaced: the MV
        // path lays the real track over the cut and XCut mutes the clips.
        // Wan 3.0 scores its own clip by default, so without this the model
        // spends effort on ambience nobody will ever hear. Providers that
        // take no such flag ignore it.
        ...(sceneId && (storyboardRef.current.find((x: any) => x.id === sceneId) as any)?.no_speech
          ? { generate_audio: false } : {}),
      }],
    }
    // Attachment ORDER is meaning: slot 0 is the start frame for recipes
    // that consume one, so a chained scene leads with the continuation
    // frame and the product references ride behind it.
    // A rerun with an explicit reference selection uses EXACTLY those files
    // (owner, Aug 9) — including [] for a deliberate text-only re-run.
    // use_files picks WHICH attachments feed this run, by the numbers the
    // user sees — and in the order given, because slot 0 is the opening
    // frame. This is what keeps style frames out of a video generation
    // while the same upload set still feeds the KEYFRAME still.
    const pickByNumber = (nums: unknown): any[] | null => {
      if (!Array.isArray(nums) || nums.length === 0) return null
      const picked = nums
        .map((n: any) => committedRef.current.find(a => (a as any).fileNo === Number(n)))
        .filter(Boolean)
      return picked.length > 0 ? picked : null
    }
    const chosenFiles = pickByNumber(inp.use_files)
    const refAtts: any[] = rerunCtx?.refs
      ? rerunCtx.refs
      : sceneRefs.length > 0
        ? sceneRefs
        : chosenFiles
          ? chosenFiles
          : (inp.use_attachments && committedRef.current.length > 0) ? committedRef.current : []
    const allAtts = [...(chainFrame ? [chainFrame] : []), ...refAtts]
    if (allAtts.length > 0) {
      payload.attachments = allAtts.map(a => ({
        storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType,
        fileName: a.fileName, fileSize: a.fileSize,
      }))
    }

    let postRes: Response
    try {
      postRes = await fetch('/api/xcreate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      patchLastGen({ status: 'error', error: 'Network error' })
      if (cardScene) patchScene(cardScene,{ status: 'error', error: 'Network error' })
      reArmOnFailure(cardScene)
      return finish({ ok: false, error: 'network error starting the generation' })
    }

    console.info('[xdirect:gen] POST /api/xcreate →', postRes.status, '(job', jobId.slice(0, 8) + '…)')
    if (!postRes.ok) {
      const detail = await postRes.json().catch(() => null)
      const msg = detail?.message ?? detail?.error ?? `HTTP ${postRes.status}`
      patchLastGen({ status: 'error', error: msg })
      if (cardScene) patchScene(cardScene,{ status: 'error', error: msg })
      reArmOnFailure(cardScene)
      return finish({
        ok: false,
        error: postRes.status === 402 ? `insufficient_credits: ${msg}` : msg,
      })
    }

    // Poll the job like the XCreate page does. The POST above resolves when
    // generation completes, but polling gives us progress + survives the
    // POST connection dropping on long videos.
    const startedAt = Date.now()
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 10 * 60_000) {
        patchLastGen({ status: 'error', error: 'Timed out' })
        if (cardScene) patchScene(cardScene,{ status: 'error', error: 'Timed out' })
        reArmOnFailure(cardScene)
        return finish({ ok: false, error: 'generation timed out after 10 minutes' })
      }
      try {
        const res = await fetch(`/api/xcreate/job/${jobId}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const slot = (data.slots ?? [])[0]
        if (data.job?.status === 'running' && !(slot?.done)) return
        // Done (or failed).
        if (slot?.error || data.job?.status === 'failed') {
          const err = slot?.error ?? data.job?.error ?? 'generation failed'
          patchLastGen({ status: 'error', error: err })
          if (cardScene) patchScene(cardScene,{ status: 'error', error: err })
          reArmOnFailure(cardScene)
          onActivity?.()   // failed rows still get a board node
          return finish({ ok: false, error: err })
        }
        const url = typeof slot?.text === 'string' ? slot.text.split('\n')[0] : null
        const cost = slot?.cost ?? 0
        const xid = data.job?.xcreateId ?? null
        if (xid) lastGenIdRef.current = xid
        patchLastGen({
          status: 'done', cost, modelName: slot?.name ?? inp.model_id,
          ...(medium === 'image' ? { imageUrl: url ?? undefined } : { videoUrl: url ?? undefined }),
        })
        // model_name / still_model_name are written back from the FINISHED
        // job, not left as whatever set_storyboard planned. Both are optional
        // in the tool schema, so the director may omit them — and when it
        // did, the card went on offering "☰ Pick model" next to a picture
        // that had already been generated and paid for (owner, Aug 25: "why
        // the Assets card shows Pick model?"). A card should report what ran.
        if (cardScene) patchScene(cardScene,{ status: 'done', url: url ?? undefined, cost, row_id: xid ?? undefined, ...(slot?.name ? { model_name: slot.name } : {}) })
        // The scene's key still: remembered on the card (so ▶ can open the
        // video on it) without becoming the card's clip.
        else if (isSceneStill && sceneId) patchScene(sceneId, { still_row_id: xid ?? undefined, still_url: url ?? undefined, status: 'draft', error: undefined, ...(slot?.name ? { still_model_name: slot.name } : {}) })
        // A ↻ comparison take keeps the card as-is but must still be FILED
        // under its cut, or it lands on the board owned by nothing.
        else if (rerunCtx?.sceneId && xid) recordTake(rerunCtx.sceneId, xid)
        onActivity?.()   // new node on the board — let the canvas redraw
        return finish({ ok: true, url: url ? '(delivered to the user in the chat)' : null, medium, costUsd: cost, model: slot?.name ?? inp.model_id, xcreateId: xid })
      } catch { /* transient poll error — keep going */ }
    }, 2500)
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async (overrideText?: string, overrideAtts?: Attachment[], extra?: StoryExtra) => {
    const text = (overrideText ?? input).trim()
    const outgoing = overrideAtts ?? atts
    // A file alone is a valid send now (owner, Aug 10): dropping in a song
    // or a lyric sheet with no words typed still starts an MV.
    if ((!text && outgoing.length === 0) || busy !== 'idle') return
    genCountRef.current = 0
    reArmedRef.current.clear()

    // ── SHOW THE WORK IMMEDIATELY (owner, Aug 10) ──────────────────────
    // Uploading a 4MB song and transcribing it takes tens of seconds, and
    // all of it used to happen BEFORE the first pixel changed: the typed
    // text sat in the box, the file chip sat there, and the page looked
    // frozen. Claim the turn first — bubble up, composer cleared, busy on,
    // and the conversation id minted so the URL becomes this chat's own
    // page right away — then do the slow work behind a progress line.
    const sending = outgoing
    setBusy('thinking')
    setPrep(sending.length > 0 ? t('xd.prep.upload') : t('xd.prep.think'))
    pushBubble({ role: 'user', text, files: sending.map(a => a.fileName) })
    setInput(''); setAtts([])
    ensureConvId()

    // Lyric sheets (.txt/.lrc) are read client-side; songs (audio/*) are
    // transcribed server-side. Both become text the director storyboards
    // from — Claude can't hear audio, so an untranscribed mp3 is useless.
    const isLyricFile = (a: Attachment) => /\.(txt|lrc)$/i.test(a.fileName) || a.mediaType === 'text/plain'
    const isAudio     = (a: Attachment) => (a.mediaType || '').startsWith('audio/')
    // Documents (PDF; and .txt under the Story template) never reach the
    // director as files — /api/xdirector/digest turns them into text first.
    const isDoc       = (a: Attachment) => a.mediaType === 'application/pdf' || /\.pdf$/i.test(a.fileName)
    const storyMode   = activeSkillRef.current === 'story-to-video'
    let lyricText = ''
    for (const a of sending) {
      if (isLyricFile(a) && a.file && !storyMode) {
        try {
          const body = (await a.file.text()).slice(0, 8000)
          // A .lrc (or any sheet with [mm:ss] line stamps) already carries
          // the timings — those are the user's own and outrank anything we
          // could transcribe, so say so rather than re-deriving them.
          const timed = /^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,2})?\]/m.test(body)
          lyricText += timed
            ? `\n\n[lyrics WITH TIMESTAMPS from ${a.fileName} — the user's own timings. Treat them as correct, use them verbatim for scene durations, and do NOT transcribe the audio again]\n${body}`
            : `\n\n[lyrics from ${a.fileName} — no timings; if a song is also attached, transcribe it for timings and use THESE words]\n${body}`
        } catch { /* skip */ }
      }
    }

    // Build vision blocks BEFORE committing — commitAttachments strips the
    // File object once the bytes are in storage.
    //
    // Each image is PRECEDED by its number and filename (owner, Aug 11:
    // "you should mark which file is 1, which file is 2"). Without a label
    // the model sees an unordered pile and "photos 1-3 are the artist,
    // 4-7 are style" is guesswork on both sides. The number is 1-BASED and
    // is the file's position in the composer, so it matches the badge on
    // the chip exactly.
    // Upload FIRST — the director now sees photos by signed URL, and a URL
    // only exists once the bytes are in storage.
    let committed = sending
    if (sending.length > 0) {
      try { committed = await commitAttachments(sending) } catch { /* keep going without */ }
      // Stamp each file with the number the user sees on its chip, so a
      // later "use file 2" resolves to these exact bytes. Numbering counts
      // ALL attachments (a song occupies its number too) — the badge is
      // the single source of truth on both ends.
      committed = committed.map((a, i) => ({ ...a, fileNo: i + 1 }))
      committedRef.current = committed.filter(a => a.storagePath && !isAudio(a) && !isLyricFile(a) && !isDoc(a))
      // Attach the committed refs to the bubble already on screen, so a
      // restored session can still generate against these photos.
      // The song rides alongside, never inside, `atts` — see the Bubble type.
      const savedSongs = committed
        .filter(a => a.storagePath && (a.mediaType || '').startsWith('audio/'))
        .map(a => ({ storagePath: a.storagePath!, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName }))
      if (committedRef.current.length > 0 || savedSongs.length > 0) {
        const saved = committedRef.current.map(a => ({
          storagePath: a.storagePath!, bucket: a.bucket, mediaType: a.mediaType,
          fileName: a.fileName, fileSize: a.fileSize, fileNo: a.fileNo,
          role: (a as any).role, label: (a as any).label,
        }))
        setBubbles(prev => {
          const i = prev.map(b => b.role).lastIndexOf('user')
          if (i < 0) return prev
          const next = [...prev]
          next[i] = {
            ...next[i],
            ...(saved.length > 0 ? { atts: saved as any } : {}),
            ...(savedSongs.length > 0 ? { songs: savedSongs } : {}),
          }
          return next
        })
      }
    }

    // Each image is PRECEDED by its number, filename and role, so "file 2 is
    // the artist" binds to actual bytes rather than to a position in a pile
    // (owner, Aug 11). The number is 1-BASED and matches the chip's badge.
    const visionBlocks: any[] = []
    const photos = committed.filter(a => a.mediaType.startsWith('image/'))
    const signedUrls = photos.length > 0 ? await signVisionUrls(photos) : {}
    let shown = 0
    for (const a of photos) {
      const no = (a as any).fileNo ?? 0
      const url = a.storagePath ? signedUrls[a.storagePath] : undefined
      if (!url || shown >= MAX_VISION) {
        visionBlocks.push({ type: 'text', text: `File ${no} — ${a.fileName} — attached (not shown inline; still available to generations via use_files)` })
        continue
      }
      const blk = { type: 'image', source: { type: 'url', url } }
      shown++
      const nm = (((a as any).label ?? '').trim())
      const role = (a as any).role === 'style'
        ? 'STYLE REFERENCE (look only — palette, light, grade; NOT the subject)'
        : `SUBJECT${nm ? ` "${nm}"` : ''} (keep this likeness)`
      visionBlocks.push({ type: 'text', text: `File ${no} — ${a.fileName} — ${role}` })
      visionBlocks.push(blk)
    }

    // Transcribe any attached song → timestamped lyrics (house-paid).
    const audioAtts = committed.filter(a => isAudio(a) && a.storagePath)
    if (audioAtts.length > 0) {
      setPrep(t('xd.prep.listen'))
      for (const a of audioAtts) {
        try {
          const res = await fetch('/api/xdirector/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket: a.bucket, storagePath: a.storagePath, mediaType: a.mediaType }),
          })
          const d = await res.json().catch(() => null)
          if (res.ok && d?.text) {
            lyricText += `\n\n[transcribed lyrics from ${a.fileName} — ${d.model}, [mm:ss] per line; use these timings for scene durations. MACHINE TRANSCRIPTION: it can mishear. If the user corrects a line, that correction is the truth — use their wording verbatim from then on and never revert to this version.]\n${d.text}`
            // Put it on screen too (owner, Aug 11: "the lyrics parsing might
            // have error, user should be able to correct that"). Until now
            // the transcript only ever reached the director, so a mishearing
            // was invisible and uncorrectable.
            pushBubble({ role: 'agent', text: `${t('xd.lyrics.heard')} — ${d.model}\n\n${d.text}\n\n${t('xd.lyrics.fix')}` })
          }
          else lyricText += `\n\n[could not transcribe ${a.fileName}: ${d?.error ?? 'error'} — ask the user to paste the lyrics]`
        } catch { lyricText += `\n\n[could not reach the transcriber for ${a.fileName}]` }
      }
    }

    // Reference video → style frames + cut rhythm (house-paid).
    //
    // The frames are the point. They arrive already in storage, so they join
    // committedRef as ordinary role:'style' attachments and the director
    // addresses them with use_files exactly like an uploaded reference — no
    // second code path, no special case downstream of here.
    //
    // The rhythm notes go in as TEXT because no still can carry them, and
    // they are shown to the user for the same reason a transcript is: a
    // machine reading that nobody can see is a machine reading nobody can
    // correct.
    let refText = ''
    if (extra?.referenceUrl) {
      setPrep(t('xd.prep.watch'))
      try {
        const res = await fetch('/api/xdirector/reference', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: extra.referenceUrl, aspect: extra.aspect ?? '16:9', frames: 2 }),
        })
        const d = await res.json().catch(() => null)
        if (res.ok && d) {
          const frames: any[] = Array.isArray(d.frames) ? d.frames : []
          if (frames.length > 0) {
            let nextNo = Math.max(0, ...committedRef.current.map(a => (a as any).fileNo ?? 0))
            const asAtts = frames.map((f, i) => ({
              storagePath: f.path, bucket: f.bucket, mediaType: f.mediaType ?? 'image/jpeg',
              fileName: `reference-look-${i + 1}.jpg`, fileSize: 0,
              fileNo: ++nextNo, role: 'style' as const,
            }))
            committedRef.current = [...committedRef.current, ...(asAtts as any)]
            pushBubble({
              role: 'agent',
              text: `${t('xd.ref.heard')}${d.look ? `\n\n${d.look}` : ''}\n\n${t('xd.ref.fix')}`,
              // previewUrl is what makes them VISIBLE. Without it the bubble
              // says "the style frames below" and shows nothing.
              atts: asAtts.map((a, i) => ({ ...a, previewUrl: frames[i]?.url ?? undefined })) as any,
            })
          }
          if (d.look) {
            refText += `\n\n[REFERENCE VIDEO — read for you by ${d.models?.watcher ?? 'a vision model'}. These are notes on CRAFT, not a script.`
              + (frames.length > 0 ? ` The style frames among the attached files (marked STYLE REFERENCE) came from this same video and are the look to shoot to.` : '')
              + `\nBorrow the grade, the light, the lens and the cutting rhythm. Do NOT recreate its shots, its performers or any on-screen text — that is not ours to copy, and the user was told so before they pasted the link.]\n${d.look}`
          }
          if (d.partial) refText += `\n[Only part of the reference could be read — say so plainly rather than pretending to a fuller reading.]`
        } else {
          refText += `\n\n[the reference video could not be read: ${d?.error ?? 'error'} — ask the user for the look in one sentence, or to attach a style frame]`
        }
      } catch {
        refText += `\n\n[could not reach the reference reader — ask the user to describe the look in one sentence instead]`
      }
    }
    // Story documents → STORY BIBLE (owner, Aug 22: "no matter how long the
    // story is, we should always summarize it and use the summary as
    // input"). A PDF (any template) or a .txt (Story template) is uploaded,
    // then /api/xdirector/digest reads it server-side: under the Story
    // template it comes back as a bible (cast + at most ten beats) and is
    // shown to the user for correction, like a transcript; under any other
    // template it comes back as plain text, like a lyric sheet. Pasted
    // story text from the setup form takes the same road.
    let bibleText = ''
    const docAtts = committed.filter(a => a.storagePath && (isDoc(a) || (storyMode && isLyricFile(a))))
    const docJobs: Array<Record<string, unknown>> = docAtts.map(a => ({ bucket: a.bucket, storagePath: a.storagePath, mediaType: a.mediaType, fileName: a.fileName }))
    if (docJobs.length === 0 && extra?.storyText) docJobs.push({ text: extra.storyText, fileName: 'pasted story' })
    if (docJobs.length > 0) {
      setPrep(t('xd.prep.read'))
      for (const job of docJobs) {
        const name = String(job.fileName ?? 'document')
        try {
          const res = await fetch('/api/xdirector/digest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...job, mode: storyMode ? 'bible' : 'extract', focus: extra?.focus, lang }),
          })
          const d = await res.json().catch(() => null)
          if (res.ok && d?.text) {
            if (storyMode) {
              bibleText += `\n\n[STORY BIBLE — digested from ${name} by ${d.model} (${d.chars} characters read in ${d.windows} part(s)). This is the ONLY script for the film: the beats are the scenes, the cast list is who gets a three-view sheet. The user can see this bible and may correct it — their correction is the truth from then on.]\n${d.text}`
              pushBubble({ role: 'agent', bible: true, text: `${t('xd.bible.heard')} — ${d.model}\n\n${d.text}\n\n${t('xd.bible.fix')}` })
            } else {
              bibleText += `\n\n[text from ${name} — the first ${d.chars} characters]\n${d.text}`
            }
          } else bibleText += `\n\n[could not read ${name}: ${d?.error ?? 'error'} — ask the user for a three-to-five-sentence summary of the story and work from that]`
        } catch { bibleText += `\n\n[could not reach the reader for ${name} — ask the user for a short summary of the story and work from that]` }
      }
    }
    setPrep(t('xd.prep.think'))

    const noteParts: string[] = []
    if (text) noteParts.push(text)
    if (committedRef.current.length > 0) {
      // Numbered the same way the user sees them, so a brief that says
      // "file 2 is the artist" binds to the right bytes.
      // Subjects group BY NAME so a board can hold several people or
      // products at once (owner, Aug 11): each named group is its own
      // identity, and a scene is fed only the subjects that appear in it.
      const fmt = (list: any[]) => list.map(a => `${a.fileNo}. ${a.fileName}`).join(', ')
      const sty = committedRef.current.filter(a => (a as any).role === 'style')
      const byName = new Map<string, any[]>()
      for (const a of committedRef.current) {
        if ((a as any).role === 'style') continue
        const k = (((a as any).label ?? '').trim()) || '(unnamed)'
        if (!byName.has(k)) byName.set(k, [])
        byName.get(k)!.push(a)
      }
      const lines = [...byName.entries()].map(([nm, list]) =>
        nm === '(unnamed)'
          ? `SUBJECT (keep this likeness): ${fmt(list)}`
          : `SUBJECT "${nm}" (keep this likeness; these files are all the same one): ${fmt(list)}`)
      noteParts.push([
        '[attached files — the ROLE TAGS BELOW ARE THE USER\'S OWN, set on each file. They are authoritative: never re-assign a role from a filename or from anything written in the brief.',
        ...lines,
        sty.length ? `STYLE REFERENCE (look only — palette, light, grade; never the subject): ${fmt(sty)}` : '',
        byName.size > 1
          ? `There are ${byName.size} DIFFERENT subjects. Name them in each scene's script and shot text, and pass use_files with ONLY the subjects that appear in that scene — mixing two people's photos into one generation blends their faces.`
          : '',
        'Address them with use_files by these numbers. Typical split: a key still takes SUBJECT + STYLE together; a video takes SUBJECT only.]',
      ].filter(Boolean).join('\n'))
    }
    // Lyrics (typed-file or transcribed song) go to the director as text —
    // an empty brief + a song is a valid "make an MV from this" request.
    if (refText) noteParts.push(refText.trim())
    if (lyricText) {
      noteParts.push(lyricText.trim())
      // With a reference in hand the orientation question is already answered
      // — the frames were generated at the aspect the user picked — so asking
      // again would spend a turn re-deciding something that is settled.
      if (!text) noteParts.push(refText
        ? 'Make a music video from these lyrics in the reference video\'s look. Storyboard scene by scene, timed to the lyric lines, cut at the rhythm the reference notes describe.'
        : 'Make a music video from these lyrics. Confirm orientation first, then storyboard scene by scene timed to the lyric lines.')
    }
    if (bibleText) {
      noteParts.push(bibleText.trim())
      if (!text && storyMode) noteParts.push('Make a short film from this story: three-view CAST sheets for the recurring characters first, then at most 10 scenes — only the beats that change the story. Ask for the style in one question if none is given.')
    }
    // THE FIX (CC, July 29): the agent used to receive only this filename
    // note, so when asked to describe the product it invented one. A real
    // Goyard tote came back as "cognac leather with polished gold hardware"
    // and that fabrication went into the generation prompt, overriding the
    // reference image. Now it sees the actual pixels.
    const userMsg = visionBlocks.length > 0
      ? { role: 'user', content: [...visionBlocks, { type: 'text', text: noteParts.join('\n') }] }
      : { role: 'user', content: noteParts.join('\n') }
    const msgs = [...protocol, userMsg]
    setProtocol(msgs)
    await agentTurn(msgs)
  }

  // Mark an ask/plan bubble as spent so its buttons stop responding.
  const resolveBubble = (idx: number, label: string) =>
    setBubbles(prev => prev.map((b, i) => i === idx ? { ...b, resolved: label } : b))

  // A chip click IS the answer to the paused tool call — feed it back as the
  // tool result rather than as a new user message, so the agent continues
  // the same thought instead of restarting.
  const answerAsk = async (idx: number, choice: string) => {
    const b = bubbles[idx]
    if (!b?.pending || b.resolved || busy !== 'idle') return
    resolveBubble(idx, choice)
    const { msgs, action, pendingToolResults } = b.pending
    const toolMsg = {
      role: 'user',
      content: [...pendingToolResults, {
        type: 'tool_result', tool_use_id: action.toolUseId,
        content: JSON.stringify({ answer: choice }),
      }],
    }
    const withResult = [...msgs, toolMsg]
    setProtocol(withResult)
    await agentTurn(withResult)
  }

  // A reloaded plan card loses its `pending` (stripped on save — it holds a
  // full copy of the message array), which used to leave a healthy-looking
  // ✨ Generate button that silently did NOTHING (owner stuck, Aug 9). But
  // everything needed to resume IS in the protocol: the unresolved
  // tool_use at the tail. Rebuild pending from it — only for the LAST plan
  // bubble, whose call is genuinely still open.
  const reconstructPending = (idx: number): Bubble['pending'] | null => {
    if (idx !== bubbles.length - 1) return null
    const last: any = protocol[protocol.length - 1]
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return null
    const uses = last.content.filter((blk: any) => blk.type === 'tool_use')
    if (uses.length === 0) return null
    const gen = uses.find((u: any) => u.name === 'start_generation') ?? uses[uses.length - 1]
    // Sibling tool calls in the same message lost their server-side results
    // with the session — close them as stale so the protocol stays legal.
    const others = uses.filter((u: any) => u.id !== gen.id).map((u: any) => ({
      type: 'tool_result', tool_use_id: u.id,
      content: JSON.stringify({ ok: false, note: 'stale after reload' }),
    }))
    return { msgs: protocol, action: { kind: 'generate', toolUseId: gen.id, input: gen.input }, pendingToolResults: others }
  }

  // The spend gate. Approving runs the generation the agent already planned.
  const approvePlan = async (idx: number) => {
    const b = bubbles[idx]
    const pend = b?.pending ?? reconstructPending(idx)
    if (!pend || b.resolved || busy !== 'idle') return
    resolveBubble(idx, 'go')
    genCountRef.current += 1
    const { msgs, action, pendingToolResults } = pend
    await runGeneration(msgs, action, pendingToolResults)
  }

  // Declining tells the agent so, so it can offer an alternative instead of
  // sitting on an unanswered tool call.
  const declinePlan = async (idx: number) => {
    const b = bubbles[idx]
    const pend = b?.pending ?? reconstructPending(idx)
    if (!pend || b.resolved || busy !== 'idle') return
    resolveBubble(idx, 'changed')
    const { msgs, action, pendingToolResults } = pend
    const toolMsg = {
      role: 'user',
      content: [...pendingToolResults, {
        type: 'tool_result', tool_use_id: action.toolUseId,
        content: JSON.stringify({ ok: false, cancelled: true, note: 'User declined this plan before it ran. Ask what to change in one short line, then propose a revised plan.' }),
        is_error: true,
      }],
    }
    const withResult = [...msgs, toolMsg]
    setProtocol(withResult)
    await agentTurn(withResult)
  }

  const chip = (enabled: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 999, fontSize: 13,
    border: '1px solid ' + (enabled ? 'var(--red)' : 'var(--border2)'),
    background: 'transparent', color: enabled ? 'var(--red)' : 'var(--muted)',
    cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit',
  })

  // ── UI ── (no page shell: the page provides arena + header)
  // Flex column filling the parent rail: transcript takes the middle and
  // scrolls INTERNALLY; the composer stays pinned at the bottom. The rail's
  // height comes from .xdirect-chat — this component never grows the page.
  // (CC, Aug 6)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* The "open canvas" escape hatch that used to sit here is gone: on
          /xdirect the canvas IS alongside the chat. (CC, Aug 5) */}

        {/* Transcript — the ONLY scrolling region in the rail. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14, paddingRight: 6 }}>
          {loading && bubbles.length === 0 && (
            <div style={{ padding: '18px 20px', fontSize: 14, color: 'var(--muted)' }}>
              <span className="stream-cursor">▋</span>
            </div>
          )}
          {/* Skill gallery. Only offered before the first message — switching
              skills mid-conversation would silently rewrite the rules the
              earlier turns were produced under. */}
          {!loading && !initialTemplate && bubbles.length === 0 && skills.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: 10 }}>
                {t('xdirector.skills')}
              </div>
              <div className="xt-tpl-grid">
                {[...skills].sort((a, b) =>
                  Number(a.metadata?.order ?? 99) - Number(b.metadata?.order ?? 99)
                ).map(sk => {
                  const on = activeSkill === sk.name
                  const emoji = sk.metadata?.emoji || '🎬'
                  const color = sk.metadata?.color || '#4a4c52'
                  const banner = sk.metadata?.banner
                  // A short result LOOP beats a poster (ComfyUI study, Aug 17:
                  // the card is the demo). Poster frame at rest; hover plays.
                  const bannerVideo = sk.metadata?.banner_video
                  const title = sk.metadata?.title || sk.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  const category = sk.metadata?.category
                  // Card copy is the TAGLINE — one written line, not the
                  // skill's operational description dumped on a customer.
                  // No model names on cards: the platform is trying them all.
                  const tagline = sk.metadata?.tagline || sk.description
                  return (
                    <button
                      key={sk.name}
                      className={on ? 'xt-tpl xd-tpl is-on' : 'xt-tpl xd-tpl'}
                      onClick={() => router.push(`/xdirect/${sk.name}`)}
                    >
                      <span className="xt-tpl-banner" style={banner || bannerVideo ? undefined : { background: `linear-gradient(135deg, ${color}, #14161a)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>
                        {bannerVideo
                          // The loop IS the banner — always playing (owner,
                          // Aug 17: the static thumbnail before hover read as
                          // a bait-and-switch). Poster is the loop's own
                          // first frame, so load-in is seamless, not a swap.
                          ? <video src={bannerVideo} poster={banner || undefined} autoPlay muted loop playsInline preload="auto" />
                          : banner
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={banner} alt="" loading="lazy" />
                            : <span aria-hidden>{emoji}</span>}
                      </span>
                      <span className="xt-tpl-body">
                        <span className="xt-tpl-text">
                          <span className="xt-tpl-head">
                            <span className="xt-tpl-name">{title}</span>
                            {category && <span className="xt-tpl-seats">{category}</span>}
                          </span>
                          <span className="xt-tpl-blurb" title={sk.description}>{tagline}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
                {/* The freeform road, made a card (owner, Aug 27). The
                    composer used to sit under the gallery as a second,
                    unlabelled entrance; removing it would have hidden
                    "just describe it" entirely, so it becomes a template
                    like the others. */}
                <button
                  className="xt-tpl xd-tpl"
                  onClick={() => router.push('/xdirect/scratch')}
                >
                  <span className="xt-tpl-banner" style={{ background: 'linear-gradient(135deg, #4a4c52, #14161a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>
                    <span aria-hidden>✏️</span>
                  </span>
                  <span className="xt-tpl-body">
                    <span className="xt-tpl-text">
                      <span className="xt-tpl-head">
                        <span className="xt-tpl-name">{t('xd.tpl.scratch')}</span>
                      </span>
                      <span className="xt-tpl-blurb">{t('xd.tpl.scratchblurb')}</span>
                    </span>
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Template setup form: music-video armed + fresh chat. Fields
              pre-answer the skill's ask turn; Start sends the structured
              brief with the files in one shot. */}
          {activeSkill === 'music-video' && bubbles.length === 0 && !setupDismissed && (
            <MusicVideoSetup
              busy={busy !== 'idle'}
              onStart={(brief, formAtts, extra) => { void send(brief, formAtts, extra) }}
              onSkip={() => setSetupDismissed(true)}
            />
          )}

          {activeSkill === 'social-post' && bubbles.length === 0 && !setupDismissed && (
            <SocialPostSetup
              busy={busy !== 'idle'}
              onStart={(brief, formAtts) => { void send(brief, formAtts) }}
              onSkip={() => setSetupDismissed(true)}
            />
          )}

          {activeSkill === 'ai-animation' && bubbles.length === 0 && !setupDismissed && (
            <AnimationSetup
              busy={busy !== 'idle'}
              onStart={(brief, formAtts) => { void send(brief, formAtts) }}
              onSkip={() => setSetupDismissed(true)}
            />
          )}

          {activeSkill === 'story-to-video' && bubbles.length === 0 && !setupDismissed && (
            <StorySetup
              busy={busy !== 'idle'}
              onStart={(brief, formAtts, extra) => { void send(brief, formAtts, extra) }}
              onSkip={() => setSetupDismissed(true)}
            />
          )}

          {/* Once the chat is running the skill is locked in — show it. */}
          {activeSkill && bubbles.length > 0 && (
            <div style={{ alignSelf: 'flex-start', fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '0.06em' }}>
              ◆ {t('xdirector.skillactive')} {activeSkill}
            </div>
          )}
          {bubbles.map((b, i) => b.role === 'ask' ? (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '82%', padding: '13px 16px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px 12px 12px 4px' }}>
              <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>{b.text}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                {(b.options ?? []).map(opt => (
                  <button
                    key={opt}
                    onClick={() => answerAsk(i, opt)}
                    disabled={!!b.resolved || busy !== 'idle'}
                    style={{
                      ...chip(!b.resolved && busy === 'idle'),
                      ...(b.resolved === opt ? { background: 'var(--red)', color: '#fff' } : {}),
                    }}
                  >{opt}</button>
                ))}
              </div>
            </div>
          ) : b.role === 'plan' ? (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '82%', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border2)', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                <span>{t('xdirector.plan')}</span>
                <span style={{ opacity: 0.8 }}>· {b.plan?.modelName}</span>
                {b.plan?.duration != null && <span style={{ opacity: 0.8 }}>· {b.plan.duration}s</span>}
                {b.plan?.estimate != null && (
                  <span style={{ marginLeft: 'auto', color: 'var(--red)' }}>~${b.plan.estimate.toFixed(2)}</span>
                )}
                <button
                  onClick={() => copyBubble(i, b.plan?.prompt ?? '')}
                  title={t('xd.copy')} aria-label={t('xd.copy')}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: copiedIdx === i ? 'var(--green)' : 'var(--muted2)', marginLeft: b.plan?.estimate != null ? 0 : 'auto' }}
                >{copiedIdx === i ? '✓' : '⧉'}</button>
              </div>
              <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.65, color: 'var(--muted2)' }}>{b.plan?.prompt}</div>
              <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>
                <button
                  onClick={() => approvePlan(i)}
                  disabled={!!b.resolved || busy !== 'idle'}
                  style={{
                    padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--red)', color: '#fff',
                    fontWeight: 700, fontSize: 13, cursor: (!b.resolved && busy === 'idle') ? 'pointer' : 'default',
                    opacity: (!b.resolved && busy === 'idle') ? 1 : 0.5,
                  }}
                >{b.resolved === 'go' ? t('xdirector.sent') : '✨ ' + t('xdirector.generate')}</button>
                <button
                  onClick={() => declinePlan(i)}
                  disabled={!!b.resolved || busy !== 'idle'}
                  style={{ ...chip(!b.resolved && busy === 'idle'), border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 9 }}
                >{t('xdirector.change')}</button>
              </div>
            </div>
          ) : b.role === 'gen' ? (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '82%', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border2)', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                {b.status === 'generating' && <span className="nav-history-spin" aria-hidden />}
                <span>{b.status === 'generating' ? 'GENERATING' : b.status === 'error' ? 'FAILED' : 'DONE'}</span>
                {b.modelName && <span style={{ opacity: 0.8 }}>· {b.modelName}</span>}
                {typeof b.cost === 'number' && b.cost > 0 && <span style={{ marginLeft: 'auto', color: 'var(--red)' }}>${b.cost.toFixed(3)}</span>}
              </div>
              {b.status === 'error'
                ? <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--red)' }}>⚠ {b.error}</div>
                : b.videoUrl
                  ? <video src={b.videoUrl} autoPlay loop muted playsInline controls style={{ width: '100%', maxWidth: 560, display: 'block', background: '#000' }} />
                  : b.imageUrl
                    ? <img src={b.imageUrl} alt="" style={{ width: '100%', maxWidth: 420, display: 'block', background: '#000' }} />
                    : <div style={{ padding: '14px', fontSize: 12, color: 'var(--muted)' }}>{b.text}</div>}
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', justifyContent: b.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%', padding: '11px 15px',
                borderRadius: b.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                background: b.role === 'user' ? 'var(--surface2)' : 'var(--surface)',
                border: '1px solid var(--border2)',
                fontSize: 14, lineHeight: 1.7,
                color: b.role === 'user' ? 'var(--muted2)' : 'var(--white)',
              }}>
                <div className="markdown-body"><ReactMarkdown skipHtml>{b.text ?? ''}</ReactMarkdown></div>
                {(b.bible || /📖/.test(b.text ?? '')) && convIdRef.current && (
                  <a href={`/xdirect/bible/${convIdRef.current}`} target="_blank" rel="noreferrer"
                     style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono), monospace', color: 'var(--red)', textDecoration: 'none', letterSpacing: '0.04em' }}>
                    📄 {t('xd.bible.open')} ↗
                  </a>
                )}
                {b.files && b.files.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>📎 {b.files.join(', ')}</div>
                )}
                {/* Style frames read off a reference video. Shown, not just
                    stored: the bubble's own copy calls them "the look I will
                    shoot to", and the user can only push back on a look they
                    can actually see. */}
                {b.atts && b.atts.some(a => a.previewUrl) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {b.atts.filter(a => a.previewUrl).map((a, k) => (
                      <a key={k} href={a.previewUrl} target="_blank" rel="noreferrer" style={{ display: 'block', lineHeight: 0 }}>
                        <img src={a.previewUrl} alt={a.fileName}
                             style={{ width: 148, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)' }} />
                      </a>
                    ))}
                  </div>
                )}
                {(b.text ?? '').trim().length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      onClick={() => copyBubble(i, b.text ?? '')}
                      title={t('xd.copy')} aria-label={t('xd.copy')}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: copiedIdx === i ? 'var(--green)' : 'var(--muted2)', opacity: copiedIdx === i ? 1 : 0.7 }}
                    >{copiedIdx === i ? `✓ ${t('xd.copied')}` : '⧉'}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy === 'thinking' && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px 12px 12px 4px', fontSize: 14, color: 'var(--muted)' }}>
              {prep
                ? <>
                    <span className="nav-history-spin" style={{ width: 13, height: 13 }} aria-hidden />
                    <span style={{ fontSize: 13 }}>{prep}</span>
                  </>
                : <span className="stream-cursor">▋</span>}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer — pinned below the scrolling transcript.
            HIDDEN while a template's setup form is up (owner, Aug 26: "why does
            XDirect have two prompt boxes if I click template?"). The form and this
            box are two entrances to the same send, and showing both left no way to
            tell which one was real. The form's Skip link is the way out — it sets
            setupDismissed, which brings this back. */}
        {!setupOpen && !galleryOpen && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, flexShrink: 0 }}>
          <AttachmentButton attachments={atts} onChange={setAtts} disabled={busy !== 'idle'} context="xcreate" multiple maxFiles={15} accept="image/jpeg,image/png,image/webp,audio/*,.mp3,.m4a,.wav,.flac,.ogg,.txt,.lrc,text/plain,.pdf,application/pdf" roles />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={taRef}
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (isSubmitEnter(e)) { e.preventDefault(); send() } }}
              placeholder={t('xdirector.placeholder')}
              /* rows is the ONLY base-height source — a minHeight alongside
                 it fought the auto-grow and left a dead extra line
                 (owner, Aug 10). */
              rows={4}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none', maxHeight: 320, overflowY: 'auto', lineHeight: 1.6 }}
            />
            {/* A song or lyric sheet alone is a valid send — don't gate on
                typed text (owner, Aug 10). */}
            <button onClick={() => void send()} disabled={busy !== 'idle' || (!input.trim() && atts.length === 0)} style={{
              padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
              fontWeight: 700, fontSize: 14, cursor: busy !== 'idle' ? 'wait' : 'pointer', flexShrink: 0,
              opacity: busy !== 'idle' || (!input.trim() && atts.length === 0) ? 0.5 : 1,
            }}>
              {busy === 'idle' ? '→' : '…'}
            </button>
          </div>
      </div>
        )}
    </div>
  )
}
