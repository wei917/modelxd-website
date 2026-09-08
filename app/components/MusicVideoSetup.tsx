'use client'
// app/components/MusicVideoSetup.tsx — the Music Video template's setup page
// (owner, Aug 14: "a better form for users to pick / preview before start";
// re-laid out Sep 6 against the owner's own reference design).
//
// The fields ARE the skill's minimal-brief contract — orientation, style
// anchor, title text, cast offer — which the director otherwise collects by
// ASKING. Pre-answered here, the first director turn is the storyboard:
// zero question round-trips.
//
// LAYOUT (Sep 6). This stopped being a tall card in the chat rail and became
// the page: the SONG across the top with its waveform, then Reference and
// Direction side by side, then a brief bar that states what is about to be
// shot. The reason is not decoration — the song is the subject of the whole
// template and it used to sit near the bottom as a paperclip, while "which
// part of the song?" was a text box you typed `00:42-01:00` into. It is a
// dragged region now, and the runtime follows it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { type Attachment } from './AttachmentButton'
import type { StoryExtra } from './StorySetup'

/** Client-side twin of isSupportedVideoUrl() in lib/providers/google.ts.
 *  Kept deliberately dumb — it only decides whether to collapse the style
 *  cards. The server validates for real before spending anything. */
function isYouTube(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const h = u.hostname.replace(/^www\./, '').toLowerCase()
    return (u.protocol === 'https:' || u.protocol === 'http:')
      && (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be')
  } catch { return false }
}

// Each preset carries a real frame. "Concept" and "Live band" mean nothing as
// words — you pick a look by looking at it (owner, Sep 6). The thumbnails are
// generated stills living in public/xdirect/styles/, so swapping one is a file
// drop rather than a deploy.
const FORMS = [
  { id: 'kpop',      i18n: 'xd.mv.form.kpop',      thumb: '/xdirect/styles/kpop.jpg' },
  { id: 'narrative', i18n: 'xd.mv.form.narrative', thumb: '/xdirect/styles/narrative.jpg' },
  { id: 'concept',   i18n: 'xd.mv.form.concept',   thumb: '/xdirect/styles/concept.jpg' },
  { id: 'live',      i18n: 'xd.mv.form.live',      thumb: '/xdirect/styles/live.jpg' },
  { id: 'anime',     i18n: 'xd.mv.form.anime',     thumb: '/xdirect/styles/anime.jpg' },
  { id: 'lyric',     i18n: 'xd.mv.form.lyric',     thumb: '/xdirect/styles/lyric.jpg' },
] as const

const FORM_BRIEF: Record<string, string> = {
  kpop:      'K-pop performance style',
  narrative: 'narrative film style',
  concept:   'concept/abstract style',
  live:      'live-session band style',
  anime:     'anime/illustrated style',
  lyric:     'lyric-forward typography style',
}

// Round numbers only. 15 and 18 were here because an early test song was 18
// seconds long — a preset that fits one file is not a preset (owner, Sep 4).
const DURATIONS = [10, 30, 60]

// Not an adjective — each level switches on a different set of REQUIREMENTS
// the board must satisfy (owner, Aug 28, after an 18s cut came back as the
// same shot at three focal lengths). The dial has to change the board, not
// the wording, so its colour ramps with it.
const DRAMA = [
  { id: 'performance', i18n: 'xd.mv.drama.perf',  hue: 'var(--mode-audio)' },
  { id: 'story',       i18n: 'xd.mv.drama.story', hue: 'var(--mode-image)' },
  { id: 'drama',       i18n: 'xd.mv.drama.drama', hue: 'var(--red)' },
] as const

const DRAMA_BRIEF: Record<string, string> = {
  performance: 'DRAMA LEVEL 1 — PERFORMANCE. The hook is the point. One spine sentence, but no turn is required and one location is fine. Chosen deliberately: do not land here by failing to find a story.',
  story:       'DRAMA LEVEL 2 — STORY. Full Step 1.5: spine sentence, both people on the board, setup/build/turn/payoff, the last cut shows the change, one place and one hour.',
  drama:       'DRAMA LEVEL 3 — DRAMA. Story, plus all four or the board is not at this level: a REVERSAL (the situation flips against the wanting — escalation is not reversal), a COST paid or deliberately withheld on screen, at least ONE UNPRETTY frame that is allowed to be uncomfortable, and a first and last cut that CONTRADICT rather than merely differ.',
}

// The song's FEELING — a different axis from the visual style, and from GENRE.
// A love song had nowhere to go in the old genre list (owner, Aug 28: "which
// one is romance?"). Genre the director can hear for itself; how the song
// FEELS is the thing only the user knows. Each chip wears its own feeling.
const MOODS = [
  { id: 'romantic',   i18n: 'xd.mv.mood.romantic',   hue: 'var(--red)' },
  { id: 'heartfelt',  i18n: 'xd.mv.mood.heartfelt',  hue: 'var(--mode-image)' },
  { id: 'upbeat',     i18n: 'xd.mv.mood.upbeat',     hue: 'var(--mode-video)' },
  { id: 'melancholy', i18n: 'xd.mv.mood.melancholy', hue: 'var(--mode-text)' },
  { id: 'driving',    i18n: 'xd.mv.mood.driving',    hue: 'var(--provider-anthropic)' },
  { id: 'laidback',   i18n: 'xd.mv.mood.laidback',   hue: 'var(--mode-audio)' },
  { id: 'nostalgic',  i18n: 'xd.mv.mood.nostalgic',  hue: 'var(--provider-alibaba)' },
  { id: 'defiant',    i18n: 'xd.mv.mood.defiant',    hue: 'var(--score-elite)' },
] as const

/** Written for the DIRECTOR, in craft terms — a genre word alone would just
 *  invite the clichés the skill spends a whole section warning against. */
const MOOD_BRIEF: Record<string, string> = {
  romantic:   'warm and close — two people in the same frame, soft light, the camera lingering a beat past comfortable',
  heartfelt:  'deep and unhurried — long takes, stillness, the emotion carried by the face and the light',
  upbeat:     'bright and light-footed — quick cuts, motion in frame, the chorus lifts',
  melancholy: 'cool and spacious — wide frames, the subject small in them, held longer than feels comfortable',
  driving:    'hard and physical — heavier contrast, handheld energy, cuts landing on the beat',
  laidback:   'loose and unhurried — slow moves, rich shadow, texture and skin, nothing rushed',
  nostalgic:  'remembered rather than seen — softer grade, grain, warm falloff, moments caught slightly late',
  defiant:    'confident and grounded — strong poses, low angles, hard cuts, attitude over prettiness',
}

/** The waveform never shows less than 10 seconds of timeline. A 6-second clip
 *  stretched across the full width reads as a long track and makes every drag
 *  wildly imprecise; centred inside a 10s window it keeps an honest
 *  seconds-per-pixel and looks like what it is (owner, Sep 6). */
const MIN_SPAN = 10
const viewOf = (dur: number) => {
  const span = Math.max(MIN_SPAN, dur)
  return { span, offset: (span - dur) / 2 }
}

const mmss = (s: number) => {
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`
}
/** In/out points to a tenth. Whole seconds made a sub-second selection read
 *  as "00:02 – 00:02" — the region was real but the numbers said nothing
 *  (seen on a 6-second file, Sep 6). Edit points need more resolution than
 *  a running clock does. */
const mmssT = (s: number) => {
  const m = Math.floor(s / 60), r = s % 60
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`
}

export default function MusicVideoSetup({ busy, onStart, onSkip }: {
  busy: boolean
  /** Build the first message from the form and send it with the files. */
  onStart: (brief: string, atts: Attachment[], extra: StoryExtra) => void
  /** Kept for the shared setup-form shape, but NOT rendered here any more
   *  (owner, Sep 6): the page opens straight on the upload box. The freeform
   *  road is its own template — /xdirect/scratch — rather than a link buried
   *  in this form's header. */
  onSkip: () => void
}) {
  const t = useT()
  const [drama, setDrama]     = useState<string>('story')
  const [sync, setSync]       = useState(false)
  const [reference, setRef]   = useState('')
  const [mood, setMood]       = useState<string | null>(null)
  const [form, setForm]       = useState<string | null>(null)
  const [aspect, setAspect]   = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDur]    = useState<number>(30)
  const [title, setTitle]     = useState('')
  const [songAtts, setSong]   = useState<Attachment[]>([])
  const [styleAtts, setStyle] = useState<Attachment[]>([])
  const [castAtts, setCast]   = useState<Attachment[]>([])
  const [coverAtts, setCover] = useState<Attachment[]>([])

  /** Peak envelope of the attached song, and its true length. Both come from
   *  the bytes the browser already holds — nothing is uploaded to draw this. */
  const [peaks, setPeaks]         = useState<number[] | null>(null)
  const [songSeconds, setSongSec] = useState<number | null>(null)
  /** The chosen stretch, in seconds. null = the whole track. */
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [matchSong, setMatchSong] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** null = idle. A number = the anchor of a NEW selection being dragged.
   *  'a' / 'b' = an existing handle is being moved. */
  const dragRef   = useRef<number | 'a' | 'b' | null>(null)
  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const rafRef    = useRef<number | null>(null)
  const [songUrl, setSongUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [head, setHead]       = useState(0)

  // A playable URL for the attached bytes, torn down with the attachment.
  useEffect(() => {
    const f = songAtts[0]?.file
    if (!f) { setSongUrl(null); return }
    const u = URL.createObjectURL(f)
    setSongUrl(u)
    return () => { URL.revokeObjectURL(u) }
  }, [songAtts])

  // ── decode the song into peaks ─────────────────────────────────────────
  useEffect(() => {
    const f = songAtts[0]?.file
    if (!f) { setPeaks(null); setSongSec(null); setSel(null); return }
    let dead = false
    ;(async () => {
      try {
        const buf = await f.arrayBuffer()
        const AC: typeof AudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext
        const ctx = new AC()
        const audio = await ctx.decodeAudioData(buf)
        if (dead) { void ctx.close(); return }
        const ch = audio.getChannelData(0)
        const N = 900
        const step = Math.max(1, Math.floor(ch.length / N))
        const out: number[] = []
        for (let i = 0; i < N; i++) {
          // RMS, not peak. A mastered track hits full scale in nearly every
          // bucket, so peak-per-bucket normalised to the maximum draws a solid
          // slab with no shape at all (owner, Sep 6: "the wave amplitude is
          // too high, scale is wrong"). RMS carries the dynamics.
          let sum = 0
          const from = i * step, to = Math.min(ch.length, from + step)
          for (let j = from; j < to; j++) sum += ch[j] * ch[j]
          out.push(Math.sqrt(sum / Math.max(1, to - from)))
        }
        // GAMMA ABOVE 1 EXPANDS the loud/quiet gap; below 1 compresses it. An
        // earlier pass used 0.7, which pushed every quiet bar up toward the
        // ceiling and made a mastered track look like a solid band — the
        // opposite of the intent (owner, Sep 6: "the volume high and low are
        // almost the same, the gap should be larger").
        //
        // RMS on a mastered pop track sits in a narrow window to begin with,
        // so the floor is subtracted before the curve: the quietest bucket
        // becomes the baseline rather than a already-tall bar, and the range
        // that remains is what gets stretched.
        // Gamma 1.35: enough to separate loud from quiet, not so much that the
        // transients tower over the body of the track. 0.7 flattened it, 1.9
        // pushed the peaks too far from the middle — this sits between them.
        const max = Math.max(...out) || 0.0001
        const min = Math.min(...out)
        const span = Math.max(max - min, 0.0001)
        setPeaks(out.map(v => Math.pow((v - min) / span, 1.35)))
        setSongSec(audio.duration)
        void ctx.close()
      } catch {
        // Decode can fail on an exotic codec. Fall back to metadata duration
        // so the rest of the form still works; the wave just doesn't draw.
        const url = URL.createObjectURL(f)
        const el = new Audio()
        el.addEventListener('loadedmetadata', () => {
          if (!dead && Number.isFinite(el.duration)) setSongSec(el.duration)
          URL.revokeObjectURL(url)
        })
        el.addEventListener('error', () => URL.revokeObjectURL(url))
        el.src = url
      }
    })()
    return () => { dead = true }
  }, [songAtts])

  // Whole-song length tracking, kept as a MODE so it survives a swap.
  useEffect(() => {
    if (matchSong && songSeconds != null) {
      setDur(Math.max(3, Math.min(180, Math.round(songSeconds))))
      setSel(null)
    }
  }, [matchSong, songSeconds])

  // A dragged region decides the runtime.
  useEffect(() => {
    if (sel) setDur(Math.max(3, Math.min(180, Math.round(sel.b - sel.a))))
  }, [sel])

  // ── draw ───────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    // Size the backing store to the real pixels. The canvas was a fixed 1600
    // stretched by CSS, so every bar was resampled and came out soft.
    const rect = cv.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(1, Math.floor(rect.width))
    const H = Math.max(1, Math.floor(rect.height))
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr
      cv.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const css = getComputedStyle(document.documentElement)
    const RED  = css.getPropertyValue('--red').trim()  || '#d63b32'
    const BLUE = css.getPropertyValue('--blue').trim() || '#2f6fd0'

    if (!peaks || !songSeconds) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, H / 2 - 1, W, 2)
      return
    }

    const { span, offset } = viewOf(songSeconds)
    const xOf = (tSec: number) => ((offset + tSec) / span) * W
    const lo = sel ? xOf(sel.a) / W : xOf(0) / W
    const hi = sel ? xOf(sel.b) / W : xOf(songSeconds) / W
    if (sel) {
      ctx.fillStyle = 'rgba(214,59,50,0.07)'
      ctx.fillRect(lo * W, 0, (hi - lo) * W, H)
    }

    // Each bar is a NEEDLE: widest at the centre line and tapering to a point
    // at BOTH ends, mirrored about the middle. Round caps gave blunt tips —
    // this is a drawn spindle, so the shape itself carries the amplitude.
    //
    // Light grey is the resting colour. Red is reserved for the SELECTION, so
    // the wave never shouts until part of it has been chosen.
    const PITCH = 4, HALFW = 0.9
    const n = Math.floor(W / PITCH)
    const mid = H / 2
    const half = (H / 2) * 0.88
    // The resting grey is the site's own --muted rather than a paler one of
    // its own — the wave has to read as content, not as a disabled control.
    const GREY = css.getPropertyValue('--muted').trim() || '#999490'
    for (let i = 0; i < n; i++) {
      const frac = i / n
      // Where this column sits in the SONG. Outside it there is no audio, so
      // nothing is drawn — that empty margin is what centres a short clip.
      const tSec = frac * span - offset
      if (tSec < 0 || tSec > songSeconds) continue
      const p = peaks[Math.floor((tSec / songSeconds) * peaks.length)] ?? 0
      const a = Math.max(0.6, p * half)
      // A CONSTANT waist. Scaling it with amplitude made the loud needles fat
      // as well as tall, which is what read as "too wide" — every needle is
      // the same thinness now, so height alone carries the volume.
      const w = HALFW
      const inSel = !!sel && frac >= lo && frac <= hi
      ctx.fillStyle = inSel ? RED : GREY
      const x = i * PITCH + PITCH / 2
      ctx.beginPath()
      ctx.moveTo(x, mid - a)      // top point
      ctx.lineTo(x + w, mid)      // right of the waist
      ctx.lineTo(x, mid + a)      // bottom point
      ctx.lineTo(x - w, mid)      // left of the waist
      ctx.closePath()
      ctx.fill()
    }

    if (head > 0 && head <= songSeconds) {
      const x = xOf(head)
      ctx.fillStyle = '#0f0f0f'
      ctx.fillRect(x - 0.5, 0, 1, H)
    }
    if (sel) {
      ;[[lo, RED], [hi, BLUE]].forEach(([p, c]) => {
        ctx.fillStyle = c as string
        ctx.fillRect((p as number) * W - 1, 0, 2, H)
        ctx.beginPath(); ctx.arc((p as number) * W, 4, 4, 0, Math.PI * 2); ctx.fill()
      })
    }
  }, [peaks, songSeconds, sel, head])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const on = () => draw()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [draw])

  const posAt = (e: React.MouseEvent | MouseEvent) => {
    const cv = canvasRef.current
    if (!cv || !songSeconds) return 0
    const r = cv.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const { span, offset } = viewOf(songSeconds)
    // Clamp into the song: the margins around a short clip are not seekable.
    return Math.max(0, Math.min(songSeconds, x * span - offset))
  }

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (d == null || !songSeconds) return
      const p = posAt(e)
      // Grabbing an existing handle MOVES that edge; grabbing empty wave
      // sweeps a fresh selection from the anchor.
      if (d === 'a' || d === 'b') {
        setSel(cur => {
          if (!cur) return cur
          const floor = Math.max(0.4, songSeconds * 0.02)
          return d === 'a'
            ? { a: Math.max(0, Math.min(cur.b - floor, p)), b: cur.b }
            : { a: cur.a, b: Math.min(songSeconds, Math.max(cur.a + floor, p)) }
        })
        return
      }
      // Floor scales with the track. A flat 2s minimum meant a normal drag on
      // a short clip set nothing at all and looked broken (owner, Sep 6, on a
      // 6-second file). Clamp instead of discarding, so the region always
      // appears under the cursor.
      const floor = Math.max(0.4, songSeconds * 0.02)
      let a = Math.min(d, p), b = Math.max(d, p)
      if (b - a < floor) b = Math.min(songSeconds, a + floor)
      setSel({ a, b })
    }
    const up = () => { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [songSeconds])

  // The song is the only hard requirement now: the lyrics box is gone because
  // Fun-ASR reads them off the track, and the user correcting a mis-heard line
  // in chat is authoritative from that moment (owner, Sep 6).
  /** Play the SELECTED stretch when there is one, the whole track otherwise —
   *  so the button always previews exactly what will be shot. */
  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); return }
    const from = sel ? sel.a : 0
    if (el.currentTime < from || (sel && el.currentTime > sel.b)) el.currentTime = from
    void el.play()
  }

  // Follow the head with rAF rather than timeupdate — timeupdate fires ~4x a
  // second, which makes the playhead visibly hop.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      return
    }
    const tick = () => {
      const el = audioRef.current
      if (el) {
        setHead(el.currentTime)
        // Stop at the out point so the preview is the cut, not the song.
        if (sel && el.currentTime >= sel.b) { el.pause(); el.currentTime = sel.a; setHead(sel.a) }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing, sel])

  /** Nudge one edge of the selection, in seconds. Keeps a 2s floor. */
  const trim = (edge: 'a' | 'b', delta: number) => {
    if (!sel || !songSeconds) return
    const floor = Math.max(0.4, songSeconds * 0.02)
    const next = { ...sel }
    if (edge === 'a') next.a = Math.max(0, Math.min(sel.b - floor, sel.a + delta))
    else              next.b = Math.min(songSeconds, Math.max(sel.a + floor, sel.b + delta))
    setSel(next)
  }

  // Free-text direction. Every other control here is a picker or an upload, so
  // until now the only way to say "the leads should be Asian" was to upload
  // photos of people who are — and the cast_source:'ask' placeholder exists
  // precisely for the case where you have no photo yet. This is the field that
  // case needed.
  const [notes, setNotes] = useState('')

  const ready = songAtts.length > 0
  const hasRef = isYouTube(reference)
  const sectionLabel = sel ? `${mmssT(sel.a)}–${mmssT(sel.b)}` : ''

  const start = () => {
    const parts: string[] = []
    parts.push(hasRef
      ? `${duration}-second music video${sectionLabel ? ` of the stretch ${sectionLabel}` : ''}, ${aspect}. The look comes from the reference video that has been read for you — follow the style frames and the rhythm notes, not a preset.`
      : `${duration}-second music video${sectionLabel ? ` of the stretch ${sectionLabel}` : ''}, ${form ? `${FORM_BRIEF[form]}, ` : ''}${aspect}.`)
    // No preset and no link: the skill is explicit that a genre word is not a
    // reference and the director should commit to a look itself rather than
    // asking the user for frames.
    if (!hasRef && !form) parts.push('No style preset was chosen and no reference was given — pick the form yourself from the song, write the look bible, and state it in one line inside the plan. Do not ask the user for reference frames.')
    if (sectionLabel) {
      parts.push(`The user picked that window on the waveform, so it is exact: shoot ${sectionLabel} of the track and nothing outside it.`)
    }
    parts.push(title.trim()
      ? `Title card first: 「${title.trim()}」 — it lives INSIDE the ${duration}s runtime.`
      : 'No title card — the full runtime is the film.')
    parts.push(castAtts.length > 0
      ? 'Cast: lock the leads from the attached subject photos.'
      : 'Cast: create original leads to fit the song.')
    // ADDITIVE, never an override. The pickers are the contract — drama dial,
    // form, reference frames — and a note that could silently contradict them
    // would give the board two sources of truth and stop it matching the
    // controls the user set. So it is scoped to what the pickers cannot say:
    // who is in it, what they wear, where it is, what to avoid.
    // Flatten before quoting. The note lands inside a quoted span in a brief
    // made of lines, so a newline breaks the structure and a double quote
    // closes the span early — both let typed text restructure the instruction
    // around it rather than be read as content.
    const noteClean = notes.replace(/[\r\n]+/g, ' ').replace(/["\u201C\u201D]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 400)
    if (noteClean) {
      parts.push(
        `Notes from the user, to honour in the casting, the wardrobe, the places and every scene prompt: "${noteClean}". ` +
        'These describe details the controls above cannot express. They do not override the form, the drama level, the runtime or the reference — where they seem to conflict, follow the controls and satisfy the note in the detail.')
    }
    parts.push(DRAMA_BRIEF[drama])
    // Only when the user has NOT brought one. Sent unconditionally it told
    // the director to generate a look anchor in the same brief that said one
    // was attached — and generate-first won.
    if (coverAtts.length === 0) parts.push('FIRST, before the storyboard: put a COVER on the ASSETS shelf (asset: true, title "LOOK · <film>", a still model) and generate it. It is the film\'s look anchor — one composition where palette, grade, lens and world all agree — and every key still afterwards references it, so the scenes drift far less than they would from six words. Show it to the user and let them approve or re-roll it at still prices before any clip money is spent. It doubles as the upload thumbnail.')
    parts.push('Run the board self-check before set_storyboard — swap test, first/last test, spine test, both-people test, shot-size test — and do not generate a board that fails one for this level.')
    if (mood) parts.push(`Song mood: ${MOOD_BRIEF[mood]}. That governs PACING and energy — cut rhythm, section grammar, how hard the chorus lands. It is a separate axis from the look; do not let it override the visual reference.`)
    if (styleAtts.length > 0) parts.push('Style: match the attached style frames — build the look bible from them.')
    if (coverAtts.length > 0) parts.push('A COVER image is attached and it is tagged COVER in the file list. Do NOT generate a look anchor — that one IS the look anchor. Put it on the ASSETS shelf as the film\'s cover and reference it by its file number on every key still.')
    if (songAtts.length > 0) {
      parts.push('The song file is attached — transcribe it for timing.')
      parts.push(sync
        ? 'SING ON CAMERA (SYNC mode): the user asked for real lip-sync, so the performance scenes are SYNC takes. '
          + 'Use an audio-capable video model — Wan 3.0 or MiniMax H3 — and attach the scene\'s own slice of the song as reference audio; '
          + 'no_speech is FALSE on those scenes and the shot text ends with "sings the exact words heard in the audio". '
          + 'Two things follow and you must say both to the user before spending: a SYNC take cannot also pin an approved opening still '
          + '(the API refuses first_frame together with reference_audio, on BOTH models), so likeness rides on reference images and written '
          + 'wardrobe invariants instead; and reference audio must be wav or mp3, at most 15s per clip, so a long chorus is split at a musical boundary. '
          + 'Keep sung takes to 9-12s. Narrative B-roll scenes stay performance-only on whichever model suits them — one board, both modes.'
        : 'PERFORMANCE ONLY: the cast never sings or speaks on camera. no_speech stays true on every scene; the song is laid over the cut afterwards.')
    }
    // Stamp the ROLE on every file as it goes. Without this they all arrived
    // untagged, so the director's file list called the cover and the style
    // frames "SUBJECT (keep this likeness)" — and a cover described in the
    // brief matched no file it could see (owner, Sep 6: "no cover was usable
    // as attached image data reached me"). The form knows what each box is
    // for; nothing downstream can recover it.
    const tag = (list: Attachment[], role: 'subject' | 'style' | 'cover') =>
      list.map(a => ({ ...a, role }))
    onStart(parts.join(' '), [
      ...songAtts,
      ...tag(castAtts, 'subject'),
      ...tag(styleAtts, 'style'),
      ...tag(coverAtts, 'cover'),
    ], {
      referenceUrl: hasRef ? reference.trim() : undefined,
      aspect,
    })
  }

  const label: React.CSSProperties = {
    fontSize: 11, color: 'var(--muted2)', fontWeight: 600, display: 'block', marginBottom: 6,
  }
  const hint: React.CSSProperties = { fontSize: 11, color: 'var(--muted2)', display: 'block', marginTop: 5 }

  const songName = songAtts[0]?.fileName ?? null

  // ── the brief rail's derived copy ──────────────────────────────────────
  const formDef   = form ? FORMS.find(f => f.id === form) : undefined
  const styleName = hasRef ? t('xd.mv.rail.fromref')
    : formDef ? t(formDef.i18n) : t('xd.mv.rail.lookauto')
  const artUrl = coverAtts[0]?.previewUrl ?? (hasRef ? undefined : formDef?.thumb)
  const artTag = coverAtts[0]?.previewUrl ? t('xd.mv.rail.cover')
    : formDef && !hasRef ? t('xd.mv.rail.insp') : t('xd.mv.rail.look')
  const artCap = coverAtts[0]?.previewUrl ? t('xd.mv.rail.mine')
    : hasRef ? t('xd.mv.rail.refcap')
      : formDef ? t(`${formDef.i18n}.tag`) : t('xd.mv.rail.lookcap')
  const artName = coverAtts[0]?.previewUrl ? (songName ?? styleName) : styleName
  // The sentence. Mood is the adjective when there is one; without it the
  // shorter template avoids "A  K-pop film." with a hole where mood was.
  const moodName = mood ? t(MOODS.find(m => m.id === mood)!.i18n) : null
  const briefLine = (moodName ? t('xd.mv.rail.line') : t('xd.mv.rail.lineplain'))
    .replace('{mood}', (moodName ?? '').toLowerCase())
    .replace('{style}', (hasRef || !formDef) ? t('xd.mv.rail.film') : t(formDef.i18n))

  /** 14px line icons, currentColor — the rail is a summary, so its glyphs
   *  have to sit at label weight and never compete with the values. */
  const Ic = ({ d }: { d: string }) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
  const I = {
    song:   'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    story:  'M4 5h16v14H4zM4 9h16M9 5v14',
    mood:   'M3 12h2l2-6 3 13 3-16 3 12 2-3h3',
    format: 'M3 5h18v11H3zM8 20h8',
    cast:   'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    window: 'M7 4v16M17 4v16M3 12h18',
    link:   'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  }
  const Row = ({ ic, k, v }: { ic: string; k: string; v: string }) => (
    <div className="mvp-railrow">
      <dt><Ic d={ic} />{k}</dt>
      <dd>{v}</dd>
    </div>
  )

  return (
    <div className="mvp-shell">
    <div className="mvp">
      {/* ── 01 the song ──────────────────────────────────────────────── */}
      {songAtts.length === 0 ? (
        <div className="mvp-songdrop">
          <AttachmentButton
            attachments={songAtts} onChange={setSong} disabled={busy}
            context="xcreate" maxFiles={1}
            accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg"
            variant="dropzone"
            label={t('xd.mv.uploadsong')}
            sublabel="MP3 / WAV / M4A / FLAC"
          />
          <p className="mvp-dropnote">{t('xd.mv.dropnote')}</p>
        </div>
      ) : (
      <div className="mvp-song">
        {coverAtts[0]?.previewUrl ? (
          <button className="mvp-art mvp-artbtn" onClick={() => setCover([])}
            title={t('xd.mv.coverclear')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverAtts[0].previewUrl} alt="" />
          </button>
        ) : (
          <div className="mvp-art mvp-artdrop">
            <AttachmentButton
              attachments={coverAtts} onChange={setCover} disabled={busy}
              context="xcreate" maxFiles={1} accept="image/jpeg,image/png,image/webp"
              variant="dropzone" label={t('xd.mv.cover')} sublabel={t('xd.mv.coveropt')}
            />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="mvp-stop">
            <div>
              <div className="mvp-title" style={songName ? undefined : { color: 'var(--muted)' }}>
                {songName ?? '—'}
              </div>
              <div className="mvp-dur">
                {songSeconds != null ? mmss(songSeconds) : t('xd.mv.needsong')}
              </div>
            </div>
            {sel && (
              <span className="mvp-seg">
                <span>{t('xd.mv.selected')}</span>
                <span className="t">{mmssT(sel.a)} – {mmssT(sel.b)} · {(sel.b - sel.a).toFixed(1)}s</span>
              </span>
            )}
          </div>

          <canvas
            ref={canvasRef} className="mvp-wave"
            aria-label={t('xd.mv.wavehint')}
            onMouseDown={e => {
              if (!songSeconds) return
              const p = posAt(e)
              // ~1.5% of the track either side counts as "on the handle".
              // ~8px worth of track, so the grab zone is the same size to the
              // hand whether the song is 6 seconds or six minutes.
              const grab = songSeconds * (8 / (canvasRef.current?.getBoundingClientRect().width || 800))
              if (sel && Math.abs(p - sel.a) < grab)      { dragRef.current = 'a'; return }
              if (sel && Math.abs(p - sel.b) < grab)      { dragRef.current = 'b'; return }
              dragRef.current = p
              setSel(null)
            }}
            onDoubleClick={() => setSel(null)}
          />
          <div className="mvp-ticks">
            <span>00:00</span>
            <span>{songSeconds != null ? mmss(songSeconds) : '--:--'}</span>
          </div>

          <div className="mvp-transport">
            <button className="mvp-play" onClick={toggle} disabled={!songUrl}
              aria-label={playing ? t('xd.mv.pause') : t('xd.mv.play')}
              title={sel ? t('xd.mv.playsel') : t('xd.mv.play')}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mvp-clock">{mmss(head)} / {songSeconds != null ? mmss(songSeconds) : '--:--'}</span>

            {sel && (
              <span className="mvp-trim">
                <span className="mvp-trimlab">{t('xd.mv.in')}</span>
                <button onClick={() => trim('a', -1)} aria-label="-1s">−</button>
                <b>{mmssT(sel.a)}</b>
                <button onClick={() => trim('a', 1)} aria-label="+1s">+</button>
                <span className="mvp-trimlab">{t('xd.mv.out')}</span>
                <button onClick={() => trim('b', -1)} aria-label="-1s">−</button>
                <b>{mmssT(sel.b)}</b>
                <button onClick={() => trim('b', 1)} aria-label="+1s">+</button>
                <button className="mvp-clear" onClick={() => setSel(null)}>{t('xd.mv.clearsel')}</button>
              </span>
            )}

            <span style={{ marginLeft: 'auto' }}>
              <AttachmentButton
                attachments={songAtts} onChange={setSong} disabled={busy}
                context="xcreate" maxFiles={1}
                accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg"
              />
            </span>
          </div>
          <p className="mvp-wavehint">{t('xd.mv.wavehint')}</p>

          {songUrl && (
            <audio
              ref={audioRef} src={songUrl} preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => { setPlaying(false); setHead(sel ? sel.a : 0) }}
            />
          )}
        </div>
      </div>
      )}

      <hr className="mvp-rule" />

      {/* ── 02 / 03 ──────────────────────────────────────────────────── */}
      <div className="mvp-cols">
        <section className="mvp-col">
          <div className="mvp-sechead">
            <div>
              <h3>{t('xd.mv.sec.ref')}</h3>
              <p>{t('xd.mv.sec.refsub')}</p>
            </div>
          </div>

          <div>
            <span style={label}>{t('xd.mv.reference')}</span>
            <input
              value={reference} onChange={e => setRef(e.target.value)}
              placeholder={t('xd.mv.referenceph')}
              className={'mv-field' + (hasRef ? ' is-live' : '')}
            />
            <span style={{ ...hint, color: hasRef ? 'var(--blue)' : 'var(--muted2)' }}>
              {reference.trim() && !hasRef ? t('xd.mv.referencebad')
                : hasRef ? t('xd.mv.referenceon') : t('xd.mv.referencehint')}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <span style={label}>{t('xd.mv.cast')}</span>
              <AttachmentButton attachments={castAtts} onChange={setCast} disabled={busy}
                context="xcreate" multiple maxFiles={3} accept="image/jpeg,image/png,image/webp"
                variant="dropzone" label={t('xd.mv.addphotos')} sublabel="JPG / PNG" />
              {castAtts.length === 0 && <span style={hint}>{t('xd.mv.castoriginal')}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <span style={label}>{t('xd.mv.stylerefs')}</span>
              <AttachmentButton attachments={styleAtts} onChange={setStyle} disabled={busy}
                context="xcreate" multiple maxFiles={4} accept="image/jpeg,image/png,image/webp"
                variant="dropzone" label={t('xd.mv.addframes')} sublabel="JPG / PNG" />
            </div>
          </div>

          {/* Sits under Cast because that is the gap it fills: with no photo,
              there was nowhere to describe who is in the film. Two rows, not a
              second composer — this is a note, and the song is the subject. */}
          <div style={{ marginTop: 14 }}>
            <span style={label}>{t('xd.mv.notes')}</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={busy}
              rows={2}
              maxLength={400}
              placeholder={t('xd.mv.notesph')}
              className="mv-field"
              style={{ width: '100%', resize: 'vertical', minHeight: 52, lineHeight: 1.5 }}
            />
            <span style={hint}>{t('xd.mv.noteshint')}</span>
          </div>

        </section>

        <section className="mvp-col">
          <div className="mvp-sechead">
            <div>
              <h3>{t('xd.mv.sec.dir')}</h3>
              <p>{t('xd.mv.sec.dirsub')}</p>
            </div>
          </div>

          {/* Preset cards are a way of DESCRIBING a look. A reference video IS
              one, so the cards stand down while a link is present. */}
          {!hasRef && (
            <div>
              <span style={label}>{t('xd.mv.formpick')}</span>
              {/* All six as thumbnails — the name lives UNDER the frame only.
                  It used to be printed inside the box as well, which is the
                  duplicate the owner caught. */}
              <div className="mvp-styles">
                {FORMS.map(f => (
                  <button key={f.id} className="mvp-style" aria-pressed={form === f.id}
                    onClick={() => setForm(f.id)}>
                    <span className="fr">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.thumb} alt="" loading="lazy" />
                      <span className="tick">✓</span>
                    </span>
                    <span className="nm">{t(f.i18n)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span style={label}>{t('xd.mv.drama')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DRAMA.map(d => (
                <button key={d.id} onClick={() => setDrama(d.id)}
                  className={'mv-chip' + (drama === d.id ? ' on' : '')}
                  style={{ ['--chip' as any]: d.hue }}>{t(d.i18n)}</button>
              ))}
            </div>
            <span style={hint}>
              {t(`xd.mv.drama.${drama === 'performance' ? 'perf' : drama}hint`)}
            </span>
          </div>

          <div>
            <span style={label}>{t('xd.mv.mood')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MOODS.map(m => (
                <button key={m.id} onClick={() => setMood(mood === m.id ? null : m.id)}
                  className={'mv-chip' + (mood === m.id ? ' on' : '')}
                  style={{ ['--chip' as any]: m.hue }}>{t(m.i18n)}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <div>
              <span style={label}>{t('xd.mv.aspect')}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setAspect('16:9')} className={'mv-chip' + (aspect === '16:9' ? ' on' : '')}>▭ 16:9</button>
                <button onClick={() => setAspect('9:16')} className={'mv-chip' + (aspect === '9:16' ? ' on' : '')}>▯ 9:16</button>
              </div>
            </div>
            <div>
              <span style={label}>{t('xd.mv.duration')}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setMatchSong(true); setSel(null) }}
                  className={'mv-chip' + (matchSong && !sel ? ' on' : '')}
                  style={{ opacity: songSeconds == null && !matchSong ? 0.55 : 1 }}
                  title={songSeconds == null ? t('xd.mv.duration.songhint') : undefined}
                >♪ {t('xd.mv.duration.song')}{songSeconds != null ? ` (${Math.round(songSeconds)}s)` : ''}</button>
                {DURATIONS.map(d => (
                  <button key={d} onClick={() => { setMatchSong(false); setSel(null); setDur(d) }}
                    className={'mv-chip' + (!matchSong && !sel && duration === d ? ' on' : '')}>{d}s</button>
                ))}
                <input
                  type="number" className="mv-field no-spin" min={3} max={180} value={duration}
                  onChange={e => { setMatchSong(false); setSel(null); setDur(Math.min(180, Math.max(3, Math.round(Number(e.target.value) || 30)))) }}
                  style={{ width: 62, padding: '7px 6px', textAlign: 'center' }}
                />
              </div>
            </div>
          </div>

          {songAtts.length > 0 && (
            <div>
              <span style={label}>{t('xd.mv.perf')}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => setSync(false)} className={'mv-chip' + (!sync ? ' on' : '')}>{t('xd.mv.perf.silent')}</button>
                <button onClick={() => setSync(true)} className={'mv-chip' + (sync ? ' on' : '')}
                  style={{ ['--chip' as any]: 'var(--mode-image)' }}>{t('xd.mv.perf.sync')}</button>
              </div>
              <span style={{ ...hint, maxWidth: 460 }}>
                {sync ? t('xd.mv.perf.synchint') : t('xd.mv.perf.silenthint')}
              </span>
            </div>
          )}

          <div>
            <span style={label}>{t('xd.mv.title')}</span>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('xd.mv.titleph')} className="mv-field" />
          </div>
        </section>
      </div>

    </div>

      {/* ── the brief rail ───────────────────────────────────────────────
          A one-line bar used to carry this, pinned under the form — which
          meant the summary AND the Start button only existed once you had
          scrolled to the bottom, and nothing told you what the film was
          while you were choosing. Sticky beside the form, it answers "what
          have I said so far" at every scroll position, and Start lives with
          the answer it sends. */}
      <aside className="mvp-rail">
        <div className="mvp-railcard">
          <div className="mvp-railhead">
            <span>{t('xd.mv.rail')}</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
              <path d="M3 9h18v11H3zM3 9l3-5 3 5M9 9l3-5 3 5M15 9l3-5 3 5" />
            </svg>
          </div>

          <div className="mvp-railart">
            {artUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={artUrl} alt="" />
              : <span className="ph" aria-hidden />}
            <span className="tag">{artTag}</span>
            <span className="ratio">{aspect}</span>
            <span className="txt">
              <b>{artName}</b>
              <i>{artCap}</i>
            </span>
          </div>

          <p className="mvp-railline">{briefLine}</p>
          <p className="mvp-railsub">{t(`xd.mv.rail.sub.${drama}`)}</p>

          <dl className="mvp-railrows">
            {songName && <Row ic={I.song} k={t('xd.mv.rail.r.track')} v={songName} />}
            {sectionLabel && <Row ic={I.window} k={t('xd.mv.rail.r.window')} v={sectionLabel} />}
            {hasRef && <Row ic={I.link} k={t('xd.mv.rail.r.ref')} v={t('xd.mv.oneref')} />}
            <Row ic={I.story} k={t('xd.mv.rail.r.story')} v={t(DRAMA.find(d => d.id === drama)!.i18n)} />
            <Row ic={I.mood} k={t('xd.mv.rail.r.mood')} v={moodName ?? '—'} />
            <Row ic={I.format} k={t('xd.mv.rail.r.format')}
              v={`${aspect} · ${duration}s${sync ? ` · ${t('xd.mv.rail.sync')}` : ''}`} />
            <Row ic={I.cast} k={t('xd.mv.rail.r.cast')}
              v={castAtts.length > 0 ? `${castAtts.length} ${t('xd.mv.rail.photos')}` : t('xd.mv.rail.castorig')} />
          </dl>

          {/* The one thing still missing, said as an invitation. A disabled
              Start with no explanation is the version of this that makes
              people leave. */}
          <div className={ready ? 'mvp-railnext is-ok' : 'mvp-railnext'}>
            <Ic d={ready ? 'M20 6 9 17l-5-5' : I.song} />
            <span>
              <b>{ready ? t('xd.mv.rail.ready') : t('xd.mv.rail.next')}</b>
              <i>{ready ? t('xd.mv.rail.readysub') : t('xd.mv.rail.nextsub')}</i>
            </span>
          </div>

          <button className="mv-start mvp-railgo" onClick={start} disabled={!ready || busy}
            title={ready ? '' : t('xd.mv.needsong')}>{t('xd.mv.start')} →</button>
        </div>
      </aside>
    </div>
  )
}
