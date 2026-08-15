---
name: social-post
description: Turn the user's photos, videos and message into a beautified, platform-sized post set — Instagram, Threads, X, 小紅書, LinkedIn, TikTok — organized on the canvas as assets, enhanced with image editing, and generated one card per output. Use when the user is posting to social media and brings media to polish or a message that needs visuals.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirector. Needs image models with image_edit and aspect_ratio support.
metadata:
  author: ModelXD
  emoji: "📱"
  banner: "/xdirect/skills/social-post.webp"
  color: "#14b8a6"
  title: "Social Post"
  version: "2.0"
  category: social
  cover: assets/cover.jpg
---

# Social post visuals

The user has something to say and often brings their own photos or clips.
Your job: organize what they brought, decide what each platform's version
should BE, and enhance — never replace — their material.

## The setup form answers first

The template opens with a form: platforms (multi-select), the message,
their media, a tone. ANSWERED IN THE BRIEF = CLOSED — when the form has
spoken, your first turn is the plan. Ask only when the brief is silent on
something you genuinely cannot decide (rare: the form covers everything).

## Their media becomes ASSETS, then gets beautified

- Every uploaded photo/video lands on the ASSETS shelf as a named source
  (`SOURCE · <short name>`, asset: true, no duration, no video model).
  The shelf is the organizer the user asked for — sources visible, named,
  reusable across every output.
- **Beautify, never fabricate.** An output made from the user's photo is an
  `image_edit` chained from that asset: cleaner light, tidier backdrop,
  platform crop, graded color. The product/person/scene stays THEIRS —
  do not invent product features, change faces, or replace their subject
  with a generated lookalike. If their photo is unusable for a format,
  say so and propose a plate AROUND it, not a replacement OF it.
- Outputs with no source photo (a pure announcement card, a background
  plate) are honest text_to_image generations — never disguised as the
  user's material.

## One card per output, sized by its platform

Each planned output is a storyboard card in KEYFRAME spirit — the STILL is
the deliverable; only Reel/TikTok cards ever get a video step (mark others
direct-irrelevant: never offer motion for a static post). Put the platform
and aspect in the card TITLE (`IG · 4:5`, `小紅書 · 3:4`) and pass the
aspect explicitly on every generation:

| Platform | Aspect | Notes |
|---|---|---|
| Instagram feed | 4:5 | 1:1 acceptable; 4:5 owns more screen |
| IG Story / Reel | 9:16 | Reel may be a short video card |
| TikTok | 9:16 | video-first; a still is the cover |
| Threads | 4:5 | 1:1 acceptable |
| X | 16:9 | text-forward platform; one strong image |
| 小紅書 | 3:4 | cover image carries the click; title text ON image |
| LinkedIn | 1.91:1 | editorial restraint; no meme energy |
| Facebook | 4:5 | feed; 1.91:1 for link posts |

Plan the SET at once: same subject, same grade, each platform's crop and
register. A set that shares one look reads as a campaign; six unrelated
crops read as spam.

## Platform register, not just platform size

- **Instagram / Threads**: mood and craft — the image IS the post.
- **小紅書**: cover with短 title text rendered ON the image (pick a model
  that renders CJK type cleanly; treat text as a spelling test).
- **X**: one sharp image that survives small; no fine text.
- **LinkedIn**: clean, editorial, zero gimmick.
- **TikTok / Reel**: motion if the user wants it; otherwise the cover still.

## Copy and text overlays

- Text ON images only where the platform expects it (小紅書 covers, quote
  cards). Exact strings in quotes in the prompt; verify spelling on the
  still before anything else.
- The post's CAPTION is the user's voice: offer one tight draft per
  platform in chat if they ask — never watermark captions into images.

## Craft rules

- Grade the set together: one palette, one light story across every output.
- Respect the platform's safe areas: 9:16 keeps faces/subject center-top
  (UI covers the bottom), 4:5 breathes at the edges.
- Model choice is per-card, from the live boards, price shown — the same
  honest casting as every surface.
- Iterate one variable at a time on a re-run: crop OR grade OR backdrop.
