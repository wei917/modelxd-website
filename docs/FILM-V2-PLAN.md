# Film v2: plan (Oct 7)

Owner, Oct 7, after test film `0b29fb5d` (30 s, $5.99): "this quality is so bad...
cannot compete with the one in the X post", and "it's not just model or image
quality. it's the story line, prompt writing, quality validation". Then: "do
both and use the boxing story as a reference story to generate test videos".

The X post is anabology's "Escape Velocity" (making-of: public Drive folder
`1aYcTHm00aY-Lk1lufsgSkXK-XJXWduMk`: README, `orchestration.md` with the agent
workflows, `direction-log.md`, `prompts-*.md`). It was directed (about 50
messages, approvals at casting, song, storyboard and v1), so the directed
version belongs in XDirect. Film is the automatic version: agents have to do
the human's job too. Both run on one engine, built and tested through Film
first.

## What went wrong in 0b29fb5d (from its session events)

| | Escape Velocity | Film v1 |
|---|---|---|
| Story | A concept with a through-line device and an arc; 3 director agents boarded it, 3 judges scored, a head director merged; a designed hook | A 9-line plan written 17 s after the brief arrived, before any picture; the brief copied 1:1 into 7 shots; he is young in the first frame, so "becomes young again" has no setup |
| Pictures | One verbatim character canon in every prompt (~640 chars); one style family; framing first; a declared empty area for text | Short generic prompts; characters re-described each time; no style family, framing system or text areas |
| Clips | Timed actions ("at one second…"), camera locked, "No cuts", face controlled | One sentence of action + "camera shake" |
| Timing | Song, beat map and word times first; 141 shots in 5:06 cut on beats | 8 clips laid end to end (2.6–6 s); voices sped up 1.4× and 1.15× to fit |
| Graphics | A JS engine: every word on time, explaining graphics, motivated transitions (48% of the spend) | One 5 KB Pillow script, written and rendered in about a minute |
| Review | Per chapter: animator, then an independent art director viewing ≥28 frames against a written bar (≤14 fixes), then a fixer; automatic checks; human notes on v1 | The same agent glanced at ~8 small images and wrote 「成片檢查沒問題」 |
| Scale | 19 h, $626 Claude (max/high effort), 77 clips | 17 min, $1.12 Claude (medium), 8 clips; post-production took about 3 minutes |

## The engine

**Stage A, pre-production (our server, Messages API, Opus 5.5 at high effort).**
Brief → three directors with different angles (anime action, character and
comedy, trailer and hook) → one judge through three lenses (a phone viewer, a
story editor, a producer) → a head director merges → code checks. Output: one
storyboard JSON (`title`, `logline`, `treatment`, `hook`, `real_people`,
`characters` with verbatim canons per state, `style` with the look string,
type system and BPM, `beats`, `keyframes`, `clips`, `shots`, `budget`,
`risks`). The code checks: shots tile the film, cuts on the beat grid, every
keyframe carries its characters' canon verbatim, voice lines fit at natural
speed, clip lengths within each model's limits, no two clips from one
keyframe, planned generation ≤ 70% of the budget. Stored on the film
(additive column, migration 128) and shown on the progress page. XDirect's
approved board maps into the same schema later.
Prototype: `scratchpad film-v2/step1/preprod.mts` (prompts to move into
`lib/film/preproduction.ts`).

**Stage B, production (Managed Agents, agent v5, Opus 5.5 at high effort).**
Input: the storyboard. Roster: the director (coordinator) and an Art director
agent (renders contact sheets and judges them against a written bar; never
edits). Order, cheapest checks first:
1. Character sheets, then keyframes from the templates. The art director
   checks them against the canon and the shot list before any clip money.
2. Voices first: every line spoken and measured; shot timings adjusted to fit
   (never sped up). Music bed at the storyboard's BPM.
3. Clips as boarded, submitted staggered. Frames of each clip checked against
   its shot; one retake when it misses.
4. Motion design and edit in a headless browser (HTML/canvas, every frame a
   pure function of t, rendered in parallel): the type system, impact frames,
   speed lines, transitions, the end card; ffmpeg encodes.
5. Final review: contact sheets at every cut, text entrance and impact;
   ≤ 10 concrete fixes, up to 2 rounds. Automatic checks: each line's subtitle
   on screen while it plays, text size, duration, loudness.
6. `film.mp4`, `notes.md` and the final storyboard.

**Tools.** `generate_image`: GPT Image 2.5 Flare at high ($0.0425 at 16:9,
the price v1 paid for GPT Image 2 at medium); test character-sheet reference
input against canon text only. `generate_video`: `model` = HappyHorse 1.1
(3–10 s, $0.14/s) or Seedance 2.5 on Replicate (5–10 s, $0.2312/s); staggered
submits, backoff and one retry on 429. `speak`: unchanged.

**Environment.** Add Chromium and Node (Puppeteer-core) to the sandbox. A ~$1
probe first: the sandbox's network reaches only package registries and our
storage host.

**Money and time.** Tiers $15, $30, $50 (owner to pick). Claude's share grows:
pre-production about $1–2, production and reviews $3–8. Time limit 45 → 90
minutes.

## Character consistency: the rule (Oct 8; owner on the result: "much better")
The first real-clip test had young Tyson "sometimes fat sometimes not": every
picture was drawn from a text description, so the model reinvented his face
and body each time ("short" and "round face" in the description pushed it
toward chunky). The fix, now the engine's rule for every character:
1. **One reference sheet per character first** (front, three-quarter, side,
   back, face close-up), with the build stated plainly (for Tyson: lean,
   heavily muscled, no belly fat, a neck as wide as his head). Approved
   before anything else.
2. **Every picture is an EDIT of that sheet** ("the same man as in this
   sheet, now in this scene"), never a fresh text-to-image. Two people in a
   shot: one input image that stacks both sheets, each named.
3. **Continuing shots are chained:** the next clip starts from the previous
   clip's last frame, so nothing is re-drawn (this also kept the hologram
   the same shape across the cut).
4. Every clip prompt ends "Keep his face, body and build exactly as in the
   first frame."
5. The art director checks each picture and clip against the sheet.

## What the Oct 7–8 tests taught (keep)
- **Motion is the base.** A preview of stills plus code effects ("so so so
  bad", "even much worse than the first version") cannot stand in for a
  film; never show one as a quality check again. Code draws only titles,
  subtitles and tracked UI text (the hologram date follows the panel).
- **The brief is the story.** Follow it beat for beat; no invented gags or
  renamed characters. Owner: real people are fine as stylized characters
  ("use real people and convert to cartoon style"); "realistic and cinematic
  for entire video"; "fast pace and action".
- **Look:** Grok Imagine Image 2.0 won the look test (realistic cinematic CG,
  strong likeness). GPT Image 2.5 refuses action shots with real names.
- **Video:** Seedance 2.5 refuses well-known faces ("flagged as sensitive",
  E005). Grok Imagine Video 1.5, HappyHorse 1.1, Wan 3.0 and MiniMax H3
  accept them; Grok won on motion and likeness. HappyHorse needs
  watermark off. Grok's own sound is quiet; normalize to -16 LUFS.
- **Replicate's balance was under $5** (throttled to 1 request at a time):
  it limits Seedance for every user, so keep it topped up.
- **Voices run longer than estimates;** record them first and fit shots to
  them; re-direct the delivery rather than speed a voice up.
- **Transitions follow film grammar** (owner, Oct 8: "you have no transition
  from sleeping to dream.... you should check how movies or animation does
  that"). Into a dream: push in on the sleeper while a glow starts on his
  eyelids, an extreme close-up of the eye, the light floods the frame, and it
  dissolves gold to gold into the dream. The dream's sound (the arena crowd)
  arrives before its picture, rises from the first glow and peaks on the
  dissolve. Out of it, mirror the way in: a blink to black, the same eye, a
  pull-back to him asleep, in silence. The pull-back clip is a start-and-end-
  frame clip whose last frame is the next shot's first frame, so the cut is
  invisible. Check every clip's own sound before using it as a bed: one
  crowd clip also had the referee talking.
- **Board first, then clips** (owner, Oct 9: "do you really read the
  video's storyline? are you sure it makes sense?", then "you're a
  professional director. please. do it well"). A cut patched together from
  clips made for an older storyline had 8 story errors: a dream that did
  not read as a dream, the change happening twice, a room that changed
  three times, emotions in the wrong order, and a reflection moving on its
  own. The process that fixed it:
  1. A captioned storyboard, one first frame per shot, checked against the
     brief beat by beat before any clip money is spent.
  2. Each picture reviewed for likeness, build and story logic. Of 10
     pictures, 3 were retaken: the beaten men still standing, and a dresser
     photo drawn photorealistic twice, so it was removed.
  3. Each clip watched at 4 frames a second.
  4. The final cut watched end to end.
- **Loudness:** do not use one-pass `loudnorm` on a film with quiet scenes.
  It flattens the mix until morning birdsong is as loud as the fight. Mix
  first, measure the integrated loudness, apply one static gain to reach
  -16 LUFS, then a peak limiter.

## Fixes from the Oct 7 test (all small)
- 429 `Throttling.RateQuota` on 7 parallel HappyHorse submits: stagger,
  backoff, and word it as a busy provider, not an account limit.
- Progress lines: always the brief's language; no real names; no internals
  ("adding asplit").
- Top-bar sign-in on 成片 returns to 影片: the sign-in snapshot must record
  that Film was open (`client.tsx`, the `xcreate.signin-draft` effects).
- One voice file broke on the agent's first download (cause unknown).
- The progress page stops polling in a background tab (by design); show
  "paused" or catch up visibly.
- The Library row has no title: save the film's title.

## Tests
Reference story: the owner's boxing brief, verbatim (B1). Every engine change
is compared with `0b29fb5d` side by side; the owner judges. Each spend needs
the owner's yes.
1. Storyboard only: done Oct 7. $3.19 (plus about $1.48 for a first attempt
   that failed: at high effort a 24k-token limit went entirely to thinking).
   Judge: action 84, character 81, trailer 75; code checks clean; planned
   generation $5.47 (15 pictures, 8 clips, 28 s). It needs image-reference
   input (old→young in the same frame), which `generate_image` lacks.
2. Character sheets + keyframes + art-director review: done Oct 7, $1.01
   (15 GPT Image 2.5 Flare pictures at high, $0.67; Opus review, $0.34).
   Verbatim canons kept both boxers on model in every frame without
   reference pictures; the young-in-bed frame made as an EDIT of the old one
   came out pixel-registered for the wipe. The review kept 11 and asked for 4
   fixes it caught before any clip money: no headroom for the stand-up clip
   (his head would leave the frame), the emblem on the wrong leg, the old age
   not reading, and a clip prompt that no longer matched its start frame.
3. Full film on the v2 engine ($15–30).
4. Then XDirect's "Produce film" on the same engine.

## Not in v2.0
Lip-sync, a song model, web research, real people. On real people (owner,
Oct 7, asked about cartoonizing downloaded photos of the two boxers): no;
the photos are someone's copyright, both men's names and faces are
commercially licensed, a cartoon keeps the likeness, and ModelXD sells the
output. Original characters only; for our own showcase or ads keep any
homage loose (a look-alike can still "evoke" a person in US law).
Owner, Oct 9, after the risk was raised again: "people can use Jensen and
Elon and Bill Gates for short video. I don't think this is a problem if the
content is fun." Decided: the test film keeps Tyson and Ali, drawn as
cartoon characters (never from downloaded photos); invented characters
(the influencer boxer) stay invented.
