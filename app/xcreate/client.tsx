'use client'
// app/xcreate/page.tsx
// Private AI studio:
// 1. Pick up to 4 models + prompt → generate side by side
// 2. Pick one to continue → this is the vote, others dismissed
// 3. Multi-turn chat with chosen model

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { discountFor } from '../../lib/xcreate-discount'
import { normalizeAudioForVideo } from '../../lib/audio-normalize'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { attachSampleFile, commitAttachments, type Attachment } from '../components/AttachmentButton'
import LabeledSlotsPicker from '../components/LabeledSlotsPicker'
import ModeIcon from '../components/ModeIcon'
import TemplatePicker from '../components/TemplatePicker'
import WorkflowCanvas, { type CanvasNode } from '../components/WorkflowCanvas'
import MatchResult, { type RatingDelta, type MatchResultEntry } from '../components/MatchResult'
import { computeMatchScores } from '../../lib/matchScore'
import { downloadFile, downloadName } from '../../lib/download'
import ProviderLogo from '../components/ProviderLogo'
import ModelPickerDialog from '../components/ModelPickerDialog'
import { XCREATE_TEMPLATES, type Template } from './templates'
import { isSubmitEnter } from '../../lib/ime'

type Mode = 'text' | 'image' | 'video'
type Phase = 'setup' | 'generating' | 'picking' | 'chatting' | 'workflow'

// Pricing + capabilities — see docs/ai_models-schema.md.
type TokenRate = number | { default: number; by_level?: Record<string, number> }

interface ModelPricing {
  tokens?: {
    text_input?:    TokenRate
    cached_input?:  TokenRate
    image_input?:   TokenRate
    video_input?:   TokenRate
    audio_input?:   TokenRate
    text_output?:   TokenRate
    image_output?:  TokenRate
    audio_output?:  TokenRate
  }
  per_image?:        Record<string, number>
  per_video_second?: Record<string, number>
  /** $ per web-search call, billed separately from tokens. */
  per_search?:       number
}

type DurationSpec = number[] | { min: number; max: number }

interface OutputModalityConfig {
  /** Video only: this model generates its own audio track. */
  audio?:                   boolean
  sizes?:                   string[]
  aspect_ratios?:           string[]
  /** Per-resolution durations: discrete list OR { min, max } range (video only). */
  durations_by_resolution?: Record<string, DurationSpec>
  /** Available thinking / reasoning levels (e.g. ['minimal','low','high']). */
  thinking_levels?:         string[]
  /** Available image quality tiers (e.g. ['low','medium','high']). Image
   *  models like gpt-image-2 declare them here. */
  qualities?:               string[]
  /** Max outputs per request — image models that can generate N images at once. */
  max_count?:               number
  /** Free-form capability flags. On the TEXT modality, 'web_search' means the
   *  provider's built-in search tool is wired up for this model. */
  capabilities?:            string[]
  /** Set when the model accepts ARBITRARY WxH sizes beyond `sizes` (image
   *  only; gpt-image-2). Presence is the feature flag — the ⚙ panel shows a
   *  free WxH input validated by customSizeError against these bounds. */
  custom_size?:             CustomSizeSpec
}

/** Expand a duration spec to the explicit integer list for runtime use. */
function expandDurations(spec: DurationSpec | undefined): number[] {
  if (!spec) return []
  if (Array.isArray(spec)) return spec
  const out: number[] = []
  for (let i = spec.min; i <= spec.max; i++) out.push(i)
  return out
}
interface OutputConfig {
  text?:  OutputModalityConfig
  image?: OutputModalityConfig
  video?: OutputModalityConfig
  audio?: OutputModalityConfig
}

/** Which top-level mode a `ModelMode` pattern produces. Used to filter the
 *  per-slot Mode picker so a video-mode card only shows video modes, etc.
 *  `reference_frames` is dual-use — it produces an image output when the
 *  model's output_modalities include 'image' (Nano Banana / Gemini 3 Image
 *  with reference shots) and a video output for video-output models. */
function modeMatchesMode(modePattern: string, m: 'text' | 'image' | 'video'): boolean {
  if (m === 'text')  return (
    modePattern === 'text_to_text'  ||
    modePattern === 'image_to_text' ||
    modePattern === 'video_to_text' ||
    modePattern === 'audio_to_text' ||
    modePattern === 'pdf_to_text'
  )
  if (m === 'image') return (
    modePattern === 'text_to_image' ||
    modePattern === 'image_edit'    ||
    modePattern === 'reference_frames'
  )
  if (m === 'video') return (
    modePattern === 'text_to_video' ||
    modePattern === 'image_to_video' ||
    modePattern === 'video_to_video' ||
    modePattern === 'video_edit' ||
    modePattern === 'start_end_frames' ||
    modePattern === 'reference_frames'
  )
  return false
}

/** Human-readable label for a mode pattern (matches the admin form). */
function modeLabel(modePattern: string): string {
  switch (modePattern) {
    case 'text_to_text':     return 'Text → Text'
    case 'image_to_text':    return 'Image → Text'
    case 'video_to_text':    return 'Video → Text'
    case 'audio_to_text':    return 'Audio → Text'
    case 'pdf_to_text':      return 'PDF → Text'
    case 'text_to_image':    return 'Text → Image'
    case 'image_edit':       return 'Image Edit'
    case 'text_to_video':    return 'Text → Video'
    case 'image_to_video':   return 'Image → Video'
    case 'video_to_video':   return 'Video → Video'
    case 'video_edit':       return 'Video + Refs → Video'
    case 'extend_video':     return 'Video → Longer Video'
    case 'start_end_frames': return 'Start + End Frames'
    case 'reference_frames': return 'Reference Frames'
    case 'audio_to_video':   return 'Audio → Video'
    default:                 return modePattern
  }
}

// ── Processing recipes (Layer 2) ─────────────────────────────────────────────
// Each output type (text/image/video) offers a set of "recipes" — one
// ModelMode (input→output pattern). A single recipe applies to the whole run:
// it filters the model picker to models that support it and decides what the
// user uploads (see recipeInputSlots).
interface Recipe {
  id:      ModelMode
  title:   string   // short friendly name
  recipe:  string   // input → output, e.g. "TEXT → IMAGE"
  provide: string   // what the user supplies
}
const RECIPES: Record<Mode, Recipe[]> = {
  text: [
    { id: 'text_to_text',  title: 'Text to Text',  recipe: 'TEXT → TEXT',  provide: 'a prompt' },
    { id: 'image_to_text', title: 'Image to Text', recipe: 'IMAGE → TEXT', provide: '1 image + a prompt' },
    { id: 'pdf_to_text',   title: 'PDF to Text',   recipe: 'PDF → TEXT',   provide: '1 PDF + a prompt' },
    { id: 'video_to_text', title: 'Video to Text', recipe: 'VIDEO → TEXT', provide: '1 video + a question — the model watches it' },
    { id: 'audio_to_text', title: 'Audio to Text', recipe: 'AUDIO → TEXT', provide: '1 audio/MP4 — verbatim transcript with timestamps' },
  ],
  image: [
    { id: 'text_to_image', title: 'Text to Image',  recipe: 'TEXT → IMAGE',  provide: 'a prompt' },
    { id: 'image_edit',    title: 'Image to Image', recipe: 'IMAGE → IMAGE', provide: '1 image + a prompt' },
  ],
  video: [
    { id: 'text_to_video',    title: 'Text to Video',      recipe: 'TEXT → VIDEO',     provide: 'a prompt' },
    { id: 'image_to_video',   title: 'Image to Video',     recipe: 'IMAGE → VIDEO',    provide: '1 image + a prompt' },
    { id: 'video_to_video',   title: 'Transform a Video',  recipe: 'VIDEO → VIDEO',    provide: '1 video + a prompt — restyles the whole clip' },
    { id: 'extend_video',     title: 'Continue a Video',   recipe: 'VIDEO → LONGER',   provide: '1 video + a prompt — the model carries the motion on past the end' },
    { id: 'video_edit',       title: 'Edit a Video',       recipe: 'VIDEO + REFS → VIDEO', provide: '1 video + reference images + a prompt — changes one thing, keeps the rest' },
    { id: 'start_end_frames', title: 'Frames to Video',    recipe: '2 FRAMES → VIDEO', provide: '2 images: first + last' },
    { id: 'reference_frames', title: 'Reference to Video', recipe: 'REFS → VIDEO',     provide: '1–2 portraits + a prompt' },
    { id: 'audio_to_video',   title: 'Audio to Video',     recipe: 'AUDIO → VIDEO',    provide: '1 song (MP3/WAV, up to 15s) + a prompt — the music drives the performance' },
  ],
}


// Input-type icon for the sub-mode menu (superset of ModeIcon: adds
// pdf / frames / references). Same 16px stroke style as ModeIcon.
function InputIcon({ kind }: { kind: 'text' | 'image' | 'video' | 'pdf' | 'frames' | 'references' | 'audio' }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (kind === 'text' || kind === 'image' || kind === 'video') return <ModeIcon m={kind} />
  if (kind === 'audio')  return (<svg {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>)
  if (kind === 'pdf')    return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>)
  if (kind === 'frames') return (<svg {...p}><rect x="2" y="6" width="9" height="12" rx="1"/><rect x="13" y="6" width="9" height="12" rx="1"/></svg>)
  return (<svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>)
}

// recipe id → [input icon, output icon] for the sub-mode menu entries.
const RECIPE_ICONS: Record<string, ['text' | 'image' | 'video' | 'pdf' | 'frames' | 'references' | 'audio', Mode]> = {
  text_to_text:     ['text',       'text'],
  image_to_text:    ['image',      'text'],
  pdf_to_text:      ['pdf',        'text'],
  video_to_text:    ['video',      'text'],
  audio_to_text:    ['audio',      'text'],
  text_to_image:    ['text',       'image'],
  image_edit:       ['image',      'image'],
  text_to_video:    ['text',       'video'],
  image_to_video:   ['image',      'video'],
  video_to_video:   ['video',      'video'],
  video_edit:       ['video',      'video'],
  extend_video:     ['video',      'video'],
  start_end_frames: ['frames',     'video'],
  reference_frames: ['references', 'video'],
  audio_to_video:   ['audio',      'video'],
}

// Upload slots a recipe needs (label + hint). [] = no upload (text_to_*).
function recipeInputSlots(r: ModelMode | null): { label: string; hint?: string }[] {
  switch (r) {
    // END FRAME is genuinely optional (owner, Aug 20): providers accept a
    // first-frame-only run — verified live, Runway/Seedance rendered one.
    // The label says so because the composer renders the picker compact,
    // where hints are only hover tooltips.
    case 'start_end_frames': return [{ label: 'START FRAME', hint: 'Start of the video' }, { label: 'END FRAME (OPTIONAL)', hint: 'Optional — end of the video' }]
    case 'reference_frames': return [{ label: 'REFERENCE 1', hint: 'A person or subject' }, { label: 'REFERENCE 2', hint: 'Optional second subject' }]
    case 'image_edit':
    case 'image_to_video':
    case 'image_to_text':    return [{ label: 'IMAGE', hint: 'Upload an image' }]
    case 'video_edit':       return [
      { label: 'VIDEO',       hint: 'The video to edit (MP4/MOV, 3–60s)' },
      { label: 'REF IMAGE 1', hint: 'Optional — e.g. the new outfit' },
      { label: 'REF IMAGE 2', hint: 'Optional second reference' },
    ]
    case 'video_to_video':
    case 'video_to_text':    return [{ label: 'VIDEO', hint: 'Upload a video' }]
    case 'pdf_to_text':      return [{ label: 'PDF', hint: 'Upload a PDF' }]
    default:                 return []
  }
}

/**
 * Infer the aspect-ratio label (e.g. '16:9', '21:9', '9:16', '1:1') from
 * a pixel size string. Compares the W/H ratio against a candidate list
 * with a small tolerance so e.g. 1536×672 (≈ 2.286) still matches '21:9'
 * (≈ 2.333). Returns null if no candidate is close enough.
 */
function aspectFromSize(size: string | null | undefined): string | null {
  if (!size) return null
  const m = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!m) return null
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
  if (!w || !h) return null
  const r = w / h
  const candidates: Array<[string, number]> = [
    ['1:1',   1],
    ['4:3',   4 / 3],
    ['3:4',   3 / 4],
    ['3:2',   3 / 2],
    ['2:3',   2 / 3],
    ['16:9',  16 / 9],
    ['9:16',  9 / 16],
    ['21:9',  21 / 9],
    ['9:21',  9 / 21],
    ['5:4',   5 / 4],
    ['4:5',   4 / 5],
  ]
  let best: [string, number] | null = null
  let bestDiff = Infinity
  for (const c of candidates) {
    const diff = Math.abs(r - c[1])
    if (diff < bestDiff) { bestDiff = diff; best = c }
  }
  // 5% tolerance — generous enough that 1536×672 → 21:9 still matches.
  return best && bestDiff / best[1] < 0.06 ? best[0] : null
}

/** Human shape for a size pill — '3:2 landscape', '9:16 portrait', 'square'.
 *  Raw WxH pills alone made the picker a guessing game ("which one is
 *  16:9?" — owner, Aug 20). Null for tier-style sizes with no shape. */
function sizeShapeLabel(size: string): string | null {
  const m = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!m) return null
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
  if (!w || !h) return null
  const name = w === h ? 'square' : w > h ? 'landscape' : 'portrait'
  const ar = aspectFromSize(size)
  return ar && ar !== '1:1' ? `${ar} ${name}` : name
}

/** Constraints for models that accept ARBITRARY WxH image sizes, declared
 *  per model in output_config.image.custom_size (data change, no deploy).
 *  gpt-image-2's published rules: multiples of 16, max edge 3840, aspect
 *  ≤3:1, 655,360–8,294,400 total pixels. Returns null when `s` is valid,
 *  else a short human reason. */
type CustomSizeSpec = { multiple?: number; max_edge?: number; max_ratio?: number; min_pixels?: number; max_pixels?: number }
function customSizeError(s: string, spec: CustomSizeSpec): string | null {
  const m = s.match(/^(\d+)x(\d+)$/)
  if (!m) return 'Use WIDTHxHEIGHT, e.g. 1920x1080'
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
  const mult = spec.multiple ?? 16
  if (w % mult !== 0 || h % mult !== 0) return `Each side must be a multiple of ${mult}`
  const edge = spec.max_edge ?? 3840
  if (Math.max(w, h) > edge) return `Max edge is ${edge}px`
  const maxRatio = spec.max_ratio ?? 3
  if (Math.max(w, h) / Math.min(w, h) > maxRatio) return `Aspect ratio must be at most ${maxRatio}:1`
  const px = w * h
  if (spec.min_pixels && px < spec.min_pixels) return `At least ${spec.min_pixels.toLocaleString()} total pixels`
  if (spec.max_pixels && px > spec.max_pixels) return `At most ${spec.max_pixels.toLocaleString()} total pixels`
  return null
}

/** Returns sizes whose inferred aspect ratio matches `aspect`. */
function sizesMatchingAspect(sizes: string[], aspect: string): string[] {
  return sizes.filter(s => aspectFromSize(s) === aspect)
}

/**
 * Map a pixel size string (e.g. '1280x720') to the closest resolution key
 * that the model declared in `durations_by_resolution` (e.g. '720p', '1080p',
 * '4k'). We compare on the smaller of width/height since portrait/landscape
 * variants of the same resolution share a duration bucket.
 */
function inferResolutionKey(size: string, available: string[]): string | null {
  if (!size || available.length === 0) return null
  const m = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!m) return null
  const minDim = Math.min(parseInt(m[1], 10), parseInt(m[2], 10))
  // Common video resolution heights. Falls back to numeric prefix parsing
  // for unusual keys (e.g. '540p').
  const dimByKey: Record<string, number> = {
    '480p': 480, '540p': 540, '720p': 720, '1080p': 1080, '1440p': 1440,
    '2k': 1440, '4k': 2160, '8k': 4320,
  }
  let best: string | null = null
  let bestDiff = Infinity
  for (const k of available) {
    const lk = k.toLowerCase()
    const dim = dimByKey[lk] ?? (() => {
      const pm = lk.match(/^(\d+)/)
      return pm ? parseInt(pm[1], 10) : NaN
    })()
    if (!Number.isFinite(dim)) continue
    const diff = Math.abs(dim - minDim)
    if (diff < bestDiff) { bestDiff = diff; best = k }
  }
  return best
}

interface DBModel {
  id: string          // uuid
  provider: string
  model_name: string
  display_name: string
  input_modalities: string[]
  tags: string[]
  is_popular: boolean | null
  released_at: string | null   // ISO timestamp
  modes:         string[]
  model_pricing: ModelPricing | null
  output_config: OutputConfig | null
  input_config?: { image?: { count?: number }; video?: { count?: number } } | null
}

type ModelMode =
  | 'text_to_text'
  | 'image_to_text'
  | 'video_to_text'
  | 'audio_to_text'
  | 'pdf_to_text'
  | 'text_to_image'
  | 'image_edit'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'video_edit'
  | 'extend_video'
  | 'audio_to_video'
  | 'start_end_frames'
  | 'reference_frames'

interface SlotModel {
  id: string          // uuid
  provider: string
  model_name: string
  display_name: string
  modes:         ModelMode[]
  model_pricing: ModelPricing | null
  output_config: OutputConfig | null
  /** Per-modality input overrides — notably image.count = how many
   *  reference images the model accepts (model-dependent, up to 14
   *  for Gemini 3 image models). */
  input_config?: { image?: { count?: number }; video?: { count?: number } } | null
}

interface SlotOptions {
  mode: ModelMode | null    // pattern picked from the model's `modes` set
  quality: string | null    // 'low' | 'medium' | 'high' for image
  size: string | null       // e.g. '1024x1024' for image, '1280x720' for video
  duration: number | null   // seconds for video
  aspect_ratio: string | null // e.g. '16:9' for video, '1:1' for image
  /** Watermark for video. null = unset (provider's default, don't send); true = on; false = off. */
  watermark: boolean | null
  /** Let the model score its own clip. Only offered when the model declares
   *  `output_config.video.audio`. null = provider default (Wan 3.0's own
   *  default is ON); false asks for a silent clip. */
  generate_audio?: boolean | null
  /** Number of outputs to generate. Only meaningful for image models that
   *  declare `output_config.image.max_count > 1`. Defaults to 1. */
  count: number | null
  /** Reasoning/thinking level for text models that declare
   *  output_config.text.thinking_levels. null = provider default (Auto). */
  thinking_level?: string | null
  /** Let the model search the web. Only offered when the model declares
   *  `web_search` in output_config.text.capabilities. Off by default: it is
   *  billed per search on top of tokens (~$0.01–0.014 a call, and the pages
   *  it reads become input tokens), so it has to be asked for. */
  web_search?: boolean
}

interface SlotState {
  text: string
  isImage: boolean
  isVideo: boolean
  streaming: boolean
  done: boolean
  cost: number
  responseTime: number
  error: string | null
  errorRef?: string | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isImage?: boolean
  isVideo?: boolean
}

interface GalleryItem {
  id: string
  mode: string
  prompt: string
  slots: any[]
  chosen_model_id: string | null
  chat_history: ChatMessage[] | null
  created_at: string
  /** Original uploads (storagePath/bucket/…), persisted July 19+. */
  input_attachments?: Attachment[] | null
}

const LABELS = ['A', 'B', 'C', 'D']
const SLOT_COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

// ── Cost estimation ──────────────────────────────────────────────────────────
// We estimate upfront USD cost so users can see what a Generate run will cost
// before they commit. Actual cost is reconciled from the provider response
// once generation completes.
//
// Text: charge = (inTokens × input_price + outTokens × output_price) / 1M.
//   We assume ~4 chars/token for the prompt and a conservative 500-token
//   response. Cached input is ignored here — the estimator is a ceiling.
// Image: per-image price from image_pricing[quality]. One image per slot.
// Video: per-second price from video_pricing[resolutionKey] × duration.
function resolutionKeyForSize(size: string): string | null {
  // Plain resolution keys ('480p', '720p', '4k') pass through directly -
  // some models (Grok Imagine) declare sizes this way, and falling back
  // to the 720p rate mis-estimated 480p runs (CC, July 20).
  if (/^\d+p$/i.test(size)) return size.toLowerCase()
  if (/^4k$/i.test(size)) return '4K'
  if (!size.includes('x')) return null
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return null
  const shortSide = Math.min(w, h)
  if (shortSide >= 2000) return '4K'
  if (shortSide >= 1000) return '1080p'
  if (shortSide >= 700)  return '720p'
  return '480p'
}

/** Searches to price in when a slot has web search on. Mirrors the server's
 *  reserve in app/api/xcreate/route.ts — the two must not drift, or the quote
 *  shown and the credits held stop matching. */
const SEARCH_ALLOWANCE = 8

// Resolve a polymorphic TokenRate to a number using the slot's chosen
// thinking level (if any). Mirrors `resolveTokenRate` in pricing.ts.
function rateOf(r: TokenRate | undefined, level?: string | null): number {
  if (r == null) return 0
  if (typeof r === 'number') return r
  if (level && r.by_level && typeof r.by_level[level] === 'number') {
    return r.by_level[level] as number
  }
  return r.default ?? 0
}

function estimateSlotDollars(
  model: SlotModel,
  m: Mode,
  opts: SlotOptions | null,
  promptLen: number,
  /** Extra input tokens from attached documents (txt/PDF) - the server
   *  folds up to ~50k tokens per file, so big uploads cost real input. */
  docTokens: number = 0,
): number | null {
  const p = model.model_pricing ?? {}
  const t = p.tokens ?? {}
  const lvl: string | null = opts?.thinking_level ?? null
  if (m === 'text') {
    const tin  = rateOf(t.text_input,  lvl)
    const tout = rateOf(t.text_output, lvl)
    if (tin === 0 && tout === 0) return null
    // Search changes the estimate in two ways, and both belong here: the
    // per-call fee, and the pages the model reads back in as input tokens.
    // Without them the figure never moves when you switch search on, and the
    // first sign of an 8x bill is the receipt. SEARCH_ALLOWANCE mirrors the
    // server's reserve so the quote and the hold agree.
    const searching = opts?.web_search === true
    const searchFee = searching ? SEARCH_ALLOWANCE * (p.per_search ?? 0) : 0
    // Rough, and deliberately not precise: a searched answer read ~30k input
    // tokens of page content in testing. An estimate that ignores it is
    // wrong by more than one that is roughly right.
    const readTokens = searching ? 30_000 : 0
    const inTokens  = Math.max(1, Math.ceil(promptLen / 4)) + docTokens + readTokens
    const outTokens = searching ? 900 : 500
    return searchFee + (inTokens * tin + outTokens * tout) / 1_000_000
  }
  if (m === 'image') {
    // Official per-image rates FIRST, keyed by the selected size ("1024"
    // tier or "1024x1024") then quality — these mirror the provider's
    // published per-image equivalents (e.g. Gemini 3 Pro 4K = $0.24), so
    // they beat any token guess. Multiply by count — qwen and gpt-image-2
    // return N images per call and bill per image / per image's tokens.
    const nImgs = Math.max(1, opts?.count ?? 1)
    const r = p.per_image
    const size = opts?.size ?? null
    const q    = opts?.quality ?? null
    if (r) {
      // Most specific key wins: "quality:size" (gpt-image-2's measured
      // matrix) → size tier ("1024" for Gemini) → quality → fallbacks.
      const flat = (q && size && r[`${q}:${size}`] != null) ? r[`${q}:${size}`]
                 : (size && r[size] != null) ? r[size]
                 : (q && r[q] != null)       ? r[q]
                 : (r.medium ?? r.default ?? Object.values(r)[0] ?? null)
      if (flat != null) return flat * nImgs
    }
    // Token-billed with no per-image table (e.g. gpt-image-2): rough
    // heuristic — ~1400 output image tokens (1372 measured on a real
    // gpt-image-2 response). Order-of-magnitude only; quality moves it.
    const imgOut = rateOf(t.image_output, lvl)
    if (imgOut > 0) {
      const inTokens     = Math.max(1, Math.ceil(promptLen / 4))
      const outImageTok  = 1400 * nImgs
      const tin = rateOf(t.text_input, lvl)
      return (inTokens * tin + outImageTok * imgOut) / 1_000_000
    }
    return null
  }
  if (m === 'video') {
    const r = p.per_video_second
    if (!r) return null
    const size = opts?.size ?? null
    const key  = size ? resolutionKeyForSize(size) : null
    let perSecond: number | null = null
    // Falling back to 720p was a silent 2x on any model whose default tier is
    // cheaper: Wan 3.0 opens at 480p ($0.05/s), so an unmapped size quoted
    // $0.10/s — double, for a run that would never bill that. Fall back to the
    // model's OWN first declared size, which is what validateOpts selects.
    const firstSize = model.output_config?.video?.sizes?.[0] ?? null
    const firstKey  = firstSize ? resolutionKeyForSize(firstSize) : null
    if (key && r[key] != null)                          perSecond = r[key]
    else if (firstKey && r[firstKey] != null)           perSecond = r[firstKey]
    else if (r['default'] != null)                      perSecond = r['default']
    else if (r['720p'] != null)                         perSecond = r['720p']
    else if (Object.values(r).length > 0)               perSecond = Object.values(r)[0] as number
    if (perSecond == null) return null
    const seconds = opts?.duration ?? 1
    return perSecond * seconds
  }
  return null
}

// Format a USD amount for display. Picks a decimal count that keeps sub-cent
// values legible without scientific notation.
// Strip a trailing parenthetical variant from a model name — e.g.
// "GPT-5.4 (free)" → "GPT-5.4" — so result cards and chat headers stay
// compact. The model card in the setup grid still shows the variant on a
// second muted line; everything post-generation hides it entirely.
function stripModelVariant(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
}

// Short price tag for the workflow composer's model dropdown — enough to
// keep the price-honesty framing without the full estimator.
function wfPriceLabel(m: any, mode: Mode): string {
  const p = m?.model_pricing ?? {}
  if (mode === 'image') {
    const v = p.per_image?.default ?? p.per_image?.medium ?? p.per_image?.['1024']
    return typeof v === 'number' ? `$${v}/img` : ''
  }
  const v = p.per_video_second?.['720p'] ?? p.per_video_second?.default
  return typeof v === 'number' ? `$${v}/s` : ''
}

function fmtDollars(dollars: number | null): string {
  if (dollars == null) return '—'
  if (dollars === 0)   return '$0'
  if (dollars >= 1)    return `$${dollars.toFixed(2)}`
  if (dollars >= 0.01) return `$${dollars.toFixed(3)}`
  return `$${dollars.toFixed(4)}`
}


// downloadFile/downloadName moved to lib/download.ts (imported above) so
// the profile gallery shares the one implementation that actually forces
// a save — see that file for the cross-origin story.


// ── Gallery Detail Modal ──────────────────────────────────────────────────────
// Shows all model results for a single saved creation. User can flip between
// model tabs to see each one's output side-by-side. Chosen model is badged
// but non-chosen ones are NOT crossed out — they're all viewable.
function GalleryDetail({ item, onClose, onContinue }: {
  item: GalleryItem,
  onClose: () => void,
  onContinue: (item: GalleryItem, slotIdx: number) => void,
}) {
  const slots = (item.slots ?? []).filter(Boolean)
  const mode  = item.mode as Mode
  const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
  const chosenIdx = slots.findIndex((s: any) => s.id === item.chosen_model_id)
  const initialIdx = chosenIdx !== -1 ? chosenIdx : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  const active = slots[activeIdx]

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 99000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 14,
        width: '100%', maxWidth: 980, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '3px 8px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(item.created_at).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--white)', lineHeight: 1.5, fontWeight: 500 }}>{item.prompt}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 8,
            background: 'var(--surface2)', border: '1px solid var(--border2)',
            color: 'var(--muted)', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Model tabs — click to view that model's result */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {slots.map((s: any, i: number) => {
            const isActive = i === activeIdx
            const isChosen = s.id === item.chosen_model_id
            return (
              <button key={i} onClick={() => setActiveIdx(i)} style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 8,
                fontFamily: 'var(--mono)', fontWeight: 600,
                cursor: 'pointer',
                border: isActive ? '1px solid var(--red)' : '1px solid var(--border2)',
                background: isActive ? 'var(--red-dim)' : 'var(--surface)',
                color: isActive ? 'var(--red)' : 'var(--muted2)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, opacity: 0.7 }}>{LABELS[i]}</span>
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {s.model_name ?? s.name}
                </span>
                {isChosen && <span style={{ fontSize: 9, color: 'var(--green)', background: '#34d39928', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>CHOSEN</span>}
              </button>
            )
          })}
        </div>

        {/* Active model result */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, background: 'var(--surface)' }}>
          {active && (
            active.isVideo ? (
              <video src={active.text} controls autoPlay loop playsInline style={{
                width: '100%', maxHeight: '55vh', borderRadius: 10, background: '#000', display: 'block',
              }} />
            ) : active.isImage ? (
              // Multi-output runs store newline-joined URLs — stack them.
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                {(active.text ?? '').split('\n').filter(Boolean).map((u: string, ui: number) => (
                  <img key={ui} src={u} alt="" style={{
                    width: '100%', maxHeight: '55vh', objectFit: 'contain',
                    borderRadius: 10, display: 'block', background: '#000',
                  }} />
                ))}
              </div>
            ) : (
              <div style={{
                fontSize: 14, lineHeight: 1.7, color: 'var(--white)',
                whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
              }}>{active.text || <span style={{ color: 'var(--muted)' }}>(empty)</span>}</div>
            )
          )}

          {/* Stats row */}
          {active && (
            <div style={{ marginTop: 16, display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' as const }}>
              {typeof active.cost === 'number' && <span>Cost: <strong style={{ color: 'var(--white)' }}>{fmtDollars(active.cost)}</strong></span>}
              {typeof active.responseTime === 'number' && active.responseTime > 0 && (
                <span>Time: <strong style={{ color: 'var(--white)' }}>{(active.responseTime / 1000).toFixed(2)}s</strong></span>
              )}
              {active.provider && <span>Provider: <strong style={{ color: 'var(--white)' }}>{active.provider}</strong></span>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', background: 'var(--bg)' }}>
          {active?.isImage && (
            <button onClick={() => { const u = (active.text ?? '').split('\n')[0]; downloadFile(u, downloadName(u, 'image')) }} style={{
              fontSize: 12, padding: '8px 14px', borderRadius: 8,
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              color: 'var(--muted2)', cursor: 'pointer',
            }}>↓ Download</button>
          )}
          {active?.isVideo && (
            <button onClick={() => downloadFile(active.text, downloadName(active.text, 'video'))} style={{
              fontSize: 12, padding: '8px 14px', borderRadius: 8,
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              color: 'var(--muted2)', cursor: 'pointer',
            }}>↓ Download</button>
          )}
          <button onClick={() => onContinue(item, activeIdx)} style={{
            fontSize: 12, padding: '8px 14px', borderRadius: 8,
            background: 'var(--red)', border: '1px solid var(--red)',
            color: '#fff', cursor: 'pointer', fontWeight: 600,
          }}>Continue with {active?.model_name ?? active?.name ?? 'this model'} →</button>
        </div>
      </div>
    </div>
  )
}

// Parse a Supabase signed URL to extract its bucket + storage path.
// The server signs URLs with a 24h TTL at generation time, so any URL stored
// in `xcreates.slots[].text` older than a day is dead. We re-sign on load.
//   /storage/v1/object/sign/{bucket}/{path}?token=...
function parseSupabaseSignedUrl(url: string): { bucket: string, path: string } | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
    if (!m) return null
    return { bucket: m[1], path: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

// Re-sign every Supabase signed URL found in `items[].slots[].text`. Batches
// per bucket via createSignedUrls to minimize round trips, then replaces the
// stale URL in-place. URLs that aren't Supabase signed URLs (or can't be
// re-signed, e.g. file deleted) are left untouched.
async function refreshSlotUrls(
  sb: ReturnType<typeof createSupabaseBrowser>,
  items: GalleryItem[],
): Promise<GalleryItem[]> {
  // Collect unique (bucket, path) pairs across all slots.
  const byBucket: Record<string, Set<string>> = {}
  items.forEach(item => {
    (item.slots ?? []).forEach((s: any) => {
      if (!s?.text) return
      const p = parseSupabaseSignedUrl(s.text)
      if (!p) return
      if (!byBucket[p.bucket]) byBucket[p.bucket] = new Set()
      byBucket[p.bucket].add(p.path)
    })
  })

  // Sign each bucket's paths in a single batched call.
  const urlMap: Record<string, Record<string, string>> = {}
  await Promise.all(Object.entries(byBucket).map(async ([bucket, paths]) => {
    const pathArr = Array.from(paths)
    if (pathArr.length === 0) return
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(pathArr, 60 * 60 * 24)
    if (error || !data) return
    urlMap[bucket] = {}
    data.forEach((d, i) => { if (d.signedUrl) urlMap[bucket][pathArr[i]] = d.signedUrl })
  }))

  // Map fresh URLs back onto each slot, leaving everything else intact.
  return items.map(item => ({
    ...item,
    slots: (item.slots ?? []).map((s: any) => {
      if (!s?.text) return s
      const p = parseSupabaseSignedUrl(s.text)
      if (!p) return s
      const fresh = urlMap[p.bucket]?.[p.path]
      return fresh ? { ...s, text: fresh } : s
    }),
  }))
}

// ── Gallery ───────────────────────────────────────────────────────────────────
// Mode filter (text/image/video) is controlled from the parent so the filter
// tabs can live on the right side of the top-level XCreate/Gallery tab row
// — keeps a single selector bar instead of stacking two.

function Gallery({ userId, filterMode, onCounts, onOpen, limit = 40, compact = false }: {
  userId: string,
  filterMode: Mode,
  onCounts: (c: Record<Mode, number>) => void,
  onOpen: (item: GalleryItem, slotIdx: number) => void,
  /** Max rows to fetch — the in-studio "Recent" strip uses a small limit. */
  limit?: number,
  /** Compact (in-studio) mode: render nothing at all when empty. */
  compact?: boolean,
}) {
  const [items,   setItems]   = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail,  setDetail]  = useState<GalleryItem | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createSupabaseBrowser()
      const { data } = await sb.from('xcreates').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
      if (cancelled) return
      // Show rows immediately so the UI doesn't block on signing, then
      // swap in refreshed URLs once the batch sign completes.
      const rows = (data ?? []) as GalleryItem[]
      setItems(rows)
      setLoading(false)
      try {
        const refreshed = await refreshSlotUrls(sb, rows)
        if (!cancelled) setItems(refreshed)
      } catch (err) {
        console.warn('[gallery] failed to refresh signed URLs', err)
      }
    })()
    return () => { cancelled = true }
  }, [userId, limit])

  // Recompute per-mode counts whenever items change so the parent's filter tabs
  // can show totals next to each mode.
  useEffect(() => {
    const counts: Record<Mode, number> = { text: 0, image: 0, video: 0 }
    items.forEach(it => { if (it.mode in counts) counts[it.mode as Mode]++ })
    onCounts(counts)
    // Intentionally omit onCounts — it's expected to be stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const filteredItems = items.filter(it => it.mode === filterMode)

  if (loading) return compact ? null : <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading gallery…</div>
  if (compact && filteredItems.length === 0) return null

  return (
    <>
      {detail && (
        <GalleryDetail
          item={detail}
          onClose={() => setDetail(null)}
          onContinue={(item, slotIdx) => { setDetail(null); onOpen(item, slotIdx) }}
        />
      )}

      {items.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Your creations will appear here.</div>
      ) : filteredItems.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>
          No {filterMode} creations yet. Switch to another tab or create one in XCreate.
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {filteredItems.map(item => {
          const slots     = (item.slots ?? []).filter(Boolean)
          const mode      = item.mode as Mode
          const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
          const chosen    = slots.find((s: any) => s.id === item.chosen_model_id)
          const preview   = chosen ?? slots[0]
          return (
            <div key={item.id}
              onClick={() => setDetail(item)}
              onMouseEnter={e => {
                const el = e.currentTarget
                el.style.transform   = 'translateY(-2px)'
                el.style.borderColor = 'var(--red)'
                el.style.boxShadow   = '0 8px 24px rgba(232,69,60,0.15)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget
                el.style.transform   = 'translateY(0)'
                el.style.borderColor = 'var(--border2)'
                el.style.boxShadow   = 'none'
              }}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
                overflow: 'hidden', cursor: 'pointer',
                transition: 'transform .18s ease, border-color .18s ease, box-shadow .18s ease',
              }}
            >
              {preview && (
                preview.isVideo ? <video src={preview.text} muted loop playsInline autoPlay style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', pointerEvents: 'none' }} />
                : preview.isImage ? <img src={(preview.text ?? '').split('\n')[0]} alt="" style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', pointerEvents: 'none' }} />
                : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>{preview.text?.slice(0, 200)}</div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted2)', background: 'var(--surface2)', padding: '2px 7px', borderRadius: 8, fontWeight: 700 }}>{slots.length} MODEL{slots.length === 1 ? '' : 'S'}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {slots.map((s: any, i: number) => {
                    const isChosen = s.id === item.chosen_model_id
                    return (
                      <span key={i} style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--mono)',
                        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                        color: isChosen ? 'var(--green)' : 'var(--muted2)',
                        background: isChosen ? 'var(--green-dim)' : 'var(--surface2)',
                        border: isChosen ? '1px solid #34d39940' : '1px solid var(--border2)',
                      }}>
                        {s.model_name ?? s.name}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
// useSearchParams() (the ?id= deep-link) requires a Suspense boundary for
// the production build's prerender pass — dev mode tolerates its absence,
// `next build` hard-fails. The wrapper is the whole fix.
// Option pill + group for the per-slot config panel. MODULE scope on
// purpose: inline definitions made React remount the panel on every state
// update, breaking slider drags (see the config panel below).
function OptPill({ color, active, onClick, children, narrow }: {
  color: string; active: boolean; onClick: () => void; children: React.ReactNode; narrow?: boolean
}) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: narrow ? '6px 4px' : '7px 6px',
        borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: active ? color + '22' : 'transparent',
        border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
        color: active ? color : 'var(--muted)',
        transition: 'all 0.15s', textAlign: 'center' as const,
      }}>
      {children}
    </button>
  )
}
function OptGroup({ label, children, last }: {
  label: string; children: React.ReactNode; last?: boolean
}) {
  return (
    <div style={{ marginBottom: last ? 0 : 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>{children}</div>
    </div>
  )
}


export default function CreateClient() {
  return (
    <Suspense fallback={null}>
      <CreateStudio />
    </Suspense>
  )
}

function CreateStudio() {
  useRequireAuth()
  const t = useT()
  const router = useRouter()   // legacy ?agent=1 / ?c= forwarding to /xdirect
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [userId,         setUserId]         = useState<string | null>(null)
  // Surface "?id=… not found or not yours" errors as a banner so the
  // user understands why the page didn't open the run they expected.
  // null = no error, string = message to display.
  const [loadError,      setLoadError]      = useState<string | null>(null)
  // Set when the server refuses a run for balance reasons, so the error
  // banner can offer the top-up route instead of just saying no.
  const [needsTopUp,     setNeedsTopUp]     = useState(false)
  const [balanceCents,   setBalanceCents]   = useState<number | null>(null)
  // Image by default — visual wow at a fraction of video's cost. Video
  // stays the marketing star; text is the cheap third tab.
  const [mode,           setMode]           = useState<Mode>('image')
  const [prompt,         setPrompt]         = useState('')
  const [selectedModels, setSelectedModels] = useState<(SlotModel | null)[]>([null, null, null, null])
  const [slots,          setSlots]          = useState<SlotState[]>([])
  const [pickerSlot,     setPickerSlot]     = useState<number | null>(null)
  const [phase,          setPhase]          = useState<Phase>('setup')
  // (Gallery view used to live here; it now lives in /profile under the
  // XCreates tab. XCreate page is single-purpose: the studio.)
  const [lightbox,       setLightbox]       = useState<string | null>(null)
  const [attachments,    setAttachments]    = useState<Attachment[]>([])
  const [slotOptions,   setSlotOptions]    = useState<(SlotOptions | null)[]>([null, null, null, null])
  // Per-slot config panel visibility — collapsed by default; the ⚙ on
  // each model card toggles it. Defaults chosen by validateOpts are fine
  // for most runs, so the knobs stay out of the way until wanted.
  const [optsOpen,      setOptsOpen]       = useState<boolean[]>([false, false, false, false])
  // (galleryFilter / galleryCounts removed with the in-page Gallery tab.)

  // Active template — purely a UI hint (highlights the picked card). The
  // actual state (mode, models, options, prompt, attachment slots) is
  // applied immediately by applyTemplate() and the user can edit any
  // of it after, so we don't "enforce" anything from the template after
  // application.
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  // True while a template's bundled sample file is being fetched + uploaded
  // (see applyTemplate). Keeps Generate disabled so a run can't start with
  // the attachment half-arrived.
  const [attachingSample, setAttachingSample] = useState(false)

  // Applying a tool/template from the galleries below the prompt box
  // scrolls the composer into view and flashes it, so the user sees
  // what just got pre-filled (otherwise a click down there looks inert).
  const promptBoxRef = useRef<HTMLDivElement | null>(null)
  const [promptFlash, setPromptFlash] = useState(false)

  // Mega-dropdown under the mode tabs (LMArena-style): hovering/clicking
  // a mode tab opens a rich panel with that mode's sub-modes + popular
  // tools & templates. Selecting anything inside closes it.
  // Prompt refiner removed July 2026 (CC: not ready to build it, and every
  // click was a paid LLM call). The /api/xcreate/refine route was deleted
  // with it — restore both together if it ever comes back.

  // Mode buttons switch the mode directly (first sub-mode as default —
  // the mode-change effect handles that). The "From:" button opens a
  // small dropdown list of the current mode's sub-modes.
  const [fromOpen, setFromOpen] = useState(false)
  const modeBlockRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!fromOpen) return
    const onDown = (e: MouseEvent) => {
      if (!modeBlockRef.current?.contains(e.target as Node)) setFromOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFromOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [fromOpen])
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashComposer = () => {
    promptBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPromptFlash(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setPromptFlash(false), 1500)
  }

  // Layer 2 — the processing recipe (one ModelMode for the whole run). Drives
  // model-picker filtering and the input slots. Defaults to the first recipe
  // for the current output type. `catalog` holds the enabled models' modes so
  // we can hide recipes no model supports.
  const [recipeMode, setRecipeMode] = useState<ModelMode>('text_to_image')  // matches the image default mode
  const [catalog, setCatalog] = useState<{ modes: ModelMode[]; output_modalities: string[] }[]>([])

  // validateOpts is the single source of truth for "what options are valid
  // for this model in this mode". It accepts a (possibly stale) opts object
  // and returns a sanitized one — any field that no longer points at a
  // declared option falls back to a sensible default. Used both when
  // first selecting a model (with all fields null) and after every
  // user-driven change to one field, so changing resolution auto-clamps
  // duration, etc.
  const validateOpts = (model: SlotModel | null, m: Mode, opts: SlotOptions): SlotOptions => {
    if (!model) return opts
    // Restrict the model's declared modes to those compatible with the
    // current top-level mode (text/image/video). For example, a video
    // model declares `text_to_video` and `image_to_video`; in video mode
    // both are valid here.
    const modeOpts = (model.modes ?? []).filter(x => modeMatchesMode(x, m))
    const mode = opts.mode && modeOpts.includes(opts.mode) ? opts.mode : (modeOpts[0] ?? null)

    // Modes that consume a non-text input file (image_to_video, image_to_image,
    // video_to_video, reference_frames, start_end_frames) inherit aspect ratio
    // from the input. The picker is hidden in those cases and we default
    // aspect_ratio to null rather than the first declared option, so the
    // route handler doesn't pass a conflicting ratio to the provider.
    const isTextOnlyInput = !mode || mode.startsWith('text_to_')

    if (m === 'image') {
      const qualities = model.output_config?.image?.qualities ?? []
      const sizes = model.output_config?.image?.sizes ?? []
      const ars   = model.output_config?.image?.aspect_ratios ?? []
      const maxCount = model.output_config?.image?.max_count ?? 1
      // Clamp count to [1, maxCount]. Default to 1 (single image).
      const count = (() => {
        const n = opts.count ?? 1
        if (!Number.isFinite(n) || n < 1) return 1
        return Math.min(n, maxCount)
      })()
      return {
        mode,
        quality: opts.quality && qualities.includes(opts.quality)
          ? opts.quality
          : (qualities.includes('medium') ? 'medium' : (qualities[0] ?? null)),
        // A size outside the preset list survives when the model declares
        // custom_size support and the value passes its constraints —
        // otherwise restoring or re-validating a run stripped the custom
        // size straight back to a preset.
        size: opts.size && (sizes.includes(opts.size)
            || (model.output_config?.image?.custom_size && !customSizeError(opts.size, model.output_config.image.custom_size)))
          ? opts.size
          : (sizes[0] ?? null),
        duration: null,
        aspect_ratio: !isTextOnlyInput
          ? null
          : opts.aspect_ratio && ars.includes(opts.aspect_ratio)
            ? opts.aspect_ratio
            : (ars[0] ?? null),
        // Watermark: same On/Off semantic as video. Default Off; ignored
        // by non-Alibaba providers in the route handler.
        watermark: opts.watermark === true ? true : false,
        count,
      }
    }
    if (m === 'video') {
      const sizes = model.output_config?.video?.sizes ?? []
      const ars   = model.output_config?.video?.aspect_ratios ?? []
      const dbr = model.output_config?.video?.durations_by_resolution ?? {}
      const size = opts.size && sizes.includes(opts.size) ? opts.size : (sizes[0] ?? null)
      const resKey = size ? inferResolutionKey(size, Object.keys(dbr)) : null
      const validForKey   = resKey ? expandDurations(dbr[resKey]) : []
      const validUnion    = Array.from(new Set(Object.values(dbr).flatMap(expandDurations))).sort((a, b) => a - b)
      let validDurations = validForKey.length > 0 ? validForKey : validUnion
      // Veo 3.1 start+end frame interpolation requires durationSeconds=8.
      // Clamp the valid set so a stale duration from another mode (e.g. 4)
      // gets snapped on switch.
      if (mode === 'start_end_frames' && model.provider === 'google' && validDurations.includes(8)) {
        validDurations = [8]
      }
      const duration = opts.duration != null && validDurations.includes(opts.duration)
        ? opts.duration
        : (validDurations[0] ?? null)
      // Text-driven recipes default to the model's first declared ratio;
      // image-driven ones default to null (AUTO — send nothing, the
      // provider decides) but KEEP an explicit user pick: Omni Flash
      // ignores the input image's shape, so overriding must be possible
      // for image_to_video too (owner, Aug 20).
      const aspect_ratio = opts.aspect_ratio && ars.includes(opts.aspect_ratio)
        ? opts.aspect_ratio
        : (isTextOnlyInput ? (ars[0] ?? null) : null)
      // Watermark default = Off. Only ever true/false now.
      return { mode, quality: null, size, duration, aspect_ratio, watermark: opts.watermark === true ? true : false, count: null }
    }
    // Text mode: no watermark concept. Thinking level clamps to the
    // model's declared set; null = Auto (provider default).
    const thinkLevels = model.output_config?.text?.thinking_levels ?? []
    const thinking_level = opts.thinking_level && thinkLevels.includes(opts.thinking_level) ? opts.thinking_level : null
    // Clamped against the capability, not just carried through: a model that
    // loses the flag (or a slot swapped to one that never had it) must not
    // keep a stale `true` and send a request the provider will reject.
    const canSearch = (model.output_config?.text?.capabilities ?? []).includes('web_search')
    const web_search = canSearch ? opts.web_search === true : false
    return { mode, quality: null, size: null, duration: null, aspect_ratio: null, watermark: null, count: null, thinking_level, web_search }
  }

  const defaultOptions = (model: SlotModel | null, m: Mode): SlotOptions =>
    validateOpts(model, m, { mode: null, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null })

  // Apply a partial change to slot i and re-validate against the model's
  // current option set, so e.g. switching resolution downstream-clamps
  // duration to something valid.
  //
  // Also applies cross-field auto-switching:
  //   - patch.aspect_ratio → set size to the (only / first) matching size
  //   - patch.size         → set aspect_ratio to the inferred ratio if declared
  // This way picking '21:9' auto-selects the lone 1536×672 size and vice versa.
  const updateSlotOpts = (i: number, patch: Partial<SlotOptions>) => {
    setSlotOptions(prev => prev.map((o, idx) => {
      if (idx !== i || !o) return o
      const model = selectedModels[idx]
      const next: SlotOptions = { ...o, ...patch }

      if (model && (mode === 'image' || mode === 'video')) {
        const sizes = mode === 'video'
          ? (model.output_config?.video?.sizes ?? [])
          : (model.output_config?.image?.sizes ?? [])
        const ars   = mode === 'video'
          ? (model.output_config?.video?.aspect_ratios ?? [])
          : (model.output_config?.image?.aspect_ratios ?? [])

        // Aspect ratio changed → align the size to it.
        if ('aspect_ratio' in patch && next.aspect_ratio) {
          const matches = sizesMatchingAspect(sizes, next.aspect_ratio)
          if (matches.length > 0 && (!next.size || !matches.includes(next.size))) {
            next.size = matches[0]
          }
        }

        // Size changed → infer aspect ratio (if declared by the model).
        if ('size' in patch && next.size) {
          const inferred = aspectFromSize(next.size)
          if (inferred && ars.includes(inferred)) {
            next.aspect_ratio = inferred
          }
        }
      }

      return validateOpts(model, mode, next)
    }))
  }

  // Per-slot draft for the custom image-size input (models declaring
  // output_config.image.custom_size). Draft ≠ applied: only a value that
  // passes customSizeError lands in slotOptions.
  const [customSizeDraft, setCustomSizeDraft] = useState<Record<number, string>>({})

  // Post-pick state
  const [chosenIdx,      setChosenIdx]      = useState<number | null>(null)
  // Which result card just had its text copied — drives the ✓ flash.
  const [copiedSlot,     setCopiedSlot]     = useState<number | null>(null)
  const copySlotText = (idx: number, text: string) => {
    try { void navigator.clipboard.writeText(text) } catch { return }
    setCopiedSlot(idx)
    setTimeout(() => setCopiedSlot(c => (c === idx ? null : c)), 1800)
  }
  // Post-pick match report (傳說對決 style). null = hidden. Delta is
  // fetched async after the vote+refit round-trip (undefined = loading).
  const [matchResult, setMatchResult] = useState<{ eyebrow: string; title: string; winnerName: string; winnerProvider: string; entries: MatchResultEntry[] } | null>(null)
  const [matchDelta,  setMatchDelta]  = useState<RatingDelta | null | undefined>(undefined)
  const [chatHistory,    setChatHistory]    = useState<ChatMessage[]>([])
  // ── Workflow view (CC, July 26): the per-creation continuation surface.
  // wfChain is the root_id lineage rendered as the step strip. ──
  const [wfChain,      setWfChain]      = useState<CanvasNode[]>([])
  // Canvas board (CC, July 27): ComfyUI-style node view of the family.
  // wfSelHero mirrors the node picked ON THE CANVAS so the hero + composer
  // can branch from any node, not just the newest step.
  const [wfView,       setWfView]       = useState<'strip' | 'canvas'>('strip')
  const [wfSelHero,    setWfSelHero]    = useState<{ url: string | null; isVideo: boolean } | null>(null)
  // ── Board editor (CC, July 28). The canvas is now an editor, so it needs
  // a SELECTION (plural — a product video takes the original photo and the
  // angles as reference images at once), the board it belongs to, and
  // placeholder nodes for jobs that have no xcreates row yet (the row is
  // only inserted once generation finishes).
  const [wfSel,        setWfSel]        = useState<string[]>([])
  const [wfBoardId,    setWfBoardId]    = useState<string | null>(null)
  // Input attachments per row, resolved server-side into fresh signed URLs.
  // These become read-only INPUT nodes: a reference photo is an attachment,
  // not an xcreates row, so without this the board drew the video and left
  // out the picture it was made from (CC, July 28).
  const [wfInputs,     setWfInputs]     = useState<Record<string, Array<{ bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number; url: string | null }>>>({})
  // Freshly-signed output URLs keyed by node id. Stored slot URLs carry a 1h
  // TTL, so an older board rendered as black rectangles until we re-signed.
  const [wfOutUrls,    setWfOutUrls]    = useState<Record<string, string>>({})
  const [wfReload,     setWfReload]     = useState(0)
  // Beta gating (CC, July 29) arrives as a PROP, resolved on the server.
  // It was a client fetch first; the flags landed on one load and not the
  // next, which cost an hour. This page mounts its studio inside <Suspense>
  // and the tab carries a second, orphaned React root, so a setState racing
  // that mount is not something to rely on. Server-resolved means the right
  // answer is present on the very first render, with no flash and no race.
  // Advisory only either way — /api/xcreate/source, /node and /inputs each
  // enforce the same gate themselves.
  // Product-board entry: uploads that become source nodes, not a generation.
  const [pbOpen,       setPbOpen]       = useState(false)
  const [pbAtts,       setPbAtts]       = useState<Attachment[]>([])
  const [pbBusy,       setPbBusy]       = useState(false)
  const [wfEditModels, setWfEditModels] = useState<any[]>([])
  const [wfPrompt,     setWfPrompt]     = useState('')
  const [wfModelId,    setWfModelId]    = useState<string | null>(null)
  // ── Batch apply (CC, July 27): re-run a proven edit on up to 10 photos.
  // Each item is a normal single-model xcreate run (own reserve/settle, own
  // gallery entry); the batch is purely a client-side fan-out.
  const [batchOpen,   setBatchOpen]   = useState(false)
  const [batchAtts,   setBatchAtts]   = useState<Attachment[]>([])
  const [batchPrompt, setBatchPrompt] = useState('')
  const [batchRuns,   setBatchRuns]   = useState<Array<{ jobId: string; fileName: string; status: 'running' | 'done' | 'error'; url?: string; cost?: number; error?: string }>>([])
  const batchRunsRef = useRef<Array<{ jobId: string; fileName: string; status: 'running' | 'done' | 'error'; url?: string; cost?: number; error?: string }>>([])
  useEffect(() => { batchRunsRef.current = batchRuns }, [batchRuns])
  const [chatInput,      setChatInput]      = useState('')
  const [chatStreaming,  setChatStreaming]  = useState(false)
  const [xcreateId,       setXcreateId]       = useState<string | null>(null)
  // Set when the composer state was resurrected from an all-failed run:
  // generate() sends it as retryOf so the server UPDATES that row instead
  // of minting a sibling — the retry keeps the same ?id= link, history
  // entry and board identity (owner, Aug 20). Cleared on success, reset,
  // and mode change.
  const [retryOfId,       setRetryOfId]       = useState<string | null>(null)
  // Multi-turn image editing context
  const [imageResponseId, setImageResponseId] = useState<string | null>(null)           // OpenAI
  const [imageConvHistory, setImageConvHistory] = useState<any[] | null>(null)           // Google

  // Job polling — persists generation across navigation.
  const [jobId,          setJobId]          = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The job THIS tab is already polling. The ?job= resume effect checks it
  // so that generate() moving the address bar to ?job=<id> (below) doesn't
  // make the effect re-restore state for a run that is already live here.
  const activeJobRef = useRef<string | null>(null)
  const modeClearedRef = useRef(false)  // skip the mode-change reset on initial resume
  const jobIdRef = useRef<string | null>(null)
  useEffect(() => { jobIdRef.current = jobId }, [jobId])

  // Cursor
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, rafId: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.35; ry += (my-ry)*0.35
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      rafId = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    rafId = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(rafId) }
  }, [])

  useEffect(() => {
    createSupabaseBrowser().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  // Open-from-URL: when /xcreate?id=<uuid> is loaded (e.g. clicking an
  // XCreate card in the profile gallery), auto-fetch that row and feed it
  // into loadFromGallery so the studio resumes in the picking/chatting
  // phase.
  //
  // Privacy: we wait for `userId` to resolve before firing — the fetch
  // goes through the authenticated Supabase browser client so RLS
  // enforces ownership server-side. If the row exists but belongs to a
  // different user, .maybeSingle() returns `data: null` and we just log
  // and bail (no leak). If the user isn't logged in at all, we skip the
  // fetch entirely; the auth modal flow (triggered elsewhere) handles
  // the sign-in prompt.
  //
  // The URL is left intact so the user can copy the deep link or refresh
  // and end up back where they were. `galleryLoadedRef` keeps the load
  // from re-firing within the same component lifetime.
  const galleryLoadedRef = useRef<string | null>(null)
  // Set by OUR OWN code right before it strips ?id= via replaceState (402
  // rollback, error-banner dismiss, reset itself). The clean-studio effect
  // below consumes it so only a real navigation to bare /xcreate — the nav
  // link, the Back button — resets the page; our own URL bookkeeping keeps
  // whatever state it deliberately left in place.
  const urlClearedByCodeRef = useRef(false)
  const searchIdParam = useSearchParams()?.get('id') ?? null
  // ?job=<uuid> — open a run that is still in flight. Distinct from ?id=,
  // which opens a FINISHED xcreate. The sidebar links to whichever applies.
  const searchJobParam = useSearchParams()?.get('job') ?? null

  // ── ?model=<model_name>&mode=<text|image|video> deep link ──
  //
  // Opens the studio with one model already in slot A. Used by the landing
  // page's value-snapshot chips ("best image value → Nano Banana 2"), and
  // reusable anywhere a specific model is worth acting on (XBoard rows).
  //
  // Matched on model_name, not the uuid: it's the stable provider-side
  // identifier, it survives a row being recreated, and it makes the link
  // readable. Unknown or disabled model -> we simply leave the studio
  // empty rather than erroring; the URL is a suggestion, not a contract.
  const searchModelParam = useSearchParams()?.get('model') ?? null
  const searchModeParam  = useSearchParams()?.get('mode')  ?? null
  // ── ?template=<template id> deep link ──
  //
  // Opens the studio with a preset already applied — mode, recommended
  // models, slot options and starter prompt. This is how the site agent
  // routes a concrete request ("remove the background of this photo") to the
  // tool that already does it, instead of dropping the visitor on an empty
  // studio and hoping they find the right card. The effect itself lives
  // below applyTemplate. (CC, Aug 5)
  const searchTemplateParam = useSearchParams()?.get('template') ?? null
  const templateLinkRef = useRef<string | null>(null)
  const modelLinkRef = useRef<string | null>(null)
  useEffect(() => {
    if (!searchModelParam) return
    if (modelLinkRef.current === searchModelParam) return
    modelLinkRef.current = searchModelParam
    ;(async () => {
      const sb = createSupabaseBrowser()
      const { data } = await sb.from('ai_models')
        .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
        .eq('model_name', searchModelParam)
        .eq('enabled', true)
        .maybeSingle()
      if (!data) return

      const m: SlotModel = {
        id: data.id, provider: data.provider, model_name: data.model_name,
        display_name: data.display_name, modes: (data.modes ?? []) as ModelMode[],
        model_pricing: data.model_pricing, output_config: data.output_config,
        input_config: data.input_config ?? null,
      }

      // Same guard applyTemplate uses: stop the mode-change effect from
      // wiping the slot we're about to fill.
      modeClearedRef.current = true
      const nextMode: Mode = (['text', 'image', 'video'] as const).includes(searchModeParam as Mode)
        ? (searchModeParam as Mode)
        : 'image'
      // Prefer the model's own first recipe for this mode; fall back to the
      // mode's default so an odd catalogue entry can't leave a dead studio.
      const recipes = RECIPES[nextMode]
      const nextRecipe = recipes.find(r => m.modes.includes(r.id as ModelMode))?.id ?? recipes[0].id
      setMode(nextMode)
      setRecipeMode(nextRecipe as ModelMode)
      setSelectedModels([m, null, null, null])
      setSlotOptions([
        validateOpts(m, nextMode, { ...defaultOptions(m, nextMode), mode: nextRecipe as ModelMode }),
        null, null, null,
      ])
      setPhase('setup')

      // Consume the params, then strip them. ?model= is a seed, not state:
      // leaving it in the address bar means that the moment the user swaps
      // the model or the mode the URL is lying, and a refresh or a shared
      // link silently drags them back to the original pick. Unlike ?id=,
      // which names a saved run and is worth keeping, there is nothing here
      // to return to. Same consume-and-strip reset() already does for ?id=.
      // Other params are preserved so this can't clobber a future deep link.
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('model')
        url.searchParams.delete('mode')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchModelParam, searchModeParam])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const idParam = searchIdParam
    if (!idParam) return
    if (galleryLoadedRef.current === idParam) return  // same run already loaded
    // Navigating to a DIFFERENT run while a job is polling: release the
    // poller BEFORE loading the target. The generation itself continues
    // server-side (functions outlive the client by design), and coming
    // back to its ?id= resumes it through the liveJob lookup below.
    // Without this, the old job's next poll tick repainted its slots AND
    // replaceState'd its ?id= back into the bar — clicking any other run
    // yanked the user straight back to the generating one (owner, Aug 26).
    if (activeJobRef.current) {
      stopPolling()
      activeJobRef.current = null
    }
    // NOTE (CC, July 27): this used to wait for the userId STATE before
    // querying, but that state comes from an async getUser() call that can
    // resolve slowly (or not at all) on a fresh load — and when it lost the
    // race, the restore never ran and ?id= links opened a blank studio.
    // The browser client already sends the stored session token with every
    // query, so RLS works without us waiting; if there's truly no session,
    // the row comes back null and the neutral error banner shows.
    galleryLoadedRef.current = idParam
    // Opening a run clears the PREVIOUS run's banner — a failed run's
    // resurrection message was outliving history clicks onto perfectly
    // fine runs (owner, Aug 21). Whatever this load finds sets its own.
    setLoadError(null)
    setNeedsTopUp(false)
    ;(async () => {
      try {
        const sb = createSupabaseBrowser()
        const { data, error } = await sb.from('xcreates').select('*').eq('id', idParam).maybeSingle()
        if (error || !data) {
          // Two reasons we end up here:
          //   1. The row exists but belongs to another user — RLS hides
          //      it and .maybeSingle() returns null.
          //   2. The row was deleted / id is wrong.
          // We can't distinguish (1) from (2) client-side (that would
          // itself be a leak), so we use a single neutral message.
          console.warn('[xcreate] open-from-url: row not found or no access', error?.message)
          setLoadError("This XCreate doesn't exist or you don't have access. It may belong to another account.")
          return
        }
        // Rows are born at run start, so this ?id= may name a run that is
        // still generating — resume its job (live cards + polling) instead
        // of restoring a half-written snapshot. Owner-read RLS on
        // xcreate_jobs makes the browser query enough. The 15-min cutoff
        // skips zombies: past maxDuration (800s) a still-'running' row is a
        // killed function, and resuming it would poll a dead job forever —
        // fall through to the row restore (stub recovery) instead.
        const { data: liveJob } = await sb.from('xcreate_jobs')
          .select('id').eq('xcreate_id', idParam).eq('status', 'running')
          .gt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (liveJob?.id && liveJob.id !== activeJobRef.current) {
          await resumeJob(liveJob.id)
          return
        }
        await loadFromGallery(data as any)
      } catch (err) {
        console.warn('[xcreate] open-from-url failed:', err instanceof Error ? err.message : err)
        setLoadError('Could not load this XCreate. Please try again.')
      }
    })()
  // Refires when the ?id param changes (nav history clicks) — the ref
  // guards against reloading the SAME id (e.g. auth state flaps).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, searchIdParam])

  useEffect(() => {
    // When resuming an in-progress job, the mode is restored from the job
    // row — don't clobber the restored state.
    if (modeClearedRef.current) { modeClearedRef.current = false; return }
    setSelectedModels([null, null, null, null]); setSlots([]); setPhase('setup')
    setChosenIdx(null); setChatHistory([]); setXcreateId(null); setAttachments([])
    setRetryOfId(null)  // switching modes is a new creation, not a retry
    setSlotOptions([null, null, null, null])
    setRecipeMode(RECIPES[mode][0].id)  // reset Layer 2 to the first recipe
  }, [mode])

  // Load enabled models' modes once so the recipe picker can hide recipes that
  // no enabled model supports (avoids dead-end selections).
  useEffect(() => {
    createSupabaseBrowser()
      .from('ai_models')
      .select('modes, output_modalities')
      .eq('enabled', true)
      .then(({ data }) => setCatalog((data ?? []) as { modes: ModelMode[]; output_modalities: string[] }[]))
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, chatStreaming])

  const activeModels = selectedModels.filter(Boolean) as SlotModel[]
  const selectedIds  = activeModels.map(m => m.id)

  // Multi-image slot count for reference_frames AND image_edit — both are
  // model-dependent (input_config.image.count; e.g. Gemini 3 image models
  // mix up to 14 reference images). With multiple models in the run, cap at the
  // SMALLEST count so every selected model accepts the same attachment
  // set. No models / no count declared → 2 for references, 1 for edit.
  const refSlotCount = (() => {
    if (recipeMode !== 'reference_frames' && recipeMode !== 'image_edit') return 0
    const counts = activeModels
      .map(m => m.input_config?.image?.count)
      .filter((n): n is number => typeof n === 'number' && n > 0)
    const dflt = recipeMode === 'reference_frames' ? 2 : 1
    const cap = counts.length ? Math.min(...counts) : dflt
    return Math.max(1, Math.min(16, cap))
  })()
  // If the cap shrinks (model with fewer slots added), drop attachments
  // that no longer have a slot so we never send more than a model allows —
  // and TELL the user instead of dropping silently.
  const [refDropNotice, setRefDropNotice] = useState<string | null>(null)
  useEffect(() => { setRefDropNotice(null) }, [recipeMode])
  useEffect(() => {
    if (refSlotCount === 0) return
    const over = attachments.filter(a => (a.slotIndex ?? 0) >= refSlotCount).length
    if (over === 0) return
    setRefDropNotice(`${over} image${over > 1 ? 's' : ''} removed — the selected models accept up to ${refSlotCount} image${refSlotCount > 1 ? 's' : ''} together`)
    setAttachments(prev => prev.filter(a => (a.slotIndex ?? 0) < refSlotCount))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refSlotCount, recipeMode, attachments])

  const addModel    = (i: number, m: SlotModel) => {
    // Slots fill left-to-right (CC, July 20): picking into an EMPTY slot
    // always lands in the leftmost empty one (open the D picker with B
    // free -> the model appears in B). Replacing a filled slot stays put.
    const firstEmpty = selectedModels.findIndex(v => !v)
    const target = selectedModels[i] ? i : (firstEmpty === -1 ? i : firstEmpty)
    setSelectedModels(prev => prev.map((v, idx) => idx === target ? m : v))
    // New models adopt the run's recipe (Layer 2), not their own first mode.
    setSlotOptions(prev => prev.map((v, idx) => idx === target
      ? validateOpts(m, mode, { mode: recipeMode, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null })
      : v))
    setOptsOpen(prev => prev.map((v, idx) => idx === target ? false : v))
    setSlots([])  // clear any stale results from previous run
    setPhase('setup')
    setPickerSlot(null)
  }
  const removeModel = (i: number) => {
    // Compact left (CC, July 20): removing a middle model shifts the ones
    // to its right down, so filled slots always run A -> D with no gaps.
    // Options and open-panel flags travel with their model; the freed tail
    // slot resets. A generic left-compactor keeps the three arrays in sync.
    const compact = <T,>(arr: T[], empty: T): T[] => {
      const next = arr.filter((_, idx) => idx !== i)
      next.push(empty)
      return next
    }
    setSelectedModels(prev => compact(prev, null))
    setSlotOptions(prev => compact(prev, null))
    setOptsOpen(prev => compact(prev, false))
    setSlots([])  // clear any stale results from previous run
    setPhase('setup')
  }

  // RESTRICTED recipes have no fallback path: a model that cannot listen
  // cannot fake a transcription the way every text model can fake PDF
  // reading via extraction. A seat that doesn't declare the recipe is a
  // guaranteed failed slot — enforce continuously, not only at the moments
  // we remember to clear (owner bug, Aug 9: Gemini Flash sat in an
  // audio_to_text run as the "default"). Clearing the seat re-triggers the
  // default-model effect below, which reseats from the RECIPE's own pool.
  useEffect(() => {
    if (phase !== 'setup') return
    if (recipeMode !== 'audio_to_text') return
    setSelectedModels(prev => prev.some(m => m && !(m.modes ?? []).includes(recipeMode))
      ? prev.map(m => (m && !(m.modes ?? []).includes(recipeMode)) ? null : m)
      : prev)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeMode, phase, selectedModels])

  // Default model — every mode starts usable. When the studio is blank
  // (fresh mode/recipe, no template, nothing picked), pre-fill slot A with
  // the model OUR OWN BOARD ranks highest for this recipe (CC, Aug 3: the
  // default was Veo via a stale is_popular flag while the video board's
  // top seat was HappyHorse — the product should default to what it
  // recommends). Popularity/newest is only the fallback for recipes where
  // nothing is rated yet. Functional updates keep this atomic: if a
  // template apply or job restore lands first, the guards see a non-empty
  // array and no-op.
  useEffect(() => {
    if (phase !== 'setup' || activeTemplateId) return
    if (selectedModels.some(Boolean)) return
    let cancelled = false
    Promise.all([
      createSupabaseBrowser()
        .from('ai_models')
        .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
        .eq('enabled', true)
        .contains('output_modalities', [mode])
        .contains('modes', [recipeMode])
        .order('is_popular', { ascending: false })
        .order('released_at', { ascending: false, nullsFirst: false })
        .then(({ data }) => data ?? []),
      fetch(`/api/xboard?mode=${mode}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ])
      .then(([rows, board]: [any[], Array<{ modelId: string; xdScore: number }>]) => {
        if (cancelled || rows.length === 0) return
        const score = new Map(board.map(b => [b.modelId, b.xdScore]))
        // Highest XD score wins; rows keep the popular/newest order, so
        // unrated recipes fall back to exactly the old behaviour.
        const row = rows.reduce((best, r) =>
          (score.get(r.id) ?? -1) > (score.get(best.id) ?? -1) ? r : best, rows[0])
        const m: SlotModel = {
          id: row.id, provider: row.provider, model_name: row.model_name,
          display_name: row.display_name, modes: (row.modes ?? []) as ModelMode[],
          model_pricing: row.model_pricing, output_config: row.output_config, input_config: row.input_config ?? null,
        }
        setSelectedModels(prev => prev.some(Boolean) ? prev : prev.map((v, idx) => idx === 0 ? m : v))
        setSlotOptions(prev => prev.some(Boolean) ? prev : prev.map((v, idx) => idx === 0
          ? validateOpts(m, mode, { mode: recipeMode, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null })
          : v))
      })
    return () => { cancelled = true }
    // selectedModels is a dep ON PURPOSE (owner bug, Aug 9: Gemini sat in
    // an audio run): when the restricted-recipe guard above clears a seat,
    // THIS effect must re-run to reseat from the recipe's own pool — with
    // static deps it had already seen the old seats and returned. The
    // some(Boolean) guard keeps the loop closed: filled seats no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recipeMode, phase, activeTemplateId, selectedModels])

  // Layer 2: choose the processing recipe for the whole run. Drops any selected
  // model that doesn't support the new recipe, re-validates the rest, and
  // clears uploads (the required inputs change with the recipe).
  const selectRecipe = (r: ModelMode) => {
    setRecipeMode(r)
    setActiveTemplateId(null)
    setAttachments([])
    setSlots([]); setPhase('setup'); setChosenIdx(null)
    setSelectedModels(prev => prev.map(m => (m && (m.modes ?? []).includes(r)) ? m : null))
    setSlotOptions(prev => prev.map((o, i) => {
      const m = selectedModels[i]
      if (!m || !(m.modes ?? []).includes(r)) return null
      return validateOpts(m, mode, { ...(o ?? defaultOptions(m, mode)), mode: r })
    }))
  }

  // Like selectRecipe, but PRESERVES the current uploads — used when the
  // sub-mode change was inferred FROM an upload (wiping the file that
  // triggered the switch would be absurd).
  const switchRecipeKeepingUploads = (r: ModelMode) => {
    setRecipeMode(r)
    setSlots([]); setPhase('setup'); setChosenIdx(null)
    setSelectedModels(prev => prev.map(m => (m && (m.modes ?? []).includes(r)) ? m : null))
    setSlotOptions(prev => prev.map((o, i) => {
      const m = selectedModels[i]
      if (!m || !(m.modes ?? []).includes(r)) return null
      return validateOpts(m, mode, { ...(o ?? defaultOptions(m, mode)), mode: r })
    }))
  }

  // Infer the sub-mode from what the user just attached (Gemini/Kling
  // pattern: drop a photo → image-powered run, no menu required).
  // Respects an explicit multi-image choice (frames/references stay put).
  const inferRecipeFromUploads = (atts: Attachment[]): ModelMode | null => {
    const kinds  = atts.map(a => a.mediaType?.startsWith('video/') ? 'video' : a.mediaType?.startsWith('audio/') ? 'audio' : a.mediaType === 'application/pdf' ? 'pdf' : 'image')
    const nImg   = kinds.filter(k => k === 'image').length
    const hasVid = kinds.includes('video')
    const hasPdf = kinds.includes('pdf')
    const hasAud = kinds.includes('audio')
    if (mode === 'text') {
      if (hasAud) return 'audio_to_text'
      if (hasPdf) return 'pdf_to_text'
      if (hasVid) return 'video_to_text'
      return nImg > 0 ? 'image_to_text' : null
    }
    if (mode === 'image') return nImg > 0 ? 'image_edit' : null
    // video
    if (hasVid) return nImg > 0 ? 'video_edit'
      : (recipeMode === 'video_edit' || recipeMode === 'extend_video') ? recipeMode
      : 'video_to_video'
    // Audio alone means audio-driven video (Wan 3.0) — auto-switch like
    // every other upload type. Audio + images stays on the image logic
    // below; the provider carries the audio as an extra reference.
    if (hasAud && nImg === 0) return 'audio_to_video'
    if (nImg === 0) return null
    if (nImg === 1) {
      // A single image fits image_to_video — but don't fight an explicit
      // frames/references choice, which also starts with one image.
      if (recipeMode === 'reference_frames' || recipeMode === 'start_end_frames') return recipeMode
      return 'image_to_video'
    }
    // 2+ images: keep frames if chosen, otherwise references (1-N slots).
    if (recipeMode === 'start_end_frames') return recipeMode
    return 'reference_frames'
  }

  // Composer attachment handler: store, then auto-switch the sub-mode if
  // an upload implies one. Only on ADD (removals never switch), and never
  // while a template drives the slots.
  const handleComposerAttachments = async (next: Attachment[]) => {
    const grew = next.length > attachments.length
    // Video-mode audio: convert whatever the browser can decode (m4a/mp4/
    // aac/…) into what the models accept — wav/mp3, ≤15s (Wan 3.0 hard
    // limits). Runs before the state lands so the chip shows the real file.
    if (grew && mode === 'video') {
      for (const att of next) {
        if (!att.file || !att.mediaType.startsWith('audio/')) continue
        const norm = await normalizeAudioForVideo(att.file, 15)
        if (!norm) continue                    // undecodable — let the provider report
        if (norm.trimmed) alert(`${att.fileName}: using the first 15 seconds (the model's audio limit).`)
        if (norm.file !== att.file) {
          att.file = norm.file; att.mediaType = 'audio/wav'
          att.fileName = norm.file.name; att.fileSize = norm.file.size
        }
      }
    }
    setAttachments(next)
    if (!grew || activeTemplateId) return
    const r = inferRecipeFromUploads(next)
    if (r && r !== recipeMode) switchRecipeKeepingUploads(r)
  }

  // ── Polling helpers ─────────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  // Apply a /api/xcreate/job/[id] response to local state.
  const applyJobData = (data: { job: any; slots: any[] }) => {
    // Convert server slot format → SlotState
    const nextSlots: SlotState[] = data.slots.map(sl => ({
      text:         sl.text ?? '',
      isImage:      !!sl.isImage,
      isVideo:      !!sl.isVideo,
      streaming:    !!sl.streaming,
      done:         !!sl.done,
      cost:         Number(sl.cost ?? 0),
      responseTime: Number(sl.responseTime ?? 0),
      error:        sl.error ?? null,
      errorRef:     sl.errorRef ?? null,
    }))
    setSlots(nextSlots)

    // The address bar follows the run's row from the FIRST poll that knows
    // it (rows are born at run start): ?id=<row> is the one durable link —
    // refresh mid-run resumes via the running-job lookup in the ?id=
    // loader, refresh after settle opens the finished run. galleryLoadedRef
    // is stamped so the ?id= open-from-URL effect doesn't re-restore a run
    // already live on screen. Guarded against churn: replaceState only
    // when the bar doesn't already say so.
    if (data.job.xcreateId && typeof window !== 'undefined') {
      galleryLoadedRef.current = data.job.xcreateId
      const want = `?id=${data.job.xcreateId}`
      if (window.location.search !== want) {
        const url = new URL(window.location.href)
        url.search = want
        window.history.replaceState({}, '', url.toString())
      }
    }
    if (data.job.status === 'completed') {
      // Every seat failed → nothing to pick, nothing to continue. 'picking'
      // would freeze the composer with Start Over — which WIPES prompt and
      // attachments — as the only exit, killing a run the user could fix by
      // editing two characters (owner, Aug 20: a Runway moderation refusal
      // left the studio dead). Prompt, attachments, models and options are
      // all still in state, so return to setup and carry the failure into
      // the banner (the error cards clear with the slots).
      if (nextSlots.length > 0 && nextSlots.every(s => s.error)) {
        const first = nextSlots.find(s => s.error)
        setLoadError(`${first?.error ?? 'Generation failed.'}${first?.errorRef ? ` (Ref: ${first.errorRef.slice(0, 8)})` : ''}`)
        // The next Generate retries THIS row in place. If this run was
        // itself a retry, job.xcreateId is already the original row's id.
        setRetryOfId(data.job.xcreateId ?? null)
        setPhase('setup')
        setSlots([])
        setJobId(null)
        stopPolling()
        return
      }
      setPhase('picking')
      if (data.job.xcreateId) setXcreateId(data.job.xcreateId)
      setRetryOfId(null)
      setJobId(null)
      stopPolling()
    } else if (data.job.status === 'failed') {
      console.warn('[xcreate] job failed:', data.job.error)
      setPhase('setup')
      setJobId(null)
      stopPolling()
    }
  }

  const pollOnce = async (id: string) => {
    try {
      const res = await fetch(`/api/xcreate/job/${id}`, { cache: 'no-store' })
      if (res.status === 404) return  // job row may not exist yet in the first ~100ms after POST
      if (!res.ok) {
        console.warn('[xcreate] poll failed', res.status)
        stopPolling()
        return
      }
      const data = await res.json()
      // A reset (nav to bare /xcreate, Start Over) may have detached this
      // tab while the fetch was in flight — applying the stale result
      // would drag the fresh studio back to the abandoned run.
      if (activeJobRef.current !== id) return
      applyJobData(data)
    } catch (err) {
      console.error('[xcreate] poll error', err)
    }
  }

  const startPolling = (id: string) => {
    stopPolling()
    activeJobRef.current = id
    setJobId(id)
    // Poll immediately, then every 1s
    pollOnce(id)
    pollTimerRef.current = setInterval(() => pollOnce(id), 1000)
  }

  // Stop polling on unmount
  useEffect(() => () => stopPolling(), [])

  // Restore a job's state (prompt, mode, models, options, live slots) and
  // resume polling it. Shared by the legacy ?job= deep link below and by
  // the ?id= loader, which resumes the running job behind a row that is
  // still generating (rows are born at run start).
  const resumeJob = async (activeId: string) => {
    try {
      const res = await fetch(`/api/xcreate/job/${activeId}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()

      // Restore prompt + mode + selectedModels + slotOptions
      const jobMode = data.job.mode as Mode
      modeClearedRef.current = true  // prevent the mode-change useEffect from wiping state
      setMode(jobMode)
      setPrompt(data.job.prompt ?? '')

      // Look up SlotModel details for each slot (for the picker / options UI)
      const sb = createSupabaseBrowser()
      const modelIds = data.slots.map((s: any) => s.modelId)
      const { data: modelRows } = await sb.from('ai_models').select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config').in('id', modelIds)
      const byId: Record<string, SlotModel> = {}
      ;(modelRows ?? []).forEach((m: any) => {
        byId[m.id] = {
          id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
          modes:         (m.modes ?? []) as ModelMode[],
          model_pricing: m.model_pricing,
          output_config: m.output_config,
          input_config:  m.input_config ?? null,
        }
      })
      const restoredModels: (SlotModel | null)[] = [null, null, null, null]
      const restoredOptions: (SlotOptions | null)[] = [null, null, null, null]
      data.slots.forEach((s: any, i: number) => {
        const m = byId[s.modelId]
        if (m) restoredModels[i] = m
        const opts = s.options ?? {}
        restoredOptions[i] = {
          mode:         opts.mode ?? null,
          quality:      opts.quality ?? null,
          size:         opts.size ?? null,
          duration:     opts.duration ?? null,
          aspect_ratio: opts.aspect_ratio ?? null,
          watermark:    opts.watermark === true ? true : false,
          count:        opts.count ?? null,
        }
      })
      setSelectedModels(restoredModels)
      setSlotOptions(restoredOptions)
      setPhase('generating')

      applyJobData(data)
      if (data.job.status === 'running') startPolling(activeId)
    } catch (err) {
      console.error('[xcreate] resume failed', err)
    }
  }

  // Legacy ?job= deep link — old bookmarks and history entries only; the
  // app no longer writes ?job= anywhere (rows carry the durable ?id= from
  // birth — owner, Aug 20). Only opens the run the URL names: bare
  // /xcreate is a fresh canvas, and runs are concurrent server-side
  // (CC, July 26).
  useEffect(() => {
    if (!userId) return
    const activeId = searchJobParam
    if (!activeId) return
    // generate() is already polling this job in this tab — re-restoring
    // from the job row would clobber the live state.
    if (activeId === activeJobRef.current) return
    void resumeJob(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, searchJobParam])

  // Current balance, so the estimate line can warn BEFORE the user commits
  // rather than letting the server refuse afterwards. RLS on user_credits
  // allows an owner read, so the browser client is enough (same as profile).
  useEffect(() => {
    if (!userId) { setBalanceCents(null); return }
    let cancelled = false
    createSupabaseBrowser()
      .from('user_credits').select('balance_cents').eq('user_id', userId).maybeSingle()
      .then(({ data }: { data: { balance_cents?: number } | null }) => {
        if (!cancelled) setBalanceCents(data?.balance_cents ?? 0)
      })
    return () => { cancelled = true }
  }, [userId])

  const generate = async () => {
    // Mirror canGenerate: video / image with an attachment is enough to
    // proceed even if the prompt is empty (image_to_video, image_to_image,
    // reference_frames, etc. animate / transform the input file with no
    // text required).
    const hasAttachmentForGen = attachments.length > 0
    const promptOkForGen = prompt.trim().length >= 1 ||
      ((mode === 'video' || mode === 'image' || recipeMode === 'audio_to_text') && hasAttachmentForGen)
    if (!promptOkForGen || activeModels.length === 0 || phase === 'generating') return
    // A previous failure's banner (moderation refusal, upload error, 402)
    // must not sit above the fresh run it prompted the user to fire.
    setLoadError(null); setNeedsTopUp(false)
    setPhase('generating')
    setSlots(activeModels.map(() => ({ text: '', isImage: false, isVideo: false, streaming: true, done: false, cost: 0, responseTime: 0, error: null })))
    setChosenIdx(null); setChatHistory([]); setXcreateId(null)

    // Client-generated job id so we can start polling before POST returns.
    const newJobId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Fire POST but don't await its body — it runs for the full generation
    // duration and we read progress from the polling endpoint instead.
    // Build modelIds + modelOptions arrays in lockstep by walking
    // selectedModels directly. Don't use activeModels.map + indexOf — when
    // the same model is picked into two different slots, indexOf collapses
    // them onto the first slot's options.
    // Attachments live in the browser until this moment — upload them
    // now, before the POST. Roll the UI back if it fails: better no run
    // than a run whose input silently didn't make it.
    let committed: Attachment[]
    try {
      committed = await commitAttachments(attachments)
    } catch (err) {
      setPhase('setup'); setSlots([])
      setLoadError(`Couldn't upload ${err instanceof Error ? err.message : String(err)}. Please try again.`)
      return
    }
    if (committed !== attachments) setAttachments(committed)

    const ids: string[] = []
    const optsList: Array<Record<string, unknown>> = []
    for (let i = 0; i < selectedModels.length; i++) {
      const m = selectedModels[i]
      if (!m) continue
      const opts = slotOptions[i]
      ids.push(m.id)
      optsList.push(opts ? {
        quality:      opts.quality,
        size:         opts.size,
        duration:     opts.duration,
        aspect_ratio: opts.aspect_ratio,
        watermark:    opts.watermark,
        count:        opts.count,
        // These two were missing from this allow-list, which made the ⚙
        // panel a placebo for text runs: thinking and search rendered, saved
        // state, changed the estimate — and were dropped right here, one
        // line before the POST. Caught in the release test when a search-on
        // run answered "I don't have web access". (CC, Aug 2)
        thinking_level: opts.thinking_level,
        web_search:     opts.web_search,
        // Same allow-list, same trap as the two above: a toggle that never
        // reaches the POST is a placebo.
        generate_audio: opts.generate_audio ?? null,
        mode:         recipeMode,   // Layer-2 recipe applies to every slot
      } : { mode: recipeMode })
    }
    // The ?id= link exists the instant Generate is clicked (owner, Aug 20):
    // the row id is minted HERE, sent to the server (which births the row
    // under it), the address bar redirects to ?id=<row> synchronously, and
    // the sidebar history learns about it via the run-started event — no
    // waiting on a poll round-trip. A retry keeps its existing row id. If
    // the server ever rejects the minted id (collision), applyJobData's
    // poll-sync self-corrects the URL to the authoritative one.
    activeJobRef.current = newJobId
    const newRowId: string | null = retryOfId ??
      ((typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : null)
    if (newRowId && typeof window !== 'undefined') {
      galleryLoadedRef.current = newRowId  // don't let the ?id= loader re-open a run already live here
      const url = new URL(window.location.href)
      url.search = `?id=${newRowId}`
      window.history.replaceState({}, '', url.toString())
      window.dispatchEvent(new CustomEvent('xcreate:run-started', { detail: { id: newRowId, prompt, mode } }))
    }
    fetch('/api/xcreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: newJobId,
        rowId: newRowId,
        prompt, mode,
        retryOf: retryOfId,
        modelIds: ids,
        modelOptions: optsList,
        attachments: committed.map(a => ({ storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize })),
      }),
    })
      .then(async res => {
        if (res.ok) return
        // Gateway timeouts (504/502/524) mean the PROXY gave up holding this
        // response open — the serverless function is still running the job
        // and polling will deliver it. Treating them as failure made the
        // client kill its own polling and wipe cards while Kimi K3 was 90s
        // from finishing (CC, Aug 3). The POST is fire-and-forget; only a
        // real pre-run refusal below may stop the run.
        if (res.status === 504 || res.status === 502 || res.status === 524) {
          console.warn(`[xcreate] POST gateway timeout (${res.status}) — job continues, polling owns delivery`)
          return
        }
        // The balance gate returns 402 BEFORE any model runs, so this lands
        // within a second — well before polling has anything to show. Without
        // reading the response at all (the old fire-and-forget), a refusal was
        // completely invisible and the UI just span forever.
        const detail = await res.json().catch(() => null)
        stopPolling()
        setPhase('setup')
        // Clear the optimistic streaming slots too — without this the cards
        // keep spinning behind the error bar and the run looks stuck.
        setSlots([])
        // The refusal came before the stub row was born, so the optimistic
        // ?id= points at nothing — put the URL back. (A RETRY keeps its
        // ?id=: that row exists and still resolves.) The optimistic history
        // entry corrects itself on Nav's next refresh.
        if (!retryOfId && newRowId && typeof window !== 'undefined' && window.location.search === `?id=${newRowId}`) {
          urlClearedByCodeRef.current = true  // keep the refused run's state for editing
          const url = new URL(window.location.href)
          url.search = ''
          window.history.replaceState({}, '', url.toString())
          galleryLoadedRef.current = null
        }
        if (res.status === 402) {
          setNeedsTopUp(true)
          // The refusal carries the authoritative balance; adopt it so the
          // cost line's warning is correct immediately.
          if (typeof detail?.balanceCents === 'number') setBalanceCents(detail.balanceCents)
          setLoadError(detail?.message ?? 'Not enough credits for this run.')
        } else {
          setLoadError(detail?.error ?? `Generation failed (HTTP ${res.status}).`)
        }
      })
      .catch(err => console.warn('[xcreate] POST failed:', err))

    // Begin polling right away. First couple of polls may 404 until the
    // server has inserted the job row — pollOnce handles 404 gracefully.
    startPolling(newJobId)
  }

  // Workflow chain + edit-capable model list. Chain fetch tolerates a
  // pre-migration DB (missing root_id column) by collapsing to a
  // single-step strip instead of erroring.
  useEffect(() => {
    if (phase !== 'workflow' || !xcreateId) return
    let cancelled = false
    ;(async () => {
      const sb = createSupabaseBrowser()
      const { data: mrows } = await sb.from('ai_models')
        .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
        .eq('enabled', true)
      if (cancelled) return
      const fits = (mrows ?? []).filter((m: any) => {
        const mm: string[] = m.modes ?? []
        return mode === 'image' ? mm.includes('image_edit') : mm.some(x => x.startsWith('video_'))
      })
      setWfEditModels(fits)
      setWfModelId(prev => (prev && fits.some((m: any) => m.id === prev)) ? prev : (fits[0]?.id ?? null))

      const thumbOf = (row: any) => {
        const ss: any[] = Array.isArray(row.slots) ? row.slots : []
        const s = ss.find((x: any) => x.chosen) ?? ss.find((x: any) => x.text)
        // Stored URLs carry a 24h TTL; older steps may 403 and fall back to
        // the numbered placeholder. Good enough for v1 — the CURRENT step is
        // always freshly signed by the gallery-restore path.
        return { thumb: typeof s?.text === 'string' ? s.text.split('\n')[0] : null, isVideo: !!s?.isVideo }
      }
      // Board load with a graceful ladder for a partly-migrated database:
      //   board_id (groups several products)  →  root_id (one lineage)  →  self.
      // Selecting a column that doesn't exist is an ERROR from PostgREST
      // rather than an empty result, so each rung is tried and checked.
      const BOARD_COLS = 'id, slots, created_at, parent_id, parent_ids, board_id, node_kind'
      const PLAIN_COLS = 'id, slots, created_at, parent_id'
      let self: any = null
      {
        const a = await sb.from('xcreates')
          .select('id, slots, root_id, parent_id, parent_ids, board_id, node_kind')
          .eq('id', xcreateId).maybeSingle()
        if (!a.error) self = a.data
        else {
          const b = await sb.from('xcreates').select('id, slots, root_id, parent_id').eq('id', xcreateId).maybeSingle()
          self = b.data
        }
      }
      if (cancelled) return
      if (!self) { setWfChain([{ id: xcreateId, thumb: null, isVideo: false, parentId: null }]); return }

      const boardKey = wfBoardId ?? self.board_id ?? self.root_id ?? xcreateId
      let rows: any[] | null = null
      {
        const a = await sb.from('xcreates').select(BOARD_COLS)
          .eq('board_id', boardKey).is('deleted_at', null)
          .order('created_at', { ascending: true })
        if (!a.error && a.data && a.data.length > 0) rows = a.data
        else {
          // deleted_at filter belongs on BOTH rungs. It was only on the
          // board query at first, so on a pre-migration database a deleted
          // node vanished optimistically and then came straight back on the
          // next reload.
          const b = await sb.from('xcreates').select(PLAIN_COLS)
            .eq('root_id', self.root_id ?? xcreateId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
          if (!b.error && b.data && b.data.length > 0) rows = b.data
        }
      }
      if (cancelled) return
      const list = rows && rows.length > 0 ? rows : [self]
      // ONE NODE PER OUTPUT, not per row. A two-model run is two videos the
      // user was charged for separately; collapsing the row to a single node
      // hid the second one completely — CC generated a handbag video with
      // Gemini Omni Flash AND HappyHorse 1.1 and the board showed one clip.
      //
      // Edges stay ROW-level (parent_ids are row ids); the memo below maps
      // them onto whichever output node represents each parent row.
      const flat: any[] = []
      for (const r of list) {
        const ss: any[] = Array.isArray(r.slots) ? r.slots : []
        const parentRowIds: string[] = (Array.isArray(r.parent_ids) && r.parent_ids.length > 0)
          ? r.parent_ids
          : (r.parent_id ? [r.parent_id] : [])
        const usable = ss
          .map((sl: any, idx: number) => ({ sl, idx }))
          .filter(({ sl }) => typeof sl?.text === 'string' && sl.text && !sl.error)
        // A row whose every slot failed still deserves one node, so the user
        // can see (and delete) what they were charged for.
        const pool = usable.length > 0 ? usable : ss.slice(0, 1).map((sl: any, idx: number) => ({ sl, idx }))
        for (const { sl, idx } of pool) {
          flat.push({
            id: `${r.id}::${idx}`,
            rowId: r.id,
            slotIdx: idx,
            chosen: !!sl?.chosen,
            thumb: typeof sl?.text === 'string' ? sl.text.split('\n')[0] : null,
            isVideo: !!sl?.isVideo,
            parentRowIds,
            parentId: null,
            parentIds: [],
            kind: (r.node_kind ?? null) as any,
            label: sl?.name ?? sl?.model_name ?? undefined,
            cost: Number(sl?.cost ?? 0) || undefined,
          })
        }
      }
      setWfChain(flat)

      // Resolve the uploaded reference images behind these rows.
      try {
        const ir = await fetch('/api/xcreate/inputs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: list.map((r: any) => r.id) }),
        })
        if (ir.ok) {
          const d = await ir.json()
          if (!cancelled) {
            setWfInputs(d?.inputs ?? {})
            setWfOutUrls(d?.outputs ?? {})
          }
        }
      } catch { /* board still works without input nodes */ }
      // Remember the board so fan-outs and new source photos land on it.
      if (!wfBoardId) setWfBoardId(boardKey)
    })()
    return () => { cancelled = true }
  }, [phase, xcreateId, mode, wfReload, wfBoardId])

  // One workflow step: current output -> input of a fresh single-model run
  // (image_edit / video_to_video), through the normal reserve/settle
  // pipeline, with parent_id linking the chain server-side.
  const generateStep = async () => {
    if (!wfModelId || !xcreateId || wfPrompt.trim().length < 1) return
    const m: any = wfEditModels.find((x: any) => x.id === wfModelId)
    if (!m) return
    const stepRecipe = mode === 'image'
      ? 'image_edit'
      : ((m.modes ?? []).includes('video_edit') ? 'video_edit' : 'video_to_video')
    const parentAtSubmit = xcreateId
    const parentSlot = chosenIdx ?? 0
    const stepPrompt = wfPrompt.trim()
    const prevSlots = slots, prevModels = selectedModels, prevChosen = chosenIdx
    const newJobId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const model: SlotModel = {
      id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
      modes: (m.modes ?? []) as ModelMode[], model_pricing: m.model_pricing,
      output_config: m.output_config, input_config: m.input_config ?? null,
    }
    setPrompt(stepPrompt)
    setWfPrompt('')
    setWfSelHero(null)
    setSelectedModels([model, null, null, null])
    setSlotOptions([validateOpts(model, mode, { mode: stepRecipe as any, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null }), null, null, null])
    setSlots([{ text: '', isImage: false, isVideo: false, streaming: true, done: false, cost: 0, responseTime: 0, error: null }])
    setChosenIdx(null); setChatHistory([]); setXcreateId(null)
    setPhase('generating')
    fetch('/api/xcreate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: newJobId, prompt: stepPrompt, mode,
        modelIds: [wfModelId], modelOptions: [{ mode: stepRecipe }],
        parentId: parentAtSubmit, parentSlotIdx: parentSlot,
      }),
    })
      .then(async res => {
        if (res.ok) return
        const detail = await res.json().catch(() => null)
        stopPolling()
        // Refusal: put the workflow view back exactly as it was.
        setSelectedModels(prevModels); setSlots(prevSlots); setChosenIdx(prevChosen)
        setXcreateId(parentAtSubmit)
        setPhase('workflow')
        if (res.status === 402) {
          setNeedsTopUp(true)
          if (typeof detail?.balanceCents === 'number') setBalanceCents(detail.balanceCents)
          setLoadError(detail?.message ?? 'Not enough credits for this run.')
        } else {
          setLoadError(detail?.error ?? `Step failed (HTTP ${res.status}).`)
        }
      })
      .catch(err => console.warn('[xcreate] step POST failed:', err))
    startPolling(newJobId)
  }

  const reloadBoard = () => setWfReload(n => n + 1)

  const deleteNodes = async (picked: CanvasNode[]) => {
    if (picked.length === 0) return
    // Deletion is at ROW granularity: a row is one generation, one charge and
    // one gallery entry, so a two-output run goes together. Input nodes are
    // attachments with no row and are filtered out by the canvas already.
    const rowIds = [...new Set(picked.filter(n => !!n.rowId).map(n => n.rowId as string))]
    setWfSel([])
    if (rowIds.length === 0) return
    setWfChain(prev => prev.filter((n: any) => !rowIds.includes(n.rowId ?? n.id)))   // optimistic
    if (xcreateId && rowIds.includes(xcreateId)) setWfSelHero(null)
    try {
      const res = await fetch('/api/xcreate/node', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: rowIds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      setLoadError('Could not delete those nodes.')
    }
    reloadBoard()
  }

  // Upload → source nodes → straight onto the canvas. Costs nothing: no
  // model runs here, the photos just become the board's roots.
  const createProductBoard = async () => {
    if (pbAtts.length === 0 || pbBusy) return
    setPbBusy(true)
    try {
      let committed: Attachment[]
      try { committed = await commitAttachments(pbAtts) }
      catch { setLoadError('Upload failed — please try again.'); return }
      const res = await fetch('/api/xcreate/source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: committed.map(a => ({
            bucket: a.bucket, storagePath: a.storagePath, mediaType: a.mediaType,
            fileName: a.fileName, fileSize: a.fileSize,
          })),
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(d?.nodes) || d.nodes.length === 0) {
        setLoadError(d?.error ?? `Could not create the board (HTTP ${res.status}).`)
        return
      }
      const created: any[] = d.nodes
      setPbAtts([]); setPbOpen(false)
      setWfBoardId(d.boardId ?? created[0].id)
      setWfChain(created.map((n: any) => ({
        id: n.id, thumb: n.thumb, isVideo: !!n.isVideo,
        parentId: null, parentIds: [], kind: 'source' as const,
        label: n.label, cost: 0,
      })))
      // Open on the canvas with every uploaded photo selected, so "Generate
      // angles" is one click away and uses all views as reference.
      setXcreateId(created[0].id)
      setChosenIdx(0)
      setChatHistory([])
      setWfSel(created.map((n: any) => n.id))
      setWfSelHero({ url: created[0].thumb, isVideo: !!created[0].isVideo })
      setWfView('canvas')
      setPhase('workflow')
    } finally { setPbBusy(false) }
  }

  // The board's full node set. Inputs first (leftmost column), then one node
  // per generated output, then placeholders for in-flight jobs.
  const wfNodes = useMemo<CanvasNode[]>(() => {
    // Which output node stands in for a whole row when something points at
    // it: the chosen slot if there is one, else the first.
    const primary: Record<string, string> = {}
    for (const n of wfChain as any[]) {
      if (!n.rowId) continue
      if (!(n.rowId in primary) || n.chosen) primary[n.rowId] = n.id
    }
    // Attachments become INPUT nodes, deduped by storage path so the same
    // photo used by three generations is one node with three wires out.
    const inputNodes: CanvasNode[] = []
    const inputIdsByRow: Record<string, string[]> = {}
    const seen = new Set<string>()
    for (const [rowId, atts] of Object.entries(wfInputs)) {
      inputIdsByRow[rowId] = []
      for (const a of atts) {
        const id = `att::${a.storagePath}`
        inputIdsByRow[rowId].push(id)
        if (seen.has(id)) continue
        seen.add(id)
        inputNodes.push({
          id, thumb: a.url, isVideo: (a.mediaType || '').startsWith('video/'),
          parentId: null, parentIds: [], label: a.fileName,
          kind: 'input', attach: a,
        })
      }
    }
    const outputNodes: CanvasNode[] = (wfChain as any[]).map(n => {
      const parents = [
        ...((n.parentRowIds ?? []) as string[]).map(p => primary[p]).filter(Boolean),
        ...(inputIdsByRow[n.rowId] ?? []),
      ]
      // Prefer the re-signed URL; fall back to the stored one (which is
      // still valid for anything generated in the last hour).
      return { ...n, thumb: wfOutUrls[n.id] ?? n.thumb, parentId: parents[0] ?? null, parentIds: parents }
    })
    return [...inputNodes, ...outputNodes]
  }, [wfChain, wfInputs, wfOutUrls])

  const markBatch = (jobId: string, patch: Partial<{ status: 'running' | 'done' | 'error'; url: string; cost: number; error: string }>) =>
    setBatchRuns(prev => prev.map(r => r.jobId === jobId ? { ...r, ...patch } : r))

  // One interval drives every in-flight batch item; it dies when the last
  // item settles.
  const batchActive = batchRuns.some(r => r.status === 'running')
  useEffect(() => {
    if (!batchActive) return
    const iv = setInterval(async () => {
      for (const r of batchRunsRef.current.filter(x => x.status === 'running')) {
        try {
          const res = await fetch(`/api/xcreate/job/${r.jobId}`, { cache: 'no-store' })
          if (!res.ok) continue
          const d = await res.json()
          const s = (d.slots ?? [])[0]
          if (d.job?.status === 'running' && !s?.done) continue
          if (s?.error || d.job?.status === 'failed') {
            markBatch(r.jobId, { status: 'error', error: s?.error ?? d.job?.error ?? 'failed' })
          } else {
            markBatch(r.jobId, { status: 'done', url: typeof s?.text === 'string' ? s.text.split('\n')[0] : undefined, cost: s?.cost ?? 0 })
          }
        } catch { /* transient poll error — next tick retries */ }
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [batchActive])

  const runBatch = async () => {
    if (!wfModelId || batchAtts.length === 0 || batchActive) return
    let committed: Attachment[]
    try { committed = await commitAttachments(batchAtts) } catch { return }
    setBatchAtts(committed)
    const good = committed.filter(a => a.storagePath)
    if (good.length === 0) return
    const pr = (batchPrompt.trim() || prompt).trim()
    if (!pr) return
    const mkId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const runs = good.map(a => ({ jobId: mkId(), fileName: a.fileName, status: 'running' as const }))
    setBatchRuns(runs)
    good.forEach((a, i) => {
      // Staggered starts: ten simultaneous provider calls is a throttling
      // invitation; 600ms apart keeps the queue civil.
      setTimeout(() => {
        fetch('/api/xcreate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: runs[i].jobId, prompt: pr, mode: 'image',
            modelIds: [wfModelId], modelOptions: [{ mode: 'image_edit' }],
            attachments: [{ storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize }],
          }),
        })
          .then(async res => {
            if (res.ok) return
            const d = await res.json().catch(() => null)
            markBatch(runs[i].jobId, { status: 'error', error: d?.message ?? d?.error ?? `HTTP ${res.status}` })
          })
          .catch(() => markBatch(runs[i].jobId, { status: 'error', error: 'network error' }))
      }, i * 600)
    })
  }

  const pickModel = async (idx: number) => {
    if (!userId) return
    setChosenIdx(idx)
    const chosen  = activeModels[idx]

    // "Generate more with X" = record the vote, then START OVER with the
    // winner pre-selected (July 2026, CC) — NOT chat continuation. The
    // label always promised fresh generation; now the behavior matches.
    // Prompt + attachments are kept so the user can tweak and re-run;
    // the winner carries ITS slot options (size/quality/count) into
    // slot A. Chat plumbing stays for gallery-restored runs.
    // Build the match report from THIS run before any state resets — the
    // closures below still see the pre-reset slots/models.
    const scores = computeMatchScores(activeModels.map((m, i) => ({
      votePts:      i === idx ? 1 : 0,
      responseTime: slots[i]?.responseTime ?? 0,
      cost:         slots[i]?.cost ?? 0,
      error:        !!slots[i]?.error,
    })))
    setMatchResult({
      eyebrow: `Run complete · ${activeModels.length} model${activeModels.length > 1 ? 's' : ''} · ${mode}`,
      title:   `${chosen.display_name} wins`,
      winnerName: chosen.display_name,
      winnerProvider: chosen.provider,
      entries: activeModels.map((m, i) => ({
        name:         m.display_name,
        provider:     m.provider,
        score:        scores[i],
        responseTime: slots[i]?.responseTime ?? 0,
        cost:         slots[i]?.cost ?? 0,
        isPick:       i === idx,
        error:        !!slots[i]?.error,
      })),
    })
    setMatchDelta(undefined)

    if (mode !== 'text' && xcreateId) {
      // Workflow continuation (CC, July 26): picking an image/video winner
      // lands on this creation's workflow view — the exact moment users
      // said they wanted to keep editing — instead of resetting to a blank
      // composer. chosenIdx was set at the top of this function, so the
      // workflow hero already knows which slot won. Text keeps the July
      // reset since its continuation surface is the chat.
      setOptsOpen([false, false, false, false])
      setPhase('workflow')
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      const rawIndices = selectedModels.map((m, i) => (m ? i : -1)).filter(i => i >= 0)
      const carried = slotOptions[rawIndices[idx] ?? idx]
      setSelectedModels([chosen, null, null, null])
      setSlotOptions([
        validateOpts(chosen, mode, carried ?? { mode: recipeMode, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null }),
        null, null, null,
      ])
      setOptsOpen([false, false, false, false])
      setSlots([])
      setChatHistory([])
      setChosenIdx(null)
      setPhase('setup')
      flashComposer()
    }

    const sb = createSupabaseBrowser()

    // Snapshot the winner's rating BEFORE the vote lands (for the delta).
    const ratingsBefore: any[] | null = await fetch(`/api/xboard?mode=${mode}`)
      .then(r => r.json()).catch(() => null)

    // Save to DB with chosen model recorded.
    //
    // The server route inserts the xcreates row at the end of /api/xcreate
    // (with chosen_model_id = null) and returns its id via the polling
    // endpoint as `xcreateId`. We therefore *update* that existing row
    // here — inserting a duplicate row was the previous behaviour and
    // had two failure modes:
    //
    //   1. The original server-inserted row stayed at chosen_model_id = null
    //      and got filtered out of the leaderboard's BT calculation,
    //      so HappyHorse I2V / any winner never accumulated votes.
    //   2. RLS / constraint failures on the duplicate insert silently
    //      dropped the vote with no user-visible error.
    //
    // Falls back to insert if xcreateId is missing for some reason
    // (e.g. polling lost the id, gallery-loaded run, etc.).
    //
    // Note: chat_history was previously written here too but it caused
    // failures on dev DBs that haven't run supabase/17_xcreate_chat_history.sql.
    // sendChat() reseeds the chat history once the user actually starts
    // chatting, so dropping it here is safe — the leaderboard only cares
    // about chosen_model_id.
    const slotsPayload = slots.map((s, i) => ({
      id: activeModels[i]?.id, name: activeModels[i]?.display_name, provider: activeModels[i]?.provider,
      model_name: activeModels[i]?.model_name,
      text: s.text, isImage: s.isImage, isVideo: s.isVideo, cost: s.cost, responseTime: s.responseTime,
      chosen: i === idx,
    }))
    if (xcreateId) {
      const { error } = await sb.from('xcreates').update({
        chosen_model_id: chosen.id,
        slots: slotsPayload,
      }).eq('id', xcreateId)
      if (error) {
        console.warn('[xcreate] update chosen_model_id failed:', error.message)
        // Fallback to insert so the vote isn't lost — same payload as before.
        const { data } = await sb.from('xcreates').insert({
          user_id: userId, mode, prompt,
          chosen_model_id: chosen.id,
          slots: slotsPayload,
          input_attachments: attachments.map(a => ({ storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize })),
        }).select('id').single()
        if (data?.id) setXcreateId(data.id)
      }
    } else {
      const { data } = await sb.from('xcreates').insert({
        user_id: userId, mode, prompt,
        chosen_model_id: chosen.id,
        slots: slotsPayload,
        input_attachments: attachments.map(a => ({ storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize })),
      }).select('id').single()
      if (data?.id) setXcreateId(data.id)
    }

    // XDRating delta for the match report: the vote is written above (the
    // DB trigger updated the aggregates in-transaction), so refit and read
    // back the winner's score. Fire-and-forget relative to the UI.
    ;(async () => {
      try {
        const beforeRows = ratingsBefore
        const before = beforeRows?.find((r: any) => r.modelId === chosen.id)?.xdScore ?? null
        await fetch('/api/xdrating/refit?source=vote&force=1', { method: 'POST' })
        const rows = await fetch(`/api/xboard?mode=${mode}`).then(r => r.json())
        const after = rows.find((r: any) => r.modelId === chosen.id)?.xdScore ?? null
        setMatchDelta(before !== null && after !== null ? { before, after } : null)
      } catch (err) {
        console.warn('[xcreate] rating delta unavailable:', err)
        setMatchDelta(null)
      }
    })()
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatStreaming || chosenIdx === null) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: userMsg }]
    setChatHistory(newHistory)
    setChatStreaming(true)

    const chosen = activeModels[chosenIdx]
    try {
      const res = await fetch('/api/xcreate/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: chosen.id,
          messages: newHistory,
          mode,
          xcreateId,                                  // groups chat charges by conversation
          previousResponseId: imageResponseId,       // OpenAI multi-turn
          conversationHistory: imageConvHistory,      // Google multi-turn
        }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', currentEvent = '', assistantText = ''

      // For image/video we add a placeholder immediately; for text we stream into it
      if (mode === 'text') {
        setChatHistory(h => [...h, { role: 'assistant', content: '' }])
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            try {
              const p = JSON.parse(line.slice(6))
              if (currentEvent === 'delta') {
                // text streaming
                assistantText += p.text ?? ''
                setChatHistory(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: assistantText } : m))
              } else if (currentEvent === 'image') {
                // image done — append as image message
                setChatHistory(h => [...h, { role: 'assistant', content: p.url, isImage: true }])
                // Update multi-turn context for next image edit
                if (p.responseId) setImageResponseId(p.responseId)
                if (p.conversationHistory) setImageConvHistory(p.conversationHistory)
              } else if (currentEvent === 'video') {
                // video done — append as video message
                setChatHistory(h => [...h, { role: 'assistant', content: p.url, isVideo: true }])
              } else if (currentEvent === 'progress') {
                // could show progress in future
              } else if (currentEvent === 'error') {
                setChatHistory(h => [...h, { role: 'assistant', content: `Error: ${p.message}` }])
              }
            } catch {}
          }
        }
      }
    } catch (err) { console.error(err) }
    setChatStreaming(false)

    // Persist updated chat history to DB so it survives navigation.
    // We read from the setter to get the latest state (setChatHistory closures
    // may be stale). Instead, schedule a microtask that reads the ref-like latest.
    setTimeout(() => {
      // Access latest chatHistory via a one-shot state read
      setChatHistory(latest => { saveChatHistory(latest); return latest })
    }, 0)
  }

  // Persist chat history to DB so it survives navigation.
  const saveChatHistory = async (history: ChatMessage[], xid?: string | null) => {
    const id = xid ?? xcreateId
    if (!id || history.length === 0) return
    try {
      const sb = createSupabaseBrowser()
      // Strip large data URLs from persisted content — store a placeholder instead.
      // Images/videos generated by the API are also saved to Supabase storage and
      // referenced via signed URLs on reload, so we only need the URL, not inline data.
      const cleaned = history.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.isImage ? { isImage: true } : {}),
        ...(m.isVideo ? { isVideo: true } : {}),
      }))
      // Also persist multi-turn context so it survives navigation
      const updatePayload: any = { chat_history: cleaned }
      if (imageResponseId) updatePayload.response_id = imageResponseId
      await sb.from('xcreates').update(updatePayload).eq('id', id)
    } catch (err) { console.warn('[xcreate] failed to save chat history:', err) }
  }

  // Apply a template: set mode, pre-pick recommended models (matched by
  // model_name from the live catalog), apply per-slot options (input
  // shape + aspect ratio + duration), and fill the prompt. The user can
  // edit anything after — templates are starting points, not contracts.
  const applyTemplate = async (t: Template) => {
    // Block the mode-change effect from wiping the state we're setting.
    modeClearedRef.current = true

    setMode(t.mode as Mode)
    setRecipeMode((t.slotMode as ModelMode) ?? RECIPES[t.mode as Mode][0].id)
    setPrompt(t.starterPrompt)
    setAttachments([])
    setActiveTemplateId(t.id)
    setSlots([])
    setPhase('setup')
    setChosenIdx(null)
    setChatHistory([])

    // Look up recommended models from the live catalog.
    const sb = createSupabaseBrowser()
    const { data: rows } = await sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
      .eq('enabled', true)
      .in('model_name', t.recommendedModels)
    const ordered = t.recommendedModels
      .map(name => (rows ?? []).find((r: any) => r.model_name === name))
      .filter(Boolean) as any[]

    const newSelected: (SlotModel | null)[] = [null, null, null, null]
    ordered.slice(0, 4).forEach((m, i) => {
      newSelected[i] = {
        id:            m.id,
        provider:      m.provider,
        model_name:    m.model_name,
        display_name:  m.display_name,
        modes:         (m.modes ?? []) as ModelMode[],
        model_pricing: m.model_pricing,
        output_config: m.output_config,
        input_config:  m.input_config ?? null,
      }
    })
    setSelectedModels(newSelected)

    // Per-slot options: prefer the template's slot mode + aspect ratio +
    // duration; validateOpts clamps anything the model doesn't actually
    // support (e.g. Veo locks duration to 8s for start_end_frames).
    const newOpts: (SlotOptions | null)[] = [null, null, null, null]
    newSelected.forEach((m, i) => {
      if (!m) return
      const base: SlotOptions = defaultOptions(m, t.mode as Mode)
      const proposed: SlotOptions = {
        ...base,
        mode:         (t.slotMode as ModelMode) ?? base.mode ?? null,
        aspect_ratio: t.aspectRatio ?? base.aspect_ratio ?? null,
        duration:     t.duration    ?? base.duration     ?? null,
      }
      newOpts[i] = validateOpts(m, t.mode as Mode, proposed)
    })
    setSlotOptions(newOpts)

    // Bring the composer into view and flash it so the pre-fill is
    // visible even when the template was clicked from the galleries
    // below the prompt box.
    flashComposer()

    // Templates that ship a sample doc (e.g. Earnings Report Analysis)
    // auto-attach it through the same storage pipeline as a real upload,
    // so the template is one click from a run. setAttachments([]) above
    // already cleared the previous template's sample.
    if (t.sampleUrl) {
      setAttachingSample(true)
      const att = await attachSampleFile(
        t.sampleUrl,
        t.sampleName ?? 'sample.txt',
        t.sampleType ?? 'text/plain',
        'xcreate',
      )
      setAttachingSample(false)
      if (att) setAttachments([{ ...att, slotIndex: 0 }])
      // Say so rather than leaving a prompt that references a document
      // the user can't see. They can still attach their own and run.
      else setLoadError(`Couldn't load the sample file for "${t.title}". Attach your own document to run this template.`)
    }
  }

  // ?template=<id> — apply the preset named in the URL, once. Declared here
  // rather than beside the other deep-link effects because it calls
  // applyTemplate, and reading it next to the thing it runs is worth more
  // than grouping the params together.
  //
  // An unknown id is ignored rather than surfaced as an error: the URL is a
  // suggestion, and a template that has since been renamed should leave the
  // visitor in a working studio, not an error state. Same consume-and-strip
  // as ?model=, for the same reason — once applied it is no longer true, and
  // a refresh should not silently undo the user's edits.
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Read the URL directly rather than through useSearchParams(). The hook
    // works, but it resolves a render later inside this Suspense boundary,
    // and a one-shot deep link only ever wants the value that was in the
    // address bar when the page opened. window.location is already correct
    // by the time any effect runs, which makes this immune to the ordering.
    // The hook stays in the dep list so an in-app navigation to a different
    // ?template= still re-fires. (CC, Aug 5)
    const id = new URLSearchParams(window.location.search).get('template')
    if (!id) return
    if (templateLinkRef.current === id) return
    templateLinkRef.current = id
    const strip = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('template')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
    const t = XCREATE_TEMPLATES.find(x => x.id === id)
    if (!t) { strip(); return }
    void (async () => {
      await applyTemplate(t)
      // Strip ONLY once we know the visitor is signed in. XCreate is gated,
      // so an arriving stranger gets the auth modal — which falls back to the
      // current URL for its post-login destination, and OAuth reloads the
      // page. Stripping before that point signs them in to an empty studio
      // and quietly loses the request that brought them here. (CC, Aug 5)
      const { data } = await createSupabaseBrowser().auth.getUser()
      if (data.user) strip()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTemplateParam])

  const reset = () => {
    // Detach from any run still polling — otherwise the next poll drags the
    // fresh studio straight back to the old run (URL re-sync + slot
    // repopulation). The generation itself continues server-side and lands
    // in the sidebar history; only this tab lets go.
    stopPolling()
    activeJobRef.current = null
    galleryLoadedRef.current = null
    // A clean studio has no leftover error bar (same staleness family as
    // the history-click case: the banner only ever cleared on dismiss).
    setLoadError(null); setNeedsTopUp(false)
    setPhase('setup'); setSlots([]); setChosenIdx(null)
    setChatHistory([]); setChatInput(''); setXcreateId(null)
    setRetryOfId(null)
    setPrompt(''); setAttachments([])
    setSelectedModels([null, null, null, null])
    setSlotOptions([null, null, null, null])
    setActiveTemplateId(null)
    setImageResponseId(null); setImageConvHistory(null)
    // Strip ?id=... from the URL so refreshing doesn't re-load the
    // run we just abandoned, and so the address bar matches the fresh
    // setup state.
    if (typeof window !== 'undefined' && window.location.search) {
      urlClearedByCodeRef.current = true
      const url = new URL(window.location.href)
      url.search = ''
      window.history.replaceState({}, '', url.toString())
    }
  }

  // Clicking XCREATE in the nav (or pressing Back) navigates to bare
  // /xcreate — a searchParams-only navigation, so this component instance
  // SURVIVES and the previous run's view kept squatting what should be a
  // clean studio (owner, Aug 20). When ?id= transitions to nothing and the
  // clear didn't come from our own replaceState bookkeeping, reset to a
  // fresh composer.
  const prevIdParamRef = useRef<string | null>(searchIdParam)
  useEffect(() => {
    const prev = prevIdParamRef.current
    prevIdParamRef.current = searchIdParam
    if (searchIdParam || !prev) return
    if (urlClearedByCodeRef.current) { urlClearedByCodeRef.current = false; return }
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIdParam])

  // Load a saved creation back into the Create tab so the user can continue
  // chatting with any model from that run. `continueIdx` is the index into the
  // stored slots array for the model they want to continue with. If omitted,
  // we default to the chosen model (or the first slot if none was chosen).
  // Multi-turn chat history isn't persisted yet — only the initial exchange
  // is restored; further conversation starts fresh.
  const loadFromGallery = async (item: GalleryItem, continueIdx?: number) => {
    const rawSlots = (item.slots ?? []).filter(Boolean)
    const itemMode = item.mode as Mode
    const sb = createSupabaseBrowser()

    // Block the mode-change useEffect from wiping the state we're about to set.
    modeClearedRef.current = true
    setMode(itemMode)
    setPrompt(item.prompt)
    // Restore the original uploads (rows created July 19+ persist them).
    // Signed URLs give images their previews — owner-read storage policy
    // lets the browser client sign its own objects.
    const savedInputs = (item.input_attachments ?? []).filter(a => a?.storagePath)
    if (savedInputs.length > 0) {
      const restored: Attachment[] = await Promise.all(savedInputs.map(async (a, idx) => {
        let previewUrl: string | undefined
        if (a.mediaType?.startsWith('image/')) {
          try {
            const { data: signed } = await sb.storage.from(a.bucket).createSignedUrl(a.storagePath, 60 * 60)
            previewUrl = signed?.signedUrl ?? undefined
          } catch { /* preview is optional */ }
        }
        // slotIndex is stripped when the run is persisted (the POST keeps
        // only storage/meta fields), and LabeledSlotsPicker matches slots by
        // `slotIndex ?? -1` — without re-tagging, a restored attachment
        // matches NO slot and is invisible in the composer even though it's
        // in state (owner, Aug 20). The persisted array is slot-sorted, so
        // array position is the best surviving record of slot placement.
        return { ...a, previewUrl, slotIndex: idx }
      }))
      setAttachments(restored)
    } else {
      setAttachments([])
    }

    // A row with NO slots is a birth-stub whose run died before writing any
    // outputs (rows are born at run start). Its inputs are restored above —
    // land in a live composer, re-runnable in place, instead of a blank
    // studio. Slot options died with the job, so the recipe resets to the
    // mode's default.
    if (rawSlots.length === 0) {
      setLoadError('This run never finished. Your prompt and files are restored — hit Generate to run it again.')
      setRecipeMode(RECIPES[itemMode][0].id)
      setSlots([]); setXcreateId(null); setRetryOfId(item.id)
      setChosenIdx(null); setChatHistory([]); setPhase('setup')
      return
    }

    // Fetch current model details for each slot (pricing/options have to be
    // pulled from the live table — the stored slot only keeps id/name/text).
    // Persisted slots carry the model UUID as `model_id` (route.ts writes
    // model_id, never id) — older/other shapes used `id`. Accept both, or
    // every lookup below misses and the synthetic fallback seats a model
    // with an INVENTED UUID that the retry POST can't resolve ("No valid
    // models found" — owner, Aug 20).
    const slotModelId = (s: any): string | null => s.id ?? s.model_id ?? null
    const modelIds = rawSlots.map((s: any) => slotModelId(s)).filter(Boolean)
    const { data: modelRows } = await sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
      .in('id', modelIds)
    const byId: Record<string, SlotModel> = {}
    ;(modelRows ?? []).forEach((m: any) => {
      byId[m.id] = {
        id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
        modes:         (m.modes ?? []) as ModelMode[],
        model_pricing: m.model_pricing,
        output_config: m.output_config,
        input_config:  m.input_config ?? null,
      }
    })

    // Also index by (provider, model_name) so we can recover if the UUID
    // changed after a sync (the sync script can delete+re-insert rows).
    const byProviderModel: Record<string, SlotModel> = {}
    ;(modelRows ?? []).forEach((m: any) => {
      byProviderModel[`${m.provider}/${m.model_name}`] = byId[m.id]
    })

    // If UUID lookup missed some slots, try a secondary lookup by (provider, model_name)
    const missingSlots = rawSlots.filter((s: any) => slotModelId(s) && !byId[slotModelId(s)!] && s.provider && s.model_name)
    if (missingSlots.length > 0) {
      // Fetch by provider+model_name pairs
      const orFilters = missingSlots.map((s: any) => `and(provider.eq.${s.provider},model_name.eq.${s.model_name})`).join(',')
      const { data: fallbackRows } = await sb.from('ai_models')
        .select('id, provider, model_name, display_name, modes, model_pricing, output_config, input_config')
        .or(orFilters)
      ;(fallbackRows ?? []).forEach((m: any) => {
        const key = `${m.provider}/${m.model_name}`
        const slot = byProviderModel[key] ?? {
          id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
          modes:         (m.modes ?? []) as ModelMode[],
          model_pricing: m.model_pricing,
          output_config: m.output_config,
          input_config:  m.input_config ?? null,
        }
        byProviderModel[key] = slot
        // Map old UUID → new model
        missingSlots.filter((s: any) => s.provider === m.provider && s.model_name === m.model_name)
          .forEach((s: any) => { byId[slotModelId(s)!] = slot })
      })
    }

    const restoredModels:  (SlotModel | null)[]   = [null, null, null, null]
    const restoredOptions: (SlotOptions | null)[] = [null, null, null, null]
    const restoredSlots:   SlotState[]            = []

    rawSlots.slice(0, 4).forEach((s: any, i: number) => {
      // Try UUID first, then fall back to (provider, model_name), then
      // build a minimal SlotModel from the stored slot data so Continue
      // still works even if the model was removed from the DB entirely.
      const mid = slotModelId(s)
      let m: SlotModel | null = mid ? byId[mid] : null
      if (!m && s.provider && s.model_name) {
        m = byProviderModel[`${s.provider}/${s.model_name}`] ?? null
      }
      if (!m && (mid || s.model_name)) {
        // Synthetic fallback — enough to render the card and call the API
        m = {
          id: mid ?? crypto.randomUUID(),
          provider: s.provider ?? 'openai',
          model_name: s.model_name ?? 'unknown',
          display_name: s.name ?? s.model_name ?? 'Unknown Model',
          modes: [],
          model_pricing: null,
          output_config: null,
        }
      }
      if (m) {
        restoredModels[i] = m
        // Restore the exact options the slot ran with (mode/quality/size/
        // duration/aspect_ratio/watermark/count). Passing the saved blob
        // through validateOpts canonicalizes anything that's missing or
        // no longer valid against the current model definition (e.g. a
        // size that's since been removed from the catalog).
        const savedOpts = s.options && typeof s.options === 'object'
          ? {
              mode:         s.options.mode         ?? null,
              quality:      s.options.quality      ?? null,
              size:         s.options.size         ?? null,
              duration:     s.options.duration     ?? null,
              aspect_ratio: s.options.aspect_ratio ?? null,
              watermark:    typeof s.options.watermark === 'boolean' ? s.options.watermark : false,
              count:        s.options.count        ?? null,
            }
          : null
        restoredOptions[i] = savedOpts
          ? validateOpts(m, itemMode, savedOpts)
          : defaultOptions(m, itemMode)
      }
      restoredSlots.push({
        text:         s.text ?? '',
        isImage:      !!s.isImage,
        isVideo:      !!s.isVideo,
        streaming:    false,
        done:         true,
        cost:         Number(s.cost ?? 0),
        responseTime: Number(s.responseTime ?? 0),
        error:        s.error ?? null,
        errorRef:     s.errorRef ?? null,
      })
    })

    // Re-sign any expired Supabase signed URLs in slot.text. Stored URLs
    // were minted with a 24h TTL, so anything older than a day comes back
    // as a broken image without this step. Same logic as the profile
    // page's gallery hydrate.
    const refreshedSlots = await Promise.all(restoredSlots.map(async (slot) => {
      if (!slot.text || typeof slot.text !== 'string') return slot
      const parts = slot.text.split('\n')
      const fresh = await Promise.all(parts.map(async (part: string) => {
        const m = part.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
        if (!m) return part
        const [, bucket, path] = m
        const { data: signed } = await sb.storage.from(bucket).createSignedUrl(decodeURIComponent(path), 60 * 60 * 24)
        return signed?.signedUrl ?? part
      }))
      return { ...slot, text: fresh.join('\n') }
    }))

    setSelectedModels(restoredModels)
    setSlotOptions(restoredOptions)
    setSlots(refreshedSlots)
    setXcreateId(item.id)

    // Decide which slot to continue with.
    //
    // Two paths into loadFromGallery:
    //   1. Explicit "Continue with X" click from the picker → pass
    //      continueIdx. Jump straight to chatting with that slot.
    //   2. Deep-link reopen via /xcreate?id=<uuid> → continueIdx is
    //      undefined. Even if the row has a stored chosen_model_id from
    //      a previous session, default to PICKING so the user sees all
    //      models' results side-by-side. They can click "Continue with
    //      X" again to dive back into chatting. Previously this auto-
    //      jumped to chatting and hid the other two results, which read
    //      as "I can't see all results from all models" on revisit.
    let targetIdx: number | null = null
    if (typeof continueIdx === 'number' && continueIdx >= 0 && continueIdx < rawSlots.length) {
      targetIdx = continueIdx
    }

    if (targetIdx !== null && restoredModels[targetIdx]) {
      setChosenIdx(targetIdx)
      // Restore multi-turn image context from stored slot data
      const targetSlot = rawSlots[targetIdx] as any
      setImageResponseId(targetSlot?.responseId ?? null)
      setImageConvHistory(targetSlot?.conversationHistory ?? null)
      // Restore persisted chat history if available, otherwise seed with initial exchange.
      const saved = Array.isArray(item.chat_history) && item.chat_history.length > 0
        ? item.chat_history
        : null
      if (saved) {
        setChatHistory(saved)
      } else {
        const initial = restoredSlots[targetIdx]
        setChatHistory([
          { role: 'user',      content: item.prompt },
          { role: 'assistant', content: initial.text, isImage: initial.isImage, isVideo: initial.isVideo },
        ])
      }
      // Text continuation is a conversation; image/video continuation is
      // the workflow view (CC, July 26).
      setPhase(itemMode === 'text' ? 'chatting' : 'workflow')
    } else {
      // Every slot failed → the workflow board would show one dead node,
      // and picking would freeze a composer whose only exit (Start Over)
      // wipes the prompt + attachments this function just restored. Land in
      // setup instead, with the failure in the banner: the dead run reopens
      // as an instantly editable one (owner, Aug 20). xcreateId goes back to
      // null so the retry writes a fresh row; the failed row stays in the
      // gallery as the record of what happened.
      if (restoredSlots.length > 0 && restoredSlots.every(s => s.error)) {
        const first = restoredSlots.find(s => s.error)
        setLoadError(`${first?.error ?? 'Generation failed.'}${first?.errorRef ? ` (Ref: ${first.errorRef.slice(0, 8)})` : ''}`)
        // The [mode] effect's recipe reset was skipped via modeClearedRef,
        // so recipeMode still belongs to the PREVIOUS mode. Restore the
        // recipe the run actually used — otherwise the composer renders the
        // wrong slot layout and the re-tagged attachments stay hidden.
        const savedRecipe = restoredOptions.find(Boolean)?.mode
        if (savedRecipe && RECIPES[itemMode].some(r => r.id === savedRecipe)) {
          setRecipeMode(savedRecipe)
        }
        setSlots([])
        setXcreateId(null)
        setRetryOfId(item.id)  // Generate retries this row in place
        setChosenIdx(null); setChatHistory([]); setPhase('setup')
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      // Reopening a finished run shows THE RUN (owner, Aug 20): prompt in
      // the locked composer, each model's card with its output, cost and
      // speed — the exact view live completion leaves behind. (July 27
      // routed single/decided image+video runs straight to the workflow
      // board instead, which shows the output node and none of that.)
      // A recorded winner carries into chosenIdx so a decided run reads
      // as a record, not a re-vote — the pick affordances gate on
      // chosenIdx === null — and the board stays reachable through the
      // per-card "Continue on canvas" button.
      const chosenStored = rawSlots.findIndex((sl: any) => sl?.chosen)
      setChosenIdx(chosenStored >= 0 ? chosenStored : null)
      setChatHistory([])
      setPhase('picking')
    }

    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // In video (and image) mode, an attached image alone is enough to drive
  // generation — image_to_video / image_to_image / reference_frames etc. all
  // animate / transform the file with no text needed. The prompt-length gate
  // would otherwise force the user to invent a text caption they don't want.
  // Text mode still requires a prompt (no other input shape exists).
  const hasAttachment = attachments.length > 0
  // audio_to_text is text mode's one attachment-driven shape (owner, Aug 9):
  // the audio IS the input, and an empty prompt means plain transcription.
  // Models that hard-require prompt text declare
  // output_config.<mode>.prompt_required (H3 400s upstream on an empty
  // text part, code 2013) — block at the composer with a named reason
  // instead of letting the provider refuse after the run starts.
  const promptRequiredBy = prompt.trim().length === 0
    ? activeModels.filter((m: any) => m?.output_config?.[mode]?.prompt_required)
    : []
  const promptOk = (prompt.trim().length >= 3 ||
    ((mode === 'video' || mode === 'image' || recipeMode === 'audio_to_text') && hasAttachment)) &&
    promptRequiredBy.length === 0
  const canGenerate = promptOk && activeModels.length > 0 && phase !== 'generating' && !attachingSample

  // Once the user fires a generation, every setup control (mode tabs,
  // model picker, per-slot options, prompt, attachment) freezes — we
  // don't want them mutating state behind already-rendered results.
  // The only way out is the Start Over button (which calls reset()).
  const isLocked = phase !== 'setup'

  // Estimated input tokens contributed by attached documents: txt/PDF at
  // ~bytes/4, capped at 50k tokens per file to mirror the server's 200k-char
  // fold guardrail (CC caught the estimate ignoring a huge PDF, July 23).
  const docTokens = attachments.reduce((sum, a) =>
    (a.mediaType === 'application/pdf' || a.mediaType.startsWith('text/'))
      ? sum + Math.min(Math.ceil((a.fileSize ?? 0) / 4), 50_000)
      : sum, 0)

  // Sum of per-slot USD estimates for the currently-selected models at their
  // currently-selected options. Null if no slot has pricing — in that case
  // we'd rather show nothing than a misleading partial total.
  const totalEstDollars = (() => {
    if (activeModels.length === 0) return null
    let total = 0
    let anyKnown = false
    for (let i = 0; i < selectedModels.length; i++) {
      const m = selectedModels[i]
      if (!m) continue
      const d = estimateSlotDollars(m, mode, slotOptions[i], prompt.length, docTokens)
      if (d != null) { total += d; anyKnown = true }
    }
    return anyKnown ? total : null
  })()

  // ── Surface: how you drive XCreate ────────────────────────────────────
  // XCreate is the PLACE you create things; the studio and XDirector are two
  // ways to drive it, not two destinations — which was true until the agent
  // owned a stage. Agent mode moved OUT to /xdirect (CC, Aug 5): the
  // director now lives beside the canvas, so this page is purely the studio
  // again. The old entrances stay live as redirects — ?agent=1 and ?c=
  // permalinks forward with their query intact, so every link the site
  // agent ever handed out keeps resolving.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('agent') === '1' || p.get('c')) {
      p.delete('agent')
      const qs = p.toString()
      router.replace(`/xdirect${qs ? `?${qs}` : ''}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
            <button onClick={() => downloadFile(lightbox, downloadName(lightbox, 'image'))} title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</button>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
      {pickerSlot !== null && (
        <ModelPickerDialog mode={mode} recipeMode={recipeMode} slotIds={selectedModels.map(m => m?.id ?? null)} onSelect={m => addModel(pickerSlot, m as unknown as SlotModel)} onClose={() => setPickerSlot(null)} />
      )}

      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* Post-pick match report — fixed overlay; the studio underneath is
          already reset to setup with the winner in slot A (pickModel). */}
      {matchResult && (
        <div
          onClick={() => { setMatchResult(null); flashComposer() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 99500,
            background: 'rgba(15,15,15,0.45)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            overflowY: 'auto',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(920px, 100%)' }}>
            <MatchResult
              eyebrow={matchResult.eyebrow}
              title={matchResult.title}
              winnerProvider={matchResult.winnerProvider}
              entries={matchResult.entries}
              ratingDelta={matchDelta}
            >
              <button
                type="button"
                onClick={() => { setMatchResult(null); flashComposer() }}
                style={{
                  padding: '13px 26px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 14,
                }}
              >
                ⚡ Keep creating with {matchResult.winnerName}
              </button>
              <button
                type="button"
                onClick={() => { setMatchResult(null); reset() }}
                style={{
                  padding: '13px 26px', borderRadius: 10, border: '1px solid var(--border2)',
                  background: 'transparent', color: 'var(--white)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Start Over
              </button>
              <a
                href="/xboard"
                style={{
                  padding: '13px 26px', borderRadius: 10, border: '1px solid var(--border2)',
                  color: 'var(--white)', fontWeight: 700, fontSize: 14, textDecoration: 'none',
                }}
              >
                View XBoard
              </a>
            </MatchResult>
          </div>
        </div>
      )}

      <div className="xduel-page">
        <div className="arena xcreate-arena">

          {/* In-page header: "// XCREATE" eyebrow + big headline (CC, July 20). */}
          <Link href="/xcreate" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xcreate.eyebrow')}</Link>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' as const }}>
            <h1 className="page-headline" style={{ marginBottom: 24, flex: '1 1 auto', minWidth: 240 }}>{t('xcreate.subtitle')}</h1>
          </div>

          {/* (Gallery tab removed — moved to /profile under the XCreates
              tab. XCreate is now single-purpose: the studio.) */}

          {/* Error banner — surfaces ?id= load failures (row not found,
              row belongs to another user) so the user understands why
              the page didn't open the run they expected. Dismissible. */}
          {loadError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', marginBottom: 24,
              background: 'rgba(232,69,60,0.08)',
              border: '1px solid rgba(232,69,60,0.35)',
              borderRadius: 8,
              color: 'var(--red)', fontSize: 13,
              fontFamily: 'var(--font-body), sans-serif',
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <span style={{ flex: 1 }}>{loadError}</span>
              {needsTopUp && (
                <a
                  href="/profile"
                  style={{
                    flexShrink: 0, padding: '7px 14px', borderRadius: 6,
                    background: 'var(--red)', color: '#fff', textDecoration: 'none',
                    fontFamily: 'var(--font-mono), monospace', fontSize: 11,
                    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
                  }}
                >{t('xcreate.addcredits')}</a>
              )}
              <button
                onClick={() => {
                  setLoadError(null)
                  setNeedsTopUp(false)
                  // Strip ?id=… so a refresh doesn't re-show the same error.
                  // Flag the clear as ours: dismissing the banner must not
                  // reset a resurrected run's restored prompt/attachments.
                  if (typeof window !== 'undefined' && window.location.search) {
                    urlClearedByCodeRef.current = true
                    const url = new URL(window.location.href)
                    url.search = ''
                    window.history.replaceState({}, '', url.toString())
                  }
                }}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.7 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}

          {/* ── WORKFLOW PHASE (CC, July 26): per-creation continuation.
              Step strip = lineage from wfChain, hero = the chosen output,
              composer = describe an edit + pick ANY edit-capable model.
              Cross-model editing is the point — same price-honesty framing
              as the main grid, one output at a time. */}
          {phase === 'workflow' ? (
            <div>
              {/* Strip ⇄ canvas toggle. The canvas is the ComfyUI-style
                  board: nodes + wires + click-to-branch (CC, July 27). */}
              {(
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button
                  onClick={() => setWfView(v => v === 'strip' ? 'canvas' : 'strip')}
                  style={{
                    background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted)',
                    borderRadius: 8, padding: '6px 14px', fontSize: 11, fontFamily: 'var(--mono)',
                    letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer',
                  }}
                >{wfView === 'strip' ? '⧉ ' + t('wf.canvas') : '☰ ' + t('wf.simple')}</button>
              </div>
              )}

              {wfView === 'canvas' && (
                <WorkflowCanvas
                  nodes={wfNodes}
                  selectedIds={wfSel}
                  onSelect={(n, additive) => {
                    setWfSel(prev => additive
                      ? (prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id])
                      : [n.id])
                    // A plain click also OPENS the node: it becomes the
                    // branch point for the composer below. Picking the slot
                    // too is what lets you branch from the HappyHorse output
                    // rather than the Gemini one in the same run. Input nodes
                    // have no row, so they only ever select.
                    if (!additive && n.status !== 'running' && n.rowId) {
                      setXcreateId(n.rowId)
                      setChosenIdx(n.slotIdx ?? 0)
                      setWfSelHero({ url: n.thumb, isVideo: n.isVideo })
                    }
                  }}
                  onClearSelection={() => setWfSel([])}
                  onDelete={deleteNodes}
                />
              )}

              {/* Step strip — oldest → newest; the open step is outlined. */}
              {wfView === 'strip' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' as const }}>
                {wfChain.map((step, i) => (
                  <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 14 }}>→</span>}
                    <div style={{
                      width: 72, height: 72, borderRadius: 10, overflow: 'hidden',
                      border: ((step as any).rowId ?? step.id) === xcreateId ? '2px solid var(--red)' : '1px solid var(--border2)',
                      background: 'var(--surface)', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {step.thumb
                        ? (step.isVideo
                          ? <video src={step.thumb} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={step.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                        : <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{t('wf.step')} {i + 1}</span>}
                    </div>
                  </div>
                ))}
              </div>
              )}

              {/* Current result — the output every next step edits. */}
              {(() => {
                const hs = slots[chosenIdx ?? 0]
                const url = wfSelHero ? wfSelHero.url : (typeof hs?.text === 'string' ? hs.text.split('\n')[0] : null)
                const vid = wfSelHero ? wfSelHero.isVideo : !!hs?.isVideo
                if (!url) return null
                return (
                  <div style={{ marginBottom: 24, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border2)', background: '#000' }}>
                    {vid
                      ? <video src={url} autoPlay loop muted playsInline controls style={{ width: '100%', maxHeight: 480, display: 'block', objectFit: 'contain' }} />
                      : <img src={url} alt="" onClick={() => setLightbox(url)} style={{ width: '100%', maxHeight: 480, display: 'block', objectFit: 'contain', cursor: 'zoom-in' }} />}
                  </div>
                )
              })()}

              {/* Composer — describe the change, pick the model, go. */}
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                <textarea
                  value={wfPrompt} onChange={e => setWfPrompt(e.target.value)}
                  onKeyDown={e => { if (isSubmitEnter(e, { requireModifier: true })) { e.preventDefault(); generateStep() } }}
                  placeholder={t('wf.placeholder')}
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box' as const, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>{t('wf.editwith')}</span>
                  <select
                    value={wfModelId ?? ''} onChange={e => setWfModelId(e.target.value || null)}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px', color: 'var(--white)', fontSize: 13, outline: 'none', maxWidth: 320 }}
                  >
                    {wfEditModels.map((m: any) => {
                      const price = wfPriceLabel(m, mode)
                      return <option key={m.id} value={m.id}>{stripModelVariant(m.display_name)}{price ? ` — ${price}` : ''}</option>
                    })}
                  </select>
                  <button
                    onClick={generateStep}
                    disabled={!wfPrompt.trim() || !wfModelId}
                    style={{
                      marginLeft: 'auto', padding: '10px 22px', borderRadius: 10, border: 'none',
                      background: 'var(--red)', color: 'var(--white)', fontWeight: 700, fontSize: 14,
                      cursor: !wfPrompt.trim() || !wfModelId ? 'default' : 'pointer',
                      opacity: !wfPrompt.trim() || !wfModelId ? 0.5 : 1,
                    }}
                  >✨ {t('wf.generate')} →</button>
                  <button onClick={reset} style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 8, padding: '9px 14px', fontSize: 12, cursor: 'pointer' }}>
                    ← New Session
                  </button>
                </div>
              </div>

              {/* ── Batch apply (CC, July 27): the workflow's edit, on many
                  photos at once. Image mode only — a 10-video batch is a
                  cost cliff nobody should fall off by accident. ── */}
              {mode === 'image' && (
                <div style={{ marginTop: 30, borderTop: '1px dashed var(--border2)', paddingTop: 16 }}>
                  <button onClick={() => setBatchOpen(o => !o)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer', padding: 0 }}>
                    ⚡ {t('wf.batch')} {batchOpen ? '▴' : '▾'}
                  </button>
                  {batchOpen && (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{t('wf.batchhint')}</div>
                      <AttachmentButton attachments={batchAtts} onChange={setBatchAtts} context="xcreate" multiple accept="image/jpeg,image/png,image/webp" maxFiles={10} disabled={batchActive} />
                      <textarea
                        value={batchPrompt} onChange={e => setBatchPrompt(e.target.value)}
                        placeholder={prompt || t('wf.placeholder')}
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box' as const, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', color: 'var(--white)', fontSize: 13, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          onClick={runBatch}
                          disabled={batchActive || batchAtts.length === 0 || !wfModelId || !(batchPrompt.trim() || prompt)}
                          style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: batchActive ? 'wait' : 'pointer', opacity: batchActive || batchAtts.length === 0 ? 0.5 : 1 }}
                        >
                          {(() => {
                            const m: any = wfEditModels.find((x: any) => x.id === wfModelId)
                            const p = m?.model_pricing?.per_image
                            const v = p?.default ?? p?.medium ?? p?.['1024']
                            const est = typeof v === 'number' && batchAtts.length > 0 ? ` · ~$${(v * batchAtts.length).toFixed(2)}` : ''
                            return `⚡ ${t('wf.batchrun')} ${batchAtts.length || ''}${est}`
                          })()}
                        </button>
                        {batchRuns.length > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                            {batchRuns.filter(r => r.status !== 'running').length}/{batchRuns.length}
                          </span>
                        )}
                      </div>
                      {batchRuns.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginTop: 4 }}>
                          {batchRuns.map(r => (
                            <div key={r.jobId} style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                              <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                                {r.status === 'done' && r.url
                                  ? <img src={r.url} alt="" onClick={() => setLightbox(r.url!)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
                                  : r.status === 'error'
                                    ? <span style={{ fontSize: 18 }}>⚠</span>
                                    : <span className="nav-history-spin" />}
                              </div>
                              <div
                                style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'var(--mono)', color: r.status === 'error' ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={r.status === 'error' ? r.error : r.fileName}
                              >
                                {r.status === 'error' ? (r.error ?? 'failed') : r.status === 'done' ? `$${(r.cost ?? 0).toFixed(3)}` : r.fileName}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          ) :

          /* ── CHATTING PHASE ── */
          phase === 'chatting' && chosenIdx !== null ? (
              <div>
                {/* Chosen model header — single line: name + run cost. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 18px', background: 'var(--surface)', border: `1px solid ${SLOT_COLORS[chosenIdx]}44`, borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)' }}>
                    {stripModelVariant(activeModels[chosenIdx].display_name)}
                    {(slots[chosenIdx]?.cost ?? 0) > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 10, fontWeight: 500 }}>
                        {fmtDollars(slots[chosenIdx]?.cost ?? 0)}
                      </span>
                    )}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--green)', background: '#34d39918', padding: '4px 10px', borderRadius: 8 }}>✓ Your pick</span>
                    <button onClick={reset} style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                      ← New Session
                    </button>
                  </div>
                </div>

                {/* Dismissed models */}
                {activeModels.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>Dismissed:</span>
                    {activeModels.map((m, i) => i === chosenIdx ? null : (
                      <span key={i} style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--border2)', padding: '3px 10px', borderRadius: 8, fontFamily: 'var(--mono)', textDecoration: 'line-through' }}>
                        {m.model_name ?? m.display_name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20, minHeight: 200 }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      {/* Provider avatar circle dropped — badge was
                          redundant noise. */}
                      <div style={{
                        maxWidth: '72%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        background: msg.role === 'user' ? 'var(--surface2)' : 'var(--surface)',
                        border: `1px solid var(--border2)`,
                        fontSize: 14, lineHeight: 1.7, color: msg.role === 'user' ? 'var(--muted2)' : 'var(--white)',
                      }}>
                        {msg.isVideo ? <video src={msg.content} autoPlay loop muted playsInline controls style={{ width: '100%', borderRadius: 6 }} />
                        : msg.isImage ? (
                          // Multi-output runs store newline-joined URLs — render
                          // one image per URL (single-URL content is unaffected).
                          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                            {msg.content.split('\n').filter(Boolean).map((u, ui) => (
                              <img key={ui} src={u} alt="" onClick={() => setLightbox(u)} style={{ maxWidth: '100%', borderRadius: 6, cursor: 'zoom-in' }} />
                            ))}
                          </div>
                        )
                        : <div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{msg.content}</ReactMarkdown></div>}
                        {i === chatHistory.length - 1 && msg.role === 'assistant' && chatStreaming && <span className="stream-cursor">▋</span>}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (isSubmitEnter(e, { requireModifier: true })) { e.preventDefault(); sendChat() } }}
                    placeholder="Continue the conversation…"
                    rows={2}
                    style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
                  />
                  <button onClick={sendChat} disabled={chatStreaming || !chatInput.trim()} style={{
                    padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
                    fontWeight: 700, fontSize: 14, cursor: chatStreaming ? 'wait' : 'pointer', flexShrink: 0,
                    opacity: chatStreaming || !chatInput.trim() ? 0.5 : 1,
                  }}>
                    {chatStreaming ? '…' : '→'}
                  </button>
                </div>
              </div>

            ) : (
              /* ── SETUP / GENERATING / PICKING ── */
              <>
                {/* Mode — clickable only during setup. Once a run has started
                    (generating / picking / chatting) the tabs lock; user must
                    Start Over to switch modes. Switching modes nukes any
                    prior selection/results via the mode-change useEffect
                    above, which is intentional. */}
                {/* Mode group + "From:" dropdown. Clicking a mode switches
                    it immediately (first sub-mode as default); the From
                    button opens a small list of the mode's sub-modes. */}
                <div
                  ref={modeBlockRef}
                  style={{ position: 'relative' as const, zIndex: 40, marginBottom: 26, opacity: isLocked ? 0.45 : 1 }}
                >
                  <div className="mode-row">
                    {/* Column 1 — "Generate:" + segmented mode group. */}
                    <div className="mode-col">
                      <div className="field-label">{t('xcreate.generate')}</div>
                      <div className="mode-seg">
                        {(['text', 'image', 'video'] as Mode[]).map(m => (
                          <button key={m} className={`mode-seg-btn ${mode === m ? 'active' : ''}`}
                            disabled={isLocked}
                            onClick={() => {
                              if (isLocked) return
                              setFromOpen(false)
                              if (m !== mode) { setMode(m); setActiveTemplateId(null) }
                            }}
                            style={{ cursor: isLocked ? 'default' : undefined }}
                          >
                            <ModeIcon m={m} />{t('mode.' + m)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Column 2 — "From:" + small dropdown list of the
                        current mode's sub-modes. */}
                    <div className="mode-col" style={{ position: 'relative' as const }}>
                      <div className="field-label">{t('xcreate.from')}</div>
                      <button type="button" className="recipe-crumb-btn" disabled={isLocked}
                        aria-haspopup="listbox" aria-expanded={fromOpen}
                        onClick={() => !isLocked && setFromOpen(o => !o)}>
                        {t('recipefrom.' + recipeMode)}
                        <span aria-hidden style={{ fontSize: 9, color: 'var(--muted)' }}>▾</span>
                      </button>
                      {fromOpen && (() => {
                        const avail = RECIPES[mode].filter(r => catalog.some(c => (c.output_modalities ?? []).includes(mode) && (c.modes ?? []).includes(r.id)))
                        const recipes = avail.length ? avail : RECIPES[mode]
                        return (
                          <div className="from-menu" role="listbox">
                            {recipes.map(r => {
                              const ic = RECIPE_ICONS[r.id]
                              return (
                                <button key={r.id} type="button" role="option"
                                  aria-selected={r.id === recipeMode}
                                  className={`from-menu-item ${r.id === recipeMode ? 'active' : ''}`}
                                  onClick={() => { selectRecipe(r.id); setFromOpen(false) }}>
                                  {ic && <span className="recipe-entry-icons" aria-hidden><InputIcon kind={ic[0]} /></span>}
                                  {t('recipefrom.' + r.id)}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>

                {/* Model slots + per-model options */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div className="field-label" style={{ marginBottom: 0 }}>{t('xcreate.selectmodels')}</div>
                  {/* Discount nudge (CC, July 20) — quiet grey hint. */}
                  {activeModels.length < 4 && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em' }}>
                      {t('xcreate.savemore')}
                    </span>
                  )}
                </div>
                {/* Once a generation run has started (generating → picking →
                    chatting), drop empty slots from the grid so the model row
                    column-aligns with the results grid below. While still in
                    setup we render all 4 slots so the user can fill them. */}
                {(() => {
                  const isRunning = phase === 'generating' || phase === 'picking' || phase === 'chatting'
                  const slotsToShow = isRunning ? [0, 1, 2, 3].filter(i => selectedModels[i]) : [0, 1, 2, 3]
                  const columnCount = slotsToShow.length
                  return (
                <div className="xcreate-slot-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`, gap: 10, marginBottom: 20, alignItems: 'start' }}>
                  {slotsToShow.map(i => {
                    const model = selectedModels[i]
                    const color = SLOT_COLORS[i]
                    const opts = slotOptions[i]

                    if (!model) {
                      // Discount teaser (CC, July 20): what the run's discount
                      // BECOMES if this slot is filled. Counted by position
                      // among the empty slots - not the slot letter - so it
                      // stays correct when a middle model is removed:
                      // A+C filled -> empty B teases 15% (3rd model), D 20%.
                      const emptyBefore = [0, 1, 2, 3].filter(j => j < i && !selectedModels[j]).length
                      const wouldBeCount = activeModels.length + emptyBefore + 1
                      const teaser = wouldBeCount >= 2 && wouldBeCount <= 4 && discountFor(wouldBeCount) > 0
                        ? t(`discount.${wouldBeCount}`)
                        : null
                      return (
                      <button key={i} onClick={() => !isLocked && setPickerSlot(i)}
                        disabled={isLocked}
                        style={{ position: 'relative', background: '#ffffff', border: '1px dashed var(--border2)', borderRadius: 10, padding: '0 14px', height: 56, boxSizing: 'border-box', color: 'var(--muted)', fontSize: 12, cursor: !isLocked ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s', opacity: isLocked ? 0.4 : 1 }}
                        onMouseEnter={e => { if (!isLocked) { const el = e.currentTarget as HTMLElement; el.style.borderColor = color; el.style.color = color } }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.color = 'var(--muted)' }}
                      >
                        <span style={{ fontSize: 18 }}>+</span> {t('xcreate.modelslot').replace('{l}', LABELS[i])}
                        {/* Discount tag - pinned to the top-right corner,
                            slightly overhanging like a price sticker. */}
                        {teaser && (
                          <span style={{
                            position: 'absolute', top: -8, right: -6,
                            fontSize: 9, fontWeight: 800, color: '#fff',
                            background: 'var(--red)', borderRadius: 999,
                            padding: '3px 8px', lineHeight: 1,
                            fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.05em',
                            whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(232,69,60,0.35)',
                          }}>
                            {teaser}
                          </span>
                        )}
                      </button>
                      )
                    }

                    // Determine which options this model has
                    const thinkLevels  = mode === 'text' ? (model.output_config?.text?.thinking_levels ?? []) : []
                    const canSearch    = mode === 'text' && (model.output_config?.text?.capabilities ?? []).includes('web_search')
                    const imgQualities = mode === 'image' ? (model.output_config?.image?.qualities ?? []) : []
                    const imgSizes     = mode === 'image' ? (model.output_config?.image?.sizes ?? []) : []
                    const imgArs       = mode === 'image' ? (model.output_config?.image?.aspect_ratios ?? []) : []
                    const vidSizes     = mode === 'video' ? (model.output_config?.video?.sizes ?? []) : []
                    const vidArs       = mode === 'video' ? (model.output_config?.video?.aspect_ratios ?? []) : []
                    // Durations now live in `durations_by_resolution`, keyed by resolutions like
                    // '720p' / '1080p'. Pick the bucket matching the currently-selected size; if
                    // the user hasn't picked one yet, fall back to the union so the picker still
                    // renders something.
                    const vidDbr = mode === 'video' ? (model.output_config?.video?.durations_by_resolution ?? {}) : {}
                    const vidResKey = opts?.size ? inferResolutionKey(opts.size, Object.keys(vidDbr)) : null
                    let vidDurations = mode === 'video'
                      ? (vidResKey && vidDbr[vidResKey] ? expandDurations(vidDbr[vidResKey]) : Array.from(new Set(Object.values(vidDbr).flatMap(expandDurations))).sort((a, b) => a - b))
                      : []
                    // Veo 3.1's start+end frame interpolation only accepts
                    // durationSeconds=8 — any other value returns a generic
                    // 400 "use case not supported". Lock the duration picker
                    // to 8s in that combo so the user can't pick something
                    // the API will reject. Other providers / modes unaffected.
                    if (
                      mode === 'video' &&
                      opts?.mode === 'start_end_frames' &&
                      model.provider === 'google'
                    ) {
                      vidDurations = vidDurations.includes(8) ? [8] : vidDurations
                    }
                    const availableModes = (model.modes ?? []).filter(x => modeMatchesMode(x, mode))
                    // Watermark is Alibaba-only — applies to both video (HappyHorse, Wan)
                    // and image (Qwen Image). Hidden for OpenAI / Google / Anthropic.
                    const showWatermark = (mode === 'video' || mode === 'image') && model.provider === 'alibaba'
                    // Some video models score their own clip (Wan 3.0 does it
                    // by default). Worth a switch, because the sound is dead
                    // weight whenever the plan is to lay a real track over the
                    // cut — which is every music video. Declared per model in
                    // output_config.video.audio, so adding a model is a data
                    // change.
                    const showAudio = mode === 'video' && model.output_config?.video?.audio === true
                    // Image count slider — shown when the model declares
                    // output_config.image.max_count > 1 (gpt-image-2: n up
                    // to 10 independent samples; qwen 2.0: up to 6, though
                    // its batch-n has produced near-identical images —
                    // alibaba.ts de-dupes and warns when that happens).
                    // Re-enabled July 2026 per CC for the e-commerce flow.
                    const imgMaxCount = mode === 'image' ? (model.output_config?.image?.max_count ?? 1) : 1
                    const showCount = imgMaxCount > 1
                    // Per-slot options are interactive only during setup.
                    // Once a run starts they're frozen (no point in changing
                    // a knob after generation is already done) — Start Over
                    // is the only way back. Still rendered when locked so
                    // the user can see what config was used; pointer-events
                    // off + reduced opacity make the "locked" state clear.
                    // (The ⚙ toggle itself stays clickable when locked —
                    // opening a read-only panel is harmless and useful.)
                    const hasOptions = !!opts && (
                      thinkLevels.length > 0 ||
                      availableModes.length > 1 ||
                      imgQualities.length > 0 || imgSizes.length > 0 || imgArs.length > 0 ||
                      vidSizes.length > 0 || vidDurations.length > 0 || vidArs.length > 0 ||
                      showWatermark || showCount || showAudio
                    )

                    // Upfront USD estimate for this slot given its current
                    // options + the live prompt length. Recomputed every render.
                    const estDollars = estimateSlotDollars(model, mode, opts, prompt.length, docTokens)

                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Model card — name + remove only. Cost estimate lives
                            in the summary row right above the prompt box, not
                            here, so the grid stays clean. */}
                        <div
                          onClick={() => !isLocked && setPickerSlot(i)}
                          title={!isLocked ? 'Change model' : undefined}
                          style={{ position: 'relative', background: '#ffffff', border: `1px solid ${color}44`, borderRadius: 10, padding: '0 14px', height: 56, display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box', cursor: !isLocked ? 'pointer' : 'default', transition: 'border-color 0.15s' }}
                          onMouseEnter={e => { if (!isLocked) (e.currentTarget as HTMLElement).style.borderColor = color }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${color}44` }}
                        >
                          {/* Discount tag stays once the slot is filled (CC):
                              rank among the FILLED slots decides the number -
                              2nd model 10%, 3rd 15%, 4th 20% - so it survives
                              middle removals the same way the teasers do. */}
                          {(() => {
                            const filledRank = [0, 1, 2, 3].filter(j => j < i && selectedModels[j]).length + 1
                            return filledRank >= 2 && filledRank <= 4 && discountFor(filledRank) > 0 ? (
                              <span style={{
                                position: 'absolute', top: -8, right: -6,
                                fontSize: 9, fontWeight: 800, color: '#fff',
                                background: 'var(--red)', borderRadius: 999,
                                padding: '3px 8px', lineHeight: 1,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.05em',
                                whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(232,69,60,0.35)',
                              }}>
                                {t(`discount.${filledRank}`)}
                              </span>
                            ) : null
                          })()}
                          <ProviderLogo provider={model.provider} size={18} />
                          {/* Split a name like "GPT-5.4 (free)" into a bold
                              main line and a smaller muted sub-line for the
                              parenthetical variant. The sub-line may truncate
                              since the card is fixed-width. */}
                          {(() => {
                            const match = model.display_name.match(/^(.*?)\s*(\([^)]*\))\s*$/)
                            const main = (match?.[1] ?? model.display_name).trim()
                            const sub = match?.[2]?.trim()
                            return (
                              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                                <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>
                                  {main}
                                </div>
                                {sub && (
                                  <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                                    {sub}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                          {hasOptions && (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                // Any gear toggles the config panels for ALL
                                // filled slots together (CC, July 20) - the
                                // separate Show Configs button is gone.
                                setOptsOpen(prev => {
                                  const anyOpen = prev.some((v, idx) => v && selectedModels[idx])
                                  return selectedModels.map(mm => (mm ? !anyOpen : false))
                                })
                              }}
                              title={optsOpen[i] ? 'Hide options' : 'Options'}
                              aria-expanded={optsOpen[i]}
                              style={{ background: 'none', border: 'none', color: optsOpen[i] ? color : 'var(--muted)', cursor: 'pointer', fontSize: 24, lineHeight: 1, padding: '4px 2px', flexShrink: 0 }}
                            >⚙</button>
                          )}
                          {!isLocked && <button title="Remove" onClick={e => { e.stopPropagation(); removeModel(i) }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 26, lineHeight: 1, padding: '4px 2px', flexShrink: 0 }}>×</button>}
                        </div>

                        {/* Options panel directly below this model's card —
                            collapsed by default (validateOpts defaults are
                            sensible); the card's ⚙ toggles it.
                            Order: Mode → Resolution/Size → Duration → Aspect Ratio → Quality. */}
                        {hasOptions && opts && optsOpen[i] && (() => {
                          // Pill/Group are module-level (OptPill/OptGroup):
                          // defining them inline changed their component
                          // identity every render, so each state update
                          // REMOUNTED the panel and killed an in-progress
                          // slider drag (CC bug report, July 20). Local
                          // aliases bind the slot color.
                          const Pill = ({ active, onClick, children, narrow }: {
                            active: boolean; onClick: () => void; children: React.ReactNode; narrow?: boolean
                          }) => <OptPill color={color} active={active} onClick={onClick} narrow={narrow}>{children}</OptPill>
                          const Group = OptGroup

                          // Decide which groups are visible so we can pass `last` to drop the bottom margin.
                          const showMode  = availableModes.length > 1
                          // When the slot's mode takes a non-text input (image_to_video,
                          // image_to_image, video_to_video, reference_frames, start_end_frames),
                          // the output's aspect ratio is inherited from the input file. Showing
                          // an aspect-ratio picker in that case is misleading — the model will
                          // ignore it. We only show the picker for text_to_* modes where the
                          // user actually needs to pick.
                          const isTextOnlyInput = !opts?.mode || opts.mode.startsWith('text_to_')
                          const showSizeI = mode === 'image' && imgSizes.length > 0
                          const showSizeV = mode === 'video' && vidSizes.length > 0
                          const showDur   = mode === 'video' && vidDurations.length > 0
                          const showArI   = mode === 'image' && imgArs.length > 0 && isTextOnlyInput
                          // NOT gated on isTextOnlyInput (owner, Aug 20): the
                          // July assumption was that image-driven runs inherit
                          // the input image's shape, so the picker was hidden
                          // for them — but Omni Flash ignores the input and
                          // crops to 16:9. The picker now always shows with an
                          // AUTO default (null = send nothing, provider
                          // decides), so input-following models keep their
                          // behavior unless the user explicitly overrides.
                          const showArV   = mode === 'video' && vidArs.length > 0
                          const showQual  = mode === 'image' && imgQualities.length > 1
                          const showThink = mode === 'text' && thinkLevels.length > 0
                          const showSearch = mode === 'text' && canSearch
                          const groupsInOrder: Array<'think' | 'search' | 'size_i' | 'size_v' | 'dur' | 'ar_i' | 'ar_v' | 'qual' | 'count' | 'wm'> = []
                          if (showThink)     groupsInOrder.push('think')
                          if (showSearch)    groupsInOrder.push('search')
                          if (showSizeV)     groupsInOrder.push('size_v')
                          if (showDur)       groupsInOrder.push('dur')
                          if (showArV)       groupsInOrder.push('ar_v')
                          if (showSizeI)     groupsInOrder.push('size_i')
                          if (showArI)       groupsInOrder.push('ar_i')
                          if (showQual)      groupsInOrder.push('qual')
                          if (showCount)     groupsInOrder.push('count')
                          if (showWatermark) groupsInOrder.push('wm')
                          const lastIdx = groupsInOrder.length - 1
                          const isLast = (k: typeof groupsInOrder[number]) => groupsInOrder.indexOf(k) === lastIdx

                          return (
                            <div style={{ background: '#ffffff', border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 12px', pointerEvents: isLocked ? 'none' as const : 'auto' as const, opacity: isLocked ? 0.55 : 1 }}>
                              {/* Per-slot Mode pills removed — the processing
                                  recipe is now a single Layer-2 selector above. */}
                              {/* Text: Thinking / reasoning level */}
                              {showThink && (
                                <Group label={t('xcreate.thinking')} last={isLast('think')}>
                                  <Pill active={opts.thinking_level == null} onClick={() => updateSlotOpts(i, { thinking_level: null })}>
                                    {t('xcreate.auto')}
                                  </Pill>
                                  {thinkLevels.map(l => (
                                    <Pill key={l} active={opts.thinking_level === l} onClick={() => updateSlotOpts(i, { thinking_level: l })}>
                                      {l}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Text: web search. Two pills rather than a
                                  checkbox so it reads as one of the model's
                                  settings, like thinking level, instead of a
                                  form field bolted next to them. */}
                              {showSearch && (
                                <Group label={t('xcreate.websearch')} last={isLast('search')}>
                                  <Pill active={opts.web_search !== true} onClick={() => updateSlotOpts(i, { web_search: false })}>
                                    {t('xcreate.off')}
                                  </Pill>
                                  <Pill active={opts.web_search === true} onClick={() => updateSlotOpts(i, { web_search: true })}>
                                    {t('xcreate.on')}
                                  </Pill>
                                </Group>
                              )}
                              {/* Video: Resolution */}
                              {showSizeV && (
                                <Group label="Resolution" last={isLast('size_v')}>
                                  {vidSizes.map(s => {
                                    const shortLabel = s.includes('x') ? s.split('x')[1] + 'p' : s
                                    return (
                                      <Pill key={s} active={opts.size === s} onClick={() => updateSlotOpts(i, { size: s })}>
                                        {shortLabel}
                                      </Pill>
                                    )
                                  })}
                                </Group>
                              )}
                              {/* Video: Duration */}
                              {showDur && (
                                <Group label="Duration" last={isLast('dur')}>
                                  {(() => {
                                    // Slider rendering when the model declared
                                    // any range. Priority:
                                    //   1. The exact spec for the inferred
                                    //      resolution (when one matches).
                                    //   2. The first range entry across all
                                    //      resolutions (so the slider still
                                    //      shows when no size is selected yet
                                    //      or the inference missed).
                                    // Falls back to the discrete pill row when
                                    // every entry is a fixed list.
                                    const inferredSpec = vidResKey ? vidDbr[vidResKey] : null
                                    const fallbackRangeEntry = Object.entries(vidDbr).find(([, v]) => v && !Array.isArray(v))
                                    const r: { min: number; max: number } | null =
                                      inferredSpec && !Array.isArray(inferredSpec) ? inferredSpec
                                      : fallbackRangeEntry ? fallbackRangeEntry[1] as { min: number; max: number }
                                      : null
                                    if (r) {
                                      const cur = opts.duration ?? r.min
                                      return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 28 }}>
                                          <input
                                            type="range"
                                            className="xc-slider"
                                            min={r.min} max={r.max} step={1}
                                            value={cur}
                                            onChange={e => updateSlotOpts(i, { duration: parseInt(e.target.value, 10) })}
                                            style={{ flex: 1, ['--xc-slider-color' as any]: color }}
                                          />
                                          <input
                                            type="number"
                                            className="no-spin"
                                            min={r.min} max={r.max} step={1}
                                            value={cur}
                                            onChange={e => {
                                              const v = parseInt(e.target.value, 10)
                                              if (!Number.isFinite(v)) return
                                              const clamped = Math.max(r.min, Math.min(r.max, v))
                                              updateSlotOpts(i, { duration: clamped })
                                            }}
                                            style={{
                                              width: 56, padding: '4px 6px',
                                              borderRadius: 6, fontSize: 12, fontWeight: 700,
                                              background: '#ffffff',
                                              border: `1px solid ${color}55`,
                                              color: 'var(--white)',
                                              fontFamily: 'var(--mono)',
                                              textAlign: 'center' as const,
                                            }}
                                          />
                                          <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const }}>
                                            s · {r.min}–{r.max}
                                          </span>
                                        </div>
                                      )
                                    }
                                    return vidDurations.map(d => (
                                      <Pill key={d} active={opts.duration === d} onClick={() => updateSlotOpts(i, { duration: d })}>
                                        {d}s
                                      </Pill>
                                    ))
                                  })()}
                                </Group>
                              )}
                              {/* Video: Aspect Ratio */}
                              {showArV && (
                                <Group label="Aspect ratio" last={isLast('ar_v')}>
                                  {/* AUTO = null = nothing sent; the provider
                                      follows its default (input shape for
                                      models that honor it, 16:9 for Omni). */}
                                  {!isTextOnlyInput && (
                                    <Pill active={opts.aspect_ratio == null} onClick={() => updateSlotOpts(i, { aspect_ratio: null })}>
                                      AUTO
                                    </Pill>
                                  )}
                                  {vidArs.map(ar => (
                                    <Pill key={ar} active={opts.aspect_ratio === ar} onClick={() => updateSlotOpts(i, { aspect_ratio: ar })}>
                                      {ar}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Size */}
                              {showSizeI && (
                                <Group label="Size" last={isLast('size_i')}>
                                  {imgSizes.map(s => {
                                    // WxH pills carry a small shape line ("3:2
                                    // landscape") — the bare numbers made the
                                    // picker a guessing game (owner, Aug 20).
                                    // Tier-style sizes ("1024" / "2048") have no
                                    // shape; they read best in K notation.
                                    const label = /^\d+$/.test(s)
                                      ? (parseInt(s) >= 1024 ? `${Math.round(parseInt(s) / 1024)}K` : `${s}px`)
                                      : s
                                    const shape = /^\d+$/.test(s) ? null : sizeShapeLabel(s)
                                    return (
                                      <Pill key={s} active={opts.size === s} onClick={() => { setCustomSizeDraft(prev => ({ ...prev, [i]: '' })); updateSlotOpts(i, { size: s }) }}>
                                        <div style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{label}</div>
                                        {shape && <div style={{ fontSize: 9, color: 'var(--muted2)', letterSpacing: '0.03em' }}>{shape}</div>}
                                      </Pill>
                                    )
                                  })}
                                  {(() => {
                                    // Free WxH entry for models that declare
                                    // custom_size (gpt-image-2). A valid value
                                    // applies as it's typed; invalid drafts show
                                    // the constraint they broke and change nothing.
                                    const spec = model.output_config?.image?.custom_size as CustomSizeSpec | undefined
                                    if (!spec) return null
                                    const isCustom = !!opts.size && !imgSizes.includes(opts.size)
                                    const draft = customSizeDraft[i] || (isCustom ? (opts.size ?? '') : '')
                                    const err = draft ? customSizeError(draft, spec) : null
                                    return (
                                      <span style={{ display: 'inline-flex', flexDirection: 'column' as const, gap: 2 }}>
                                        <input
                                          value={draft}
                                          onChange={e => {
                                            const v = e.target.value.trim().replace(/[×*]/g, 'x')
                                            setCustomSizeDraft(prev => ({ ...prev, [i]: v }))
                                            if (v && !customSizeError(v, spec)) updateSlotOpts(i, { size: v })
                                          }}
                                          placeholder="custom WxH"
                                          spellCheck={false}
                                          style={{
                                            width: 110, padding: '6px 8px', borderRadius: 8, fontSize: 12,
                                            fontFamily: 'var(--mono)', outline: 'none',
                                            border: `1px solid ${err ? 'var(--red)' : (isCustom && !customSizeDraft[i]) || (draft && !err) ? 'var(--red)' : 'var(--border2)'}`,
                                            background: 'var(--surface)', color: 'var(--white)',
                                          }}
                                        />
                                        {err && <span style={{ fontSize: 9, color: 'var(--red)', maxWidth: 160, lineHeight: 1.3 }}>{err}</span>}
                                      </span>
                                    )
                                  })()}
                                </Group>
                              )}
                              {/* Image: Aspect Ratio */}
                              {showArI && (
                                <Group label="Aspect ratio" last={isLast('ar_i')}>
                                  {imgArs.map(ar => (
                                    <Pill key={ar} active={opts.aspect_ratio === ar} onClick={() => updateSlotOpts(i, { aspect_ratio: ar })}>
                                      {ar}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Quality */}
                              {showQual && (
                                <Group label="Quality" last={isLast('qual')}>
                                  {imgQualities.map(q => (
                                    <Pill key={q} active={opts.quality === q} onClick={() => updateSlotOpts(i, { quality: q })}>
                                      {q.charAt(0).toUpperCase() + q.slice(1)}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Count slider (only for models with max_count > 1) */}
                              {showCount && (
                                <Group label={`Output Count (${opts.count ?? 1} of ${imgMaxCount})`} last={isLast('count')}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 28 }}>
                                    <input
                                      type="range"
                                      className="xc-slider"
                                      min={1} max={imgMaxCount} step={1}
                                      value={opts.count ?? 1}
                                      onChange={e => updateSlotOpts(i, { count: parseInt(e.target.value, 10) })}
                                      style={{ flex: 1, ['--xc-slider-color' as any]: color }}
                                    />
                                    <input
                                      type="number"
                                      min={1} max={imgMaxCount} step={1}
                                      value={opts.count ?? 1}
                                      onChange={e => {
                                        const v = parseInt(e.target.value, 10)
                                        if (!Number.isFinite(v)) return
                                        const clamped = Math.max(1, Math.min(imgMaxCount, v))
                                        updateSlotOpts(i, { count: clamped })
                                      }}
                                      style={{
                                        width: 56, padding: '4px 6px',
                                        borderRadius: 6, fontSize: 12, fontWeight: 700,
                                        background: '#ffffff',
                                        border: `1px solid ${color}55`,
                                        color: 'var(--white)',
                                        fontFamily: 'var(--mono)',
                                        textAlign: 'center' as const,
                                      }}
                                    />
                                  </div>
                                </Group>
                              )}
                              {/* Video: Watermark (Alibaba only). Two-state On/Off, defaults Off. */}
                              {showAudio && (
                                <Group label="Model audio" last={false}>
                                  <Pill active={opts.generate_audio !== false} onClick={() => updateSlotOpts(i, { generate_audio: true })}>On</Pill>
                                  <Pill active={opts.generate_audio === false} onClick={() => updateSlotOpts(i, { generate_audio: false })}>Off</Pill>
                                </Group>
                              )}
                              {showWatermark && (
                                <Group label="Watermark" last={isLast('wm')}>
                                  <Pill active={opts.watermark === true}  onClick={() => updateSlotOpts(i, { watermark: true  })}>On</Pill>
                                  <Pill active={opts.watermark !== true}  onClick={() => updateSlotOpts(i, { watermark: false })}>Off</Pill>
                                </Group>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
                  )
                })()}

                {/* (Per-slot EST. COST row removed — the total estimate in
                    the composer's action row is the single cost signal.) */}

                {/* (Popular strip removed — it lives in the mode dropdown
                    now; the full catalog stays below the composer.) */}

                {/* Prompt — framed composer. The labeled upload slots
                    (ROSE/JACK/YOUR PHOTO…) render INSIDE the frame, above
                    the borderless textarea (Pollo-style), so prompt +
                    assets read as one unit. */}
                <div ref={promptBoxRef} className="prompt-box framed" style={{
                  opacity: isLocked ? 0.55 : 1,
                  boxShadow: promptFlash ? '0 0 0 3px rgba(214,59,50,0.30)' : 'none',
                  transition: 'box-shadow 0.4s ease, border-color 0.2s',
                }}>
                  {(() => {
                    const activeTemplate = activeTemplateId ? XCREATE_TEMPLATES.find(x => x.id === activeTemplateId) : null
                    const templateSlots = activeTemplate?.attachmentSlots
                    // Template's named slots win (ROSE/JACK …); otherwise the
                    // run's recipe decides the upload slots (works in text mode
                    // too, e.g. image→text / pdf→text).
                    let slots = (templateSlots && templateSlots.length > 0) ? templateSlots : recipeInputSlots(recipeMode)
                    // Reference / edit slots scale with the selected models
                    // (min of input_config.image.count; defaults 2 / 1).
                    // Progressive disclosure: show filled slots + ONE empty
                    // one — the next empty slot is the "add" affordance,
                    // and the "up to N" note announces the capacity.
                    if ((!templateSlots || templateSlots.length === 0) && refSlotCount > 0) {
                      const isRefs = recipeMode === 'reference_frames'
                      const filled = attachments.filter(a => (a.slotIndex ?? 0) < refSlotCount).length
                      const visible = Math.min(filled + 1, refSlotCount)
                      slots = Array.from({ length: visible }, (_, i) => ({
                        label: isRefs ? `REFERENCE ${i + 1}` : `IMAGE ${i + 1}`,
                        hint:  i === 0
                          ? (isRefs ? 'A person or subject' : 'The main image to edit')
                          : (isRefs ? 'Optional' : 'Optional — reference image'),
                      }))
                    }
                    // Template slots also grow, reference_frames only: the
                    // named slots are the default set; once ALL are filled,
                    // reveal one more generic slot at a time up to the
                    // models' shared capacity (refSlotCount). image_edit
                    // templates stay fixed — their prompts assume an exact
                    // input shape (e.g. Remove Background = 1 photo).
                    else if (
                      templateSlots && templateSlots.length > 0 &&
                      recipeMode === 'reference_frames' &&
                      refSlotCount > templateSlots.length
                    ) {
                      const filled = attachments.filter(a => (a.slotIndex ?? 0) < refSlotCount).length
                      const visible = Math.max(
                        templateSlots.length,
                        Math.min(filled + 1, refSlotCount),
                      )
                      slots = Array.from({ length: visible }, (_, i) =>
                        templateSlots[i] ?? { label: `IMAGE ${i + 1}`, hint: 'Optional' })
                    }
                    // Always-on attach slot: when the recipe needs no
                    // upload, show one optional slot anyway. Dropping a
                    // file there auto-switches the sub-mode (see
                    // handleComposerAttachments).
                    const generic = !slots || slots.length === 0
                    if (generic) {
                      slots = [{ label: 'ATTACH', hint: 'Optional' }]
                    }
                    // What the slots accept: recipe-specific media, or the
                    // mode's full union for the generic slot.
                    const IMG = 'image/jpeg,image/png,image/gif,image/webp'
                    const VID = 'video/mp4,video/quicktime,video/webm'
                    const accept =
                      // Extensions + audio/*, not a bare MIME list: the
                      // macOS picker maps MIME types unreliably and grays
                      // out real MP3s (owner, Aug 10: "I can't select mp3").
                      // Applies to the GENERIC slot too — the From-menu
                      // path has no template, and its old text accept had
                      // no audio at all, which was the actual lockout.
                      recipeMode === 'audio_to_text' ? 'audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.mp4,.webm'
                      // Any decodable audio is fine — lib/audio-normalize
                      // converts to wav/mp3 ≤15s in the browser before
                      // upload (Wan 3.0's hard limits).
                      : recipeMode === 'audio_to_video' ? 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.mp4'
                      : !generic && recipeMode === 'pdf_to_text' ? 'application/pdf'
                      : !generic && recipeMode === 'video_edit' ? `${VID},${IMG}`
                      // Reference video templates: images + any audio
                      // (normalized to wav ≤15s client-side).
                      : !generic && recipeMode === 'reference_frames' && mode === 'video' ? `${IMG},audio/*,.mp3,.m4a,.aac,.wav`
                      : !generic && (recipeMode === 'video_to_video' || recipeMode === 'extend_video' || recipeMode === 'video_to_text') ? VID
                      : generic && mode === 'text' ? `${IMG},${VID},application/pdf,audio/*,.mp3,.m4a,.wav`
                      // Generic video slot takes audio too — normalized
                      // client-side; models without audio input reject the
                      // attachment with a named error in alibaba.ts.
                      : generic && mode === 'video' ? `${IMG},${VID},audio/*,.mp3,.m4a,.aac,.wav`
                      : undefined
                    const isFrames = recipeMode === 'start_end_frames'
                    return (
                      <div className="prompt-slots" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
                        <LabeledSlotsPicker
                          slots={slots}
                          attachments={attachments}
                          onChange={handleComposerAttachments}
                          disabled={isLocked}
                          context="xcreate"
                          arrows={isFrames}
                          swappable={isFrames}
                          compact
                          accept={accept}
                          audioMaxSeconds={mode === 'video' ? 15 : undefined}
                          onPreview={a => { if (a.previewUrl) setLightbox(a.previewUrl) }}
                        />
                        {/* ("up to N images" capacity note removed July 2026
                            per CC — slots just keep appearing until the cap;
                            no announcement needed.) */}
                        {refDropNotice && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#f59e0b', background: '#f59e0b14', border: '1px solid #f59e0b40', borderRadius: 8, padding: '3px 8px' }}>
                            ⚠ {refDropNotice}
                            <button onClick={() => setRefDropNotice(null)} aria-label="Dismiss"
                              style={{ background: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  <textarea className="prompt-textarea"
                    maxLength={8000}
                    placeholder={t('xcreate.ph.' + mode)}
                    value={prompt} onChange={e => setPrompt(e.target.value)}
                    // Locked once a run starts. The user can still see what
                    // prompt was used, but can't edit it until Start Over.
                    disabled={isLocked}
                    readOnly={isLocked}
                    onKeyDown={e => { if (isSubmitEnter(e, { requireModifier: true })) { e.preventDefault(); if (canGenerate) generate() } }}
                  />
                  {/* Fill-in hint — INSIDE the prompt box (CC), shown while
                      the prompt contains a {{placeholder}}. Distinctive
                      double-brace delimiter can't false-fire on normal
                      user text; disappears once the user replaces them.
                      Defaults still generate fine untouched. */}
                  {phase === 'setup' && /\{\{[^}]+\}\}/.test(prompt) && (
                    <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                      ✏️ Replace the {'{{marked}}'} parts with your own words — or keep the defaults
                    </div>
                  )}
                </div>

                {/* Actions row — OUTSIDE the prompt box (July 2026, CC):
                    sits just below the composer as a normal flex row, so it
                    can never overlap the prompt text. (XDuel keeps its own
                    overlay .prompt-actions — this row is XCreate-only.) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                  <span className="prompt-counter">{activeModels.length === 0 ? t('xcreate.pickone') : activeModels.length === 1 ? t('xcreate.selected1') : t('xcreate.selected').replace('{n}', String(activeModels.length))}</span>
                  {/* Multi-model discount — red little label, full string
                      from i18n (en "10% off" = zh "9折"). */}
                  {activeModels.length >= 2 && phase !== 'generating' && (
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: 'var(--red)',
                      fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em',
                      whiteSpace: 'nowrap' as const,
                    }}>
                      {t(`discount.${activeModels.length}`)}
                    </span>
                  )}
                  {totalEstDollars != null && phase !== 'generating' && (
                    <span
                      title={mode === 'text' ? 'Estimated total — assumes ~500-token response per model' : 'Estimated total based on your selected options'}
                      style={{
                        fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
                        color: 'var(--muted2)', whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {t('xcreate.estcost')}{fmtDollars(totalEstDollars * (1 - discountFor(activeModels.length)))}
                    </span>
                  )}
                  {/* Pre-flight warning. The server still gates with a 402,
                      but being told after a click is a worse experience than
                      seeing it while choosing models (CC, July 26). */}
                  {(() => {
                    if (totalEstDollars == null || balanceCents == null || phase === 'generating') return null
                    const estC = Math.round(totalEstDollars * (1 - discountFor(activeModels.length)) * 100)
                    if (estC <= 0 || estC <= balanceCents) return null
                    return (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' as const,
                        fontSize: 12, fontFamily: 'var(--font-body), sans-serif', color: 'var(--red)',
                      }}>
                        {t('xcreate.lowbalance')} {fmtDollars(balanceCents / 100)}
                        <a href="/profile" style={{
                          padding: '5px 11px', borderRadius: 5, background: 'var(--red)', color: '#fff',
                          textDecoration: 'none', fontFamily: 'var(--font-mono), monospace', fontSize: 10,
                          letterSpacing: '0.1em', textTransform: 'uppercase' as const, fontWeight: 700,
                        }}>{t('xcreate.addcredits')}</a>
                      </span>
                    )
                  })()}
                  {/* Setup phase: real Generate button.
                      Generating phase: disabled "⏳ Generating…" indicator.
                      Picking / chatting phase: nothing — Start Over is the
                      only path back to a new generation. */}
                  {phase === 'setup' && promptRequiredBy.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--font-mono), monospace' }}>
                      {promptRequiredBy.map((m: any) => m.display_name).join(', ')} — {t('xcreate.promptneed')}
                    </span>
                  )}
                  {phase === 'setup' && (
                    <button className="btn-battle" onClick={generate} disabled={!canGenerate}>
                      {t('xcreate.generatebtn')}
                    </button>
                  )}
                  {phase === 'generating' && (
                    <button className="btn-battle" disabled style={{ opacity: 0.7 }}>
                      {t('xcreate.generating')}
                    </button>
                  )}
                </div>

                {/* ── Product board (CC, July 28): the entry point for the
                    product-video pipeline. Uploading here does NOT generate
                    anything — the photos become source nodes on a fresh
                    board, and everything after that happens on the canvas.
                    Image mode only. ── */}
                {phase === 'setup' && mode === 'image' && (
                  <div style={{ marginTop: 22, borderTop: '1px dashed var(--border2)', paddingTop: 16 }}>
                    <button
                      onClick={() => setPbOpen(o => !o)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer', padding: 0 }}
                    >
                      ⊞ {t('wf.addphotos')} {pbOpen ? '▴' : '▾'}
                    </button>
                    {pbOpen && (
                      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                          {t('wf.addphotoshint')}
                        </div>
                        <AttachmentButton
                          attachments={pbAtts} onChange={setPbAtts} context="xcreate"
                          multiple accept="image/jpeg,image/png,image/webp" maxFiles={10} disabled={pbBusy}
                        />
                        <div>
                          <button
                            onClick={createProductBoard}
                            disabled={pbBusy || pbAtts.length === 0}
                            style={{
                              padding: '10px 20px', borderRadius: 10, border: 'none',
                              background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13,
                              cursor: pbBusy ? 'wait' : 'pointer',
                              opacity: pbBusy || pbAtts.length === 0 ? 0.5 : 1,
                            }}
                          >
                            ⊞ {t('wf.addphotos')} {pbAtts.length || ''} →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Discovery — the full tools + templates catalog, below the
                    composer (CapCut "Inspiration" pattern: browse when you
                    want it, out of the way when you're working). Hidden once
                    a run has results so it doesn't compete with them.
                    Clicking anything applies it and scrolls back up to the
                    flashing composer. */}
                {phase === 'setup' && slots.length === 0 && (() => {
                  // Category sections (Popular / Tools / Templates), each
                  // wrapped so EVERY card is visible — no horizontal
                  // scrolling (July 2026: CC prefers the full catalog on
                  // screen over Netflix rows). Items may appear in more
                  // than one section — that's fine.
                  const forMode = XCREATE_TEMPLATES.filter(x => x.mode === mode)
                  // Popular row removed (owner, Aug 26): it duplicated cards
                  // that already sit in Tools/Templates below. `popular` on
                  // templates still orders/badges elsewhere — don't delete
                  // the flag.
                  const rows: { key: string; caption: string; items: Template[] }[] = [
                    { key: 'tools',     caption: t('xcreate.alltools'),     items: forMode.filter(x => x.kind === 'tool') },
                    { key: 'templates', caption: t('xcreate.alltemplates'), items: forMode.filter(x => x.kind !== 'tool') },
                  ]
                  return (
                    <div style={{ marginTop: 36 }}>
                      {rows.filter(r => r.items.length > 0).map(r => (
                        <div key={r.key} style={{ marginBottom: 22 }}>
                          <div className="ms-cap">{r.caption}</div>
                          <TemplatePicker
                            templates={r.items}
                            selectedId={activeTemplateId}
                            onSelect={applyTemplate}
                            onClear={reset}
                            layout="wrap"
                          />
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Results */}
                {slots.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    {/* A single-model run has no contest — no vote header,
                        no Select button (owner, Aug 10). The output simply
                        stands; Start Over remains the way onward. */}
                    {phase === 'picking' && slots.length > 1 && chosenIdx === null && (
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>Which result won?</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pick it to record your vote and keep generating with that model</div>
                      </div>
                    )}
                    {/* 4 results → 2×2 grid (readable), otherwise single row.
                        Column count matters more than matching the setup row
                        because the cards are content-heavy. Use a 1px gap
                        with the arena border-color showing through instead
                        of the shared `.battle-card:first-child` right-border
                        rule — that rule only produces the correct divider
                        for 1×2 layouts, not 2×2. */}
                    <div className="battle-arena" style={{ gridTemplateColumns: slots.length === 4 ? '1fr 1fr' : `repeat(${slots.length}, 1fr)`, gap: 1, background: 'var(--border2)' }}>
                      {slots.map((slot, i) => {
                        const model = activeModels[i]
                        const color = SLOT_COLORS[i]
                        if (!model) return null
                        return (
                          <div key={i} className="battle-card"
                            style={{ position: 'relative' }}
                            onMouseEnter={() => setCursor(color)}
                            onMouseLeave={() => setCursor('#e8453c')}
                          >
                            {/* Slot identity stripe — 3px ribbon at the top
                                of the card, in the slot's color. Deliberately
                                NOT bound to the provider: the provider in any
                                given slot changes run to run, so a per-slot
                                color is what stays stable and matches the
                                model name, price badge and hover cursor. */}
                            <span className="provider-stripe" style={{ background: color }} aria-hidden="true" />
                            <div className={`battle-card-header ${mode !== 'text' ? 'image-mode' : ''}`}>
                              <div className="battle-model-id" style={{ color, fontSize: 12, display: 'flex', alignItems: 'center' }}>
                                {!slot.done && slot.streaming && (
                                  <span className="streaming-dot" style={{ background: color }} aria-hidden="true" />
                                )}
                                {stripModelVariant(model.display_name)}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {/* Copy the whole text output (owner, Aug 10)
                                    — text mode only; images/videos have their
                                    own download. */}
                                {slot.done && !slot.error && mode === 'text' && !slot.isImage && !slot.isVideo && slot.text && (
                                  <button
                                    onClick={() => copySlotText(i, slot.text)}
                                    title={t('xc.copyoutput')} aria-label={t('xc.copyoutput')}
                                    style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 12, fontFamily: 'var(--mono)', color: copiedSlot === i ? 'var(--green)' : 'var(--muted2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  >{copiedSlot === i ? `✓ ${t('xc.copied')}` : `⧉ ${t('xc.copy')}`}</button>
                                )}
                                {slot.done && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>⏱ {(slot.responseTime / 1000).toFixed(2)}s</span>}
                                {slot.done && slot.cost > 0 && <span className="price-badge" style={{ color }}>{fmtDollars(slot.cost)}</span>}
                              </div>
                            </div>
                            {/* Config summary line — shows the exact options
                                used for this slot so you remember what you
                                generated against. Each field is only included
                                when the model actually exposes that choice
                                (e.g. quality tiers > 1, multiple sizes, etc.),
                                matching the form's picker visibility. */}
                            {(() => {
                              // `i` indexes the COMPACTED activeModels/slots
                              // array, but slotOptions is indexed by the raw
                              // 4-slot positions (with null gaps). Map back
                              // to the raw index or a model in slot C reads
                              // slot B's (possibly null) options and the
                              // summary silently disappears.
                              const rawIndices = selectedModels
                                .map((m, idx) => (m ? idx : -1))
                                .filter(idx => idx >= 0)
                              const used = slotOptions[rawIndices[i] ?? i]
                              if (!used) return null
                              const oc = model.output_config ?? {}
                              const sizes = mode === 'video' ? (oc.video?.sizes ?? []) : mode === 'image' ? (oc.image?.sizes ?? []) : []
                              const ars   = mode === 'video' ? (oc.video?.aspect_ratios ?? []) : mode === 'image' ? (oc.image?.aspect_ratios ?? []) : []
                              const dbr   = mode === 'video' ? (oc.video?.durations_by_resolution ?? {}) : {}
                              const allDurations = Array.from(new Set(Object.values(dbr).flat()))
                              const qualities = mode === 'image' ? (model.output_config?.image?.qualities ?? []) : []
                              const compatibleModes = (model.modes ?? []).filter(x => modeMatchesMode(x, mode))

                              const parts: string[] = []
                              if (used.mode         && compatibleModes.length > 1)         parts.push(modeLabel(used.mode))
                              if (used.size         && sizes.length          > 0)          parts.push(used.size)
                              if (used.duration     && allDurations.length   > 0)          parts.push(`${used.duration}s`)
                              if (used.aspect_ratio && ars.length            > 0)          parts.push(used.aspect_ratio)
                              if (used.quality      && qualities.length      > 1)          parts.push(`${used.quality} quality`)
                              if (mode === 'image' && (model.output_config?.image?.max_count ?? 1) > 1 && (used.count ?? 1) > 0) {
                                parts.push(`${used.count ?? 1} image${(used.count ?? 1) > 1 ? 's' : ''}`)
                              }
                              // Watermark only applies to Alibaba image/video models —
                              // never to text. Skip the line for any other case.
                              const summaryShowsWatermark = (mode === 'video' || mode === 'image') && model.provider === 'alibaba'
                              if (summaryShowsWatermark && used.watermark === true)  parts.push('watermark on')
                              if (summaryShowsWatermark && used.watermark === false) parts.push('watermark off')
                              if (mode === 'video' && used.generate_audio === false) parts.push('audio off')
                              // THIS MODEL'S share of the bill. The per-slot cost
                              // row was removed once for clutter, leaving the
                              // composer's total as the only price signal — but
                              // XCreate exists to run models SIDE BY SIDE, and
                              // price is half of what is being compared. Hiding
                              // it here argues against the whole product. Back as
                              // one term on a line that already exists, so the
                              // total stays the single headline.
                              const slotEst = estimateSlotDollars(model, mode, used, prompt.length, docTokens)
                              if (slotEst != null && slotEst > 0) parts.push(`~$${slotEst < 0.01 ? slotEst.toFixed(4) : slotEst.toFixed(2)}`)
                              if (parts.length === 0) return null
                              return (
                                <div style={{
                                  padding: '4px 12px 8px',
                                  fontSize: 11,
                                  fontFamily: 'var(--font-mono), monospace',
                                  color: 'var(--muted2)',
                                  letterSpacing: '0.04em',
                                  display: 'flex', flexWrap: 'wrap', gap: '0 8px',
                                  borderBottom: '1px solid var(--border)',
                                }}>
                                  {parts.join('  ·  ')}
                                </div>
                              )
                            })()}
                            <div className={`battle-response ${mode !== 'text' ? 'image-response' : ''} ${slot.streaming && !slot.text ? 'loading' : ''}`}>
                              {slot.streaming && !slot.text
                                ? <><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></>
                                : slot.error ? (
                                  <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>
                                    ⚠️ {slot.error}
                                    {slot.errorRef && (
                                      <div title={slot.errorRef} style={{ fontSize: 10, marginTop: 6, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.05em', userSelect: 'all' }}>
                                        Ref: {slot.errorRef.slice(0, 8)}
                                      </div>
                                    )}
                                  </div>
                                )
                                : slot.isVideo ? <video src={slot.text} autoPlay loop muted playsInline controls style={{ display: 'block' }} />
                                : slot.isImage ? (() => {
                                    // Multi-image slots store URLs newline-delimited
                                    // in `slot.text`. Single image still renders flush;
                                    // multi-image renders as a 2-col grid.
                                    const urls = (slot.text ?? '').split('\n').filter(Boolean)
                                    if (urls.length <= 1) {
                                      const u = urls[0] ?? ''
                                      return <img src={u} alt="Generated" onClick={() => setLightbox(u)} style={{ display: 'block', cursor: 'zoom-in' }} />
                                    }
                                    const cols = urls.length === 2 ? 2 : urls.length === 3 ? 3 : 2
                                    return (
                                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, background: 'var(--border)' }}>
                                        {urls.map((u, ui) => (
                                          <img key={ui} src={u} alt={`Generated ${ui + 1}`}
                                            onClick={() => setLightbox(u)}
                                            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in', background: 'var(--surface)' }} />
                                        ))}
                                      </div>
                                    )
                                  })()
                                : <><div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{slot.text}</ReactMarkdown></div>{slot.streaming && <span className="stream-cursor">▋</span>}</>
                              }
                            </div>
                            {/* Pick button — only when there was a contest
                                AND no winner is recorded yet (a reopened
                                decided run is a record, not a re-vote). */}
                            {phase === 'picking' && slots.length > 1 && chosenIdx === null && slot.done && !slot.error && (
                              <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                                <button onClick={() => pickModel(i)} style={{
                                  width: '100%', padding: '10px 0', borderRadius: 8,
                                  background: 'transparent', border: `1px solid ${color}`,
                                  color, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                                  transition: 'all 0.15s',
                                }}
                                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = color + '18' }}
                                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent' }}
                                >
                                  {mode === 'image' || mode === 'video' ? `Generate more with ${stripModelVariant(model.display_name)} →` : `Select ${stripModelVariant(model.display_name)} →`}
                                </button>
                              </div>
                            )}
                            {/* Continuation for runs with nothing left to
                                vote on — a single model, or a winner already
                                recorded. Routes to the workflow board (the
                                July 27 continuation surface) WITHOUT the
                                vote machinery, so reopening can never
                                double-count. Image/video only: text
                                continuation is the chat. */}
                            {phase === 'picking' && mode !== 'text' && xcreateId && slot.done && !slot.error && (slots.length === 1 || chosenIdx !== null) && (
                              <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                                <button onClick={() => { setChosenIdx(i); setWfView('canvas'); setPhase('workflow'); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{
                                  width: '100%', padding: '10px 0', borderRadius: 8,
                                  background: 'transparent', border: '1px solid var(--border2)',
                                  color: 'var(--white)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                                  transition: 'all 0.15s',
                                }}
                                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)' }}
                                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)' }}
                                >
                                  Continue on canvas →
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Generating phase: show "Start a new run" so the
                        user isn't stuck waiting on a long video. The
                        server-side job continues regardless — its row is
                        already in `xcreates` and the result will surface
                        in /profile (XCreates tab) when done. Polling
                        just stops client-side. */}
                    {phase === 'generating' && (
                      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 8, marginTop: 32 }}>
                        <button className="btn-secondary" onClick={reset}>↻ Start a new run</button>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                          Current run continues in background — check Profile when ready
                        </span>
                      </div>
                    )}
                    {(phase === 'picking' || phase === 'chatting') && (() => {
                      const totalActual = slots.reduce((sum, s) => sum + (s.done && s.cost > 0 ? s.cost : 0), 0)
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 32 }}>
                          <button className="btn-secondary" onClick={reset}>← Start Over</button>
                          {totalActual > 0 && (
                            <span style={{
                              fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
                              color: 'var(--muted2)', whiteSpace: 'nowrap' as const,
                            }}>
                              Total {fmtDollars(totalActual)}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
        </div>
      </div>
    </>
  )
}
