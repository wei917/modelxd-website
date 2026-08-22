---
name: story-to-video
description: Turn a story of any length — a novel, a chapter, a short story, a fairy tale, a PDF or pasted text — into a short film. The document is digested into a STORY BIBLE first (logline, cast with visual invariants, at most 10 beats that change the story); the director casts every recurring character as a three-view sheet, locks one style, and storyboards only the beats that matter. Use when the user brings a book, 小說 / 小说 / 故事 / 物語 / 소설, a chapter, a script or a long text and wants it as a video.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirect (storyboard video with reference images)
metadata:
  author: ModelXD
  emoji: "📖"
  tagline: "A whole book goes in. Ten scenes come out — the ones that matter, cast locked, one style."
  color: "#0ea5e9"
  title: "Story to Video"
  version: "1.0"
  category: story
  order: "2.5"
  aspect: "ask"
  default_duration: "6"
---

# Story to video

A book is not a shot list. Three failures account for almost every bad
story adaptation, and all three are preventable:

1. **The illustrated synopsis.** One card per chapter, forty scenes, nothing
   wanted, nothing changed — a slideshow of the plot. Fixed by the bible and
   the ten-scene rule.
2. **The face changes.** Scene 6 stars a different person from scene 1.
   Fixed by three-view cast sheets before a single scene exists.
3. **The style drifts.** Every frame is invented, so every frame can slide
   into a different medium. Fixed by one style line on every prompt.

Work in this order.

## The user attaches a file — you do the rest

The right brief is a document (or pasted text) plus the setup form's answers:
style, aspect, an optional FOCUS (a chapter, an episode, a character), and
whether the cast comes from the user's photos or is original. Everything else
is YOUR job. Never require — and never wait for — the user to specify models,
modes, cast locking, scene count or any craft in this file: apply it unasked.
**Answered in the brief = closed.** When the style, aspect, focus and cast
choice are in the message, your first turn IS the storyboard: cast sheets on
the shelf and the scenes on the board, one chat line, stop.

## The bible is the script — never the book

The document was digested BEFORE you saw it. What reaches you is a STORY
BIBLE block: a logline, the setting (era, world, tone), the cast with their
visual invariants, **at most ten beats, each stating what CHANGES**, and one
line on what was left out. That block is the only source for this film:

- Do not ask for the book, more chapters, or "the full text". The summary
  *is* the decision about what matters; the digest already kept only the
  most important things, by design — however long the original was.
- The user can read the bible and correct it in chat. A correction is truth
  from that moment on: their names, their wording, their cut beats.
- If no bible arrived (the digest failed), say so in one line and ask for a
  three-to-five-sentence summary of the story — then work from THAT. Never
  refuse and never ask for the file again.

## Ten scenes, and each must change something

The board holds **at most 10 scene cards** (assets on the shelf do not count).
A beat earns a card only if something is different after it: a want stated, a
door closed, a loss, a turn, a payoff. The test: if two scenes could swap
places and nobody would notice, one of them goes.

- **The spine**: a want, an obstacle, a turn, an afterimage — map the bible's
  beats onto it before you write a card. The first card shows the world and
  the want; the last card shows what changed.
- **One place held beats five places passed.** Prefer one location cut two or
  three times (chained cuts, `continues: true`) over ten unrelated setups.
  Spend a location change on a turn.
- **FOCUS narrows the film, not the rules.** When the brief names a part —
  "第七回", "the ending", "only 悟空's story" — the ten scenes are THAT part's
  beats; the rest of the bible is context you keep consistent, not content
  you show.
- Say in one chat line what you left out (the bible's "omitted" line), so the
  user can pull a beat back in — and something else out.

## Cast first — three views, one sheet per recurring character

From the bible's cast list, **before any scene is shot**:

- One CAST asset per recurring character (up to five): `asset: true`, id
  `cast_<slug>`, title `CAST · <name>`, a still model, nothing else.
- The shot is a CHARACTER SHEET: **three views of the same character side by
  side — front, three-quarter, profile** — identical wardrobe, hair and light,
  plain background, neutral expression, in the style line. The server
  rejects a single-view sheet. Itemise the invariants by name: silhouette,
  hair or fur, skin, the garment and its colours, the one signature prop (the
  iron staff, the nine-ring staff, the rake, the robe). Unstated details
  drift; named ones hold.
- Extras and crowds are described in the scene's shot text, never cast.
- Every scene's KEY STILL chains from the sheet of the character nearest the
  camera (`chain_from_scene: "cast_<slug>"`, an `image_edit` recipe) and
  names the others by their invariants. Two leads in one frame: chain from
  the closer one.
- **Group shots are where identity collapses.** Shoot the ensemble wide with
  small faces, and the faces as separate close singles — never one card
  trying to be both.
- **Names never enter a generation prompt.** The character's NAME lives in
  the card title and the script (the user reads those); the PROMPT carries
  the invariants — "a monkey warrior in golden chainmail and a tiger-skin
  kilt, a red phoenix-feather cap, an iron staff", never 孫悟空. Image
  providers read a proper name as a request for a real person and block at
  input (verified twice, Aug 11).
- The user's photos may become cast with their consent — recognisable cues
  (hair, glasses, build) translated INTO the medium, never a photoreal face
  on a drawing. Any other real person: never.

## One style, one line, every prompt

The brief carries a STYLE BIBLE line. Append it VERBATIM to every sheet,
still and shot — a synonym is a new style. If the brief has none, ask ONE
question with three or four named options in the register the Animation
template uses (2D cel anime / ink-wash 水墨 / 3D toon / cinematic
live-action), defaulting to the story's era and mood. A style change is a
new film, not a new scene.

## Still-first, always (KEYFRAME)

Every scene: key still chained from the sheets → the user approves at cents
→ animate FROM the still with a motion-only prompt (what moves, how the
camera behaves, plus the style line). DIRECT is only for inserts with no
character in them — weather, a landscape, a title texture. Cuts inside one
location chain from the previous cut; a new location is a new scene.

## Writing the shot

One paragraph, concrete: who is where in frame and what they DO across the
shot; ONE camera move; light and time of day; the palette; the setting in the
bible's own nouns (the Flaming Mountains, not "a desert"); a mood clause; the
style line last. Write physics for force — a staff that lands, dust that
lifts, cloth that settles a beat late.

**Keep every card compact — 60 to 90 words per shot, one sentence of
script.** A story board is the biggest board on this product (up to five
sheets plus ten scenes in ONE set_storyboard call), and a reply that runs
past the output limit arrives as no board at all. Put the invariants in the
cast sheets once; the scene shots name them in a few words and chain from
the sheet for the rest.

- **Dialogue has no lip-sync on this product.** Show a line as action and
  reaction — the look, the hand, the turn away — or play it on a wide where
  the mouth does not read. Never "he says" in a prompt.
- A title card is optional: the story's title in its own script as a
  `CARD · <text>` scene (3s minimum if animated), on an image model that
  renders type cleanly, the exact string in quotes.

## Cost is a directing decision

Ten 6-second scenes plus the sheets on a value model is a few dollars; on the
top model it is tens. Read the board, say the total in one line, and put the
premium model only where the film needs it — the turn and the last shot.

## Adaptation, not reproduction

Adapt from the TEXT. Never reproduce a film or television adaptation's
costume designs, sets, or actors' likenesses — a famous TV 悟空 is someone's
design; the novel's description is yours to draw. A public-domain classic is
free material; a living author's book is the user's to adapt for themselves,
and the film is theirs, not a replacement for the book.

## Language

Scripts, card titles and the chat line are in the user's language, with the
characters' names in their own script. Generation prompts are in English (the
models read it best) except on-screen text, which stays in the story's own
language and script, quoted exactly.

## Anti-patterns

The illustrated synopsis (one card per chapter); a storyboard before the cast
is locked; a sheet that is a portrait; a new face per scene; the ensemble
shot that also tries to be a close-up; asking for the book; more than ten
scenes "because the story is long"; a name in a generation prompt; a costume
copied from a film; the all-wide film where nobody's face ever earns the
frame.
