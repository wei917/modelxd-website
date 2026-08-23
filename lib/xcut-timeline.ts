// lib/xcut-timeline.ts — XCut's timeline: the types, the rough cut from a
// storyboard, the edits (trim / split / move / remove), subtitles from the
// scene scripts, validation, and the RENDER PLAN the ffmpeg route consumes.
// Pure functions, no IO — unit-tested in scripts/test-xcut-timeline.ts.
//
// Model (v1): ONE video track (a sequence — clips butt against each other,
// no gaps; a clip's timeline start is the sum of the lengths before it),
// ONE audio track (clips placed freely by `start`), ONE subtitle track
// (timed cues). Times are seconds. A video clip is a `video` (trimmed by
// in/out of its source) or an `image` held for `out - in` seconds.

export type MediaSrc = {
  bucket: string
  path: string
  mediaType: string
  url?: string          // signed, short-lived; re-signed on load
  fileName?: string
  rowId?: string        // the xcreates row this came from (board/history)
  duelId?: string       // the duel it came from
}

export type VideoClip = {
  id: string
  kind: 'video' | 'image'
  src: MediaSrc
  in: number            // source in-point (s); images: 0
  out: number           // source out-point (s); images: the hold length
  srcDuration?: number  // known source length (s) — trims are clamped to it
  label?: string        // what the badge says (scene title, file name)
  model?: string        // model display name, when generated on ModelXD
  cost?: number         // what that generation cost (USD)
  sceneId?: string      // storyboard scene this clip came from
  transition?: 'cut' | 'dissolve'   // how this clip ENTERS (ignored on the first clip)
  mute?: boolean        // drop the clip's own sound
  gain?: number         // clip sound, 0..2 (1 = as generated)
}

export type AudioClip = {
  id: string
  src: MediaSrc
  start: number         // timeline position (s)
  in: number
  out: number
  srcDuration?: number
  gain: number          // 0..2
  fadeIn?: number       // s
  fadeOut?: number      // s
  label?: string
}

export type Subtitle = { id: string; start: number; end: number; text: string }

export type Timeline = {
  version: 1
  aspect: '16:9' | '9:16' | '1:1'
  fps: 24 | 30
  video: VideoClip[]
  audio: AudioClip[]
  subtitles: Subtitle[]
  settings: {
    resolution: '720p' | '1080p'
    muteClips: boolean   // mute every clip's own sound (music-only films)
    dissolve: number     // seconds, for clips marked transition:'dissolve'
    burnSubtitles: boolean   // burn the subtitle track into the export (and show it in the preview)
  }
}

export const MAX_CLIPS = 120
export const MAX_AUDIO = 24
export const MAX_SUBS  = 400
export const MAX_TOTAL_S = 30 * 60   // a 30-minute cap on what one render will take
export const MIN_CLIP_S  = 0.2

export function emptyTimeline(aspect: Timeline['aspect'] = '16:9'): Timeline {
  return { version: 1, aspect, fps: 24, video: [], audio: [], subtitles: [], settings: { resolution: '1080p', muteClips: false, dissolve: 0.35, burnSubtitles: true } }
}

export const clipLength = (c: { in: number; out: number }) => Math.max(0, c.out - c.in)

/** Timeline start of every video clip (sequence: sum of the lengths before it). */
export function clipStarts(tl: Timeline): number[] {
  const out: number[] = []
  let t = 0
  for (const c of tl.video) { out.push(t); t += clipLength(c) }
  return out
}

export function totalDuration(tl: Timeline): number {
  const v = tl.video.reduce((n, c) => n + clipLength(c), 0)
  const a = tl.audio.reduce((n, c) => Math.max(n, c.start + clipLength(c)), 0)
  return Math.max(v, a)
}

/** Which video clip plays at timeline time t, and the offset into its source. */
export function locate(tl: Timeline, t: number): { index: number; clip: VideoClip; offset: number; start: number } | null {
  const starts = clipStarts(tl)
  for (let i = 0; i < tl.video.length; i++) {
    const c = tl.video[i], len = clipLength(c)
    const last = i === tl.video.length - 1
    if (t >= starts[i] && (t < starts[i] + len || (last && t <= starts[i] + len))) {
      return { index: i, clip: c, offset: c.in + Math.min(len, Math.max(0, t - starts[i])), start: starts[i] }
    }
  }
  return null
}

let seq = 0
export const newId = (prefix = 'c') => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`

// ── Edits (each returns a NEW timeline) ────────────────────────────────────

export function trimClip(tl: Timeline, id: string, edit: { in?: number; out?: number }): Timeline {
  return { ...tl, video: tl.video.map(c => {
    if (c.id !== id) return c
    const max = c.kind === 'image' ? Number.POSITIVE_INFINITY : (c.srcDuration ?? Number.POSITIVE_INFINITY)
    let nin = edit.in ?? c.in, nout = edit.out ?? c.out
    nin = Math.max(0, Math.min(nin, max))
    nout = Math.max(0, Math.min(nout, max))
    if (nout - nin < MIN_CLIP_S) { if (edit.out !== undefined) nout = nin + MIN_CLIP_S; else nin = Math.max(0, nout - MIN_CLIP_S) }
    return { ...c, in: nin, out: nout }
  }) }
}

/** Split the clip under timeline time t into two clips at that point. */
export function splitAt(tl: Timeline, t: number): Timeline {
  const hit = locate(tl, t)
  if (!hit) return tl
  const { index, clip, offset } = hit
  if (offset - clip.in < MIN_CLIP_S || clip.out - offset < MIN_CLIP_S) return tl
  const a: VideoClip = { ...clip, out: offset }
  const b: VideoClip = { ...clip, id: newId(), in: offset, transition: 'cut' }
  const video = [...tl.video.slice(0, index), a, b, ...tl.video.slice(index + 1)]
  return { ...tl, video }
}

export function moveClip(tl: Timeline, id: string, toIndex: number): Timeline {
  const from = tl.video.findIndex(c => c.id === id)
  if (from < 0) return tl
  const video = [...tl.video]
  const [c] = video.splice(from, 1)
  video.splice(Math.max(0, Math.min(toIndex, video.length)), 0, c)
  return { ...tl, video }
}

export function removeClip(tl: Timeline, id: string): Timeline {
  return { ...tl, video: tl.video.filter(c => c.id !== id), audio: tl.audio.filter(c => c.id !== id), subtitles: tl.subtitles.filter(s => s.id !== id) }
}

export function insertClip(tl: Timeline, clip: VideoClip, atIndex?: number): Timeline {
  const video = [...tl.video]
  video.splice(atIndex === undefined ? video.length : Math.max(0, Math.min(atIndex, video.length)), 0, clip)
  return { ...tl, video }
}

// ── From a storyboard: the rough cut ───────────────────────────────────────

export type StoryboardScene = {
  id: string; title?: string; script?: string; duration_s?: number; asset?: boolean; continues?: boolean
  url?: string; row_id?: string; still_url?: string; still_row_id?: string; model_name?: string; still_model_name?: string; cost?: number
}

/** A source resolved for a scene: its clip (if shot) or its key still. */
export type SceneSource = { video?: MediaSrc & { duration?: number }; still?: MediaSrc }

/**
 * The rough cut you arrive with: scenes in strip order, assets skipped; a
 * shot scene is its clip trimmed to the card's duration (or the clip's own
 * length when shorter); an unshot scene with a key still is that still held
 * for the card's duration; a scene with neither is skipped. A continuation
 * (continues:true) enters on a hard cut; a new scene enters on a dissolve
 * when the timeline's dissolve setting is > 0.
 */
export function timelineFromStoryboard(
  scenes: StoryboardScene[],
  sources: Record<string, SceneSource>,
  opts?: { aspect?: Timeline['aspect']; dissolve?: number },
): Timeline {
  const tl = emptyTimeline(opts?.aspect ?? '16:9')
  if (opts?.dissolve !== undefined) tl.settings.dissolve = opts.dissolve
  let first = true
  for (const s of scenes) {
    if (s.asset) continue
    const src = sources[s.id]
    const want = Math.max(MIN_CLIP_S, Number(s.duration_s) || 6)
    const enter: VideoClip['transition'] = first ? 'cut' : (s.continues ? 'cut' : (tl.settings.dissolve > 0 ? 'dissolve' : 'cut'))
    if (src?.video) {
      const len = src.video.duration && src.video.duration > 0 ? Math.min(want, src.video.duration) : want
      tl.video.push({ id: newId(), kind: 'video', src: src.video, in: 0, out: len, srcDuration: src.video.duration, label: s.title, model: s.model_name, cost: s.cost, sceneId: s.id, transition: enter })
      first = false
    } else if (src?.still) {
      tl.video.push({ id: newId(), kind: 'image', src: src.still, in: 0, out: want, label: s.title, model: s.still_model_name, sceneId: s.id, transition: enter })
      first = false
    }
  }
  tl.subtitles = subtitlesFromScenes(scenes, tl)
  return tl
}

/** One cue per clip that came from a scene, spanning that clip, carrying the scene's script. */
export function subtitlesFromScenes(scenes: StoryboardScene[], tl: Timeline): Subtitle[] {
  const byId = new Map(scenes.map(s => [s.id, s]))
  const starts = clipStarts(tl)
  const out: Subtitle[] = []
  tl.video.forEach((c, i) => {
    const s = c.sceneId ? byId.get(c.sceneId) : undefined
    const text = (s?.script ?? '').trim()
    if (!text) return
    out.push({ id: newId('s'), start: starts[i], end: starts[i] + clipLength(c), text })
  })
  return out
}

// ── Validation (what the API accepts from the client) ──────────────────────

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

function cleanSrc(raw: any): MediaSrc | null {
  if (!raw || typeof raw !== 'object') return null
  const bucket = str(raw.bucket, 64), path = str(raw.path, 400), mediaType = str(raw.mediaType, 64)
  if (!bucket || !path || !mediaType) return null
  return {
    bucket, path, mediaType,
    ...(str(raw.url, 2000) ? { url: str(raw.url, 2000) } : {}),
    ...(str(raw.fileName, 160) ? { fileName: str(raw.fileName, 160) } : {}),
    ...(str(raw.rowId, 64) ? { rowId: str(raw.rowId, 64) } : {}),
    ...(str(raw.duelId, 64) ? { duelId: str(raw.duelId, 64) } : {}),
  }
}

export function cleanTimeline(raw: unknown): Timeline | null {
  if (!raw || typeof raw !== 'object') return null
  const r: any = raw
  const tl = emptyTimeline(['16:9', '9:16', '1:1'].includes(r.aspect) ? r.aspect : '16:9')
  tl.fps = r.fps === 30 ? 30 : 24
  tl.settings = {
    resolution: r.settings?.resolution === '720p' ? '720p' : '1080p',
    muteClips: r.settings?.muteClips === true,
    dissolve: Math.max(0, Math.min(2, num(r.settings?.dissolve, 0.35))),
    burnSubtitles: r.settings?.burnSubtitles !== false,   // on unless switched off
  }
  for (const c of (Array.isArray(r.video) ? r.video : []).slice(0, MAX_CLIPS)) {
    const src = cleanSrc(c?.src); if (!src) continue
    const kind = c.kind === 'image' ? 'image' : 'video'
    const cin = Math.max(0, num(c.in)), cout = Math.max(cin + MIN_CLIP_S, num(c.out, cin + 6))
    tl.video.push({
      id: str(c.id, 40) || newId(), kind, src, in: cin, out: cout,
      ...(Number.isFinite(Number(c.srcDuration)) ? { srcDuration: num(c.srcDuration) } : {}),
      ...(str(c.label, 120) ? { label: str(c.label, 120) } : {}),
      ...(str(c.model, 80) ? { model: str(c.model, 80) } : {}),
      ...(Number.isFinite(Number(c.cost)) ? { cost: num(c.cost) } : {}),
      ...(str(c.sceneId, 40) ? { sceneId: str(c.sceneId, 40) } : {}),
      transition: c.transition === 'dissolve' ? 'dissolve' : 'cut',
      ...(c.mute === true ? { mute: true } : {}),
      ...(Number.isFinite(Number(c.gain)) ? { gain: Math.max(0, Math.min(2, num(c.gain, 1))) } : {}),
    })
  }
  for (const c of (Array.isArray(r.audio) ? r.audio : []).slice(0, MAX_AUDIO)) {
    const src = cleanSrc(c?.src); if (!src) continue
    const cin = Math.max(0, num(c.in)), cout = Math.max(cin + MIN_CLIP_S, num(c.out, cin + 30))
    tl.audio.push({
      id: str(c.id, 40) || newId('a'), src, start: Math.max(0, num(c.start)), in: cin, out: cout,
      ...(Number.isFinite(Number(c.srcDuration)) ? { srcDuration: num(c.srcDuration) } : {}),
      gain: Math.max(0, Math.min(2, num(c.gain, 1))),
      ...(num(c.fadeIn) > 0 ? { fadeIn: Math.min(10, num(c.fadeIn)) } : {}),
      ...(num(c.fadeOut) > 0 ? { fadeOut: Math.min(10, num(c.fadeOut)) } : {}),
      ...(str(c.label, 120) ? { label: str(c.label, 120) } : {}),
    })
  }
  for (const s of (Array.isArray(r.subtitles) ? r.subtitles : []).slice(0, MAX_SUBS)) {
    const text = str(s?.text, 400)?.trim(); if (!text) continue
    const start = Math.max(0, num(s.start)), end = Math.max(start + 0.1, num(s.end, start + 2))
    tl.subtitles.push({ id: str(s.id, 40) || newId('s'), start, end, text })
  }
  tl.subtitles.sort((a, b) => a.start - b.start)
  return tl
}

// ── The render plan (what ffmpeg is asked to do) ───────────────────────────

export type RenderPlan = {
  width: number; height: number; fps: number
  duration: number
  segments: Array<{ index: number; kind: 'video' | 'image'; src: MediaSrc; in: number; out: number; start: number; length: number; dissolveIn: number; mute: boolean; gain: number }>
  audio: Array<{ src: MediaSrc; start: number; in: number; out: number; gain: number; fadeIn: number; fadeOut: number }>
  subtitles: Subtitle[]
  muteClips: boolean
}

export function renderPlan(tl: Timeline): RenderPlan {
  const [w, h] = tl.settings.resolution === '720p'
    ? (tl.aspect === '9:16' ? [720, 1280] : tl.aspect === '1:1' ? [720, 720] : [1280, 720])
    : (tl.aspect === '9:16' ? [1080, 1920] : tl.aspect === '1:1' ? [1080, 1080] : [1920, 1080])
  const starts = clipStarts(tl)
  const segments = tl.video.map((c, i) => {
    const length = clipLength(c)
    // A dissolve can't be longer than either neighbour; the first clip has none.
    const prevLen = i > 0 ? clipLength(tl.video[i - 1]) : 0
    const dissolveIn = i > 0 && c.transition === 'dissolve'
      ? Math.max(0, Math.min(tl.settings.dissolve, length / 2, prevLen / 2)) : 0
    return { index: i, kind: c.kind, src: c.src, in: c.in, out: c.out, start: starts[i], length, dissolveIn, mute: tl.settings.muteClips || c.mute === true || c.kind === 'image', gain: c.gain ?? 1 }
  })
  const videoLen = segments.reduce((n, s) => n + s.length, 0) - segments.reduce((n, s) => n + s.dissolveIn, 0)
  const audio = tl.audio.map(a => ({ src: a.src, start: a.start, in: a.in, out: a.out, gain: a.gain, fadeIn: a.fadeIn ?? 0, fadeOut: a.fadeOut ?? 0 }))
  const duration = Math.max(videoLen, ...audio.map(a => a.start + (a.out - a.in)), 0)
  return { width: w, height: h, fps: tl.fps, duration, segments, audio, subtitles: tl.settings.burnSubtitles ? tl.subtitles.filter(s => s.start < duration) : [], muteClips: tl.settings.muteClips }
}

// ── Subtitle layout ────────────────────────────────────────────────────────
// libass wraps only at spaces, so a Chinese cue is one line however long —
// a 28-character script ran off both edges of a 1080p frame (Aug 23). The
// render writes ASS and wraps here: at most two lines per cue, broken after
// punctuation where possible, and a cue that still will not fit is shrunk
// (down to a floor) rather than clipped.

/** Display width of a character in font-size units: CJK ≈ 1 em, Latin ≈ 0.55, space 0.3. */
const charUnits = (ch: string) => /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55
const BREAK_AFTER = /[，。、；：！？,.;:!?)\]）」』\s—–]/

/** Greedy wrap to lines of ≤ maxUnits, preferring a break right after punctuation or a space. */
export function wrapCue(text: string, maxUnits: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const chars = [...para.trim()]
    if (chars.length === 0) continue
    let line: string[] = [], width = 0, lastBreak = -1, widthAtBreak = 0
    for (const ch of chars) {
      const w = charUnits(ch)
      if (width + w > maxUnits && line.length > 0) {
        // Break at the last punctuation if it is not too far back; else here.
        if (lastBreak > 0 && width - widthAtBreak < maxUnits * 0.45) {
          out.push(line.slice(0, lastBreak).join('').trim())
          line = line.slice(lastBreak); width -= widthAtBreak
        } else { out.push(line.join('').trim()); line = []; width = 0 }
        lastBreak = -1; widthAtBreak = 0
      }
      line.push(ch); width += w
      if (BREAK_AFTER.test(ch)) { lastBreak = line.length; widthAtBreak = width }
    }
    if (line.length > 0) out.push(line.join('').trim())
  }
  return out.filter(Boolean)
}

/** Fit a cue into ≤ 2 lines: wrap at the base size, shrink (×0.85 steps, floor 0.6) until it fits, else 3 lines at the floor. */
export function fitCue(text: string, frameWidth: number, baseSize: number): { lines: string[]; size: number } {
  const usable = frameWidth * 0.88
  let size = baseSize
  for (let i = 0; i < 4; i++) {
    const lines = wrapCue(text, usable / size)
    if (lines.length <= 2) return { lines, size }
    size = Math.max(baseSize * 0.6, Math.round(size * 0.85))
    if (size === baseSize * 0.6) break
  }
  return { lines: wrapCue(text, usable / size).slice(0, 3), size }
}

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}
const assText = (t: string) => t.replace(/[{}]/g, ch => (ch === '{' ? '｛' : '｝')).replace(/\\/g, '＼')

/** Subtitles as an ASS file sized to the frame (burned in by the render). */
export function toAss(subs: Subtitle[], width: number, height: number, fontName = 'Noto Sans TC'): string {
  const base = Math.round(height / 24)           // ~4% of the frame, the subtitling convention
  const marginV = Math.round(height / 20), marginH = Math.round(width * 0.06)
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${base},&H00FFFFFF,&H000000FF,&HA0000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(base / 18))},0,2,${marginH},${marginH},${marginV},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const lines = [...subs].sort((a, b) => a.start - b.start).map(s => {
    const { lines: wrapped, size } = fitCue(s.text, width, base)
    const tag = size !== base ? `{\\fs${size}}` : ''
    return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${tag}${wrapped.map(assText).join('\\N')}`
  })
  return head.concat(lines).join('\n') + '\n'
}

/** Subtitles as an SRT file (for download). */
export function toSrt(subs: Subtitle[]): string {
  const ts = (t: number) => {
    const ms = Math.round(t * 1000)
    const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), r = ms % 1000
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
  }
  return [...subs].sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text.replace(/\r?\n/g, '\n')}\n`).join('\n')
}
