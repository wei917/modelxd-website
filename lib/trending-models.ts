// lib/trending-models.ts
//
// Which image and video models "Trending on social media" is about: the ones
// XCreate can run (owner, Sep 27: "remove midjourney. we should search models
// we support"). Read from the catalog, never a fixed list. A family is
// searched, and its posts are served, only while one of its ai_models rows is
// enabled, not blocked for 'xcreate', made by a provider the router can
// generate that kind with, and offering an XCreate recipe. What is written
// down here is only how each family is NAMED on X ("Nano Banana" for
// gemini-*-image, "Hailuo" for MiniMax). A catalog model no family covers
// gets one named from its display name, so a new model is searched without a
// code change.
//
// A post is eligible when EVERY image or video model it credits belongs to a
// supported family and at least one of them makes the post's kind (Codex
// review, Sep 27): [Midjourney, Seedance 2.5] is out, [GPT Image 2,
// Seedance 2.5] stays. LLMs and agents stay out as before; "ChatGPT" counts
// only as the app GPT Image ran in, beside a supported image model in an
// image post. Pure apart from loadSupport (scripts/test-trending-models.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { FEATURE, isBlockedFor } from './model-features'
import type { ModelMode } from './providers/types'

export type MediaKind = 'video' | 'image'
const KINDS: MediaKind[] = ['video', 'image']

/** Providers the router can make each kind with (lib/providers/index.ts,
 *  generateImage and generateVideo). */
const GENERATORS: Record<MediaKind, string[]> = {
  image: ['openai', 'google', 'xai', 'alibaba'],
  video: ['google', 'xai', 'runway', 'minimax', 'alibaba'],
}

/** XCreate's recipes per mode (RECIPES in app/xcreate/client.tsx). A model
 *  offering none of them can't be picked in the studio. */
const RECIPES: Record<MediaKind, ModelMode[]> = {
  image: ['text_to_image', 'image_edit'],
  video: ['text_to_video', 'image_to_video', 'video_to_video', 'extend_video', 'video_edit', 'start_end_frames', 'reference_frames', 'audio_to_video'],
}

type Spec = {
  name: string          // what X calls it: the family's label and first search term
  also?: string[]       // other names on X, searched too
  catalog: RegExp       // ai_models.model_name of its rows
  mention: RegExp       // a credited model name that belongs to it
  solo?: boolean        // big enough on X for a search of its own
}

// Order counts twice: a credited name takes the first family it matches (the
// Gemini Omni video models before the Gemini image models), and searches
// share families out in this order.
const SPECS: Spec[] = [
  { name: 'Seedance',     catalog: /^seedance/i,             mention: /\bseedance(?![a-z])/i, solo: true },
  { name: 'Veo',          catalog: /^veo-/i,                 mention: /\bveo(?![a-z])/i },
  { name: 'Gemini Omni',  catalog: /^gemini-omni/i,          mention: /\bgemini[\s-]*omni(?![a-z])/i },
  { name: 'Wan',          catalog: /^wan\d/i,                mention: /\bwan(?:x|xiang)?(?![a-z])/i },
  { name: 'HappyHorse',   catalog: /^happyhorse/i,           mention: /\bhappy[\s-]*horse(?![a-z])/i },
  { name: 'MiniMax',      catalog: /^minimax/i,              mention: /\b(?:minimax|hailuo)(?![a-z])/i, also: ['Hailuo'] },
  { name: 'Runway',       catalog: /^gen\d/i,                mention: /\brunway(?![a-z])|\bgen[\s-]?[34](?!\d)/i },
  { name: 'GPT Image',    catalog: /^gpt-image/i,            mention: /\bgpt[\s-]*images?(?![a-z])/i },
  { name: 'Nano Banana',  catalog: /^gemini-(?!omni).*image/i, mention: /\bnano[\s-]*banana(?![a-z])|\bgemini\b.*\bimage(?![a-z])/i },
  { name: 'Qwen Image',   catalog: /^qwen-image/i,           mention: /\bqwen[\s-]*image(?![a-z])/i },
  { name: 'Grok Imagine', catalog: /^grok-imagine/i,         mention: /\bgrok[\s-]*imagine(?![a-z])/i },
]

export type CatalogRow = {
  provider: string
  model_name: string
  display_name: string
  output_modalities: string[] | null
  modes: string[] | null
  blocked_features?: string[] | null
  enabled?: boolean | null
}

/** A catalog row XCreate can run, and the kinds it makes there. */
export type UsableModel = { model_name: string; display_name: string; modes: string[]; kinds: MediaKind[] }

export type Family = {
  name: string
  terms: string[]       // search terms, name first
  mention: RegExp
  kinds: MediaKind[]    // what its usable rows make
  solo: boolean
  models: string[]      // its usable ai_models.model_name
}

export type Support = { families: Family[]; models: UsableModel[] }

/** The kinds a catalog row makes in XCreate: none when it is disabled or
 *  blocked there, or no generator or recipe of that kind takes it. */
export function usableKinds(r: CatalogRow): MediaKind[] {
  if (r.enabled === false || isBlockedFor(r, FEATURE.xcreate)) return []
  const outs = r.output_modalities ?? [], modes = r.modes ?? []
  return KINDS.filter(k => outs.includes(k) && GENERATORS[k].includes(r.provider) && RECIPES[k].some(m => modes.includes(m)))
}

const MODE_WORD = /^(?:pro|flash|lite|turbo|preview|image|video|text|reference|edit|to|t2v|i2v|r2v|v2v|hd|max|plus|fast|ultra)$/i

/** A family name for a catalog model no Spec covers: its display name up to
 *  the first version number or mode word ("Kling 3.0 Text to Video" →
 *  "Kling", "FLUX.2 Pro" → "FLUX"). */
export function derivedName(display: string): string | null {
  const words: string[] = []
  for (const w of display.split(' - ')[0].trim().split(/\s+/)) {
    if (MODE_WORD.test(w)) break
    const head = w.match(/^[A-Za-z][A-Za-z'-]*/)?.[0] ?? ''
    if (head.length > 1) words.push(head)   // "V7" is a version, not a name
    if (head !== w) break                   // the name ends where a number starts
  }
  const name = words.join(' ')
  return name.length >= 3 ? name : null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentionFor = (name: string) => new RegExp(`\\b${name.split(/\s+/).map(escapeRe).join('[\\s-]*')}(?![a-z])`, 'i')

export function supportFrom(catalog: CatalogRow[]): Support {
  const models: UsableModel[] = []
  const found = new Map<string, { spec: Spec | null; kinds: Set<MediaKind>; models: string[] }>()
  for (const r of catalog) {
    const kinds = usableKinds(r)
    if (!kinds.length) continue
    models.push({ model_name: r.model_name, display_name: r.display_name, modes: r.modes ?? [], kinds })
    const spec = SPECS.find(s => s.catalog.test(r.model_name)) ?? null
    const name = spec?.name ?? derivedName(r.display_name)
    if (!name) continue
    const f = found.get(name) ?? { spec, kinds: new Set<MediaKind>(), models: [] }
    kinds.forEach(k => f.kinds.add(k))
    f.models.push(r.model_name)
    found.set(name, f)
  }
  // Written-down families in SPECS order, then derived ones by name.
  const at = (spec: Spec | null) => spec ? SPECS.indexOf(spec) : SPECS.length
  const families = [...found.entries()]
    .sort(([a, x], [b, y]) => at(x.spec) - at(y.spec) || a.localeCompare(b))
    .map(([name, f]) => ({
      name,
      terms: [name, ...(f.spec?.also ?? [])],
      mention: f.spec?.mention ?? mentionFor(name),
      kinds: KINDS.filter(k => f.kinds.has(k)),
      solo: !!f.spec?.solo,
      models: f.models,
    }))
  return { families, models }
}

/** The catalog as the feed sees it. Throws when the catalog can't be read:
 *  callers fail closed rather than guess what XCreate offers. */
export async function loadSupport(sb: SupabaseClient): Promise<Support> {
  const { data, error } = await sb.from('ai_models')
    .select('provider, model_name, display_name, output_modalities, modes, blocked_features, enabled')
    .eq('enabled', true)
    .overlaps('output_modalities', ['image', 'video'])
  if (error) throw new Error(`ai_models unreadable: ${error.message}`)
  return supportFrom((data ?? []) as CatalogRow[])
}

// ── posts ────────────────────────────────────────────────────────────────────

/** The supported family a credited model name belongs to, or null. */
export function familyOf(name: string, support: Support): Family | null {
  return support.families.find(f => f.mention.test(name)) ?? null
}

/** The kinds a credited name stands for: its family's, narrowed by an
 *  explicit "Image" or "Video" in the name, so "Grok Imagine Video" is not
 *  the image model (Codex review, Sep 27); none when it is no model XCreate
 *  offers. A bare "Grok Imagine" stands for whichever kinds are offered. */
export function kindsOf(name: string, support: Support): MediaKind[] {
  const f = familyOf(name, support)
  if (!f) return []
  const image = /\bimages?\b/i.test(name), video = /\bvideos?\b/i.test(name)
  return image === video ? f.kinds : f.kinds.filter(k => k === (image ? 'image' : 'video'))
}

const SPLIT = /\s*(?:[+&/,;|→]|->)\s*|\s+(?:and|x)\s+/i
const pieces = (s: string) => s.split(SPLIT).map(p => p.trim()).filter(p => /[a-z]/i.test(p))

/** The model names in one credited label: "Midjourney + Seedance 2.5" is two
 *  (Codex review, Sep 27). A parenthesised note is not a name, and a piece
 *  without letters is a version ("Hailuo 02/03"). */
export function namesIn(label: string): string[] {
  return pieces(label.replace(/\([^)]*\)/g, ' '))
}

/** A model name that is an LLM or coding agent, not an image or video model.
 *  "GPT Image 2", "Gemini Omni", "Nano Banana", "Grok Imagine" are not. */
export function isLlmName(name: string): boolean {
  const n = name.toLowerCase()
  if (/claude|opus|sonnet|haiku|chat\s*gpt|codex|cursor|copilot|deepseek|kimi|llama|manus|agent/.test(n)) return true
  if (/\bgpt[-\s]?\d/.test(n) && !/image/.test(n)) return true
  if (/gemini/.test(n) && !/image|omni|veo|nano/.test(n)) return true
  if (/grok/.test(n) && !/imagine/.test(n)) return true
  return false
}

const isChatGptApp = (name: string) => /^chat\s*gpt$/i.test(name.trim())

/** "ChatGPT" beside a supported image model in an image post is the app the
 *  model ran in ("GPT Image 2, made in ChatGPT"), not an LLM making the work
 *  (Codex review, Sep 27). */
export function chatGptIsApp(kind: MediaKind, models: readonly string[], support: Support): boolean {
  return kind === 'image' && models.flatMap(namesIn).some(n => kindsOf(n, support).includes('image'))
}

export type Verdict = { ok: true } | { ok: false; reason: string }

/** Whether a post crediting `models` belongs in the `kind` feed. Every name
 *  in every label must be a model XCreate offers, no label may name another
 *  generator or an LLM anywhere (notes included), and one name must make the
 *  post's kind. */
export function eligibility(kind: MediaKind, models: readonly string[], support: Support): Verdict {
  const labels = models.map(s => String(s).trim()).filter(Boolean)
  if (!labels.length) return { ok: false, reason: 'names no model' }
  const app = chatGptIsApp(kind, labels, support)
  const everyPiece = labels.flatMap(l => pieces(l.replace(/[()]/g, ',')))
  if (everyPiece.some(p => isLlmName(p) && !(app && isChatGptApp(p)))) {
    return { ok: false, reason: `LLM or agent post (${labels.join(', ')})` }
  }
  const names = labels.flatMap(namesIn).filter(n => !(app && isChatGptApp(n)))
  const other = new Set([
    ...names.filter(n => kindsOf(n, support).length === 0),
    ...labels.flatMap(l => otherGeneratorsIn(l, support)),
  ])
  if (other.size) return { ok: false, reason: `not a model XCreate offers (${[...other].join(', ')})` }
  if (!names.some(n => kindsOf(n, support).includes(kind))) {
    return { ok: false, reason: `no ${kind} model XCreate offers (${labels.join(', ')})` }
  }
  return { ok: true }
}

/** Image and video generators as text names them. Grok's list of credited
 *  models can leave one out (it left out Claude Opus on Sep 26), and a label
 *  can hide one behind a supported name ("Kling via Runway"), so labels and a
 *  candidate's own text are both searched. Only names that can't be an
 *  ordinary word ("Imagen" needs its number: it is Spanish for "image"). */
const GENERATOR_NAMES = /\b(?:midjourney|niji|kling|sora|flux|seedream|imagen\s*\d|ideogram|recraft|dall[-\s·]?e|stable\s*diffusion|sdxl|pika|pixverse|vidu|hunyuan|luma\s*(?:ai|labs|ray)|dream\s*machine|leonardo(?:\.ai|\s+ai)|seedance|veo|hailuo|minimax|happy\s*horse|gemini\s*omni|grok\s*imagine(?:\s+(?:image|video))?|gpt[\s-]*image|nano\s*banana|qwen[\s-]*image|runway)(?![a-z])/gi

/** Generators the text names that XCreate doesn't offer. A name of a
 *  supported family (Hailuo is MiniMax) doesn't count; an explicit
 *  "Grok Imagine Video" counts when only the image model is offered. */
export function otherGeneratorsIn(text: string, support: Support): string[] {
  const out = new Map<string, string>()
  for (const m of text.matchAll(GENERATOR_NAMES)) {
    const name = m[0].replace(/\s+/g, ' ').trim()
    if (kindsOf(name, support).length === 0) out.set(name.toLowerCase(), name)
  }
  return [...out.values()]
}

/** A model name as letters and digits: Hailuo read as MiniMax, a ".0"
 *  version dropped ("GPT Image 2.0" is GPT Image 2). */
const normName = (s: string) => s.toLowerCase().replace(/hailuo/g, 'minimax').replace(/(\d)\.0(?!\d)/g, '$1').replace(/[^a-z0-9]/g, '')

type PresetRow = { model_name: string; display_name: string; modes: string[] | null }

/** The names a catalog row answers to: its id and each part of its display
 *  name ("Nano Banana Pro - Gemini 3 Pro Image" is both). */
const aliasesOf = (c: PresetRow) => [c.model_name, ...c.display_name.split(' - ')].map(normName).filter(Boolean)

/** `long` is `short` plus a variant word, not another version: the character
 *  after the shared part must not be a digit ("gptimage25..." does not
 *  extend "gptimage2"). */
const addsVariant = (long: string, short: string) =>
  long.length > short.length && long.startsWith(short) && !/\d/.test(long[short.length])

/** The catalog model a preset runs: the first credited name that points at
 *  exactly one model able to run the recipe. An exact name wins ("GPT IMAGE
 *  2" is gpt-image-2; as a substring it had matched gpt-image-2.5-sunburst
 *  first, Codex review, Sep 27). Otherwise one model whose name only adds a
 *  variant word ("Veo 3.1" → Veo 3.1 Preview, "Seedance 2.5 Pro" → Seedance
 *  2.5), never another version ("Veo 3" is not 3.1). A name that fits two
 *  models ("GPT Image 2.5": Flare or Sunburst) gives no preset, not a guess. */
export function presetModel(models: readonly string[], recipe: string, catalog: readonly PresetRow[]): string | null {
  const able = catalog.filter(c => (c.modes ?? []).includes(recipe))
  for (const name of models.flatMap(namesIn)) {
    const want = normName(name)
    if (want.length < 3) continue
    const exact = able.filter(c => aliasesOf(c).includes(want))
    if (exact.length === 1) return exact[0].model_name
    if (exact.length > 1) continue
    const near = able.filter(c => aliasesOf(c).some(a => addsVariant(a, want) || addsVariant(want, a)))
    if (near.length === 1) return near[0].model_name
  }
  return null
}

/** The name of the model a stored preset runs on, for the tag beside its
 *  button (owner, Sep 27: "you must know the model"): the catalog's display
 *  name before any alias ("Nano Banana Pro - Gemini 3 Pro Image" is "Nano
 *  Banana Pro"). Null once the preset no longer runs: its model is gone,
 *  doesn't make the post's kind, or no longer offers the recipe (Codex
 *  review, Sep 27). */
export function presetRunsOn(kind: MediaKind, preset: { model: string; recipe: string } | null | undefined, support: Support): string | null {
  const m = preset && support.models.find(m => m.model_name === preset.model && m.kinds.includes(kind) && m.modes.includes(preset.recipe))
  return m ? m.display_name.split(' - ')[0].trim() : null
}

// ── searches ─────────────────────────────────────────────────────────────────

/** The searches for one kind, at most `count`: the supported families that
 *  make it, a `solo` family on its own and the rest shared out in order.
 *  Never a model-agnostic search ("AI video", "AI art", "prompt"): those
 *  brought back models XCreate doesn't offer (Midjourney, Sep 27). */
export function searchGroups(kind: MediaKind, support: Support, count: number): Family[][] {
  const fams = support.families.filter(f => f.kinds.includes(kind))
  let solo = fams.filter(f => f.solo)
  if (solo.length >= count) solo = []
  const rest = fams.filter(f => !solo.includes(f))
  const slots = Math.min(count - solo.length, rest.length)
  const groups = solo.map(f => [f])
  for (let i = 0; i < slots; i++) {
    groups.push(rest.slice(Math.floor(i * rest.length / slots), Math.floor((i + 1) * rest.length / slots)))
  }
  return groups
}

/** A group as x_search text: `Seedance`, `(Veo OR "Gemini Omni")`. */
export function groupQuery(group: Family[]): string {
  const terms = group.flatMap(f => f.terms).map(t => /\s/.test(t) ? `"${t}"` : t)
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
}
