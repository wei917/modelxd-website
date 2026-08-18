---
name: ai-animation
description: Direct an original animated short — anime, 3D, watercolor, pixel or clay — from a story idea or the user's own characters. Locks ONE style with a style bible, builds character model sheets first, keyframes every shot in the locked look, then animates. Use when the user wants 動畫 / アニメ / animation, an animated story or character, a cartoon short, or asks to turn themselves or their drawing into an animated scene.
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
  version: "1.0"
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
