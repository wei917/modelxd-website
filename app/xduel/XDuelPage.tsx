'use client'

import { useEffect, useRef, useState } from 'react'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useAuthModal } from '../../lib/AuthModalContext'
import { createBrowserClient } from '@supabase/ssr'
import { usePromptRefiner } from '../components/PromptRefiner'
import { useLang } from '../../lib/i18n'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../lib/markdown'
import { commitAttachments, type Attachment } from '../components/AttachmentButton'
import LabeledSlotsPicker from '../components/LabeledSlotsPicker'
import MatchResult from '../components/MatchResult'
import XDuelBar, { type DuelKind } from './XDuelBar'
import VoteFeed from './VoteFeed'
import RecipeBar, { ModeDropdown } from './RecipeBar'
import { DUEL_MODELS } from '../../lib/duel-allowance'
import { DEFAULT_VIDEO_RECIPE, isVideoRecipe, recipeSpec, type VideoRecipe, AUDIO_KINDS, DEFAULT_AUDIO_KIND, isAudioKind, audioMaxChars, type AudioKind } from '../../lib/xduel-recipes'
import { computeMatchScores, duelVotePts } from '../../lib/matchScore'
import { usePageTitle } from '../../lib/PageTitleContext'
import { isSubmitEnter } from '../../lib/ime'
import { downloadUrl } from '@/lib/download-url'
import { finalizeInterrupted, STREAM_INTERRUPTED_MESSAGE, STREAM_NEVER_STARTED_MESSAGE } from '@/lib/xduel-stream'

type Vote = number | 'T' | null   // index of chosen model, or 'T' for tie
// 語音 (text to speech) joined Oct 19 in place of the game duels (owner).
type Mode = 'text' | 'image' | 'video' | 'audio'

/** Text runs cost fractions of a cent, video costs dollars — one fixed
 *  precision would print either "$0.00" or "$1.230000". */
function fmtSpend(c: number): string {
  if (!Number.isFinite(c) || c <= 0) return '$0'
  if (c >= 1)      return `$${c.toFixed(2)}`
  if (c >= 0.01)   return `$${c.toFixed(3)}`
  if (c >= 0.0001) return `$${c.toFixed(4)}`
  return '<$0.0001'
}

type ArenaPhase = 'vote' | 'revote'

type ModelMeta = {
  id?: string
  name: string
  provider: string
  outputPrice: number
  priceLabel: string
  // The CATALOG rate ($/1M tokens, $/image, $/video). priceLabel is
  // rewritten to this run's actual spend once image/video slots finish,
  // which left the cards with no rate at all in those modes and no total
  // in text mode. Keeping both lets every mode show rate AND total. (CC)
  unitLabel?: string
}

type ModelState = {
  meta: ModelMeta
  text: string
  isImage: boolean
  isVideo: boolean
  /** A speech duel's slot: `text` is the audio file's link. */
  isAudio?: boolean
  tokens: number
  responseTime: number
  streaming: boolean
  done: boolean
  cost: number
  /** Web searches this slot ran. Billed per call on top of tokens, so it is
   *  shown next to spend rather than folded silently into it. */
  searches: number
  // When a slot errors out, we carry the message here so the render path
  // can show a proper error block instead of stuffing it into <video src>
  // or <img src>, which the browser silently treats as a broken asset.
  errorMessage: string | null
  errorRef: string | null
}

const STEPS = [
  { n:1, key:'xduel.step.task' },
  { n:2, key:'xduel.step.vote' },
  { n:3, key:'xduel.step.reveal' },
  { n:4, key:'xduel.step.voteagain' },
  { n:5, key:'xduel.step.meet' },
]

const LABELS = ['A','B','C','D']

/** Format a per-call cost as a readable dollar amount (never scientific notation) */
function formatCost(cost: number, isImage: boolean, isVideo: boolean): string {
  if (isImage) return `$${parseFloat(cost.toFixed(4))} / image`
  if (isVideo) return `$${parseFloat(cost.toFixed(4))} / video`
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  return `$${cost.toFixed(4)}`
}

/** A saved duel's slots (/api/xduel/view, or a vote's reveal) as the page's
 *  cards. Before the viewer's vote the server sends no names, prices or
 *  cost, so `revealed` false leaves them blank, exactly as a live duel is
 *  until its first vote. */
/** A saved slot with no answer; shown in the reader's language (errText). */
const DID_NOT_FINISH = 'This model did not finish.'

/** 音訊's Mode row (Oct 21): 語音 and 音樂, not X創作's "From: 文字". */
const AUDIO_NAMES = { text_to_speech: 'xduel.audio.speech', text_to_music: 'xduel.audio.music' }
const AUDIO_ICONS = { text_to_speech: 'mic', text_to_music: 'audio' } as const

/** The label under a judged input, by the port it fed (lib/xduel-recipes.ts). */
const PORT_LABEL: Record<string, string> = {
  first_frame: 'xduel.slot.first', last_frame: 'xduel.slot.last',
  reference_image: 'xduel.slot.ref', video_in: 'xduel.slot.video', reference_audio: 'xduel.slot.audio',
}

function slotsToModels(slots: any[], revealed: boolean): ModelState[] {
  return (Array.isArray(slots) ? slots : []).filter(Boolean).map((s: any) => {
    const isImage = !!s.isImage, isVideo = !!s.isVideo, isAudio = !!s.isAudio
    const cost = revealed ? Number(s.cost ?? 0) : 0
    // Image and video are token-billed: their price is what this run cost,
    // as revealModels() does on a live duel.
    const media = (isImage || isVideo) && cost > 0
    const label = media ? `$${parseFloat(cost.toFixed(4))} / ${isImage ? 'image' : 'video'}` : (s.priceLabel ?? '…')
    return {
      meta: revealed
        ? { id: s.model_id ?? s.id ?? '', name: s.name ?? '', provider: s.provider ?? '', outputPrice: media ? cost : Number(s.outputPrice ?? 0), priceLabel: label, unitLabel: label }
        : { id: '', name: '', provider: '', outputPrice: 0, priceLabel: '…', unitLabel: undefined },
      text: s.text ?? '',
      isImage, isVideo, isAudio,
      tokens: 0,
      responseTime: Number(s.responseTime ?? 0),
      searches: Number(s.searches ?? 0),
      streaming: false,
      done: true,
      cost,
      errorMessage: s.text ? null : DID_NOT_FINISH,
      errorRef: null,
    }
  })
}

const parseVote = (v: unknown): Vote => v === 'T' ? 'T' : v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null

/** One page for every duel. `/xduel` starts a new one; `/xduel/<id>`
 *  (resumeId) opens a saved one at the step its viewer has reached (owner,
 *  Oct 18: the duel's id in the address, so a reload or a shared link
 *  carries on the same duel). The maker continues their own five steps;
 *  someone else gets the same blind vote, then the prices, then a second
 *  vote (community votes); a signed-out visitor sees the result. */
export default function XDuel({ resumeId }: { resumeId?: string } = {}) {
  // A shared duel can be looked at signed out; voting asks then.
  useRequireAuth(!resumeId)
  const { show: showAuth } = useAuthModal()
  const { t, lang } = useLang()
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  // 0 while a saved duel loads (no step is shown until it is placed).
  const [step,       setStep]       = useState(resumeId ? 0 : 1)
  const [mode,       setMode]       = useState<Mode>('image')  // visual wow, sustainable cost
  // Every duel is 1v1 (owner, Oct 18; lib/duel-allowance.ts).
  const count = DUEL_MODELS
  const [duelId,     setDuelId]     = useState<string | null>(null)
  // Who is looking at this duel: its maker (every new duel), another signed-
  // in user (votes as the community), or a signed-out visitor (sees it).
  const [viewer,     setViewer]     = useState<'owner' | 'other' | 'guest'>('owner')
  // Opening a saved duel: loading, not found, or done (null).
  const [resume,     setResume]     = useState<'loading' | 'missing' | null>(resumeId ? 'loading' : null)
  // The duel's own input photo/video, shown to whoever judges a saved duel
  // (owner, Sep 14: a voter judging "animate this photo" needs the photo).
  const [inputMedia, setInputMedia] = useState<{ url: string; mediaType: string; fileName?: string; all?: { url: string; mediaType: string; port: string | null }[] } | null>(null)
  // A video duel's kind (owner, Oct 19): 文字生成 / 首幀 / 首尾幀 / 參考圖 /
  // 改編影片 / 配樂・對嘴, each with its own inputs (lib/xduel-recipes.ts).
  const [recipe, setRecipe] = useState<VideoRecipe>(DEFAULT_VIDEO_RECIPE)
  // 音訊's kind (Oct 21; owner: "do it in one tab"): 語音 or 音樂.
  const [audioKind, setAudioKind] = useState<AudioKind>(DEFAULT_AUDIO_KIND)
  const spec = recipeSpec(recipe)
  const [prompt,     setPrompt]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [apiError,   setApiError]   = useState<string | null>(null)
  const [models,     setModels]     = useState<ModelState[]>([])
  // XDRating movement for the match report (step 5). undefined = fetching,
  // null = unavailable (tie / refit throttled / error) — chip hides.
  // XBoard rows captured BEFORE the blind vote lands — the report's delta
  // must cover the WHOLE duel (both votes), not just the informed vote.
  // Without this, vote1's refit is already priced in by the time the
  // report reads "before" and the chip shows a misleading partial delta.
  const [vote1,      setVote1]      = useState<Vote>(null)
  const [lightbox,   setLightbox]   = useState<string | null>(null)
  const [vote2,      setVote2]      = useState<Vote>(null)
  const [phase,      setPhase]      = useState<ArenaPhase>('vote')
  // The refiner has no speech mode; a script to read is rewritten as text.
  const refiner = usePromptRefiner({ prompt, mode: mode === 'audio' ? 'text' : mode, surface: 'xduel', disabled: loading, onApply: setPrompt })
  // /xduel?mode=image&q=… prefills step 1 (the TGS gallery links here, Sep
  // 14). It only fills the form: nothing runs until the user presses start,
  // so sign-in, quotas and charges are exactly as before. The prompt is
  // applied once the requested mode is in, so a mode switch cannot clear it.
  const seed = useRef<{ q: string; m: Mode } | null>(null)
  useEffect(() => {
    if (resumeId) return   // a saved duel brings its own type
    try {
      const url = new URL(window.location.href)
      const q = url.searchParams.get('q')
      const m = url.searchParams.get('mode')
      // The top bar's links (XDuelBar) name the type alone, with no prompt.
      // An old ?mode=game link (game duels left XDuel Oct 19) opens image.
      const mm: Mode = m === 'text' || m === 'video' || m === 'audio' ? m : 'image'
      if (q) seed.current = { q: q.slice(0, 2000), m: mm }
      if (mm !== mode) setMode(mm)
      const r = url.searchParams.get('recipe')
      if (mm === 'video' && isVideoRecipe(r)) setRecipe(r)
      if (mm === 'audio' && isAudioKind(r)) setAudioKind(r)
    } catch { /* no window */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (seed.current && seed.current.m === mode) { setPrompt(seed.current.q); seed.current = null }
  }, [mode])
  const { setOverride } = usePageTitle()
  const [showPrices, setShowPrices] = useState(false)
  const [showReveal, setShowReveal] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // Daily XDuel allowance. XDuel is free for users but ModelXD pays the
  // provider bills, so the server allows 10 duels a day of any type
  // (lib/duel-allowance.ts). The page shows no counts (owner, Oct 17):
  // only, once the day's allowance is gone, that it is and to come back
  // tomorrow. Refetched after each run and after a 429.
  type Quota = { left: { text: number; image: number; video: number; audio: number } }
  const [quota, setQuota] = useState<Quota | null>(null)
  const fetchQuota = async () => {
    try {
      const r = await fetch('/api/xduel/quota')
      if (!r.ok) return
      const j = await r.json()
      if (j?.left) setQuota({ left: j.left })
    } catch { /* ignore */ }
  }
  useEffect(() => { fetchQuota() }, [])

  const bothDone    = models.length > 0 && models.every(m => m.done)
  const anyStreaming = models.some(m => m.streaming)

  // Cheapest model index — LIST price (meta.outputPrice), never this run's
  // actual spend. A user is picking a model, not one response, and list price
  // is what priceLabel shows, what the step-3 badges compare and what step 5's
  // "Nx cheaper / saves $X per month" is built on. Ranking by actual cost meant
  // a verbose cheap model could out-spend a terse expensive one on a single
  // run, putting the green "cheapest" highlight and the "Smart call, you saved
  // money" verdict on a card whose list price is actually higher. Per-run cost
  // still feeds the match score's cost component (lib/matchScore.ts), which is
  // a genuine per-run efficiency measure — that is a different question.
  const cheapestIdx = models.length > 0
    ? models.reduce((minI, m, i, arr) => m.meta.outputPrice < arr[minI].meta.outputPrice ? i : minI, 0)
    : -1

  const currentVote = phase === 'vote' ? vote1 : vote2

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, id: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.35; ry += (my-ry)*0.35
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      id = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    id = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(id) }
  }, [])

  const goStep = (n: number) => { setStep(n); window.scrollTo({ top:0, behavior:'smooth' }) }

  // Open a saved duel (/xduel/<id>) where its viewer left it:
  //   maker      — not voted: step 2; voted blind: step 4 with prices; both: the report.
  //   other user — not voted: step 2, blind; voted: the report with their choice.
  //   signed out — the maker's result once judged, else the answers (a vote asks to sign in).
  useEffect(() => {
    if (!resumeId) return
    let gone = false
    ;(async () => {
      try {
        const res = await fetch(`/api/xduel/view?id=${encodeURIComponent(resumeId)}`)
        const j = await res.json().catch(() => null)
        if (gone) return
        const d = j?.duel
        if (!res.ok || !d) { setResume('missing'); return }
        const role = d.is_owner ? 'owner' : j.canVote ? 'other' : 'guest'
        let v1: Vote = null, v2: Vote = null
        if (role !== 'other') { v1 = parseVote(d.vote1); v2 = parseVote(d.vote2) }
        else if (j.revealed) {
          // Their own choice; a community vote keeps one, the final one.
          const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
          const { data: { user } } = await sb.auth.getUser()
          const { data: row } = user
            ? await sb.from('duel_votes').select('vote_choice').eq('duel_id', d.id).eq('user_id', user.id).maybeSingle()
            : { data: null }
          v1 = v2 = parseVote(row?.vote_choice)
        }
        if (gone) return
        setViewer(role)
        setDuelId(d.id)
        if (d.mode === 'text' || d.mode === 'image' || d.mode === 'video' || d.mode === 'audio') setMode(d.mode)
        if (isVideoRecipe(d.recipe)) setRecipe(d.recipe)
        if (d.mode === 'audio') setAudioKind(isAudioKind(d.recipe) ? d.recipe : DEFAULT_AUDIO_KIND)
        setPrompt(d.prompt ?? '')
        setInputMedia(d.input_media?.url && /^(image|video|audio)\//.test(d.input_media.mediaType ?? '') ? d.input_media : null)
        setModels(slotsToModels(d.slots, !!j.revealed))
        setVote1(v1); setVote2(v2)
        const judged = role === 'other' ? !!j.revealed : v1 !== null && v2 !== null
        if (judged) { setPhase('revote'); setShowPrices(true); setShowReveal(true); setStep(5) }
        else if (role === 'owner' && v1 !== null) { setPhase('revote'); setShowPrices(true); setStep(4) }
        else { setPhase('vote'); setStep(2) }
        setResume(null)
      } catch {
        if (!gone) setResume('missing')
      }
    })()
    return () => { gone = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  /** Point the address at this duel (or back at a new one) without
   *  reloading: /xduel/<id> once a duel is saved, /xduel?mode= otherwise. */
  /** The fixed English sentences from lib/xduel-stream.ts and saved slots,
   *  in the reader's language; anything else as it came. */
  const errText = (msg: string) =>
    msg === STREAM_INTERRUPTED_MESSAGE ? t('xduel.err.interrupted')
    : msg === STREAM_NEVER_STARTED_MESSAGE ? t('xduel.err.neverstarted')
    : msg === DID_NOT_FINISH ? t('xduel.err.other')
    : msg

  const setAddress = (id: string | null, kind: string = mode, rec: VideoRecipe = recipe, ak: AudioKind = audioKind) => {
    try {
      const u = new URL(window.location.href)
      u.pathname = id ? `/xduel/${id}` : '/xduel'
      u.search = ''
      if (!id) u.searchParams.set('mode', kind)
      if (!id && kind === 'video' && rec !== DEFAULT_VIDEO_RECIPE) u.searchParams.set('recipe', rec)
      if (!id && kind === 'audio' && ak !== DEFAULT_AUDIO_KIND) u.searchParams.set('recipe', ak)
      window.history.replaceState(window.history.state, '', u)
    } catch { /* no window */ }
  }

  const startDuel = async () => {
    setLoading(true)
    setApiError(null)
    setModels([])
    setVote1(null); setVote2(null)
    setDuelId(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    goStep(2)

    try {
      // Attachments are held in the browser until submit — upload now.
      const committed = await commitAttachments(attachments)
      if (committed !== attachments) setAttachments(committed)
      // Every file in slot order; a video kind names each one's port (首幀,
      // 尾幀, 參考圖, 原影片, 音訊) so both models read it in the same role.
      const files = committed.map((a, i) => ({
        storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize,
        ...(mode === 'video' && spec.slots[a.slotIndex ?? i] ? { port: spec.slots[a.slotIndex ?? i].port } : {}),
      }))
      const res = await fetch('/api/xduel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, count, lang, ...(mode === 'video' ? { recipe } : mode === 'audio' ? { recipe: audioKind } : {}), attachments: files }),
      })

      if (!res.ok || !res.body) {
        // Try to parse a structured JSON error first so we can show a
        // friendlier message for known cases (quota, unverified email).
        const text = await res.text()
        let parsed: { error?: string; message?: string; mode?: string; limit?: number } | null = null
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }
        if (res.status === 429 && parsed?.error === 'daily_limit_reached') {
          fetchQuota()
          throw new Error(t('xduel.limit'))
        }
        if (res.status === 403 && parsed?.error === 'email_not_verified') {
          throw new Error(parsed.message ?? 'Please verify your email before using XDuel.')
        }
        throw new Error(text || `Server error ${res.status}`)
      }

      // Did the server close the duel itself? Anything else — a proxy
      // cutting an idle stream, a lost connection, the function reaching
      // its limit — is an interruption to settle explicitly (Sep 16).
      let sawEnd  = false
      let sawMeta = false
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6))

              if (currentEvent === 'meta') {
                sawMeta = true
                if (payload.duelId) setDuelId(payload.duelId)
                // Blind slots. The server no longer sends identities or prices
                // while the duel is unvoted (see the `meta` note in
                // app/api/xduel/route.ts) — they arrive in the vote-1
                // response and are merged in by revealModels(). Nothing
                // between here and that point reads these fields: every
                // price block is gated on showPrices, and the names appear
                // only on the reveal card.
                const initialModels: ModelState[] = Array.from({ length: payload.count }, () => ({
                  meta: {
                    id:          '',
                    name:        '',
                    provider:    '',
                    outputPrice: 0,
                    priceLabel:  '…',
                    unitLabel:   undefined,
                  },
                  text:         '',
                  isImage:      false,
                  isVideo:      false,
                  tokens:       0,
                  responseTime: 0,
                  searches:     0,
                  streaming:    true,
                  done:         false,
                  cost:         0,
                  errorMessage: null,
                  errorRef: null,
                }))
                setModels(initialModels)
                setLoading(false)

              } else if (currentEvent.startsWith('trying:')) {
                // The slot's first model was unusable and the server redrew.
                // Clear whatever it managed to stream so the replacement's
                // answer doesn't get appended to a half-sentence; the new
                // identity and price come with the reveal like everyone
                // else's.
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? { ...m, text: '', isImage: false, isVideo: false, isAudio: false, cost: 0, streaming: true, done: false } : m
                ))

              } else if (currentEvent.startsWith('delta:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? {
                    ...m,
                    text: payload.text != null ? (payload.isImage || payload.isVideo || payload.isAudio ? payload.text : m.text + payload.text) : m.text,
                    isImage: payload.isImage ?? m.isImage,
                    isVideo: payload.isVideo ?? m.isVideo,
                    isAudio: payload.isAudio ?? m.isAudio,
                  } : m
                ))

              } else if (currentEvent.startsWith('done:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) => {
                  if (i !== idx) return m
                  // Only what this RUN did. The price-label folding that used
                  // to happen here moved to revealModels(): at this point the
                  // slot has no list price to fold into, because the duel is
                  // still blind. Every provider sends `cost` on done, so the
                  // old outputPrice-based fallback had nothing left to do.
                  return {
                    ...m,
                    tokens:       payload.tokens,
                    responseTime: payload.responseTime,
                    cost:         payload.cost != null ? Number(payload.cost) : 0,
                    searches:     Number(payload.searches ?? 0),
                    streaming:    false,
                    done:         true,
                  }
                }))

              } else if (currentEvent === 'end') {
                sawEnd = true
                // Saved (the row is written before 'end'): the address
                // becomes the duel's, so a reload or a shared link carries
                // on with it. A duel with a failed slot is saved too and
                // gets its address as well (owner, Oct 19: "we still
                // should have!"); it just never reaches the vote feed.
                if (payload?.duelId) setAddress(payload.duelId)
                // A duel with a failed slot refunds the quota server-side
                // (July 19). Tell the user plainly — no provider details.
                if (payload?.refunded) {
                  setApiError(t('xduel.err.refunded'))
                  fetchQuota()
                }

              } else if (currentEvent === 'resolved') {
                                // Update with actually-used models after any fallbacks
                                setModels(prev => prev.map((m, i) => ({
                                  ...m,
                                  meta: payload.models[i] ?? m.meta,
                                })))

              } else if (currentEvent.startsWith('error:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx
                    ? {
                        ...m,
                        // Clear text/isImage/isVideo so the render path
                        // doesn't try to stuff the error string into a
                        // <video src>/<img src> attribute. We carry the
                        // message in a dedicated errorMessage slot.
                        text: '',
                        isImage: false,
                        isVideo: false,
                        // The reason in the reader's language, by its
                        // class (lib/provider-errors.ts providerErrorKind).
                        errorMessage: payload.kind ? t(`xduel.err.${payload.kind}`) : (payload.message || t('xduel.err.other')),
                        errorRef: payload.ref ?? null,
                        streaming: false,
                        done: true,
                      }
                    : m
                ))
              }
            } catch {}
          }
        }
      }
      if (!sawEnd) {
        // EOF without `end`: every card still waiting becomes a failed card
        // with a sentence, never a spinner for a model that will not
        // answer. Quota is re-read below; the server refunds only when it
        // reached the end itself, so nothing is promised here.
        if (sawMeta) setModels(prev => finalizeInterrupted(prev))
        setApiError(sawMeta ? STREAM_INTERRUPTED_MESSAGE : STREAM_NEVER_STARTED_MESSAGE)
        setLoading(false)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      // Same settlement for a read that threw (the socket died mid-duel).
      setModels(prev => finalizeInterrupted(prev))
      setApiError(msg)
      setLoading(false)
      // Quota state may have shifted (either we consumed a slot before
      // failing, or we hit the cap). Refresh so the UI matches reality.
      fetchQuota()
      return
    }
    // Refresh quota after a successful duel so the counter advances
    // in the UI without requiring a page reload.
    fetchQuota()
  }

  // Publish the wizard-step title into the content TopBar ("// XDuel" +
  // big title) — every page's title lives in the bar now (CC, July 16).
  useEffect(() => {
    setOverride({
      eyebrow: t('xduel.eyebrow'),
      title: step === 1 ? t('xduel.title') :
             step === 5 ? t('xduel.reveal') :
             phase === 'vote' ? t('xduel.voteblind') :
             t('xduel.voteagain'),
    })
    return () => setOverride(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phase, t])

  /** Merge the identities and prices the server releases once vote 1 is
   *  recorded. This is also where a run's ACTUAL cost becomes a price label
   *  for image/video: those models are token-billed and their headline rate
   *  is 0 until the usage comes back, so the reveal's savings math needs the
   *  measured number folded into outputPrice. Text keeps the catalog's
   *  per-1M rate. (Both used to happen in the `done:` handler, back when the
   *  slot already knew its price mid-duel.) */
  const revealModels = (revealed: any[]) => {
    setModels(prev => prev.map((m, i) => {
      const r = revealed.find((x: any) => x.index === i)
      if (!r) return m
      const listPrice = r.outputPrice ?? 0
      const priceLabel = m.isImage
        ? `$${parseFloat(m.cost.toFixed(4))} / image`
        : m.isVideo
        ? `$${parseFloat(m.cost.toFixed(4))} / video`
        : (r.priceLabel ?? '…')
      return {
        ...m,
        meta: {
          id: r.id ?? '', name: r.name, provider: r.provider,
          outputPrice: (m.isImage || m.isVideo) && m.cost > 0 ? m.cost : listPrice,
          priceLabel,
          unitLabel: priceLabel,
        },
      }
    }))
  }

  // Someone else's duel votes as the community: the blind choice earns the
  // names and prices back, and the final choice replaces it (one row per
  // viewer, /api/xduel/community-vote). Remembered in this browser too, as
  // the vote feed hides what you have judged.
  const communityVote = (choice: Vote, reveal: boolean) => {
    if (!duelId) return
    fetch('/api/xduel/community-vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duelId, voteChoice: choice === 'T' ? 'T' : String(choice) }),
    })
      .then(r => r.json())
      .then(d => { if (reveal && Array.isArray(d?.slots)) setModels(slotsToModels(d.slots, true)) })
      .catch(console.error)
  }

  const castVote = (choice: Vote) => {
    if (viewer === 'guest') { showAuth(); return }
    setVote1(choice)
    setTimeout(() => { setShowPrices(true); setPhase('revote'); setStep(4) }, 500)
    if (viewer === 'other') { communityVote(choice, true); return }
    // No model id is sent: the server derives the winner from this slot
    // index against the duel's own row, and answers with the reveal.
    if (duelId) fetch('/api/xduel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duelId, vote1: choice === 'T' ? 'T' : String(choice) }),
    })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.models)) revealModels(d.models) })
      .catch(console.error)
  }

  const castRevote = (choice: Vote) => {
    if (viewer === 'guest') { showAuth(); return }
    setVote2(choice)
    if (viewer === 'other') communityVote(choice, false)
    // No rating movement is shown (owner, Oct 1), so nothing is read back
    // and no refit is forced; the 5-minute cron refits as before.
    else if (duelId) fetch('/api/xduel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duelId, vote2: choice === 'T' ? 'T' : String(choice) }),
    }).catch(console.error)
    setTimeout(() => {
      goStep(5)
      setTimeout(() => setShowReveal(true), 600)
    }, 600)
  }

  const clearState = (keepPrompt = false) => {
    setVote1(null); setVote2(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    setModels([]); setApiError(null)
    // Whatever duel was open, the next one is the viewer's own.
    setViewer('owner'); setDuelId(null); setInputMedia(null)
    if (!keepPrompt) { setPrompt(''); setAttachments([]) }
  }

  // A type picked in the top bar. Past step 1 it starts over in that type
  // with an empty box, as Next Duel does (owner, Oct 19: "after the XDuel,
  // the prompt is still there. should clear it"); the address keeps the
  // type, so a reload lands on it.
  const pickKind = (k: DuelKind) => {
    if (step !== 1) { clearState(); goStep(1) }
    setMode(k)
    // Text takes documents and speech takes nothing: a photo staged for an
    // image or video duel must not ride along silently.
    if (k === 'text' || k === 'audio') setAttachments([])
    setAddress(null, k)
  }
  // A video kind picked from its chips: its own inputs, so the files staged
  // for another kind go.
  const pickRecipe = (r: VideoRecipe) => {
    if (r === recipe) return
    setRecipe(r)
    setAttachments([])
    setAddress(null, 'video', r)
  }
  // 語音 / 音樂: the same box, a different task.
  const pickAudioKind = (k: AudioKind) => {
    if (k === audioKind) return
    setAudioKind(k)
    setAddress(null, 'audio', recipe, k)
  }

  // Prompt chars ≈ /3; attached .txt files count too (≈ bytes/4) —
  // they're folded into the prompt server-side, so they cost real tokens.
  // The server folds at most 200k chars per file (lib/providers/index.ts),
  // so the estimate caps at ~50k tokens per attachment to match.
  const attachTokens = attachments.reduce((sum, a) =>
    a.mediaType?.startsWith('text/') ? sum + Math.min(Math.round((a.fileSize ?? 0) / 4), 50_000) : sum, 0)
  const attachTruncated = attachments.some(a => a.mediaType?.startsWith('text/') && (a.fileSize ?? 0) > 200_000)
  const approxTokens = Math.round(prompt.length / 3) + attachTokens

  // Cheapest model for savings calc
  const cheapestModel = cheapestIdx >= 0 ? models[cheapestIdx] : null
  const mostExpensive = models.length > 0
    ? models.reduce((maxM, m) => m.meta.outputPrice > maxM.meta.outputPrice ? m : maxM, models[0])
    : null
  // Ratio shown as e.g. "1.4× cheaper" or "2× cheaper". Math.round() collapsed
  // anything between 1.0 and 1.5 into "1× cheaper" which read as "no
  // difference" — keep one decimal until we cross 10×, then drop it.
  const rawRatio = cheapestModel && mostExpensive && cheapestModel.meta.outputPrice > 0
    ? mostExpensive.meta.outputPrice / cheapestModel.meta.outputPrice
    : 0
  const ratio = rawRatio >= 10
    ? Math.round(rawRatio).toString()
    : rawRatio > 0
      ? (Math.round(rawRatio * 10) / 10).toString()
      : '0'
  // The savings line's volume: 1,000 images, videos or minutes of speech,
  // or 100M tokens (images were 2,000 until Oct 19; owner: one figure).
  const isMediaMode = mode === 'image' || mode === 'video' || mode === 'audio'
  // Free duels this type can still take today (XDuel is free-only — paid
  // duels were tried and removed July 19; XCreate is the paid path).
  const quotaLeft = quota ? quota.left[mode] : Infinity
  const limitNote = quotaLeft === 0 ? t('xduel.limit') : null
  // Start waits for what the task needs: every required input of a video
  // kind, and a prompt unless the kind's inputs carry the task.
  const missingInputs = mode === 'video' && spec.slots.some((s, i) => s.required && !attachments.some((a, j) => (a.slotIndex ?? j) === i))
  const canStart = quotaLeft !== 0 && !missingInputs && (
    prompt.trim().length >= 3 || (mode === 'video' && spec.promptOptional && attachments.length > 0)
  )
  // Image / video models are billed per generation in fractional dollars
  // (e.g. $0.04). Math.round() on a $14.10 figure was fine, but the previous
  // version used Math.round on $0.04, which floored to $0. Switch to two-
  // decimal precision and let toLocaleString format it.
  // Video outputPrice is PER SECOND (priceLabel "$0.4 / sec"), so a
  // per-generation figure must multiply by clip length — 8s, the default
  // the templates sell. Without it the video pitch was ~6x too small.
  const VIDEO_SECONDS = 8
  const delta = cheapestModel && mostExpensive
    ? mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice
    : 0
  const monthlyRaw =
    mode === 'video' ? delta * VIDEO_SECONDS * 1000   // 1K clips × 8s
    : mode === 'image' ? delta * 1000                 // 1K images
    : mode === 'audio' ? delta * 1000                 // 1K minutes of speech ($/min), or 1K songs
    : delta * 100                                     // 100M tokens
  const monthly = isMediaMode
    ? Math.round(monthlyRaw * 100) / 100
    : Math.round(monthlyRaw)
  const monthlyLabel = t(mode === 'video' ? 'xd.basis.video' : mode === 'image' ? 'xd.basis.image' : mode === 'audio' ? (audioKind === 'text_to_music' ? 'xd.basis.music' : 'xd.basis.audio') : 'xd.basis.text')

  // ── Price-reveal framing (CC, July 29) ─────────────────────────────────
  // The headline is the pitch, so it should state what THIS duel actually
  // showed rather than ask a generic question. Text answers that match
  // word-for-word are the strongest version of the argument; otherwise fall
  // back to the price spread, and only to a neutral line when there is no
  // spread to talk about.
  const priceAt = (i: number) => models[i]?.meta?.outputPrice
  const pickedIdx  = typeof vote1 === 'number' ? vote1 : null
  const dearestIdx = models.length > 0
    ? models.reduce((maxI, m, i, arr) => m.meta.outputPrice > arr[maxI].meta.outputPrice ? i : maxI, 0)
    : -1
  const spreadPct = (() => {
    const lo = priceAt(cheapestIdx), hi = priceAt(dearestIdx)
    if (typeof lo !== 'number' || typeof hi !== 'number' || hi <= 0 || lo === hi) return null
    return Math.round(((hi - lo) / hi) * 100)
  })()
  const answersMatch = models.length === 2 && mode === 'text' && !!models[0]?.text && !!models[1]?.text
    && models[0].text.trim().replace(/\s+/g, ' ').toLowerCase() === models[1].text.trim().replace(/\s+/g, ' ').toLowerCase()
  const revealHeadline = answersMatch && spreadPct
    ? t('xduel.rv.same')
    : spreadPct
      ? t('xduel.rv.spread').replace('{p}', String(spreadPct))
      : t('xduel.rv.neutral')
  // Speed side of the trade-off, for the vs bar.
  // Time saved, beside the money saved (owner, Oct 19: "we should also add
  // time saved if it runs faster"): the fastest answer's lead over the
  // slowest, per run, and at the savings line's own volume where runs are
  // countable (1,000 images or videos). A lead under half a second is
  // noise and says nothing.
  const timeSaved = (() => {
    const ok = models.map((m, i) => ({ m, i })).filter(x => !x.m.errorMessage && x.m.responseTime > 0)
    if (ok.length < 2) return null
    const fast = ok.reduce((a, b) => b.m.responseTime < a.m.responseTime ? b : a)
    const diffMs = Math.max(...ok.map(x => x.m.responseTime)) - fast.m.responseTime
    if (diffMs < 500) return null
    const sec = (diffMs / 1000).toFixed(1)
    const runs = mode === 'image' || mode === 'video' ? 1000 : 0
    if (!runs) return { idx: fast.i, scaled: false, line: t('xd.report.faster.each').replace('{sec}', sec) }
    const minutes = diffMs * runs / 60_000
    const time = minutes >= 60
      ? t('xd.time.hours').replace('{n}', (minutes / 60).toFixed(1))
      : t('xd.time.minutes').replace('{n}', String(Math.max(1, Math.round(minutes))))
    return { idx: fast.i, scaled: true, line: t('xd.report.faster.scaled').replace('{sec}', sec).replace('{time}', time) }
  })()

  // Speed compares answers only: a failed model's 0 s is not "faster"
  // (it read ⚡ 快 100% beside 生成失敗, Oct 19).
  const answered = models.filter(m => !m.errorMessage && m.responseTime > 0)
  const slowestTime = answered.length >= 2 ? Math.max(...answered.map(m => m.responseTime)) : 0
  const fasterPct = (m: ModelState) =>
    !m.errorMessage && m.responseTime > 0 && m.responseTime < slowestTime
      ? Math.round((slowestTime - m.responseTime) / slowestTime * 100) : null
  const fastestIdx = answered.length > 0
    ? models.indexOf(answered.reduce((a, b) => b.responseTime < a.responseTime ? b : a))
    : -1
  const speedPct = (() => {
    const times = answered.map(m => m.responseTime)
    if (times.length < 2) return null
    const lo = Math.min(...times), hi = Math.max(...times)
    return hi > 0 && lo !== hi ? Math.round(((hi - lo) / hi) * 100) : null
  })()

  const userChoseCheaper = typeof vote2 === 'number' && vote2 === cheapestIdx
  const savingsEmoji = vote2 === 'T' ? '⚖' : userChoseCheaper ? '🎉' : '😂'

  const voteLabel = (v: Vote) => v === 'T' ? 'a Tie' : v !== null ? `Model ${LABELS[v as number]}` : ''

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
            <a href={downloadUrl(lightbox, `modelxd-${Date.now()}.png`)} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* X先知's layout and colours (owner, Oct 16): its top bar with the
          duel types, then the page on its paper (.xduel-xt in globals.css).
          The bar sits outside .xduel-page, whose overflow would swallow its
          sticky. */}
      <div className="xduel-xt">
      <XDuelBar current={mode} onPick={pickKind} busy={step !== 1 && (loading || anyStreaming)} />
      <div className="xduel-page">
        <div className="arena">

          {/* Step progress bar — a prompt-duel thing; game duels have no
              steps here (their arc lives on the game page). On top, above
              the headline (owner, Oct 18). */}
          {!resume && <div className="step-bar">
            {STEPS.map((s, i) => (
              <span key={s.n} style={{display:'contents'}}>
                <div className={`step-item ${step===s.n?'active':''} ${step>s.n?'done':''}`}>
                  <div className="step-num">{s.n}</div>{t(s.key)}
                </div>
                {i < STEPS.length-1 && <span className={`step-connector ${step>s.n?'done':''}`} aria-hidden="true">&gt;</span>}
              </span>
            ))}
          </div>}

          {/* ── In-page header: the step's guiding line as the headline
              (CC, July 20). No "X對決" eyebrow above it since Oct 17
              (owner); step 5's report carries its own title, so no header
              then. ── */}
          {step !== 5 && !resume && (
          <div className="prompt-header">
            {/* After Start the line is the user's own prompt, at a reading
                size rather than the headline's (owner, Oct 19). */}
            <h1 className={`page-headline${step !== 1 && phase === 'vote' ? ' xduel-asked' : ''}`}>
              {step === 1 ? t('xduel.subtitle') :
               phase === 'vote'
                ? `"${prompt.substring(0,80)}${prompt.length>80?'…':''}"`
                : revealHeadline}
            </h1>
            {/* A saved duel's inputs, for whoever judges it: every frame,
                reference, clip or song a video kind was made from. */}
            {inputMedia && (step === 2 || step === 4) && (
              <div className="xduel-inputs">
                {(inputMedia.all ?? [{ ...inputMedia, port: null }]).map((f, i) => (
                  <figure key={i} className="xduel-input">
                    {f.mediaType.startsWith('image/')
                      ? <img src={f.url} alt="" onClick={() => setLightbox(f.url)} />
                      : f.mediaType.startsWith('audio/')
                      ? <audio src={f.url} controls preload="metadata" />
                      : <video src={f.url} controls muted playsInline />}
                    {f.port && <figcaption>{t(PORT_LABEL[f.port] ?? 'xduel.slot.ref1')}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Opening a saved duel, or one that is not there. */}
          {resume && (
            <div className="xduel-resume" role="status">
              {resume === 'loading' ? t('xduel.loadingduel') : <>
                <p>{t('xduel.notfound')}</p>
                <button className="btn-next" onClick={() => { setResume(null); clearState(); setAddress(null, mode); goStep(1) }}>{t('xduel.startnew')} →</button>
              </>}
            </div>
          )}

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="step-section">
              {/* The day's allowance is gone: say so once, here, and Start
                  waits for tomorrow (owner, Oct 17). */}
              {limitNote && <div className="xduel-limit" role="status">{limitNote}</div>}

              <>
              {/* XCreate-style framed composer (CC, July 20): upload slot
                  INSIDE the frame above the borderless textarea; the action
                  row (counter + battle button) sits below the box. Text mode
                  accepts documents only (PDF / txt): the router feeds the PDF
                  natively to pdf_to_text-capable models and folds extracted
                  text into the prompt for the rest — keeping the duel fair. */}
              {/* 影片's kinds (owner, Oct 19): a Mode row above the box they shape. */}
              {mode === 'video' && <RecipeBar recipe={recipe} onPick={pickRecipe} t={t} />}
              {mode === 'audio' && <RecipeBar recipe={audioKind} kinds={AUDIO_KINDS} names={AUDIO_NAMES} icons={AUDIO_ICONS} onPick={pickAudioKind} t={t} />}
              <div className="prompt-box framed">
                {/* A video kind's own labelled inputs (none for 文字生成). */}
                {mode === 'video' && spec.slots.length > 0 && <div className="prompt-slots" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
                  <LabeledSlotsPicker
                    key={recipe}
                    slots={spec.slots.map(s => ({ label: t(s.label), hint: t(s.hint) }))}
                    attachments={attachments}
                    onChange={setAttachments}
                    context="xduel"
                    compact
                    arrows={!!spec.arrows}
                    accept={spec.slots[0].type === 'audio'
                      ? 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm,audio/flac'
                      : spec.slots[0].type === 'video'
                      ? 'video/mp4,video/quicktime,video/webm'
                      : 'image/jpeg,image/png,image/gif,image/webp'}
                    {...(spec.slots[0].type === 'audio' ? { audioMaxSeconds: 15 } : {})}
                  />
                </div>}
                {/* A speech duel reads the text; nothing is attached, so no row.
                    Video's inputs come from its kind, above. */}
                {mode !== 'audio' && mode !== 'video' && <div className="prompt-slots" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
                  <LabeledSlotsPicker
                    slots={[{ label: t('xduel.attach'), hint: mode === 'text' ? t('xduel.attach.hint.doc') : t('xduel.attach.hint') }]}
                    attachments={attachments}
                    onChange={setAttachments}
                    context="xduel"
                    compact
                    accept={mode === 'text'
                      ? 'application/pdf,text/plain'
                      : 'image/jpeg,image/png,image/gif,image/webp'}
                  />
                </div>}
                <textarea
                  className="prompt-textarea"
                  maxLength={mode === 'audio' ? audioMaxChars(audioKind) : 8000}
                  placeholder={t(mode === 'video' ? 'xduel.ph.video.' + recipe : mode === 'audio' && audioKind === 'text_to_music' ? 'xduel.ph.music' : 'xduel.ph.' + mode)}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (isSubmitEnter(e, { requireModifier: true })) {
                      e.preventDefault()
                      if (canStart) startDuel()
                    }
                  }}
                />
                {/* The same mode as the row above, as a dropdown in the box
                    (owner, Oct 20: "a dropdown is much easier to select"). */}
                {mode === 'video' && (
                  <div className="xduel-prompt-tools">
                    <ModeDropdown recipe={recipe} onPick={pickRecipe} t={t} />
                  </div>
                )}
                {mode === 'audio' && (
                  <div className="xduel-prompt-tools">
                    <ModeDropdown recipe={audioKind} kinds={AUDIO_KINDS} names={AUDIO_NAMES} icons={AUDIO_ICONS} onPick={pickAudioKind} t={t} />
                  </div>
                )}
              </div>
              {/* 圖1 / 圖2 name the reference pictures; each model gets them
                  in its own words (lib/reference-tokens.ts). */}
              {mode === 'video' && recipe === 'reference_frames' && <p className="xduel-refhint">{t('ref.howto')}</p>}
              <div className="duel-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 10, marginBottom: 24 }}>
                <span className="prompt-counter">
                  {mode === 'audio'
                    ? `${prompt.length} / ${audioMaxChars(audioKind)}`
                    : prompt.length > 7000
                    ? `${prompt.length.toLocaleString()} / 8,000 — for longer text, attach a .txt file`
                    : approxTokens > 0 ? `~${approxTokens.toLocaleString()} tokens${attachTruncated ? ' (large file — first 200k characters used)' : ''}` : ''}
                </span>
                {/* Improve prompt (owner, Sep 16): secondary, beside Start;
                    a suggestion the user confirms, never a duel start. */}
                {refiner.action}
                <button className="btn-battle" onClick={startDuel} disabled={!canStart}>
                  ⚔️ {t('xduel.cta')} →
                </button>
              </div>
              {/* Duels are published to the vote feed, so say so before the
                  user commits: a small * line under the buttons (owner,
                  Oct 19). */}
              <p className="xduel-public">* {t('xduel.publichint')}</p>
              {refiner.preview}

              {/* Other people's duels of this type to vote on (XVote's
                  feed, folded in Oct 17 in place of the 熱門 starters). */}
              <VoteFeed mode={mode} recipe={mode === 'video' ? recipe : mode === 'audio' ? audioKind : null} />
              </>
            </div>
          )}

          {/* ── STEPS 2/3/4: arena view ── */}
          {(step === 2 || step === 3 || step === 4) && (
            <div className="step-section">
              {/* Error state */}
              {apiError && (
                <div style={{background:'rgba(232,69,60,0.1)',border:'1px solid rgba(232,69,60,0.4)',borderRadius:6,padding:'16px 20px',marginBottom:24,fontFamily:'var(--mono)',fontSize:13,color:'var(--red)'}}>
                  ⚠️ {errText(apiError)}
                  <button className="btn-secondary" style={{marginLeft:16}} onClick={() => { setAddress(null); goStep(1) }}>← {t('xduel.err.tryagain')}</button>
                </div>
              )}

              {/* Battle cards — responsive grid */}
              <div className="battle-arena" style={{
                gridTemplateColumns: `repeat(${models.length || count}, 1fr)`
              }}>
                {(loading ? Array(count).fill(null) : models).map((m: ModelState | null, i: number) => {
                  const isVoted   = currentVote === i
                  const isOther   = currentVote !== null && currentVote !== 'T' && currentVote !== i
                  const cheapest  = i === cheapestIdx
                  const cardColor    = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                  const cardColorHex = i === 0 ? '#4a9eff' : i === 1 ? '#e8453c' : i === 2 ? '#a78bfa' : '#34d399'
                  return (
                    <div key={i}
                      className={`battle-card ${isVoted?'voted-this':''} ${isOther?'voted-other':''} ${phase==='revote' && vote1===i ? 'blind-pick' : ''}`}
                      onMouseEnter={() => setCursor(cardColorHex)}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                      <div className={`battle-card-header ${mode==='image'?'image-mode':''} n${models.length || count}`}>
                        <div className="battle-model-id" style={{color: cardColor}}>Model {LABELS[i]}</div>
                        {/* Anchored to the card rather than a separate strip:
                            the blind pick is a fact ABOUT this model, and
                            saying it here removes the duplicate row that
                            used to sit under the arena.
                            BOTH badges are always in the DOM and merely
                            hidden — mounting them at reveal re-flowed the
                            header and jumped the response time sideways at
                            the exact moment the user was reading it. The
                            slot is sized by the widest badge on either card
                            from the first paint, so nothing moves. (CC) */}
                        <div className="xd-badge-slot">
                          <span
                            className={`xd-badge pick ${phase === 'revote' && vote1 === i ? '' : 'is-ghost'}`}
                            style={{ background: cardColor }}
                            aria-hidden={!(phase === 'revote' && vote1 === i)}
                          >{t('xduel.badgepick')}</span>
                          <span
                            className={`xd-badge best ${showPrices && cheapest && models.length > 1 ? '' : 'is-ghost'}`}
                            aria-hidden={!(showPrices && cheapest && models.length > 1)}
                          >{t('xduel.badgebest')}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          {m?.done && bothDone && (
                            <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted2)',opacity:1,transition:'opacity 0.3s'}}>
                              ⏱ {(m.responseTime/1000).toFixed(2)}s
                              {(() => {
                                const pct = fasterPct(m)
                                if (pct !== null) {
                                  return <span style={{marginLeft:4,fontSize:9,color:cardColor}}>⚡ {t('xd.faster').replace('{pct}', String(pct))}</span>
                                }
                                return null
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                      {showPrices && m && (
                        <div style={{
                          padding:'8px 16px',
                          background: cheapest ? 'rgba(0,200,150,0.08)' : 'rgba(232,69,60,0.08)',
                          borderBottom:'1px solid var(--border)',
                          fontFamily:'var(--font-mono)',
                          fontSize:13,
                          fontWeight:700,
                          color: cheapest ? '#34d399' : 'var(--red)',
                          textAlign:'center',
                          transition:'opacity 0.5s',
                          // One line on every card (owner, Oct 18: with 4 models
                          // "more expensive" fell to a second line). Four cards
                          // drop the cheapest / more-expensive words: the colour
                          // and the 最佳價格 badge already say it.
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        }}>
                          {m.meta.unitLabel ?? m.meta.priceLabel}
                          {/* What this run actually cost. The rate alone
                              never answered "so what did I just spend?" */}
                          <span style={{marginLeft:8,fontSize:11,fontWeight:600,opacity:0.85}}>
                            · {t('xduel.total')} {fmtSpend(m.cost)}
                          </span>
                          {cheapest && models.length === 2 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💰 {t('xd.cheapest')}</span>}
                          {!cheapest && models.length === 2 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💸 {t('xd.pricier')}</span>}
                        </div>
                      )}
                      <div className={`battle-response ${loading||!m?'loading':''} ${(mode==='image'||mode==='video')?'image-response':''}`}>
                        {loading || !m
                          ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>
                          : m?.errorMessage
                          ? <div style={{
                              display:'flex',
                              flexDirection:'column',
                              alignItems:'center',
                              justifyContent:'center',
                              padding:'40px 24px',
                              gap:12,
                              color:'var(--red)',
                              textAlign:'center',
                            }}>
                              <div style={{fontSize:28,lineHeight:1}}>⚠️</div>
                              <div style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,letterSpacing:1,textTransform:'uppercase',opacity:0.8}}>{t('xd.failed')}</div>
                              <div style={{fontSize:13,lineHeight:1.5,maxWidth:460,color:'var(--muted)',wordBreak:'break-word'}}>{errText(m.errorMessage)}</div>
                              {m.errorRef && (
                                <div title={m.errorRef} style={{fontSize:10,marginTop:6,color:'var(--muted)',fontFamily:'var(--font-mono), monospace',letterSpacing:'0.05em',userSelect:'all'}}>
                                  Ref: {m.errorRef.slice(0, 8)}
                                </div>
                              )}
                            </div>
                          : m.isAudio && m.text
                          ? <div className="xduel-audio"><audio src={m.text} controls preload="auto" /></div>
                          : m.isVideo && m.text
                          ? <video src={m.text} autoPlay loop muted playsInline controls style={{display:'block'}} />
                          : m.isImage && m.text
                          ? <img src={m.text} alt="Generated" onClick={() => setLightbox(m.text)} style={{borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : (m.isImage || m.isVideo || m.isAudio) && !m.text
                          ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'60px 20px',color:'var(--muted2)',fontSize:13,gap:8}}>
                              <div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/>
                              <span style={{marginLeft:8}}>{t(m.isImage ? 'xd.generating.image' : m.isAudio ? (audioKind === 'text_to_music' ? 'xd.generating.music' : 'xd.generating.audio') : 'xd.generating.video')}</span>
                            </div>
                          : <><div className="markdown-body"><ReactMarkdown skipHtml remarkPlugins={REMARK_PLUGINS} components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{m.text}</ReactMarkdown></div>{m.streaming && <span className="stream-cursor">▋</span>}</>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Stats row — response time + cost, one column per model */}
              {bothDone && (
                <div className="stats-row" style={{gridTemplateColumns:`repeat(${models.length},1fr)`}}>
                  {models.map((m, i) => {
                    const cheapest  = i === cheapestIdx
                    const cardColor = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                    const pct       = fasterPct(m)
                    return (
                      <div key={i} className="stats-cell">
                        <div className="stats-line">
                          <span className="stats-label">{t('xd.responsetime')}</span>
                          <span className="stats-value" style={{color: cardColor}}>
                            {(m.responseTime / 1000).toFixed(2)}s
                            {pct !== null && (
                              <span style={{marginLeft:6,fontSize:9,letterSpacing:'0.1em',color:cardColor}}>⚡ {t('xd.faster').replace('{pct}', String(pct))}</span>
                            )}
                          </span>
                        </div>
                        {showPrices && (
                          <div className="stats-line" style={{animation:'slideDown 0.35s ease forwards'}}>
                            <span className="stats-label">{t('xd.price')}</span>
                            <span className="stats-value" style={{display:'flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>
                              {/* Four narrow cards: the rate and total are in the
                                  price strip above each card, so this line keeps
                                  only the comparison and stays on one line. */}
                              {models.length === 2 && <>
                              <span style={{color: cheapest ? '#34d399' : 'var(--muted2)'}}>
                                {m.meta.unitLabel ?? m.meta.priceLabel}
                              </span>
                              <span style={{color:'var(--muted2)',opacity:0.9}}>
                                · {t('xduel.total')} {fmtSpend(m.cost)}
                              </span>
                              </>}
                              {/* Both badges compare LIST prices (meta.outputPrice), the same
                                  number priceLabel renders immediately to the left and the same
                                  basis step 5 uses for "Nx cheaper". They used to compare
                                  m.cost -- this run's actual spend, which includes reasoning
                                  tokens -- so a 4x list-price gap was labelled "92% cheaper"
                                  next to "$2.50 / 1M", contradicting step 5 in the same flow. */}
                              {cheapest && models.length > 1 && (() => {
                                const maxOther = Math.max(...models.filter((_, j) => j !== i).map(o => o.meta.outputPrice))
                                const mine = m.meta.outputPrice
                                if (maxOther > mine && maxOther > 0) {
                                  const savingPct = Math.round((maxOther - mine) / maxOther * 100)
                                  return <span style={{fontSize:9,color:'#34d399',letterSpacing:'0.1em'}}>💰 {t('xd.cheaperpct').replace('{pct}', String(savingPct))}</span>
                                }
                                return null
                              })()}
                              {!cheapest && models.length > 1 && (() => {
                                // "X% more expensive" is relative to the CHEAPER baseline, not to
                                // my own price -- dividing by myCost capped the figure below 100%
                                // and printed the exact same number as the "cheaper" badge, which
                                // cannot be true of both framings. Past 2x, "Nx the price" reads
                                // clearer than "300% more expensive".
                                const base = cheapestModel ? cheapestModel.meta.outputPrice : 0
                                const mine = m.meta.outputPrice
                                if (mine > base && base > 0) {
                                  const times = mine / base
                                  const label = times >= 2
                                    ? t('xd.timesprice').replace('{x}', String(times >= 10 ? Math.round(times) : Math.round(times * 10) / 10))
                                    : t('xd.morepct').replace('{pct}', String(Math.round((mine - base) / base * 100)))
                                  return <span style={{fontSize:9,color:'var(--red)',letterSpacing:'0.1em'}}>{label}</span>
                                }
                                return null
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── The trade-off, on one axis (CC, July 29) ─────────────
                  Speed left, price right, widths tracking the real spread.
                  But a "vs" bar is a lie when one model wins BOTH axes —
                  the first live duel threw up Model A as faster AND 88%
                  cheaper, and splitting that into two opposing bars invents
                  a tension that isn't there. When there's no trade-off we
                  say so in one line instead. */}
              {phase === 'revote' && spreadPct !== null && (() => {
                const noTradeoff = fastestIdx === cheapestIdx || speedPct === null
                if (noTradeoff) {
                  return (
                    <div className="xd-vs solo">
                      <div className="xd-vs-claim">
                        {speedPct !== null && fastestIdx === cheapestIdx
                          ? t('xduel.rv.bothwin').replace('{l}', LABELS[cheapestIdx]).replace('{p}', String(spreadPct)).replace('{s}', String(speedPct))
                          : t('xduel.rv.cheaper').replace('{l}', LABELS[cheapestIdx]).replace('{p}', String(spreadPct))}
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="xd-vs">
                    <span className="xd-vs-side left">
                      {t('xduel.rv.faster').replace('{l}', LABELS[fastestIdx]).replace('{p}', String(speedPct))}
                    </span>
                    <div className="xd-vs-mid">
                      <div className="xd-vs-claim">
                        {t('xduel.rv.cheaper').replace('{l}', LABELS[cheapestIdx]).replace('{p}', String(spreadPct))}
                      </div>
                      <div className="xd-vs-track">
                        <span className="xd-vs-fill speed" style={{ width: `${Math.max(8, Math.min(60, speedPct))}%` }} />
                        <span className="xd-vs-pin">vs</span>
                        <span className="xd-vs-fill price" style={{ width: `${Math.max(8, Math.min(60, spreadPct))}%` }} />
                      </div>
                    </div>
                    <span className="xd-vs-side right">
                      {models[fastestIdx] ? `${(models[fastestIdx].responseTime/1000).toFixed(2)}s` : ''}
                    </span>
                  </div>
                )
              })()}

              {phase === 'revote' && (
                <div className="xd-q2">{t('xduel.q2')}</div>
              )}

              {/* Vote row — A | ... | Tie | ... | B */}
              {/* Columns: half the vote buttons, TIE, the other half —
                  sized to the model count (2–4, CC July 19). */}
              <div
                className={`vote-row${phase === 'revote' ? ' is-revote' : ''}`}
                style={{
                  gridTemplateColumns: `repeat(${Math.ceil((models.length || count) / 2)}, 1fr) auto repeat(${Math.floor((models.length || count) / 2)}, 1fr)`,
                }}
              >
                {(() => {
                  const total = models.length || count
                  const half = Math.ceil(total / 2)
                  const allLabels = LABELS.slice(0, total)
                  const left = allLabels.slice(0, half)
                  const right = allLabels.slice(half)
                  const cardColorHex2 = (i: number) => i === 0 ? '#4a9eff' : i === 1 ? '#e8453c' : i === 2 ? '#a78bfa' : '#34d399'
                  // In the informed round a button is no longer "X is
                  // better" — it is "keep the one you already chose" or
                  // "switch, and here is what that costs". Putting the price
                  // delta on the button itself is the whole product thesis
                  // in one control.
                  const priceOf = (i: number) => models[i]?.meta?.outputPrice
                  const deltaLabel = (i: number) => {
                    if (phase !== 'revote' || typeof vote1 !== 'number') return null
                    const a = priceOf(vote1), b = priceOf(i)
                    if (typeof a !== 'number' || typeof b !== 'number' || a === b) return null
                    const cheaper = b < a
                    return { cheaper, text: `${cheaper ? '−' : '+'}${Math.abs(((b - a) / (a || 1)) * 100).toFixed(0)}%` }
                  }
                  const makeBtn = (label: string, i: number) => {
                    const cardColor = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                    const voted = currentVote === i
                    const isStick = phase === 'revote' && vote1 === i
                    const d = deltaLabel(i)
                    return (
                      <button
                        key={i}
                        className={`btn-vote ${voted ? 'voted' : ''} ${isStick ? 'is-stick' : ''} ${!isStick && phase === 'revote' && d?.cheaper ? 'is-save' : ''}`}
                        style={voted
                          ? {borderColor: cardColor, color: cardColor, background: `${cardColor}18`}
                          : isStick
                            ? {borderColor: cardColor, color: cardColor, '--hover-color': cardColor} as React.CSSProperties
                            : {'--hover-color': cardColor} as React.CSSProperties}
                        onClick={() => phase==='vote' ? castVote(i) : castRevote(i)}
                        disabled={!bothDone || currentVote !== null}
                        onMouseEnter={() => setCursor(cardColorHex2(i))}
                        onMouseLeave={() => setCursor('#e8453c')}
                      >
                        {voted
                          ? t('xduel.picked').replace('{l}', label)
                          : phase === 'revote'
                            // The price row above already states every number.
                            // The button only names the decision. ·B1
                            ? (isStick
                                ? t('xduel.stickwith').replace('{l}', label)
                                : t('xduel.switchto').replace('{l}', label))
                            : t('xduel.isbetter').replace('{l}', label)}
                      </button>
                    )
                  }
                  return <>
                    {left.map((label, i) => makeBtn(label, i))}
                    <button
                      className={`btn-tie ${currentVote==='T'?'voted':''}`}
                      onClick={() => phase==='vote' ? castVote('T') : castRevote('T')}
                      disabled={!bothDone || currentVote !== null}
                      onMouseEnter={() => setCursor('#888888')}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                  {currentVote==='T' ? t('xd.tied') : phase === 'revote' ? '⚖ ' + t('xduel.eithernow') : t('xd.tie')}
                    </button>
                    {right.map((label, i) => makeBtn(label, half + i))}
                  </>
                })()}
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {loading
                    ? t('xd.connecting')
                    : anyStreaming
                    ? t('xduel.responding')
                    : phase==='vote'
                    ? t('xduel.pickhint')
                    : t('xduel.finalvote')}
                </span>
                {phase==='vote' && bothDone && (
                  viewer === 'owner' && <button className="btn-secondary" onClick={() => { setAddress(null); goStep(1) }}>← {t('xduel.changeprompt')}</button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5: Reveal ── */}
          {step === 5 && (
            <div className="step-section">
              <div className="xduel-report" style={{
                opacity: showReveal ? 1 : 0,
                transform: showReveal ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}>
                {(() => {
                  // 傳說對決-style match report — per-run scores from
                  // lib/matchScore.ts (vote-heavy 60/20/20), MVP = top score.
                  const scores = computeMatchScores(models.map((m, i) => ({
                    votePts:      duelVotePts(i, vote1, vote2),
                    responseTime: m.responseTime,
                    cost:         m.cost,
                    error:        !!m.errorMessage,
                  })))
                  const winnerIdx  = typeof vote2 === 'number' ? vote2 : null
                  const winnerName = winnerIdx !== null ? models[winnerIdx]?.meta.name : null
                  return (
                    <MatchResult
                      eyebrow={t('xd.report.eyebrow')}
                      title={winnerName ? t('xd.report.wins').replace('{name}', winnerName) : t('xd.report.tie')}
                      winnerProvider={winnerIdx !== null ? models[winnerIdx]?.meta.provider : null}
                      entries={models.map((m, i) => ({
                        name:         m.meta.name,
                        provider:     m.meta.provider,
                        score:        scores[i],
                        responseTime: m.responseTime,
                        cost:         m.cost,
                        isPick:       winnerIdx === i,
                        error:        !!m.errorMessage,
                        priceLabel:   m.meta.unitLabel ?? m.meta.priceLabel,
                        searches:     m.searches,
                        note: (i === cheapestIdx
                          ? (monthly > 0
                              ? t('xd.report.cheaper').replace('{emoji}', savingsEmoji).replace('{ratio}', String(ratio)).replace('{amount}', monthly.toLocaleString())
                              : t('xd.report.sameprice'))
                          : t(monthly > 0 ? 'xd.report.pricier' : 'xd.report.same'))
                          + (timeSaved?.idx === i ? '\n' + timeSaved.line : ''),
                        // What the savings are counted over, inside the card
                        // that shows them (owner, Oct 19).
                        foot: (i === cheapestIdx && monthly > 0) || (timeSaved?.idx === i && timeSaved.scaled)
                          ? t('xd.report.basis').replace('{basis}', monthlyLabel)
                          : undefined,
                      }))}
                    />
                  )
                })()}
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {t(userChoseCheaper ? 'xd.hint.smart' : vote2 === 'T' ? 'xd.hint.tie' : 'xd.hint.pricier')}
                </span>
                <button className="btn-next" onClick={() => { clearState(); setAddress(null, mode); goStep(1) }}>{t('xd.next')}</button>
              </div>
            </div>
          )}

        </div>
      </div>
      </div>
    </>
  )
}
