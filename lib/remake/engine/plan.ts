// lib/remake/engine/plan.ts: 同款 phase 2, stage A. The director (Claude)
// turns the original's shot list and the user's swaps into the remake's
// plan: the same shots, timing, camera and transitions, with new characters,
// theme and setting. It maps; it does not invent (the boxing test took ~15
// rounds because the story had to be invented; here the original supplies
// it). Code then checks the plan before any money is spent on pictures.

import type { Breakdown, CastChoice, RemakeLook, Shot } from '../config'

export type CastSwap = { choice: CastChoice; text: string; photo?: boolean }
export type RemakeRequest = {
  breakdown: Breakdown
  /** The stretch to remake, on the breakdown's clock. */
  from: number
  seconds: number
  cast: Record<string, CastSwap>
  theme: string
  setting: string
  look: RemakeLook
  /** Voices and on-screen text. */
  language: string
  product: boolean
  /** The source's real shape when known (X and uploads); the breakdown's is a guess. */
  aspect?: string
  /** An effect drawn over the whole remake in the edit instead of by the
   *  models. 'fan': a ceiling fan's blade passes make the changes (the fan
   *  outfit-change trend), so no picture or clip may contain a fan. */
  overlay?: 'fan'
}

export type PlanCharacter = {
  id: string
  name: string
  /** keep / describe / famous / photo: gets a reference sheet. extra: drawn inline, no sheet. */
  source: 'keep' | 'describe' | 'famous' | 'photo' | 'extra'
  /** English, 30–70 words: who they are, build, face, hair, clothes. Pasted into every picture of them. */
  canon: string
}
export type PlanShot = {
  n: number
  t0: number
  t1: number
  /** Starts from the previous shot's last frame instead of a new keyframe. */
  continues: boolean
  /** The first frame, in English (framing, who is where, setting, light). Empty when `continues`. */
  keyframe: string
  /** Characters whose sheets feed the keyframe (at most 2). */
  refs: string[]
  /** Whether the user's product appears in the keyframe. */
  product: boolean
  /** What happens in the clip, in English, timed, with the camera move. */
  clip: string
  /** What this shot sounds like, in English: the clip model makes its own sound from it. */
  sound: string
  /** Whole seconds to generate (1–15), at least the shot's length. */
  clip_seconds: number
  transition_in: string
  /** On-screen text in the remake's language, or "". */
  text: string
  /** For a shot on the same set as an earlier one (`sameSet`): only what is
   *  different from that shot's first frame (clothes, pose, who is there), in
   *  English. Its keyframe is an edit of that frame, so the room stays put. */
  change?: string
  /** Nobody changes place during the shot and the camera is locked: the clip
   *  gets the same first and last frame, so its camera cannot drift. */
  still?: boolean
}
export type PlanVoice = { t: number; who: string; text: string; voice: string; style: string }
export type RemakePlan = {
  title: string
  logline: string
  /** The style alone, pasted at the start of every picture prompt (sheets included). */
  look: string
  /** The setting, pasted into every keyframe (never into sheets, or the venue leaks into them). */
  world: string
  characters: PlanCharacter[]
  shots: PlanShot[]
  voices: PlanVoice[]
  sound: string
}

export const VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede'] as const

const LOOKS: Record<RemakeLook, string> = {
  keep: '',
  anime: 'Hand-drawn 2D anime film frame: bold clean ink outlines, cel shading, flat painted color, expressive faces, painterly backgrounds, cinematic light. Not 3D, not CG, not photographic.',
  realistic: 'Cinematic photoreal film still: natural skin and fabric, real lenses and light, shallow depth of field. Not a cartoon, not CG.',
  '3d': 'Stylized 3D animated feature film frame: soft global illumination, appealing rounded characters, rich materials, like a modern animated studio film.',
}

/** The shots of the stretch to remake, moved to its own clock (0 = its start). */
export function stretch(b: Breakdown, from: number, seconds: number): Shot[] {
  const end = from + seconds
  return b.shots
    .filter(s => s.t1 > from + 0.05 && s.t0 < end - 0.05)
    .map(s => ({ ...s, t0: Math.round((Math.max(s.t0, from) - from) * 10) / 10, t1: Math.round((Math.min(s.t1, end) - from) * 10) / 10 }))
}

const STILL_CAMERA = /^(locked|static|still|fixed|tripod)/i

/** For each shot, the earlier shot whose set it shares (index), or null: the
 *  same place, the same framing, and a camera that does not move in either.
 *  A video that never changes scene (owner, Oct 17: "the original video
 *  doesn't change scene at all") is one set: every later keyframe is an edit
 *  of the first one, so the room, the camera and the light cannot drift. Code
 *  decides this from the read, so the director cannot forget it. */
export function sameSet(shots: Shot[]): (number | null)[] {
  return shots.map((s, i) => {
    if (!s.place || !STILL_CAMERA.test(s.camera.trim())) return null
    for (let j = 0; j < i; j++) {
      const o = shots[j]
      if (o.place === s.place && o.framing === s.framing && STILL_CAMERA.test(o.camera.trim())) return j
    }
    return null
  })
}

export function plannerPrompt(req: RemakeRequest): { system: string; user: string } {
  const shots = stretch(req.breakdown, req.from, req.seconds)
  const sets = sameSet(shots)
  const used = new Set(shots.flatMap(s => s.who))
  const counts = new Map<string, number>()
  for (const s of shots) for (const w of s.who) counts.set(w, (counts.get(w) ?? 0) + 1)
  const cast = req.breakdown.characters.filter(c => used.has(c.id)).map(c => {
    const swap = req.cast[c.id] ?? { choice: 'keep', text: '' }
    const what = swap.choice === 'describe' ? `replace with: ${swap.text}`
      : swap.choice === 'famous' ? `replace with the well-known person ${swap.text}, drawn in the film's style`
      : swap.choice === 'photo' ? 'replace with the person in the user\'s photo (a reference sheet is made from it)'
      : 'keep as in the original'
    return { id: c.id, original: `${c.role}: ${c.look}`, shots: counts.get(c.id) ?? 0, swap: what }
  })
  const look = req.look === 'keep' ? `Match the original's look: ${req.breakdown.look.style}; ${req.breakdown.look.palette}; ${req.breakdown.look.light}.` : LOOKS[req.look]
  const system = `You are the director of a remake made by AI models. You get the shot list of a real video and what the user wants changed. Your job is to map every shot of the original onto the remake: same timing, same framing, same camera move, same transition, same energy and comedy beat, but with the user's characters, theme and setting. Do not invent a different story; the original's structure is the story.

How the remake is produced (write for this):
- Every character with a reference sheet is drawn from it: the picture model edits the sheet into each keyframe, so faces and builds stay the same. Give each sheet character one fixed English "canon" (30-70 words: species or age, build, face, hair, clothes) that stays the same in every shot.
- One-shot extras (crowd faces, passers-by) get source "extra": no sheet, described inside the keyframe.
- A keyframe is the first frame of a shot: describe framing, who is where, the setting and light. At most 2 sheet characters per keyframe. Never ask for text, letters or logos in a picture.
- A clip is made from its keyframe by an image-to-video model, 1 to 15 whole seconds, then cut to the shot's length. Describe one clear action with timing ("at 0.5 s he..."), the camera move, and end with "No cuts." Fast shots under a second still get their own 1-second clip.
- If a shot is the same continuous moment as the previous one (same place, same people, the action carries on), set "continues": true: it starts from the previous clip's last frame and needs no keyframe.
- Set "still": true for a shot in which nobody changes place and the camera is locked (only small movement: breathing, a blink, a smile, a slight turn of the head or hand): its clip is made with the same picture as its first and last frame, which keeps the camera perfectly still. Any shot where someone moves across the frame, rolls, walks, falls, or the camera moves is "still": false.
- A shot marked "same_set_as": n is filmed on exactly the same set, from exactly the same locked camera, as shot n: its first frame is made by EDITING shot n's first frame, so the room, the furniture, the framing and the light come out identical. For it, write "change": only what is different from shot n's first frame (her clothes, pose, expression, who is there), in English, never the room again. Its keyframe text is still written in full.
- On-screen text and spoken lines are rewritten for the new theme, in ${req.language}, about the same length and timing as the original's. Never copy the original's lyrics, slogans or brand names. Voices come from text to speech: pick a voice from ${VOICES.join(', ')} and give a short delivery style in English.
- Every shot says what it sounds like ("sound": crowd roar, sparks, a scream, footsteps...): the video model makes the clip's own sound from it, and a shot with no sound direction comes out nearly silent. Match the original's energy: if the crowd roars through a shot, say so.
- Nothing from the original is reused: not its footage, sound, music, logos or text.${req.overlay === 'fan' ? `
- A ceiling fan is added over the whole remake in the edit, by our own effect: its blades sweep across the frame at one steady speed, and each change of clothes happens under a passing blade. So never draw, mention or imply a ceiling fan, fan blades, a motor housing or their shadows in any keyframe, change or clip. After any opening move, every shot is the person lying still in that shot's pose, with only small natural movement (breathing, a blink, a slight smile or head turn) and no change of position, so the shot ends on the frame it starts with; write each clip that way. Sound: quiet room tone and a fan's soft whir, never music or singing (the music is chosen later).` : ''}

Return JSON only:
{"title": string (${req.language}), "logline": string (${req.language}), "look": string (English: the drawing style only, never the place or the frame shape), "world": string (English: the setting and its light, pasted into every keyframe; signs and screens carry no lettering),
 "characters": [{"id": string, "name": string, "source": "keep"|"describe"|"famous"|"photo"|"extra", "canon": string}],
 "shots": [{"n": int, "t0": number, "t1": number, "continues": bool, "keyframe": string, "change": string (only for a same_set_as shot, else ""), "still": bool, "refs": [ids], "product": bool, "clip": string, "clip_seconds": int, "sound": string, "transition_in": string, "text": string}],
 "voices": [{"t": number, "who": id, "text": string, "voice": string, "style": string}],
 "sound": string (English: the ambience and effects the clips should carry)}
The shots must be exactly the original shots given, in order, with the same t0 and t1.`
  const user = JSON.stringify({
    original: { title: req.breakdown.title, summary: req.breakdown.summary, hook: req.breakdown.hook, look: req.breakdown.look, music: req.breakdown.music, aspect: req.aspect ?? req.breakdown.aspect },
    stretch: { from_seconds: req.from, seconds: req.seconds },
    shots: shots.map((s, i) => sets[i] == null ? s : { ...s, same_set_as: sets[i]! + 1 }),
    lines: req.breakdown.lines.filter(l => l.t >= req.from && l.t < req.from + req.seconds).map(l => ({ ...l, t: Math.round((l.t - req.from) * 10) / 10 })),
    cast,
    changes: { theme: req.theme || '(keep)', setting: req.setting || '(keep)', look, language: req.language, product_photo: req.product },
  }, null, 1)
  return { system, user }
}

/** Code checks before any picture is paid for. Returns the problems found. */
export function checkPlan(plan: RemakePlan, req: RemakeRequest): string[] {
  const issues: string[] = []
  const shots = stretch(req.breakdown, req.from, req.seconds)
  if (plan.shots.length !== shots.length) issues.push(`plan has ${plan.shots.length} shots, the stretch has ${shots.length}`)
  const ids = new Set(plan.characters.map(c => c.id))
  plan.shots.forEach((s, i) => {
    const o = shots[i]
    if (o && (Math.abs(s.t0 - o.t0) > 0.15 || Math.abs(s.t1 - o.t1) > 0.15)) issues.push(`shot ${s.n}: ${s.t0}-${s.t1} is not the original's ${o.t0}-${o.t1}`)
    const len = s.t1 - s.t0
    if (!Number.isInteger(s.clip_seconds) || s.clip_seconds < 1 || s.clip_seconds > 15) issues.push(`shot ${s.n}: clip_seconds ${s.clip_seconds}`)
    else if (s.clip_seconds + 0.01 < len) issues.push(`shot ${s.n}: a ${s.clip_seconds}s clip for a ${len.toFixed(1)}s shot`)
    if (i === 0 && s.continues) issues.push('shot 1 cannot continue')
    if (!s.continues && !s.keyframe.trim()) issues.push(`shot ${s.n}: no keyframe`)
    if (s.refs.length > 2) issues.push(`shot ${s.n}: ${s.refs.length} sheet characters (2 at most)`)
    for (const r of s.refs) {
      if (!ids.has(r)) issues.push(`shot ${s.n}: unknown character ${r}`)
      else if (plan.characters.find(c => c.id === r)?.source === 'extra') issues.push(`shot ${s.n}: extra ${r} has no sheet`)
    }
  })
  for (const v of plan.voices) if (!VOICES.includes(v.voice as any)) issues.push(`voice ${v.voice} is not offered`)
  return issues
}

/** What the plan will cost to make, in dollars, at list prices (phase 0/1 rates). */
export function estimatePlanUsd(plan: RemakePlan): number {
  const sheets = plan.characters.filter(c => c.source !== 'extra').length
  const keyframes = plan.shots.filter(s => !s.continues).length
  const seconds = plan.shots.reduce((a, s) => a + s.clip_seconds, 0)
  return (sheets + keyframes) * 0.09 + seconds * 0.14 + plan.shots.length * 0.01 + plan.voices.length * 0.01
}
