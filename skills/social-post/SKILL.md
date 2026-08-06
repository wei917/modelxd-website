---
name: social-post
description: Turn a piece of content — an article, a news story, a thread draft, a product launch, a personal take — into the images or video a post needs, sized and framed for a specific platform. Asks which platform first because that decides the crop, then plans the whole set at once and generates it. Use when the user is writing a post for X, Threads, Instagram or LinkedIn and needs the visuals to go with it.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirector. Needs image models and aspect_ratio support on start_generation.
metadata:
  author: ModelXD
  version: "1.1"
  category: social
  cover: assets/cover.jpg
---

# Social post visuals

The user has something to say and needs pictures that carry it. Your job is
to decide what those pictures should BE. Generating them is the easy part.

## 1. Platform first — before anything else

Ask this ONCE, with chips, and nothing else in the same turn:

> Where is this going? — Threads · X · Instagram · LinkedIn

Ask it even if you think you can guess, and skip it only when the user has
already named the platform. This is the one question worth spending, because
the answer sets the crop, and a crop cannot be fixed afterwards: a 16:9 image
cannot be cut down to 9:16 without destroying the framing you composed. Read
`references/PLATFORMS.md` once you have the answer and follow that row.

Everything else — how many images, which model, what they depict, how they
are worded — you decide. Do not ask.

## 2. Find the spine of the content

Read what the user gave you and find the two or three beats a reader has to
understand. Not a summary — the beats. A story about a fund blowing up has a
who, a mechanism and a consequence; a product launch has a before, an after
and a proof.

One image per beat, and no more images than beats. Three strong pictures beat
six that repeat each other. If the content only has one beat, make one image
and say so.

## 3. Plan the whole set in one reply

State the set before you generate any of it — one short line per image saying
what that picture carries, then the model and total cost in one line. The user
confirms once, not once per image.

They are a SET, not a gallery. Fix the treatment before you write the first
prompt and hold it across every image: same medium (editorial photo, oil
illustration, 3D render — pick one), same palette, same light, same crop.
Without this you get three unrelated stock photos and the post looks assembled
rather than authored.

## 4. Write prompts that render

One paragraph each. Subject and arrangement, composition and crop, lighting,
palette, medium, mood. Then:

- Open with the aspect — "9:16 vertical composition" — and also pass
  aspect_ratio on start_generation. Some models weight the text over the flag.
- Always end with "no text, no logos, no watermarks". Image models add
  gibberish type unless told not to, and text baked into a social image cannot
  be edited, translated or corrected after it is posted.
- Name objects and their arrangement, never the abstract idea. "A whale
  tangled in four steel cables being winched into black water while three
  sleek shapes circle below" renders. "A hedge fund being hunted by Wall
  Street" does not.
- Leave room for the caption if the platform overlays one — see the safe-area
  column in `references/PLATFORMS.md`.

Generate one at a time, in order, and react in one line between them.

## 5. Real people

Never depict a real, named living person's likeness. This restricts the
LIKENESS, not the subject: illustrate the story with anonymous figures seen
from behind or silhouetted, with objects, charts or metaphor. For editorial
work that is the stronger picture anyway, and a post about a real event
carrying an obviously fake portrait of its subject loses the reader's trust
in the first second. Offer that framing rather than refusing.

## 6. Hand it over ready to post

When the set is done, give the user the caption text to go with it — matched
to the platform's length in `references/PLATFORMS.md`, in the user's own
language, in their voice if you have a sample of it. A bare image is not a
post. Read `references/CAPTIONS.md` before writing it.

## If the post wants motion

Stills generate directly, as ever. The moment a post needs VIDEO — a looping
product beat, a clip for Reels — that video goes through the storyboard like
any other: set_storyboard first (usually one scene), the card is the confirm,
generation waits for the user.
