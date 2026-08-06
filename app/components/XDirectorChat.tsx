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

export default function XDirectorChat({ onConversationId, onActivity }: {
  /** /xdirect listens here so its canvas can follow the conversation's
   *  board (board id === conversation id). Fired on restore and on the
   *  first message of a fresh chat. */
  onConversationId?: (id: string) => void
  /** Fired whenever the board may have changed (a generation settled, a
   *  conversation restored) — the canvas refreshes on it. */
  onActivity?: () => void
} = {}) {
  const t = useT()

  const [bubbles,  setBubbles]  = useState<Bubble[]>([])
  const [protocol, setProtocol] = useState<any[]>([])   // verbatim Anthropic messages
  const [input,    setInput]    = useState('')

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
  const genCountRef  = useRef(0)                          // auto-gens this user turn
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [bubbles])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

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

  // ── Agent turn: POST the whole conversation, render what comes back ──────
  const agentTurn = async (msgs: any[]) => {
    setBusy('thinking')
    let data: any
    try {
      const res = await fetch('/api/xdirector', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          ...(activeSkillRef.current ? { skill: activeSkillRef.current } : {}),
        }),
      })
      data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
    } catch (err: any) {
      setBusy('idle')
      pushBubble({ role: 'agent', text: `⚠ ${err?.message ?? 'The director is unreachable right now.'}` })
      return
    }

    const withNew = [...msgs, ...(data.newMessages ?? [])]
    setProtocol(withNew)

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
      if (genCountRef.current >= MAX_AUTO_GENS) {
        // Safety valve: acknowledge but don't run — the user can just say "go".
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

  // ── Execute a start_generation action via the normal XCreate pipeline ────
  const runGeneration = async (msgs: any[], action: any, pendingToolResults: any[]) => {
    const inp = action.input ?? {}
    setBusy('generating')
    pushBubble({ role: 'gen', status: 'generating', modelName: models[inp.model_id]?.name ?? inp.model_id, text: inp.prompt })

    const finish = async (result: any) => {
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
      ...(lastGenIdRef.current ? { parentIds: [lastGenIdRef.current] } : {}),
      modelIds: [inp.model_id],
      modelOptions: [{
        mode: inp.recipe,
        ...(typeof inp.duration === 'number' ? { duration: inp.duration } : {}),
        ...(typeof inp.aspect_ratio === 'string' ? { aspect_ratio: inp.aspect_ratio } : {}),
      }],
    }
    if (inp.use_attachments && committedRef.current.length > 0) {
      payload.attachments = committedRef.current.map(a => ({
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
      return finish({ ok: false, error: 'network error starting the generation' })
    }

    if (!postRes.ok) {
      const detail = await postRes.json().catch(() => null)
      const msg = detail?.message ?? detail?.error ?? `HTTP ${postRes.status}`
      patchLastGen({ status: 'error', error: msg })
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

    pushBubble({ role: 'user', text, files: atts.map(a => a.fileName) })
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

  // The spend gate. Approving runs the generation the agent already planned.
  const approvePlan = async (idx: number) => {
    const b = bubbles[idx]
    if (!b?.pending || b.resolved || busy !== 'idle') return
    resolveBubble(idx, 'go')
    genCountRef.current += 1
    const { msgs, action, pendingToolResults } = b.pending
    await runGeneration(msgs, action, pendingToolResults)
  }

  // Declining tells the agent so, so it can offer an alternative instead of
  // sitting on an unanswered tool call.
  const declinePlan = async (idx: number) => {
    const b = bubbles[idx]
    if (!b?.pending || b.resolved || busy !== 'idle') return
    resolveBubble(idx, 'changed')
    const { msgs, action, pendingToolResults } = b.pending
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

  // ── UI ── (no page shell: the XCreate page provides arena + header)
  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6, marginTop: -8 }}>{t('xdirector.subtitle')}</p>

      {/* The "open canvas" escape hatch that used to sit here is gone: on
          /xdirect the canvas IS alongside the chat. (CC, Aug 5) */}

        {/* Transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20, minHeight: 160 }}>
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

        {/* Composer */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <AttachmentButton attachments={atts} onChange={setAtts} disabled={busy !== 'idle'} context="xcreate" multiple accept="image/jpeg,image/png,image/webp" />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (isSubmitEnter(e)) { e.preventDefault(); send() } }}
              placeholder={t('xdirector.placeholder')}
              rows={2}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
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
