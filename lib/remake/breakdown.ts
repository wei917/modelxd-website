// lib/remake/breakdown.ts: a pasted video, broken into the shot list a remake
// follows (same shots, timing, camera and transitions; new characters, theme
// and setting). Phase 0 (Oct 10): Gemini 3.8 Flash at 5 frames a second found
// 10 of 10 cuts at 0.1 s on a video whose cuts we knew, and matched 19–21 of
// 20–25 hard cuts on two X videos. The prompt is the one phase 0 tested, plus
// "skip logos and rating cards" (Overwatch's first 10 s were an ESRB card and
// the Blizzard logo).

import type { Breakdown, Character, Line, Shot } from './config'

export const BREAKDOWN_PROMPT = `You are a film editor. Make a precise shot list of this video so that another team can remake it shot for shot with different characters, a different theme and a different setting. Watch the whole part you were given.

Return JSON only, in exactly this shape:
{
  "duration": number (seconds you watched),
  "aspect": "16:9" | "9:16" | "1:1" | "4:5" | other,
  "title": string (what this video is, a few words),
  "summary": string (one sentence: what happens),
  "hook": string (what grabs attention in the first 2 seconds),
  "look": { "style": string (e.g. hand-drawn 2D anime, photoreal live action, 3D CG), "palette": string, "light": string },
  "characters": [ { "id": "c1", "role": string, "look": string (appearance and clothing; describe, do not name real people) } ],
  "shots": [ {
    "t0": number, "t1": number,
    "framing": "extreme close-up" | "close-up" | "medium close-up" | "medium" | "medium wide" | "wide" | "extreme wide" | "insert",
    "camera": string (locked, push in, pull out, pan, tilt, tracking, handheld, crane, whip pan, orbit, zoom...),
    "action": string (what happens, concrete and visual),
    "who": [character ids],
    "where": string (the setting),
    "transition_in": "cut" | "dissolve" | "fade from black" | "fade from white" | "flash" | "whip" | "match cut" | "wipe" | other,
    "text": string (on-screen text, verbatim, or ""),
    "sound": string (dialogue, sound effects or music cue in this shot, or "")
  } ],
  "lines": [ { "t": number, "who": string, "text": string (verbatim), "language": string } ],
  "music": { "present": boolean, "bpm": number | null, "mood": string, "cuts_on_beat": boolean }
}

Rules:
- A new shot starts at EVERY cut or transition. Do not merge shots. Fast cuts under one second are still separate shots.
- Times in seconds to one decimal. Shots cover the whole duration in order, with no gaps and no overlaps: each t0 equals the previous t1.
- The first shot starts at 0.
- Leave out rating cards, studio or channel logos, sponsor slates and end screens: they are not part of what would be remade. Times stay those of the video.`

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese (as written in Taiwan)', 'zh-Hans': 'Simplified Chinese',
  ja: 'Japanese', ko: 'Korean',
}

/** The prompt for one piece of a read. The page shows the shot list, so the
 *  words come back in the reader's language; framing and transition stay the
 *  English words above, which the page translates. A piece that starts later
 *  than 0 still counts its times from 0, and is told who has already
 *  appeared so the same person keeps the same id across pieces. */
export function breakdownPrompt(lang: string, start: number, known: Character[] = []): string {
  const name = LANGUAGE_NAMES[lang] ?? 'English'
  let p = `${BREAKDOWN_PROMPT}\n- Write title, summary, hook, look, role, character look, camera, action, where and sound in ${name}. Keep "framing" and "transition_in" exactly as the English words listed. Spoken lines and on-screen text stay verbatim in their own language.`
  if (start > 0) p += `\n- The part you were given starts ${start} seconds into the video. Give every time from the start of that part, so the first shot starts at 0.`
  if (known.length) p += `\n- These people already appeared earlier in the video: ${JSON.stringify(known.map(c => ({ id: c.id, role: c.role, look: c.look })))}. When one of them appears, use their id. List every person who appears in this part under "characters", and give new people new ids after the last one.`
  return p
}

/** Long reads go in pieces: phase 1 (Oct 10) found Gemini's times accurate
 *  for a minute and then jumping ~40 s ahead on an 86 s video, while every
 *  60 s piece in phase 0 was right to 0.1 s. */
export const READ_PIECE_SECONDS = 60

/** Join the pieces of one read: times moved to the read's own clock,
 *  characters merged by id (a later piece may add people), lines in order.
 *  The first piece names the video; the summary keeps the first piece's. */
export function joinPieces(pieces: { offset: number; b: Breakdown }[]): Breakdown {
  const first = pieces[0].b
  const characters: Character[] = []
  const seen = new Set<string>()
  const shots: Shot[] = [], lines: Line[] = []
  for (const { offset, b } of pieces) {
    for (const ch of b.characters) if (!seen.has(ch.id)) { seen.add(ch.id); characters.push(ch) }
    for (const s of b.shots) shots.push({ ...s, t0: r1(s.t0 + offset), t1: r1(s.t1 + offset) })
    for (const l of b.lines) lines.push({ ...l, t: r1(l.t + offset) })
  }
  // A cut that falls on a piece's edge was read twice: the earlier piece
  // ends the shot, the later one starts it again. Merge nothing; just keep
  // the clock touching.
  for (let i = 1; i < shots.length; i++) shots[i].t0 = shots[i - 1].t1
  const last = pieces[pieces.length - 1]
  return {
    ...first,
    duration: r1(last.offset + last.b.duration),
    characters, shots, lines,
    music: { ...first.music, cuts_on_beat: pieces.some(p => p.b.music.cuts_on_beat) },
  }
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : NaN)
const r1 = (n: number) => Math.round(n * 10) / 10

/** Parse and clean what the model returned: times in order and touching, at
 *  most `maxSeconds`, empty or broken shots dropped. Null when it is not a
 *  shot list at all. */
export function normalizeBreakdown(raw: string, maxSeconds: number, knownIds: string[] = []): Breakdown | null {
  let b: any
  try { b = JSON.parse(raw) } catch {
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
    if (s < 0 || e <= s) return null
    try { b = JSON.parse(raw.slice(s, e + 1)) } catch { return null }
  }
  if (!b || !Array.isArray(b.shots)) return null

  const characters: Character[] = (Array.isArray(b.characters) ? b.characters : []).slice(0, 30)
    .map((c: any, i: number) => ({ id: str(c?.id, 12) || `c${i + 1}`, role: str(c?.role, 120), look: str(c?.look, 400) }))
  // A later piece may name someone from an earlier piece without listing them again.
  const ids = new Set([...characters.map(c => c.id), ...knownIds])

  const shots: Shot[] = []
  for (const s of b.shots as any[]) {
    let t0 = num(s?.t0), t1 = num(s?.t1)
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue
    t0 = Math.max(0, Math.min(t0, maxSeconds)); t1 = Math.max(0, Math.min(t1, maxSeconds))
    if (t1 - t0 < 0.05) continue
    shots.push({
      t0, t1,
      framing: str(s.framing, 40), camera: str(s.camera, 80), action: str(s.action, 400),
      who: (Array.isArray(s.who) ? s.who : []).map((w: unknown) => str(w, 12)).filter((w: string) => ids.has(w)),
      where: str(s.where, 160), transition_in: str(s.transition_in, 30) || 'cut',
      text: str(s.text, 200), sound: str(s.sound, 200),
    })
  }
  if (!shots.length) return null
  shots.sort((a, b) => a.t0 - b.t0)
  // Touching, in order: each shot starts where the last ended (the model's
  // small gaps and overlaps are rounding, not missing footage).
  shots[0].t0 = 0
  for (let i = 1; i < shots.length; i++) {
    shots[i].t0 = shots[i - 1].t1 = Math.max(shots[i - 1].t0 + 0.1, shots[i].t0)
    if (shots[i].t1 < shots[i].t0 + 0.1) shots[i].t1 = shots[i].t0 + 0.1
  }
  const duration = Math.min(maxSeconds, Math.max(num(b.duration) || 0, shots[shots.length - 1].t1))
  shots[shots.length - 1].t1 = Math.max(shots[shots.length - 1].t0 + 0.1, duration)
  for (const s of shots) { s.t0 = r1(s.t0); s.t1 = r1(s.t1) }

  const lines: Line[] = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)
    .map((l: any) => ({ t: r1(Math.max(0, num(l?.t) || 0)), who: str(l?.who, 12), text: str(l?.text, 300), language: str(l?.language, 12) }))
    .filter((l: Line) => l.text)
  const m = b.music ?? {}
  return {
    duration: r1(duration),
    aspect: str(b.aspect, 8) || '16:9',
    title: str(b.title, 120), summary: str(b.summary, 400), hook: str(b.hook, 300),
    look: { style: str(b.look?.style, 160), palette: str(b.look?.palette, 160), light: str(b.look?.light, 160) },
    characters, shots, lines,
    music: { present: !!m.present, bpm: Number.isFinite(num(m.bpm)) ? Math.round(num(m.bpm)) : null, mood: str(m.mood, 160), cuts_on_beat: !!m.cuts_on_beat },
  }
}
