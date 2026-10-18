// lib/remake/breakdown.ts: a pasted video, broken into the shot list a remake
// follows (same shots, timing, camera and transitions; new characters, theme
// and setting). Phase 0 (Oct 10): Gemini 3.8 Flash at 5 frames a second found
// 10 of 10 cuts at 0.1 s on a video whose cuts we knew, and matched 19–21 of
// 20–25 hard cuts on two X videos. The prompt is the one phase 0 tested, plus
// "skip logos and rating cards" (Overwatch's first 10 s were an ESRB card and
// the Blizzard logo). Oct 13 (owner: "break down the essential materials ...
// for users to replace"): the same read also lists the things and places a
// remake swaps, and the moment and spot where each person and thing is seen
// best, so the page can show a picture of each.

import { THING_KINDS, type Box, type Breakdown, type Character, type Line, type Place, type Shot, type Thing, type ThingKind } from './config'

export const BREAKDOWN_PROMPT = `You are a film editor. Make a precise shot list of this video so that another team can remake it shot for shot with different characters, a different theme and a different setting. Watch the whole part you were given.

Return JSON only, in exactly this shape:
{
  "duration": number (seconds you watched),
  "aspect": "16:9" | "9:16" | "1:1" | "4:5" | other,
  "title": string (what this video is, a few words),
  "summary": string (one sentence: what happens),
  "hook": string (what grabs attention in the first 2 seconds),
  "look": { "style": string (e.g. hand-drawn 2D anime, photoreal live action, 3D CG), "palette": string, "light": string },
  "characters": [ { "id": "c1", "role": string, "look": string (appearance and clothing; describe, do not name real people), "best": number (the second where this person's face is seen most clearly), "box": [ymin, xmin, ymax, xmax] (this person's head and shoulders at that second, each 0-1000 of the frame) } ],
  "things": [ { "id": "t1", "kind": "product" | "prop" | "logo", "name": string (a few words), "look": string (shape, colours, material, any writing on it), "best": number (the second where it is seen most clearly), "box": [ymin, xmin, ymax, xmax] (where it is at that second, each 0-1000 of the frame) } ],
  "places": [ { "id": "p1", "name": string (a few words), "look": string (what it looks like, its light), "best": number (a second that shows it well) } ],
  "shots": [ {
    "t0": number, "t1": number,
    "framing": "extreme close-up" | "close-up" | "medium close-up" | "medium" | "medium wide" | "wide" | "extreme wide" | "insert",
    "camera": string (locked, push in, pull out, pan, tilt, tracking, handheld, crane, whip pan, orbit, zoom...),
    "action": string (what happens, concrete and visual),
    "who": [character ids],
    "things": [thing ids in view],
    "place": place id,
    "where": string (the setting),
    "transition_in": "cut" | "dissolve" | "fade from black" | "fade from white" | "flash" | "whip" | "match cut" | "wipe" | other,
    "text": string (on-screen text, verbatim, or ""),
    "sound": string (dialogue, sound effects or music cue in this shot, or "")
  } ],
  "lines": [ { "t": number, "who": string, "text": string (verbatim), "language": string } ],
  "music": { "present": boolean, "bpm": number | null, "mood": string, "cuts_on_beat": boolean,
             "genre": string (genre, sub-genre and era, in English), "instruments": [string] (in English), "key": string (key and mode if heard, else ""),
             "energy": string (how the energy moves over the video, with times), "vocals": string ("none", or voice type, delivery and language) }
}

Rules:
- A new shot starts at EVERY cut or transition. Do not merge shots. Fast cuts under one second are still separate shots.
- Times in seconds to one decimal. Shots cover the whole duration in order, with no gaps and no overlaps: each t0 equals the previous t1.
- The first shot starts at 0.
- Leave out rating cards, studio or channel logos, sponsor slates and end screens: they are not part of what would be remade. Times stay those of the video.
- Characters, things and places are the materials a remake swaps out. List every person who appears. As things, list only what the video depends on: the product it shows or sells, the props the action needs, and every logo or brand mark on screen; not the app's or channel's watermark, not every object in the background. Each distinct setting is one place, and shots in the same setting share its id.
- "best" is a moment inside a shot where that person or thing is clearly in view, and "box" is where it is in the frame at that moment.
- "lines" are words a person in the video SPEAKS. Words sung in the music are not lines: leave them out, and never write down song lyrics. Describe the music only by its style; never name the song or the artist.`

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese (as written in Taiwan)', 'zh-Hans': 'Simplified Chinese',
  ja: 'Japanese', ko: 'Korean',
}

/** The prompt for one piece of a read. The page shows the shot list, so the
 *  words come back in the reader's language; framing and transition stay the
 *  English words above, which the page translates. A piece that starts later
 *  than 0 still counts its times from 0, and is told who has already
 *  appeared so the same person keeps the same id across pieces. */
export function breakdownPrompt(lang: string, start: number, known: Character[] | Known = []): string {
  const name = LANGUAGE_NAMES[lang] ?? 'English'
  let p = `${BREAKDOWN_PROMPT}\n- Write title, summary, hook, look, role, character look, the names and looks of things and places, camera, action, where and sound in ${name}. Keep "framing", "transition_in" and "kind" exactly as the English words listed. Spoken lines and on-screen text stay verbatim in their own language.`
  if (start > 0) p += `\n- The part you were given starts ${start} seconds into the video. Give every time from the start of that part, so the first shot starts at 0.`
  const k = Array.isArray(known) ? { characters: known, things: [], places: [] } : known
  if (k.characters.length) p += `\n- These people already appeared earlier in the video: ${JSON.stringify(k.characters.map(c => ({ id: c.id, role: c.role, look: c.look })))}. When one of them appears, use their id. List every person who appears in this part under "characters", and give new people new ids after the last one.`
  if (k.things.length || k.places.length) p += `\n- These things and places already appeared earlier: ${JSON.stringify({ things: k.things.map(t => ({ id: t.id, kind: t.kind, name: t.name })), places: k.places.map(x => ({ id: x.id, name: x.name })) })}. Use the same ids when they appear again, list them again with "best" in this part when they are in view, and give new ones new ids after the last one.`
  return p
}

/** Who and what the pieces read so far have named, once each. */
export function knownSoFar(pieces: { b: Breakdown }[]): Known {
  const once = <T extends { id: string }>(list: T[]) => list.filter((x, i) => list.findIndex(y => y.id === x.id) === i)
  return {
    characters: once(pieces.flatMap(p => p.b.characters)),
    things: once(pieces.flatMap(p => p.b.things ?? [])),
    places: once(pieces.flatMap(p => p.b.places ?? [])),
  }
}
export type Known = { characters: Character[]; things: Thing[]; places: Place[] }

/** Long reads go in pieces: phase 1 (Oct 10) found Gemini's times accurate
 *  for a minute and then jumping ~40 s ahead on an 86 s video, while every
 *  60 s piece in phase 0 was right to 0.1 s. */
export const READ_PIECE_SECONDS = 60

/** Join the pieces of one read: times moved to the read's own clock,
 *  people, things and places merged by id (a later piece may add some; the
 *  first sighting keeps its picture spot), lines in order. The first piece
 *  names the video; the summary keeps the first piece's. */
export function joinPieces(pieces: { offset: number; b: Breakdown }[]): Breakdown {
  const first = pieces[0].b
  const characters: Character[] = [], things: Thing[] = [], places: Place[] = []
  const seen = new Set<string>()
  const shots: Shot[] = [], lines: Line[] = []
  const later = (t: number | undefined, offset: number) => t == null ? undefined : r1(t + offset)
  for (const { offset, b } of pieces) {
    for (const ch of b.characters) if (!seen.has(ch.id)) { seen.add(ch.id); characters.push({ ...ch, best: later(ch.best, offset) }) }
    for (const t of b.things ?? []) if (!seen.has(t.id)) { seen.add(t.id); things.push({ ...t, best: later(t.best, offset) }) }
    for (const x of b.places ?? []) if (!seen.has(x.id)) { seen.add(x.id); places.push({ ...x, best: later(x.best, offset) }) }
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
    characters, things, places, shots, lines,
    music: { ...first.music, cuts_on_beat: pieces.some(p => p.b.music.cuts_on_beat) },
  }
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : NaN)
const r1 = (n: number) => Math.round(n * 10) / 10

/** Parse and clean what the model returned: times in order and touching, at
 *  most `maxSeconds`, empty or broken shots dropped. Null when it is not a
 *  shot list at all. `known`: ids an earlier piece introduced. */
export function normalizeBreakdown(raw: string, maxSeconds: number, known: string[] | { characters?: string[]; things?: string[]; places?: string[] } = []): Breakdown | null {
  let b: any
  try { b = JSON.parse(raw) } catch {
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
    if (s < 0 || e <= s) return null
    try { b = JSON.parse(raw.slice(s, e + 1)) } catch { return null }
  }
  if (!b || !Array.isArray(b.shots)) return null
  const k = Array.isArray(known) ? { characters: known } : known
  const time = (v: unknown) => { const t = num(v); return Number.isFinite(t) ? r1(Math.max(0, Math.min(t, maxSeconds))) : undefined }
  const once = <T extends { id: string }>(list: T[]) => list.filter((x, i) => list.findIndex(y => y.id === x.id) === i)

  const characters: Character[] = once((Array.isArray(b.characters) ? b.characters : []).slice(0, 30)
    .map((c: any, i: number) => ({ id: str(c?.id, 12) || `c${i + 1}`, role: str(c?.role, 120), look: str(c?.look, 400), best: time(c?.best), box: toBox(c?.box) })))
  const things: Thing[] = once((Array.isArray(b.things) ? b.things : []).slice(0, 20)
    .map((t: any, i: number) => {
      const kind = str(t?.kind, 12) as ThingKind
      return { id: str(t?.id, 12) || `t${i + 1}`, kind: THING_KINDS.includes(kind) ? kind : 'prop', name: str(t?.name, 80), look: str(t?.look, 300), best: time(t?.best), box: toBox(t?.box) }
    })
    .filter((t: Thing) => t.name))
  const places: Place[] = once((Array.isArray(b.places) ? b.places : []).slice(0, 12)
    .map((x: any, i: number) => ({ id: str(x?.id, 12) || `p${i + 1}`, name: str(x?.name, 80), look: str(x?.look, 300), best: time(x?.best) }))
    .filter((x: Place) => x.name))
  // A later piece may name someone from an earlier piece without listing them again.
  const who = new Set([...characters.map(c => c.id), ...(k.characters ?? [])])
  const what = new Set([...things.map(t => t.id), ...(k.things ?? [])])
  const where = new Set([...places.map(x => x.id), ...(k.places ?? [])])

  const shots: Shot[] = []
  for (const s of b.shots as any[]) {
    let t0 = num(s?.t0), t1 = num(s?.t1)
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue
    t0 = Math.max(0, Math.min(t0, maxSeconds)); t1 = Math.max(0, Math.min(t1, maxSeconds))
    if (t1 - t0 < 0.05) continue
    const place = str(s.place, 12)
    shots.push({
      t0, t1,
      framing: str(s.framing, 40), camera: str(s.camera, 80), action: str(s.action, 400),
      who: (Array.isArray(s.who) ? s.who : []).map((w: unknown) => str(w, 12)).filter((w: string) => who.has(w)),
      things: (Array.isArray(s.things) ? s.things : []).map((w: unknown) => str(w, 12)).filter((w: string) => what.has(w)),
      place: where.has(place) ? place : '',
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

  // No moment given: the middle of the first shot they are in. A box only
  // means something at the model's own moment, so it goes with it.
  const middle = (inShot: (s: Shot) => boolean) => { const s = shots.find(inShot); return s ? r1((s.t0 + s.t1) / 2) : undefined }
  for (const c of characters) if (c.best == null) { c.best = middle(s => s.who.includes(c.id)); c.box = undefined }
  for (const t of things) if (t.best == null) { t.best = middle(s => !!s.things?.includes(t.id)); t.box = undefined }
  for (const x of places) if (x.best == null) x.best = middle(s => s.place === x.id)

  const lines: Line[] = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)
    .map((l: any) => ({ t: r1(Math.max(0, num(l?.t) || 0)), who: str(l?.who, 12), text: str(l?.text, 300), language: str(l?.language, 12) }))
    .filter((l: Line) => l.text)
  const m = b.music ?? {}
  return {
    duration: r1(duration),
    aspect: str(b.aspect, 8) || '16:9',
    title: str(b.title, 120), summary: str(b.summary, 400), hook: str(b.hook, 300),
    look: { style: str(b.look?.style, 160), palette: str(b.look?.palette, 160), light: str(b.look?.light, 160) },
    characters, things, places, shots, lines,
    music: {
      present: !!m.present, bpm: Number.isFinite(num(m.bpm)) ? Math.round(num(m.bpm)) : null, mood: str(m.mood, 160), cuts_on_beat: !!m.cuts_on_beat,
      genre: str(m.genre, 160), instruments: (Array.isArray(m.instruments) ? m.instruments : []).map((x: any) => str(x, 60)).filter(Boolean).slice(0, 10),
      key: str(m.key, 40), energy: str(m.energy, 400), vocals: str(m.vocals, 160),
    },
  }
}

/** A box the model gave, or nothing when it is not one: four numbers on the
 *  0–1000 scale, top-left before bottom-right, not a sliver. */
function toBox(v: unknown): Box | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined
  const [y0, x0, y1, x1] = v.map(n => Math.round(Math.max(0, Math.min(1000, num(n)))))
  if (![y0, x0, y1, x1].every(Number.isFinite) || y1 - y0 < 20 || x1 - x0 < 20) return undefined
  return [y0, x0, y1, x1]
}
