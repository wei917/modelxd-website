'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import ModeIcon from '../components/ModeIcon'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import ReactMarkdown from 'react-markdown'
import { attachSampleFile, commitAttachments, type Attachment } from '../components/AttachmentButton'
import LabeledSlotsPicker from '../components/LabeledSlotsPicker'
import TemplatePicker from '../components/TemplatePicker'
import { SAMPLES_BASE, type Template } from '../xcreate/templates'
import MatchResult, { type RatingDelta } from '../components/MatchResult'
import GameDuel from './GameDuel'
import { computeMatchScores, duelVotePts } from '../../lib/matchScore'
import { usePageTitle } from '../../lib/PageTitleContext'
import { isSubmitEnter } from '../../lib/ime'
import { downloadUrl } from '@/lib/download-url'

type Vote = number | 'T' | null   // index of chosen model, or 'T' for tie
type Mode = 'text' | 'image' | 'video'

// Popular starter prompts, per mode (CC, July 19) — the XDuel analog of
// XCreate's popular templates. Clicking a chip fills the prompt box;
// chips marked needsImage want a photo attached (image_to_image / i2v).
const POPULAR_PROMPTS: Record<Mode, { label: string; prompt: string; needsImage?: boolean; sampleUrl?: string; sampleName?: string }[]> = {
  text: [
    { label: '9.9 vs 9.11',       prompt: 'Which number is bigger: 9.9 or 9.11? Explain your reasoning.' },
    { label: 'Explain like I\'m 5', prompt: 'Explain how airplanes stay in the air to a 5-year-old.' },
    { label: 'Monday haiku',      prompt: 'Write a haiku about Monday mornings.' },
    // Auto-attaches the bundled public-domain novel (CC, July 19) — a
    // real summarization stress test (~38k tokens per model).
    { label: 'Summarization', prompt: 'Summarize this novel in three paragraphs, then give one insight most readers miss.', sampleUrl: `${SAMPLES_BASE}/alice-in-wonderland.txt`, sampleName: 'alice-in-wonderland.txt' },
  ],
  image: [
    { label: 'Remove background people', needsImage: true, prompt: 'Remove the people in the background of my photo. Keep the main subject and everything else exactly the same.' },
    { label: 'Ghibli style',             needsImage: true, prompt: 'Turn my photo into a Studio Ghibli-style illustration. Keep the composition and subjects recognizable.' },
    { label: 'Neon sign text',           prompt: "A photorealistic neon sign at night that says 'MODEL XD', glowing pink and blue, reflected on a rain-slicked street." },
    { label: 'Astronaut on a horse',     prompt: 'A hyper-realistic photo of an astronaut riding a white horse on the moon, Earth glowing in the black sky.' },
  ],
  video: [
    { label: 'Make my photo move', needsImage: true, prompt: 'Bring this photo to life with natural, subtle motion. Keep the subject exactly the same.' },
    { label: 'Wave at the camera', needsImage: true, prompt: 'Make the person in this photo smile and wave at the camera naturally.' },
    { label: 'Glass fruit ASMR',   prompt: 'ASMR video: a knife slowly slices a translucent glass apple on a wooden cutting board, crisp crystal sounds, macro shot.' },
    { label: 'Surfing dog',        prompt: 'A golden retriever surfing a big wave, cinematic slow motion, golden hour light.' },
    { label: 'Storm timelapse',    prompt: 'A timelapse of a thunderstorm rolling over a mountain range at dusk, lightning flashing inside the clouds.' },
  ],
}
// XCreate-style popular cards (CC, July 20): the chips row is rendered
// with the same TemplatePicker card gallery XCreate uses, so both pages'
// "Popular" sections look identical. Cards are derived from
// POPULAR_PROMPTS; emoji/subtitle per label.
const POPULAR_CARD_META: Record<string, { emoji: string; subtitle: string }> = {
  '9.9 vs 9.11':             { emoji: '🔢', subtitle: 'A classic reasoning trap' },
  "Explain like I'm 5":      { emoji: '🧒', subtitle: 'How do airplanes fly?' },
  'Monday haiku':            { emoji: '✍️', subtitle: 'A tiny writing duel' },
  'Summarization': { emoji: '📖', subtitle: 'Auto-attaches the book (.txt)' },
  'Remove background people': { emoji: '🧹', subtitle: 'Uses your photo' },
  'Ghibli style':            { emoji: '🎨', subtitle: 'Uses your photo' },
  'Restore old photo':       { emoji: '🖼️', subtitle: 'Uses your photo' },
  'Neon sign text':          { emoji: '💡', subtitle: 'Can they spell it right?' },
  'Astronaut on a horse':    { emoji: '🧑‍🚀', subtitle: 'The classic benchmark' },
  'Make my photo move':      { emoji: '📷', subtitle: 'Uses your photo' },
  'Wave at the camera':      { emoji: '👋', subtitle: 'Uses your photo' },
  'Glass fruit ASMR':        { emoji: '🍏', subtitle: 'Macro + sound design' },
  'Surfing dog':             { emoji: '🐕', subtitle: 'Cinematic slow motion' },
  'Storm timelapse':         { emoji: '⛈️', subtitle: 'Lightning in the clouds' },
}
const POPULAR_PREVIEW_OVERRIDE: Record<string, string> = {
  // Reuse XCreate's existing thumbnails where the task is the same.
  '9.9 vs 9.11':              '/templates/text-decimals.jpg',
  'Remove background people': '/templates/tool-remove-background.jpg',
  'Ghibli style':             '/templates/style-watercolor-anime.jpg',
}
const POPULAR_CARDS: Record<Mode, Template[]> = (['text','image','video'] as Mode[]).reduce((acc, m) => {
  acc[m] = POPULAR_PROMPTS[m].map(p => ({
    id:            'xduel-' + p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    emoji:         POPULAR_CARD_META[p.label]?.emoji ?? '⚔️',
    title:         p.label,
    subtitle:      POPULAR_CARD_META[p.label]?.subtitle ?? p.prompt,
    mode:          m,
    slotMode:      '',
    starterPrompt: p.prompt,
    kind:          'tool' as const,
    previewUrl:    POPULAR_PREVIEW_OVERRIDE[p.label]
                     ?? '/templates/xduel-' + p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.jpg',
    recommendedModels: [],
    attachmentSlots: [],
  }))
  return acc
}, {} as Record<Mode, Template[]>)

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

export default function XDuel() {
  useRequireAuth()
  const t = useT()
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [step,       setStep]       = useState(1)
  const [mode,       setMode]       = useState<Mode>('image')  // visual wow, sustainable cost
  // GAME task type (owner, Aug 6): blind game duels. Not a prompt mode —
  // selecting it swaps the composer for the match launcher; the duel arc
  // (watch → judge → reveal) plays out on the game's own page. The chip
  // only shows for users who'd pass the /xgame gate anyway.
  const [gameArena,  setGameArena] = useState(false)
  // Was gated on a feature flag ('xtalk') that stopped existing when those
  // betas ended — /api/features never returned it again, so the Game chip
  // was invisible to EVERYONE from Aug 18 to Aug 24. XGame is open; so is
  // the chip. (Same class of bug as the vanished profile tabs.)
  const canGame = true
  const [count,      setCount]      = useState(2)
  const [duelId,     setDuelId]     = useState<string | null>(null)
  const [prompt,     setPrompt]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [apiError,   setApiError]   = useState<string | null>(null)
  const [models,     setModels]     = useState<ModelState[]>([])
  // XDRating movement for the match report (step 5). undefined = fetching,
  // null = unavailable (tie / refit throttled / error) — chip hides.
  const [duelDelta,  setDuelDelta]  = useState<RatingDelta | null | undefined>(undefined)
  // XBoard rows captured BEFORE the blind vote lands — the report's delta
  // must cover the WHOLE duel (both votes), not just the informed vote.
  // Without this, vote1's refit is already priced in by the time the
  // report reads "before" and the chip shows a misleading partial delta.
  const preDuelRatingsRef = useRef<any[] | null>(null)
  const [vote1,      setVote1]      = useState<Vote>(null)
  const [lightbox,   setLightbox]   = useState<string | null>(null)
  const [vote2,      setVote2]      = useState<Vote>(null)
  const [phase,      setPhase]      = useState<ArenaPhase>('vote')
  const { setOverride } = usePageTitle()
  const [showPrices, setShowPrices] = useState(false)
  const [showReveal, setShowReveal] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // Set when a clicked popular-prompt chip wants a photo and none is attached.
  const [chipNeedsImage, setChipNeedsImage] = useState(false)
  const [attachingSample, setAttachingSample] = useState(false)
  // Which popular card is highlighted (XCreate-style selected ring).
  const [popularId, setPopularId] = useState<string | null>(null)

  // Daily XDuel quota state. XDuel is free for users but ModelXD pays
  // the provider bills — so the server caps usage per mode per UTC day.
  // We mirror the cap in the UI so users see "1 / 3 image XDuels used
  // today" before clicking Start. Refetched after each successful run
  // and after a 429.
  type Quota = {
    limits: { text: number; image: number; video: number }
    used:   { text: number; image: number; video: number }
  }
  const [quota, setQuota] = useState<Quota | null>(null)
  // If the remaining quota can't cover the selected count (cost =
  // count - 1), fall back to the biggest affordable count.
  useEffect(() => {
    if (!quota) return
    const left = Math.max(0, quota.limits[mode] - quota.used[mode])
    if (count - 1 > left) setCount(Math.max(2, Math.min(4, left + 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quota, mode])
  const fetchQuota = async () => {
    try {
      const r = await fetch('/api/xduel/quota')
      if (!r.ok) return
      const j = await r.json()
      setQuota({ limits: j.limits, used: j.used })
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
      const a0 = committed[0]
      const res = await fetch('/api/xduel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, count, attachment: a0 ? { storagePath: a0.storagePath, bucket: a0.bucket, mediaType: a0.mediaType, fileName: a0.fileName, fileSize: a0.fileSize } : null }),
      })

      if (!res.ok || !res.body) {
        // Try to parse a structured JSON error first so we can show a
        // friendlier message for known cases (quota, unverified email).
        const text = await res.text()
        let parsed: { error?: string; message?: string; mode?: string; limit?: number } | null = null
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }
        if (res.status === 429 && parsed?.error === 'daily_limit_reached') {
          throw new Error(parsed.message ?? `Daily free ${parsed.mode ?? ''} XDuel limit reached. Resets at UTC midnight.`)
        }
        if (res.status === 403 && parsed?.error === 'email_not_verified') {
          throw new Error(parsed.message ?? 'Please verify your email before using XDuel.')
        }
        throw new Error(text || `Server error ${res.status}`)
      }

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
                if (payload.duelId) setDuelId(payload.duelId)
                // Initialize slots with model info from meta (includes price data)
                const initialModels: ModelState[] = payload.models.map((pm: any) => ({
                  meta: {
                    id:          pm.id ?? '',
                    name:        pm.name,
                    provider:    pm.provider,
                    outputPrice: pm.outputPrice ?? 0,
                    priceLabel:  pm.priceLabel ?? '…',
                    unitLabel:   pm.priceLabel ?? undefined,
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
                // Worker picked a model — update that slot's meta
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? { ...m, meta: { id: payload.id ?? '', name: payload.name, provider: payload.provider, outputPrice: payload.outputPrice, priceLabel: payload.priceLabel, unitLabel: payload.priceLabel }, text: '', streaming: true, done: false } : m
                ))

              } else if (currentEvent.startsWith('delta:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? {
                    ...m,
                    text: payload.text != null ? (payload.isImage || payload.isVideo ? payload.text : m.text + payload.text) : m.text,
                    isImage: payload.isImage ?? m.isImage,
                    isVideo: payload.isVideo ?? m.isVideo,
                  } : m
                ))

              } else if (currentEvent.startsWith('done:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) => {
                  if (i !== idx) return m
                  const realCost = payload.cost != null ? Number(payload.cost) : m.isImage ? m.meta.outputPrice : (payload.tokens / 1_000_000) * m.meta.outputPrice
                  // Update priceLabel to reflect actual cost
                  const realPriceLabel = m.isImage
                    ? `$${parseFloat(realCost.toFixed(4))} / image`
                    : m.isVideo
                    ? `$${parseFloat(realCost.toFixed(4))} / video`
                    : m.meta.priceLabel
                  // Image/video models that are token-billed (e.g. gpt-image-2)
                  // have a headline outputPrice of 0 because calcImageCost
                  // can't compute without a usage block. Once the real cost
                  // comes back from the API, fold it back into meta.outputPrice
                  // so the reveal-page savings math (cheapest vs most expensive)
                  // has the actual numbers to work with. For text models, keep
                  // outputPrice as the per-1M-token rate from the catalog.
                  const realOutputPrice = (m.isImage || m.isVideo) && realCost > 0
                    ? realCost
                    : m.meta.outputPrice
                  return {
                    ...m,
                    tokens:       payload.tokens,
                    responseTime: payload.responseTime,
                    cost:         realCost,
                    searches:     Number(payload.searches ?? 0),
                    meta:         { ...m.meta, priceLabel: realPriceLabel, outputPrice: realOutputPrice },
                    streaming:    false,
                    done:         true,
                  }
                }))

              } else if (currentEvent === 'end') {
                // A duel with a failed slot refunds the quota server-side
                // (July 19). Tell the user plainly — no provider details.
                if (payload?.refunded) {
                  setApiError('One of the models could not finish, so this duel did not count against your free quota. Feel free to try again.')
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
                        errorMessage: payload.message || 'Unknown error',
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
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

  const castVote = (choice: Vote) => {
    setVote1(choice)
    // Snapshot ratings before this duel's first vote can trigger a refit.
    fetch(`/api/xboard?mode=${mode}`).then(r => r.json())
      .then(rows => { preDuelRatingsRef.current = rows })
      .catch(() => { preDuelRatingsRef.current = null })
    setTimeout(() => { setShowPrices(true); setPhase('revote'); setStep(4) }, 500)
    if (duelId) fetch('/api/xduel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId,
        vote1: choice === 'T' ? 'T' : String(choice),
        vote1ModelId: choice === 'T' ? null : models[choice as number]?.meta?.id ?? null,
      }),
    }).catch(console.error)
  }

  const castRevote = (choice: Vote) => {
    setVote2(choice)
    const winnerId = choice === 'T' ? null : models[choice as number]?.meta?.id ?? null
    setDuelDelta(winnerId ? undefined : null)
    ;(async () => {
      try {
        // Before-rating for the winner, then vote → refit → after-rating.
        // See docs/xdrating-pipeline.md (true delta is fine at current
        // volume; switch to an Elo-style display delta if refits start
        // coalescing post-launch).
        let before: number | null = null
        if (winnerId) {
          // Prefer the pre-duel snapshot (covers both votes); fall back to
          // a live read (covers only vote2) if the early fetch failed.
          const rows = preDuelRatingsRef.current
            ?? await fetch(`/api/xboard?mode=${mode}`).then(r => r.json())
          before = rows?.find((r: any) => r.modelId === winnerId)?.xdScore ?? null
        }
        if (duelId) await fetch('/api/xduel/vote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            duelId,
            vote2: choice === 'T' ? 'T' : String(choice),
            vote2ModelId: winnerId,
          }),
        })
        if (!winnerId) return
        await fetch('/api/xdrating/refit?source=vote&force=1', { method: 'POST' })
        const rows = await fetch(`/api/xboard?mode=${mode}`).then(r => r.json())
        const after = rows.find((r: any) => r.modelId === winnerId)?.xdScore ?? null
        setDuelDelta(before !== null && after !== null ? { before, after } : null)
      } catch (err) {
        console.warn('[xduel] rating delta unavailable:', err)
        setDuelDelta(null)
      }
    })()
    setTimeout(() => {
      goStep(5)
      setTimeout(() => setShowReveal(true), 600)
    }, 600)
  }

  const clearState = (keepPrompt = false) => {
    setVote1(null); setVote2(null); setDuelDelta(undefined)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    setModels([]); setApiError(null)
    if (!keepPrompt) { setPrompt(''); setAttachments([]) }
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
  // text:  savings per 10M tokens
  // image/video: savings per 1000 generations
  const isMediaMode = mode === 'image' || mode === 'video'
  // Remaining free duels for the current mode (XDuel is free-only —
  // paid duels were tried and removed July 19; XCreate is the paid path).
  const quotaLeft = quota ? Math.max(0, quota.limits[mode] - quota.used[mode]) : Infinity
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
    : mode === 'image' ? delta * 2000                 // 2K images
    : delta * 100                                     // 100M tokens
  const monthly = isMediaMode
    ? Math.round(monthlyRaw * 100) / 100
    : Math.round(monthlyRaw)
  const monthlyLabel =
    mode === 'video' ? '1K videos' : mode === 'image' ? '2K images' : '100M tokens'

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
  const fastestIdx = models.length > 0
    ? models.reduce((minI, m, i, arr) => m.responseTime < arr[minI].responseTime ? i : minI, 0)
    : -1
  const speedPct = (() => {
    const times = models.map(m => m.responseTime).filter(n => n > 0)
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

      <div className="xduel-page">
        <div className="arena">

          {/* ── In-page header: "// XDUEL" eyebrow + the step's guiding
              line as the big headline (CC, July 20). ── */}
          <div className="prompt-header">
            <Link href="/xduel" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xduel.eyebrow')}</Link>
            <h1 className="page-headline">
              {step === 1 ? t('xduel.subtitle') :
               step === 5 ? null :
               phase === 'vote'
                ? `"${prompt.substring(0,80)}${prompt.length>80?'…':''}"`
                : revealHeadline}
            </h1>
          </div>

          {/* Step progress bar — a prompt-duel thing; game duels have no
              steps here (their arc lives on the game page). */}
          {!gameArena && <div className="step-bar">
            {STEPS.map((s, i) => (
              <span key={s.n} style={{display:'contents'}}>
                <div className={`step-item ${step===s.n?'active':''} ${step>s.n?'done':''}`}>
                  <div className="step-num">{s.n}</div>{t(s.key)}
                </div>
                {i < STEPS.length-1 && <div className={`step-connector ${step>s.n?'done':''}`} />}
              </span>
            ))}
          </div>}

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="step-section">
              {/* Step-1 composer header — same labeled-column language as
                  XCreate's "Generate: / From:" row (CC redesign, July 19). */}
              <div className="mode-row" style={{ marginBottom: 20 }}>
                <div className="mode-col">
                  <div className="field-label">{t('xduel.tasktype')}</div>
                  <div className="mode-seg">
                    {(['text','image','video'] as Mode[]).map(m => (
                      <button key={m} className={`mode-seg-btn ${mode===m && !gameArena?'active':''}`} onClick={() => {
                        setGameArena(false)
                        setMode(m)
                        setChipNeedsImage(false)
                        setPopularId(null)
                        // Text mode hides the attachment button — clear any
                        // staged attachments so they don't silently submit.
                        if (m === 'text') setAttachments([])
                      }}>
                        <ModeIcon m={m} />{t('mode.' + m)}
                      </button>
                    ))}
                    {canGame && (
                      <button className={`mode-seg-btn ${gameArena?'active':''}`} onClick={() => setGameArena(true)}>
                        <ModeIcon m="game" />{t('mode.game')}
                      </button>
                    )}
                  </div>
                </div>
                {!gameArena && (
                <div className="mode-col">
                  <div className="field-label">{t('xduel.howmany')}</div>
                  <div className="count-selector" style={{ paddingBottom: 0 }}>
                    {[2, 3, 4].map(c => (
                      <button
                        key={c}
                        className={`count-btn ${count === c ? 'active' : ''}`}
                        disabled={c - 1 > quotaLeft}
                        title={c - 1 > quotaLeft ? 'Not enough free duels left today' : `Counts as ${c - 1} duel${c > 2 ? 's' : ''}`}
                        onClick={() => setCount(c)}
                      >
                        {c}
                      </button>
                    ))}
                    <span className="count-note" style={quotaLeft === 0 ? { color: 'var(--red)' } : undefined}>
                      {quota
                        ? quotaLeft === 0
                          ? t('xduel.noneleft').replace('{mode}', t('mode.' + mode))
                          : `${count > 2 ? t('xduel.countsas').replace('{n}', String(count - 1)) : t('xduel.countsas1')} · ${t('xduel.freeleft').replace('{n}', String(quotaLeft)).replace('{mode}', t('mode.' + mode))}`
                        : ''}
                    </span>
                  </div>
                </div>
                )}
              </div>

              {gameArena ? <GameDuel /> : (<>
              {/* XCreate-style framed composer (CC, July 20): upload slot
                  INSIDE the frame above the borderless textarea; the action
                  row (counter + battle button) sits below the box. Text mode
                  accepts documents only (PDF / txt): the router feeds the PDF
                  natively to pdf_to_text-capable models and folds extracted
                  text into the prompt for the rest — keeping the duel fair. */}
              <div className="prompt-box framed">
                <div className="prompt-slots" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
                  <LabeledSlotsPicker
                    slots={[{ label: 'ATTACH', hint: mode === 'text' ? 'Optional — PDF or .txt' : 'Optional' }]}
                    attachments={attachments}
                    onChange={setAttachments}
                    context="xduel"
                    compact
                    accept={mode === 'text'
                      ? 'application/pdf,text/plain'
                      : 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm'}
                  />
                </div>
                <textarea
                  className="prompt-textarea"
                  maxLength={8000}
                  placeholder={t('xduel.ph.' + mode)}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (isSubmitEnter(e, { requireModifier: true })) {
                      e.preventDefault()
                      if (prompt.trim().length >= 3) startDuel()
                    }
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 10, marginBottom: 24 }}>
                <span className="prompt-counter">
                  {prompt.length > 7000
                    ? `${prompt.length.toLocaleString()} / 8,000 — for longer text, attach a .txt file`
                    : approxTokens > 0 ? `~${approxTokens.toLocaleString()} tokens${attachTruncated ? ' (large file — first 200k characters used)' : ''}` : ''}
                </span>
                {/* Duels are published to XVote, so say so before the user
                    commits rather than after. Sits directly beside the CTA so
                    it reads as a condition of pressing it (CC, July 25). */}
                <span className="prompt-counter" style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'right' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20a15.3 15.3 0 0 1 0-20" />
                  </svg>
                  {t('xduel.publichint')}
                </span>
                <button className="btn-battle" onClick={startDuel} disabled={prompt.trim().length < 3}>
                  ⚔️ {t('xduel.cta')} →
                </button>
              </div>

              {/* Popular starter prompts — same card gallery as XCreate's
                  Popular section (TemplatePicker, wrap layout). */}
              <div style={{ marginTop: 36 }}>
                <div className="ms-cap">{t('xcreate.popular')}</div>
                <TemplatePicker
                  templates={POPULAR_CARDS[mode]}
                  selectedId={popularId}
                  disabled={attachingSample}
                  layout="wrap"
                  onClear={() => {
                    setPopularId(null)
                    setPrompt('')
                    setChipNeedsImage(false)
                    setAttachments([])
                  }}
                  onSelect={async card => {
                    const p = POPULAR_PROMPTS[mode].find(x => x.label === card.title)
                    if (!p) return
                    setPopularId(card.id)
                    setPrompt(p.prompt)
                    setChipNeedsImage(!!p.needsImage)
                    // Attachments follow the template (CC, July 20): a card
                    // with a bundled sample replaces whatever is attached;
                    // a text card without one clears the previous sample.
                    // (Image/video cards keep the user's own uploaded photo
                    // - those prompts are meant to run on it.)
                    if (!p.sampleUrl && mode === 'text') setAttachments([])
                    if (p.sampleUrl && !attachments.some(a => a.fileName === p.sampleName)) {
                      // Fetch the bundled sample and attach it like a
                      // user upload (same storage pipeline).
                      setAttachingSample(true)
                      const att = await attachSampleFile(
                        p.sampleUrl, p.sampleName ?? 'sample.txt', 'text/plain', 'xduel',
                      )
                      setAttachingSample(false)
                      if (att) setAttachments([{ ...att, slotIndex: 0 }])
                      else setApiError(`Couldn't load the sample document for "${p.label}". Attach your own file to run this prompt.`)
                    }
                  }}
                />
              </div>
              {chipNeedsImage && attachments.length === 0 && (
                <div className="prompt-chip-hint">{t('xduel.attachhint')}</div>
              )}
              </>)}
            </div>
          )}

          {/* ── STEPS 2/3/4: arena view ── */}
          {(step === 2 || step === 3 || step === 4) && (
            <div className="step-section">
              {/* Error state */}
              {apiError && (
                <div style={{background:'rgba(232,69,60,0.1)',border:'1px solid rgba(232,69,60,0.4)',borderRadius:6,padding:'16px 20px',marginBottom:24,fontFamily:'var(--mono)',fontSize:13,color:'var(--red)'}}>
                  ⚠️ {apiError}
                  <button className="btn-secondary" style={{marginLeft:16}} onClick={() => goStep(1)}>← Try again</button>
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
                                const maxTime = Math.max(...models.map(x => x.responseTime))
                                if (m.responseTime < maxTime) {
                                  const pct = Math.round((maxTime - m.responseTime) / maxTime * 100)
                                  return <span style={{marginLeft:4,fontSize:9,color:cardColor}}>⚡ {pct}% faster</span>
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
                        }}>
                          {m.meta.unitLabel ?? m.meta.priceLabel}
                          {/* What this run actually cost. The rate alone
                              never answered "so what did I just spend?" */}
                          <span style={{marginLeft:8,fontSize:11,fontWeight:600,opacity:0.85}}>
                            · {t('xduel.total')} {fmtSpend(m.cost)}
                          </span>
                          {cheapest && models.length > 1 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💰 cheapest</span>}
                          {!cheapest && models.length > 1 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💸 more expensive</span>}
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
                              <div style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,letterSpacing:1,textTransform:'uppercase',opacity:0.8}}>Generation failed</div>
                              <div style={{fontSize:13,lineHeight:1.5,maxWidth:460,color:'var(--muted)',wordBreak:'break-word'}}>{m.errorMessage}</div>
                              {m.errorRef && (
                                <div title={m.errorRef} style={{fontSize:10,marginTop:6,color:'var(--muted)',fontFamily:'var(--font-mono), monospace',letterSpacing:'0.05em',userSelect:'all'}}>
                                  Ref: {m.errorRef.slice(0, 8)}
                                </div>
                              )}
                            </div>
                          : m.isVideo && m.text
                          ? <video src={m.text} autoPlay loop muted playsInline controls style={{display:'block'}} />
                          : m.isImage && m.text
                          ? <img src={m.text} alt="Generated" onClick={() => setLightbox(m.text)} style={{borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : (m.isImage || m.isVideo) && !m.text
                          ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'60px 20px',color:'var(--muted2)',fontSize:13,gap:8}}>
                              <div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/>
                              <span style={{marginLeft:8}}>Generating{m.isImage ? ' image' : ' video'}…</span>
                            </div>
                          : <><div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{m.text}</ReactMarkdown></div>{m.streaming && <span className="stream-cursor">▋</span>}</>
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
                    const maxTime   = Math.max(...models.map(x => x.responseTime))
                    const pct       = m.responseTime < maxTime ? Math.round((maxTime - m.responseTime) / maxTime * 100) : null
                    return (
                      <div key={i} className="stats-cell">
                        <div className="stats-line">
                          <span className="stats-label">Response Time</span>
                          <span className="stats-value" style={{color: cardColor}}>
                            {(m.responseTime / 1000).toFixed(2)}s
                            {pct !== null && (
                              <span style={{marginLeft:6,fontSize:9,letterSpacing:'0.1em',color:cardColor}}>⚡ {pct}% faster</span>
                            )}
                          </span>
                        </div>
                        {showPrices && (
                          <div className="stats-line" style={{animation:'slideDown 0.35s ease forwards'}}>
                            <span className="stats-label">Price</span>
                            <span className="stats-value" style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{color: cheapest ? '#34d399' : 'var(--muted2)'}}>
                                {m.meta.unitLabel ?? m.meta.priceLabel}
                              </span>
                              <span style={{color:'var(--muted2)',opacity:0.9}}>
                                · {t('xduel.total')} {fmtSpend(m.cost)}
                              </span>
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
                                  return <span style={{fontSize:9,color:'#34d399',letterSpacing:'0.1em'}}>💰 {savingPct}% cheaper</span>
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
                                    ? `${times >= 10 ? Math.round(times) : Math.round(times * 10) / 10}× the price`
                                    : `${Math.round((mine - base) / base * 100)}% more expensive`
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
                  {currentVote==='T' ? '✓ Tied' : phase === 'revote' ? '⚖ ' + t('xduel.eithernow') : '⚖ Tie'}
                    </button>
                    {right.map((label, i) => makeBtn(label, half + i))}
                  </>
                })()}
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {loading
                    ? 'Connecting…'
                    : anyStreaming
                    ? t('xduel.responding')
                    : phase==='vote'
                    ? t('xduel.pickhint')
                    : t('xduel.finalvote')}
                </span>
                {phase==='vote' && bothDone && (
                  <button className="btn-secondary" onClick={() => goStep(1)}>← {t('xduel.changeprompt')}</button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5: Reveal ── */}
          {step === 5 && (
            <div className="step-section">
              <div style={{
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
                      eyebrow={`Duel complete · ${models.length} models · blind → informed`}
                      title={winnerName ? `${winnerName} wins` : "It's a tie"}
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
                        note: i === cheapestIdx
                          ? (monthly > 0
                              ? `${savingsEmoji} ${ratio}× cheaper — an AI-heavy user saves $${monthly.toLocaleString()}/mo (${monthlyLabel})`
                              : '⚖ Same price as the other')
                          : (monthly > 0 ? 'More expensive option' : 'Same price'),
                      }))}
                      ratingDelta={duelDelta}
                    />
                  )
                })()}
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {userChoseCheaper ? 'Smart call. You saved money without sacrificing quality.'
                  : vote2==='T'     ? 'Interesting. The cheaper model held its own.'
                  :                   'The cheaper model was right there. XD.'}
                </span>
                <button className="btn-next" onClick={() => { clearState(true); goStep(1) }}>Next Duel →</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
