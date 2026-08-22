// lib/story-digest.ts — a story of ANY length → a STORY BIBLE the director
// can storyboard from (owner, Aug 22: "no matter how long the story is, we
// should always summarize it and use the summary as input … 10 scenes most
// … only keep the most important things").
//
// Pure functions only — chunking, prompts, parsing, rendering — so the
// pipeline is unit-testable without a network. The IO (auth, storage,
// model calls) lives in app/api/xdirector/digest/route.ts.
//
// Shape: MAP each window of the text to a short part-summary on a cheap
// model, then REDUCE all part-summaries into one bible on the director's
// model. A short pasted story takes the same road (one window) — the
// digest is what keeps the ten-scene discipline, not the length.

export const MAX_DOC_CHARS = 3_000_000   // hard cap on what we will read (abuse bound)
export const WINDOW_CHARS  = 40_000      // ≤ ~70k tokens even for CJK — any catalog text model takes it
export const MAX_BEATS     = 10
export const MAX_CAST      = 5

export type StoryBible = {
  title: string
  logline: string
  setting: { era: string; world: string; tone: string }
  cast: Array<{ name: string; role: string; look: string }>
  beats: Array<{ n: number; title: string; what_happens: string; change: string; who: string[]; where: string }>
  omitted: string
}

export type Window = { index: number; text: string; headings: string[] }

// Chapter-style headings across the markets we serve: 第一回 / 第1章 / 第三話 /
// Chapter 7 / CHAPTER IV / Prologue / 序章 / 제3장. Multiline + case-insensitive.
const HEADING_RE = /^[ \t]*(?:第[ \t]*[0-9０-９一二三四五六七八九十百千零〇两兩]+[ \t]*[回章节節卷折幕话話]|chapter[ \t]+(?:\d+|[ivxlc]+)\b|prologue\b|epilogue\b|序章|終章|终章|最終回|最终回|제[ \t]*\d+[ \t]*[장화])[^\n]*/gim

/** Split on chapter headings when the text has them (≥ 2), else on paragraph
 *  boundaries, then pack consecutive pieces into windows of ≤ WINDOW_CHARS. */
export function splitIntoWindows(raw: string, windowChars = WINDOW_CHARS): Window[] {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const pieces: Array<{ text: string; heading?: string }> = []
  const marks: Array<{ at: number; heading: string }> = []
  for (const m of text.matchAll(HEADING_RE)) marks.push({ at: m.index ?? 0, heading: m[0].trim() })

  if (marks.length >= 2) {
    if (marks[0].at > 0) pieces.push({ text: text.slice(0, marks[0].at) })
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].at : text.length
      pieces.push({ text: text.slice(marks[i].at, end), heading: marks[i].heading })
    }
  } else {
    pieces.push({ text })
  }

  // A single piece longer than a window is cut at paragraph boundaries.
  const atoms: Array<{ text: string; heading?: string }> = []
  for (const p of pieces) {
    if (p.text.length <= windowChars) { atoms.push(p); continue }
    let rest = p.text, first = true
    while (rest.length > windowChars) {
      let cut = rest.lastIndexOf('\n\n', windowChars)
      if (cut < windowChars * 0.5) cut = rest.lastIndexOf('\n', windowChars)
      if (cut < windowChars * 0.5) cut = windowChars
      atoms.push({ text: rest.slice(0, cut), heading: first ? p.heading : undefined })
      rest = rest.slice(cut); first = false
    }
    if (rest.trim()) atoms.push({ text: rest })
  }

  const windows: Window[] = []
  let cur: Window | null = null
  for (const a of atoms) {
    if (!a.text.trim()) continue
    if (cur && cur.text.length + a.text.length > windowChars) { windows.push(cur); cur = null }
    if (!cur) cur = { index: windows.length, text: '', headings: [] }
    cur.text += (cur.text ? '\n\n' : '') + a.text.trim()
    if (a.heading) cur.headings.push(a.heading)
  }
  if (cur) windows.push(cur)
  return windows
}

const LANG_NAME: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese (繁體中文)', 'zh-Hans': 'Simplified Chinese (简体中文)', ja: 'Japanese', ko: 'Korean',
}
export const langName = (lang?: string) => LANG_NAME[lang ?? 'en'] ?? 'English'

/** MAP prompt: one window → a part summary the reducer can work from. */
export function mapPrompt(w: Window, total: number, lang?: string, focus?: string): string {
  const span = w.headings.length > 0 ? ` It contains: ${w.headings.slice(0, 12).join(' / ')}${w.headings.length > 12 ? ' / …' : ''}.` : ''
  return `You are reading part ${w.index + 1} of ${total} of a story that will be adapted into a SHORT FILM of at most ${MAX_BEATS} scenes. Summarize THIS PART ONLY, for a story editor who will later pick the few beats that matter.${span}
${focus ? `The film will FOCUS on: "${focus}". Give that material more detail; summarize the rest more briefly.\n` : ''}
Write in ${langName(lang)}. Keep every proper name in its ORIGINAL script exactly as the text spells it.

Give, in plain text (no markdown tables):
1. For each chapter or section in this part: its heading verbatim, then 3–5 sentences — what happens, and what has CHANGED by its end (a want, a loss, a turn, a decision).
2. CHARACTERS who appear: name — role — every physical detail the text itself gives (age, body, face, hair or fur, clothing and colours, weapons or signature objects). Quote the text's own descriptions; do not invent.
3. PLACES, with the text's own descriptive nouns.
At most 700 words. Nothing else.

=== PART ${w.index + 1}/${total} ===
${w.text}`
}

/** REDUCE prompt: all part summaries → the bible, as strict JSON. */
export function reducePrompt(summaries: string[], lang?: string, focus?: string): string {
  const parts = summaries.map((s, i) => `--- PART ${i + 1} of ${summaries.length} ---\n${s}`).join('\n\n')
  return `You are the story editor for a SHORT FILM of at most ${MAX_BEATS} scenes adapted from a longer text. Below are sequential summaries of the WHOLE text. Your job is to decide what matters and throw the rest away — the film cannot show everything, and a film that tries is a slideshow.

${focus ? `FOCUS: "${focus}". The beats cover ONLY this part of the story; everything else is context that keeps names, looks and places consistent, not content to show.\n\n` : ''}Return ONE JSON object and nothing else — no prose, no markdown fence:
{
  "title": "the story's title (original script)",
  "logline": "ONE sentence: who wants what, what stands in the way, what has changed by the end",
  "setting": { "era": "…", "world": "…", "tone": "…" },
  "cast": [ { "name": "…", "role": "…", "look": "…" } ],
  "beats": [ { "n": 1, "title": "2–4 words", "what_happens": "1–2 sentences", "change": "what is different after this beat", "who": ["names"], "where": "place" } ],
  "omitted": "one sentence: what was left out and why"
}
Rules:
- cast: at most ${MAX_CAST} RECURRING characters (the ones the film cannot do without). look = concrete VISUAL invariants in ≤ 40 words — body/face/hair or fur, the garment and its colours, one signature prop — taken from the text where it gives them, invented once and consistently where it does not. Extras are not cast.
- beats: at most ${MAX_BEATS}, in story order, and EVERY beat must change something; a beat that only shows the world or repeats a state is cut. Together they form a spine: a want, an obstacle, a turn, a payoff. The first beat shows the world and the want; the last shows what changed. Prefer fewer, stronger beats over ten thin ones.
- Write in ${langName(lang)}; keep every proper name in its original script.

${parts}`
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Pull the JSON object out of a model reply and clamp it to the schema. */
export function parseBible(reply: string): StoryBible | null {
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: any
  try { raw = JSON.parse(reply.slice(start, end + 1)) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const cast = (Array.isArray(raw.cast) ? raw.cast : []).slice(0, MAX_CAST)
    .map((c: any) => ({ name: clip(c?.name, 60), role: clip(c?.role, 120), look: clip(c?.look, 400) }))
    .filter((c: any) => c.name)
  const beats = (Array.isArray(raw.beats) ? raw.beats : []).slice(0, MAX_BEATS)
    .map((b: any, i: number) => ({
      n: i + 1,
      title: clip(b?.title, 80),
      what_happens: clip(b?.what_happens, 600),
      change: clip(b?.change, 300),
      who: (Array.isArray(b?.who) ? b.who : []).slice(0, 8).map((w: any) => clip(w, 60)).filter(Boolean),
      where: clip(b?.where, 120),
    }))
    .filter((b: any) => b.title || b.what_happens)
  if (beats.length === 0) return null
  return {
    title: clip(raw.title, 120),
    logline: clip(raw.logline, 400),
    setting: { era: clip(raw.setting?.era, 120), world: clip(raw.setting?.world, 300), tone: clip(raw.setting?.tone, 200) },
    cast, beats,
    omitted: clip(raw.omitted, 400),
  }
}

/** The bible as the text the user reads in chat and the director reads in
 *  the message — one rendering, so what the user corrects is what the
 *  director saw. */
export function renderBible(b: StoryBible): string {
  const lines: string[] = []
  lines.push(`📖 ${b.title || '—'}`)
  if (b.logline) lines.push(`Logline: ${b.logline}`)
  const s = [b.setting.era, b.setting.world, b.setting.tone].filter(Boolean).join(' · ')
  if (s) lines.push(`Setting: ${s}`)
  if (b.cast.length) {
    lines.push('Cast:')
    for (const c of b.cast) lines.push(`- ${c.name}${c.role ? ` — ${c.role}` : ''}${c.look ? ` — ${c.look}` : ''}`)
  }
  lines.push(`Beats (${b.beats.length}):`)
  for (const t of b.beats) {
    const tail = [t.who.length ? t.who.join(', ') : '', t.where].filter(Boolean).join(' · ')
    lines.push(`${t.n}. ${t.title} — ${t.what_happens}${t.change ? ` → ${t.change}` : ''}${tail ? ` (${tail})` : ''}`)
  }
  if (b.omitted) lines.push(`Left out: ${b.omitted}`)
  return lines.join('\n')
}
