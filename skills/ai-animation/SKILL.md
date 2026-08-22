---
name: ai-animation
description: Direct an original animated short — anime, 3D, watercolor, pixel or clay — from a story idea, the user's own characters, or their manga/comic panels. Locks ONE style with a style bible, builds character model sheets first, keyframes every shot in the locked look, then animates (including first/last-frame inbetweening). Use when the user wants 動畫 / アニメ / animation, an animated story or character, a cartoon short, a manga or comic brought to life, a VTuber clip or anime PV, or asks to turn themselves or their drawing into an animated scene.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirect (storyboard video with reference images)
metadata:
  author: ModelXD
  emoji: "🎞"
  banner: "/xdirect/skills/ai-animation-cover.webp"
  banner_video: "/xdirect/skills/ai-animation-loop.mp4"
  tagline: "One style, your characters, a story that moves — animated shot by shot."
  color: "#f472b6"
  title: "Animation"
  version: "1.3"
  category: animation
  order: "2"
  aspect: "ask"
  default_duration: "5"
---

# AI animation

An animated short lives or dies on ONE thing live-action never worries
about: every frame is drawn, so every shot can silently drift into a
different art style. The job is to pin the style once, pin the characters
once, and then never let either be re-argued by a prompt.

## The style bible comes first — one line, every prompt

Before any generation, fix a STYLE BIBLE line: medium, line treatment,
shading, palette, era. Examples of the register:

- `2D cel anime, clean dark linework, flat two-tone shading, muted pastel palette, 90s OVA grain`
- `soft watercolor storybook, visible paper texture, loose ink outlines, warm morning light`
- `3D toon-shaded, rounded shapes, gentle subsurface glow, film-still lighting`
- `1-bit pixel art, 4-frame walk-cycle energy, chunky dither`

The bible line is APPENDED VERBATIM to every still and every video prompt
in the project — cast sheets, keyframes, shots. A synonym is a new style;
do not paraphrase it, ever. If the user gave a reference image instead of
words, describe the reference INTO a bible line once, confirm it, then
treat the line as law.

**Style is the mandatory ask.** If the brief names no style and attaches
no reference, ask ONE question with 3-4 named options (with the register
above), and default the pick to the story's mood. Genre alone ("cute",
"cool") is not a style.

## Characters are model sheets, not descriptions

Animation studios draw model sheets before animating; so do we.

- Every recurring character gets a CAST asset on the shelf: full-body
  turnaround (front / three-quarter / profile) on a plain background,
  in the bible style, `asset: true`, no duration, no video model.
- The sheet's job is invariants: silhouette, hair mass, eye shape,
  outfit, palette accents. Name them in the sheet prompt so later shots
  can repeat the WORDS while the sheet carries the LOOK.
- A user photo may become a stylized character with their consent — the
  character keeps the person's recognizable cues (hair, glasses, build)
  translated INTO the medium, never a photoreal face pasted on a drawing.
  Real institution branding (uniform crests, school names) never rides
  into generated frames.
- Shots that feature a character chain from the model sheet the same way
  music-video shots chain from cast stills: sheet → keyframe → motion.
- **The sheet is always the three-view frame** — front, three-quarter
  and profile side by side in ONE still. The server rejects a CAST asset
  written as a single view (all templates, Aug 22). When a shot needs an
  angle the sheet lacks (the back, a low three-quarter), the cheap way
  to get it is ONE video rather than more stills: a scene chained from
  the sheet with "turns a slow full circle in place, neutral pose,
  constant framing, camera locked" (~5s i2v), then pull the frames you
  need. Probed live (Aug 18): one 5s clip delivered every angle with
  hair, uniform and style consistent through the rotation — the angles
  agree by construction.

## Still-first, always (KEYFRAME by default)

Image models draw the bible style far more faithfully than video models
invent it, and stills iterate at cents. Every story shot:

1. KEYFRAME still — composed shot in the locked style, chained from the
   model sheets of whoever is in frame plus the bible line.
2. Approve / iterate the still (one variable at a time).
3. Animate the approved frame. The video prompt describes MOTION ONLY —
   what moves, how the camera behaves — plus the bible line. The look is
   already in the pixels; do not re-describe the character.

DIRECT (no still) is for style-safe inserts only: rain on a window,
drifting petals, an abstract transition.

## Inbetweening — the animator's move for precise motion

Real animation is drawn as keyframes first, inbetweens second (原画 →
動画) — and the model ecosystem ships this as a first-class mode
(first/last-frame → video; ToonCrafter's cartoon interpolation, the
FLF2V template family). Probed live on this product (Aug 18): a 4s take
opened exactly on keyframe A, closed exactly on keyframe B, and the
mid-frames drew the turn between them — style unbroken throughout.
Casters with `start_end_frames` today: MiniMax H3 (cheapest), Wan 2.7,
Seedance 2.5, Veo 3.1.

Use it whenever a shot's MOTION must land exactly — a turn to camera, a
reach for a hand, a door opening on a reveal, a look-back:

1. Generate keyframe A (the shot's opening) and keyframe B (where it
   must END), both in the bible style, both chained from the model
   sheets. Build B as an image_edit FROM A — "the SAME everything,
   except <the change>" — so the world carries over by construction.
   Iterate at still prices until both are right, and CHECK B's
   invariants: edits invent small accessories uninvited (a probe's B
   grew a hair ribbon nobody asked for).
2. Cast a `start_end_frames` model and let it draw the inbetweens. The
   motion is now CHOSEN — both endpoints approved — instead of hoped for
   from a prompt.
3. The prompt describes only the path and timing between the frames
   ("she turns smoothly, hair follows late, held beat at the end").

When the user brings MANGA OR COMIC PANELS, the panels ARE keyframes:
adjacent panels become A→B pairs and the page animates scene by scene —
treat panel order as the storyboard and keep the panels' own framing.

Plain i2v (one still, motion prompt) remains right for ambient shots,
loops, and single-action holds where the endpoint doesn't matter.

## Animation-native motion grammar

Generated video wants to be live-action; animation motion must be asked
for by name:

- **Less is more**: one clear primary action per shot. Anime holds a pose
  and lets the camera or hair carry life — "she holds the gaze, hair and
  scarf moving in the wind, slow push-in" beats three actions fighting.
- **Camera like an animator**: slow push-ins, lateral pans over a held
  scene, parallax layers. Whip pans and handheld shake read live-action —
  use them only as deliberate accents.
- **Loops are first-class**: rain, steam, blinking neon, breathing idle —
  a 4-6s shot that loops cleanly is worth more than 10s that wander.
  Ask for "seamless loop, ends where it begins" when the shot is ambient.
- **Timing words work**: "sudden stop", "held beat, then quick turn",
  "gentle constant drift". Name the rhythm; do not hope for it.
- **Keep motion strength LOW.** Anime-specialized models publish low
  motion-score recommendations (AniSora: 2-4 out of 10) because default
  video-model dynamics are too much for the medium. Where our models
  expose no such knob, say it in words: "limited animation, calm motion,
  small movement range" — and let the camera, not the character, carry
  the energy.

## The story spine still governs

Three beats minimum, even for 15 seconds: a want, a turn, an afterimage.
An animation without a spine is a style test — beautiful and forgettable.
Write the spine into the plan before any generation, same as every other
template.

## Craft rules

- One style bible per project; a style CHANGE is a new project, not a new
  scene.
- Aspect is explicit on every generation (16:9 cinematic default; 9:16
  only when the user is posting vertical).
- Model choice is per-shot from the live boards with real prices shown —
  same honest casting as every surface. Stills and motion may come from
  different models; the bible line is what keeps them one film.
- Dialogue mouths are loose in animation — prefer performance without
  speech; if the character must sing, that is the music-video skill's
  SYNC territory and the two skills compose.
- Iterate one variable at a time: pose OR framing OR palette accent.
