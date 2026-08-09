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
import { useT } from '../../lib/i18n'
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { commitAttachments, type Attachment } from '../components/AttachmentButton'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import { isSubmitEnter } from '../../lib/ime'

// One bubble in the visible transcript. Generation bubbles update in place
// as the job progresses.
type Bubble = {
  role: 'user' | 'agent' | 'gen' | 'ask' | 'plan'
  text?: string
  files?: string[]          // attachment names shown under a user bubble
  /** Committed attachment descriptors (storagePath etc.), persisted with the
   *  bubble so a RESTORED conversation can still generate with its reference
   *  photos. Before this, committedRef lived only in memory: a reload +
   *  scene ▶ fired a reference recipe with zero images and the provider
   *  failed (IMG_3776, Aug 6). */
  atts?: Array<{ storagePath: string; bucket?: string; mediaType: string; fileName: string; fileSize?: number }>
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
  generateScene: (sceneId: string, sceneLabel: string) => void
  /** Run every draft scene, in order. One click authorizes the batch. */
  generateAll: (sceneIds: string[]) => void
  /** Canvas rerun (owner, Aug 9): same prompt, different model — the new
   *  output lands as a SIBLING of the original so the two compare side by
   *  side. The plan bubble still gates the spend. */
  rerunNode: (node: { rowId?: string; prompt?: string; isVideo: boolean; kind?: string | null; parentRowIds?: string[] }, model: { id: string; display_name: string }, opts?: { duration?: number; resolution?: string; aspect_ratio?: string }) => void
}

export default function XDirectorChat({ onConversationId, onMintedConversation, onActivity, storyboard, onStoryboard, runnerRef, onBusy, boardNodes }: {
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
} = {}) {
  const t = useT()

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
  const [busy,     setBusy]     = useState<'idle' | 'thinking' | 'generating'>('idle')
  // id -> { name, perSec }. Without this the transcript printed the raw
  // model UUID next to GENERATING, which read like an error code.
  const [models,   setModels]   = useState<Record<string, { name: string; perSec: number | null }>>({})
  // ── Skills (CC, July 28) ──────────────────────────────────────────────
  // The catalogue is the open Agent Skills format read off disk by
  // /api/skills. Selecting one sends its name with every agent turn; the
  // server loads the SKILL.md body and fences it behind ModelXD's own rules.
  const [skills,      setSkills]      = useState<Array<{ name: string; description: string; metadata: Record<string, string> }>>([])
  const [activeSkill, setActiveSkill] = useState<string | null>(null)
  // agentTurn is re-entered from chip clicks and generation results, so the
  // selection is read from a ref rather than a stale closure.
  const activeSkillRef = useRef<string | null>(null)
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
    const firstUser = bubs.find(b => b.role === 'user')?.text ?? 'Untitled'
    try {
      await fetch('/api/xdirector/conversation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: convIdRef.current, title: firstUser.slice(0, 120),
          protocol: proto, bubbles: slim,
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
  const pendingRerunRef = useRef<{ parentRowIds: string[] } | null>(null)
  // The ↻ config step showed the price and the click was the confirm —
  // same rule as scene cards. One-shot: authorizes exactly one generation,
  // so the plan bubble never strands a fullscreen-canvas user in a chat
  // they cannot see (owner, Aug 9).
  const armedRerunRef = useRef(false)
  const genCountRef  = useRef(0)                          // auto-gens this user turn
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { onBusy?.(busy !== 'idle') }, [busy, onBusy])

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

  const patchScene = (sceneId: string, p: Record<string, any>) => {
    const next = storyboardRef.current.map((s: any) => s.id === sceneId ? { ...s, ...p } : s)
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

  // Shrink an attachment to something the agent can actually look at on
  // every turn. 768px is enough to read colour, material, print and hardware
  // — the attributes it was previously inventing.
  const toVisionBlock = (file: File): Promise<any | null> => new Promise(resolve => {
    try {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 768 / Math.max(img.width, img.height))
        const cv = document.createElement('canvas')
        cv.width = Math.max(1, Math.round(img.width * scale))
        cv.height = Math.max(1, Math.round(img.height * scale))
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
        URL.revokeObjectURL(url)
        const dataUrl = cv.toDataURL('image/jpeg', 0.82)
        resolve({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] },
        })
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    } catch { resolve(null) }
  })

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

  // ── Agent turn: POST the whole conversation, render what comes back ──────
  const agentTurn = async (rawMsgs: any[]) => {
    const msgs = healProtocol(rawMsgs)
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
      console.info('[xdirect:turn] generate gate', { sceneId, sceneArmed: !!(sceneId && armedScenesRef.current.has(sceneId)), rerunArmed: armedRerunRef.current, autoGens: genCountRef.current })
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
    const first: any = [...patches.values()][0]
    pushBubble({ role: 'agent', text: `✓ ${first.label ?? 'The generation'} finished while the page was away — the clip is on the canvas${typeof first.cost === 'number' ? ` ($${first.cost.toFixed(2)})` : ''}.` })
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
      generateScene: (sceneId: string, sceneLabel: string) => {
        if (busy !== 'idle') return
        genCountRef.current = 0
        armedScenesRef.current.add(sceneId)
        const text = `▶ ${sceneLabel}`
        pushBubble({ role: 'user', text })
        const msgs = [...protocol, { role: 'user', content: `Generate storyboard scene ${sceneId} now, exactly as it appears on the board. Use its current shot text, model, recipe and duration, pass scene_id="${sceneId}", and do not re-plan or re-confirm.` }]
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
        pendingRerunRef.current = { parentRowIds: Array.isArray(node.parentRowIds) ? node.parentRowIds : [] }
        armedRerunRef.current = true
        console.info('[xdirect:rerun] armed — sending director turn')
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
          + `- references: the same as the original generation of this prompt (set use_attachments accordingly).\n`
          + `- recipe: the same as the original if this model supports it; otherwise silently use the closest recipe this model DOES support for the same inputs (image_to_video ↔ reference_frames are acceptable substitutes).` }]
        setProtocol(msgs)
        void agentTurn(msgs)
      },
      generateAll: (sceneIds: string[]) => {
        if (busy !== 'idle' || sceneIds.length === 0) return
        genCountRef.current = 0
        for (const id of sceneIds) armedScenesRef.current.add(id)
        pushBubble({ role: 'user', text: `▶▶ ${t('xd.sb.genall')}` })
        const msgs = [...protocol, { role: 'user', content: `Generate every remaining draft storyboard scene now, one at a time in board order (${sceneIds.join(', ')}). Use each scene's current shot text, model, recipe and duration, pass its scene_id, and do not re-plan or re-confirm between scenes.` }]
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

    console.info('[xdirect:gen] start', { model_id: inp.model_id, recipe: inp.recipe, sceneId, duration: inp.duration, resolution: inp.resolution ?? null, use_attachments: !!inp.use_attachments, committed: committedRef.current.length })

    // Fail FAST with an error the director can act on, instead of burning a
    // provider attempt that cannot succeed (Gemini charged us a real try on
    // images=0, Aug 6).
    const bail = async (err: string) => {
      console.warn('[xdirect:gen] BAIL:', err)
      pushBubble({ role: 'gen', status: 'error', modelName: models[inp.model_id]?.name ?? inp.model_id, error: err })
      if (sceneId) patchScene(sceneId, { status: 'error', error: err })
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

    if (inp.use_attachments && committedRef.current.length === 0 && sceneRefs.length === 0) {
      return bail('No reference photos are available in this session — ask the user to re-attach the photo, then retry.')
    }

    // ── Frame chaining: this scene opens on another scene's closing frame ──
    let chainFrame: Attachment | null = null
    if (typeof inp.chain_from_scene === 'string' && inp.chain_from_scene) {
      const src: any = storyboardRef.current.find((s: any) => s.id === inp.chain_from_scene)
      if (!src || src.status !== 'done' || !src.url) {
        return bail(`Scene ${inp.chain_from_scene} has no finished clip to continue from — generate it first, then retry this one.`)
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

    setBusy('generating')
    pushBubble({ role: 'gen', status: 'generating', modelName: models[inp.model_id]?.name ?? inp.model_id, text: inp.prompt })
    if (sceneId) patchScene(sceneId, { status: 'generating', error: undefined })

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

    // The agent now directs stills as well as motion. Trust the declared
    // medium but fall back to reading the recipe, because a recipe and a
    // medium that disagree would bill against the wrong pipeline.
    const medium: 'image' | 'video' =
      inp.medium === 'image' || inp.medium === 'video'
        ? inp.medium
        : (typeof inp.recipe === 'string' && inp.recipe.includes('video') ? 'video' : 'image')

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
        const rerun = pendingRerunRef.current
        if (rerun) {
          pendingRerunRef.current = null
          return rerun.parentRowIds.length > 0 ? { parentIds: rerun.parentRowIds } : {}
        }
        if (sceneId) {
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
      }],
    }
    // Attachment ORDER is meaning: slot 0 is the start frame for recipes
    // that consume one, so a chained scene leads with the continuation
    // frame and the product references ride behind it.
    const refAtts = sceneRefs.length > 0
      ? sceneRefs
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
      if (sceneId) patchScene(sceneId, { status: 'error', error: 'Network error' })
      return finish({ ok: false, error: 'network error starting the generation' })
    }

    console.info('[xdirect:gen] POST /api/xcreate →', postRes.status, '(job', jobId.slice(0, 8) + '…)')
    if (!postRes.ok) {
      const detail = await postRes.json().catch(() => null)
      const msg = detail?.message ?? detail?.error ?? `HTTP ${postRes.status}`
      patchLastGen({ status: 'error', error: msg })
      if (sceneId) patchScene(sceneId, { status: 'error', error: msg })
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
        if (sceneId) patchScene(sceneId, { status: 'error', error: 'Timed out' })
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
          if (sceneId) patchScene(sceneId, { status: 'error', error: err })
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
        if (sceneId) patchScene(sceneId, { status: 'done', url: url ?? undefined, cost, row_id: xid ?? undefined })
        onActivity?.()   // new node on the board — let the canvas redraw
        return finish({ ok: true, url: url ? '(delivered to the user in the chat)' : null, medium, costUsd: cost, model: slot?.name ?? inp.model_id, xcreateId: xid })
      } catch { /* transient poll error — keep going */ }
    }, 2500)
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async () => {
    const text = input.trim()
    if (!text || busy !== 'idle') return
    genCountRef.current = 0

    // Build vision blocks BEFORE committing — commitAttachments strips the
    // File object once the bytes are in storage.
    const visionBlocks: any[] = []
    for (const a of atts) {
      if (a.file && a.mediaType.startsWith('image/')) {
        const blk = await toVisionBlock(a.file)
        if (blk) visionBlocks.push(blk)
      }
    }

    let committed = atts
    if (atts.length > 0) {
      try { committed = await commitAttachments(atts) } catch { /* keep going without */ }
      committedRef.current = committed.filter(a => a.storagePath)
    }

    pushBubble({
      role: 'user', text, files: atts.map(a => a.fileName),
      // Persisted with the conversation — this is what lets a restored
      // session keep generating against the same reference photos.
      ...(committedRef.current.length > 0 ? {
        atts: committedRef.current.map(a => ({
          storagePath: a.storagePath!, bucket: a.bucket, mediaType: a.mediaType,
          fileName: a.fileName, fileSize: a.fileSize,
        })),
      } : {}),
    })
    setInput(''); setAtts([])

    const noteParts: string[] = [text]
    if (committedRef.current.length > 0) {
      noteParts.push(`[attached ${committedRef.current.length} file(s): ${committedRef.current.map(a => `${a.fileName} (${a.mediaType})`).join(', ')} — available as reference inputs via use_attachments]`)
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
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 18, lineHeight: 1.6, marginTop: -8, flexShrink: 0 }}>{t('xdirector.subtitle')}</p>

      {/* The "open canvas" escape hatch that used to sit here is gone: on
          /xdirect the canvas IS alongside the chat. (CC, Aug 5) */}

        {/* Transcript — the ONLY scrolling region in the rail. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14, paddingRight: 6 }}>
          {loading && bubbles.length === 0 && (
            <div style={{ padding: '18px 20px', fontSize: 14, color: 'var(--muted)' }}>
              <span className="stream-cursor">▋</span>
            </div>
          )}
          {!loading && bubbles.length === 0 && (
            <div style={{ padding: '18px 20px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, fontSize: 14, color: 'var(--muted2)', lineHeight: 1.7 }}>
              {t('xdirector.intro')}
            </div>
          )}

          {/* Skill gallery. Only offered before the first message — switching
              skills mid-conversation would silently rewrite the rules the
              earlier turns were produced under. */}
          {!loading && bubbles.length === 0 && skills.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: 10 }}>
                {t('xdirector.skills')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {skills.map(sk => {
                  const on = activeSkill === sk.name
                  return (
                    <button
                      key={sk.name}
                      onClick={() => setActiveSkill(on ? null : sk.name)}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: 11, cursor: 'pointer',
                        border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
                        background: on ? 'rgba(232,69,60,0.06)' : 'var(--surface)',
                        boxShadow: on ? '0 0 0 3px rgba(232,69,60,0.15)' : 'none',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: on ? 'var(--red)' : 'var(--white)' }}>{sk.name}</span>
                        {sk.metadata?.category && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', border: '1px solid var(--border2)', borderRadius: 4, padding: '1px 5px' }}>
                            {sk.metadata.category}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
                        {sk.description}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
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
                {b.files && b.files.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>📎 {b.files.join(', ')}</div>
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
            <div style={{ alignSelf: 'flex-start', padding: '10px 16px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px 12px 12px 4px', fontSize: 14, color: 'var(--muted)' }}>
              <span className="stream-cursor">▋</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer — pinned below the scrolling transcript. */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, flexShrink: 0 }}>
          <AttachmentButton attachments={atts} onChange={setAtts} disabled={busy !== 'idle'} context="xcreate" multiple accept="image/jpeg,image/png,image/webp" />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={taRef}
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (isSubmitEnter(e)) { e.preventDefault(); send() } }}
              placeholder={t('xdirector.placeholder')}
              rows={2}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none', maxHeight: 240, overflowY: 'auto' }}
            />
            <button onClick={send} disabled={busy !== 'idle' || !input.trim()} style={{
              padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
              fontWeight: 700, fontSize: 14, cursor: busy !== 'idle' ? 'wait' : 'pointer', flexShrink: 0,
              opacity: busy !== 'idle' || !input.trim() ? 0.5 : 1,
            }}>
              {busy === 'idle' ? '→' : '…'}
            </button>
          </div>
      </div>
    </div>
  )
}
