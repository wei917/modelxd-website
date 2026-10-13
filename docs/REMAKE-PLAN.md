# 同款 (Remake): plan (Oct 10)

Owner, Oct 10: "I want to build a new feature that user can paste a link to do
the same video。做同款。 但是換掉人物或主角 主題 背景...etc." and "the link can be
anything, youtube, x.com, tiktok...etc". Agreed the same day: its own tab next to
成片, running on Film's engine.

## What it is
Paste a link to a video you saw, choose what to swap (主角, 主題, 背景, look,
language, your product), and get your own version with the same shots, timing,
camera moves and transitions.

It is the automatic sibling of XDirect's reference video. That one (Aug 26,
`/api/xdirector/reference`) borrows only the look and the cut rhythm of a
YouTube video for a music video. Same split as Film and XDirect: XCreate is
automatic, XDirect is directed.

Why it should work better than Film: the reference supplies the story, the pace
and the transitions. Those were the hard part of the boxing test (about 15
rounds on a 25 s opening; owner: "this is so hard to get it to what I want").
The director maps instead of inventing.

## Where it lives
The sixth type on the X創作 top bar, after 成片. `STUDIO_TYPES` in
`app/components/xcreate/studio-type.ts` gets `'remake'`.

| Language | Tab |
|---|---|
| zh-Hant / zh-Hans | 同款 |
| en | Remake |
| ja | リメイク |
| ko | 리메이크 |

The main button says 「做同款」. www's XCreate shows the same tab.

## The user's three screens (phone first)
1. **Paste.** One paste box and an upload button. Under them, the trending
   videos (the existing feed, 1,000+ likes), each with a 「做同款」 button.
2. **Breakdown and swaps.**
   - The original's storyboard as cards, one per shot: time, what happens, who
     is in it, the camera move.
   - The swap panel:
     - Each character: keep, my photo, describe one, or a famous person.
     - 主題: one line.
     - 背景: one line or a photo.
     - Look: keep the original's, or pick one (anime, realistic, 3D…).
     - Language for voices and text.
     - A product photo (optional).
   - The price, then 「做同款」.
3. **Making.** Film's progress page. The result is a film row in the Library,
   with the existing platform exports (`ExportBar`, `VideoExportBar`).

## Reading the link
| Link | How | Cost |
|---|---|---|
| YouTube (incl. Shorts) | Gemini reads the URL; we never download it (as XDirect's reference does). Public videos only. | Gemini tokens, cents |
| X (x.com, twitter.com) | X API v2: `GET /2/tweets/:id` with `expansions=attachments.media_keys&media.fields=variants` gives the MP4; Gemini watches it. | about $0.005 a post read, plus Gemini |
| TikTok, Instagram, Douyin, Bilibili, anything else | The user uploads the file (saved from the app). Downloading these ourselves breaks their terms. Reuses the own-file upload the converter uses. | Gemini |

Notes on reading:
- **X needs setup.** It needs an app bearer token (`X_BEARER_TOKEN`, not set
  yet).
- **The source video is never kept.** The file (X or upload) lives only until
  the breakdown is done.
- **Length (owner, Oct 10):** "length cap to 3 minutes, if our pipeline can
  handle. but do let users set cap."
  - Sources up to 3 minutes.
  - The user picks how much to remake: 15 s, 30 s, 60 s or the whole video,
    or a stretch dragged on the timeline. Each choice shows its price.
- **Can the pipeline handle 3 minutes?**
  - Reading: yes. About 65k video tokens at 5 fps, roughly $0.20.
  - Making: about 60–90 shots, roughly $50 and 45–60 minutes with clips sent
    in staggered batches. Film's 45-minute session limit has to rise (already
    planned for v2).
  - Phase 2 includes one long test before anything over 60 s is offered.

## The breakdown
Model: **Gemini 3.8 Flash at 5 frames a second** (phase 0, Oct 10; script
`scripts/.remake-probe.tmp.ts` in the film-v2 worktree).

**Accuracy.** Tested on our own 24.5 s boxing opening, where every true cut is
known:
- At 5 fps it found 10 of 10 cuts, with a mean timing error of 0.10 s.
- It added 2 extra splits, both at big action changes inside one long shot.
- Every description was right. It even understood that the young boxer is the
  same man as the old one.

**Pro vs Flash.** Gemini 3.1 Pro matched it at twice the price.

**Gemini's default of 1 fps is not enough.** Cuts land 0.3–1 s off, and long
shots get chopped into 1 s pieces. Always set `videoMetadata.fps = 5`.

**Cost.** About $0.04 for a 25 s video and $0.05 for 60 s.

**YouTube.** Both links read cleanly from the URL:
- Overwatch "Dragons": 10 shots, with the narration transcribed.
- "Death Walks Into a Bar": 13 shots, with the dialogue transcribed.
- One link needed a retry after a network error.

**Lessons for the build:**
- Skip rating cards, studio logos and end cards. Dragons' first 10 s were an
  ESRB card and the Blizzard logo.
- Give uploads an ASCII file name; a Chinese name broke Gemini's file upload.
- Retry once on a fetch failure.

Output, one JSON:
- `duration` and `hook` (the first 2 s).
- `shots[]`: `t0`, `t1`, framing, camera, action, who, where, `transition_in`,
  on-screen text, sound.
- `characters[]`: id, role, look.
- `lines[]`: time, speaker, text, language.
- `music`: bpm, mood, whether the cuts land on the beat.
- `look`: style, palette, light.
- `title`.

Code checks:
- The shots tile the duration.
- No shot is shorter than 0.3 s.
- Every character a shot names exists.

Shown as cards. X videos and uploads can show one thumbnail per shot, cut from
the file and deleted with the job (decision). YouTube shows text cards, because
we never have its pixels.

**Materials (Oct 13).** Owner: "it should automatically break down the
essential materials (input images, audio...etc) for users to replace." The
read now also returns:
- `things[]`: id, kind (product, prop, logo), name, look, best, box.
- `places[]`: id, name, look, best.
- On each character: best and box.
- On each shot: `things` and `place`.

`best` is the second where the person or thing is seen most clearly; `box`
is `[ymin, xmin, ymax, xmax]` on 0–1000. The page adds the music, one voice
per speaker and the distinct on-screen texts. Every material gets a tile and a
card with its own choices:
- People: keep, my photo, describe, famous person.
- Things: keep, my photo, describe, remove. A logo has no keep and starts as
  remove.
- Places: keep, my photo, describe.
- Music: none, or my track. There is no music model yet.
- Voices: AI voice, my recording, or no voice.
- Texts: the user's own words, or rewritten for the theme.

Tested Oct 13, $0.19 in total:
- Jensen X post (85 s, two pieces): 12 people, sunglasses, a sign, the stage
  and its music, 1 speaker, 19 texts. 13 of 15 pictures right; the misses
  had the model's moment off.
- Our boxing upload (24.5 s): 4 people, the system window, 4 places. 8 of 9
  pictures right; the referee's showed his glove.
- A YouTube video (30 s): 2 people, a gun, a notebook, 2 places. It has no
  pictures; the cards play the moment instead.

The pictures add about 60–80 KB to the response. The engine does not read
the new choices yet; wiring them in comes with making.

## Making it (Film v2's process, `docs/FILM-V2-PLAN.md`)
1. **Storyboard.** The director (Claude, Messages API) turns breakdown + swaps
   into the remake's storyboard: the same shot list, timing and transitions,
   with the swaps applied. The code checks are Film v2's Stage A.
2. **Consistency.**
   - A reference sheet for each swapped character, from the user's photo or a
     description.
   - Every keyframe is an edit of the sheets; for two people, both sheets go in
     one input.
   - A continuing shot starts from the previous clip's last frame.
3. **Clips by shot type.**
   - Grok Imagine Video 1.5: action from one frame.
   - Wan 3.0 first + last frame: transformations and exact moves.
   - HappyHorse or Seedance where they accept the content. Seedance refuses
     famous faces.
4. **Sound and text.**
   - Voices re-recorded in the chosen language (the speak tool).
   - Music: a new track at the original's tempo and mood. The music model is
     not chosen yet.
   - On-screen text drawn in code and tracked onto surfaces, as the boxing
     test's system window was.
5. **Edit.**
   - Transitions as in the original.
   - Loudness: one static gain to -16 LUFS plus a limiter. Never one-pass
     `loudnorm`; it flattens quiet scenes.
6. **Review before delivery.**
   - Watch at 4 frames a second.
   - Compare with the breakdown shot by shot: count, order, timing within
     0.3 s, who and where.
   - Up to 2 fix rounds.

**Never copied:** the original's footage, frames, audio, music, voices or
logos. On-screen text is rewritten unless the user keeps generic words.

## Money
- **Breakdown:** house-paid, because it is the hook. A few cents a link, with a
  daily cap per user (decision).
- **Remake:** quoted before it starts, reserved, settled at list price, unused
  money refunded (as Film).
- **Rough cost:** about $0.20–0.30 per finished second in pictures and clips,
  plus $1–2 of planning and review. That makes 15 s about $5, 30 s about $9 and
  60 s about $17. Measure in phase 2 before setting prices.

## Rules
- **Faces.**
  - The user's own photo needs a consent tick.
  - Someone else's photo needs an "I have their permission" tick, as
    相學館's partner photo does.
  - Public figures are allowed for fun (owner, Oct 9).
- **Moderation.** Text swaps and photos go through `lib/moderation.ts` before
  any spend. A provider refusal becomes a clear message and costs nothing.
- **X terms.** Read the current developer agreement before launch. It bans
  training models on X content; analysing one post for one user's remake is a
  different use, but confirm it.
- **Logging.** Every call is logged in `provider_calls` with the user id, as
  Film's are.

## Build
- **Tab.** `studio-type.ts` gets `'remake'`, plus i18n `mode.remake`.
- **UI.** `app/xcreate/RemakeStudio.tsx`: paste, breakdown cards, swap panel,
  price. `remake-copy.ts` holds the words in 5 languages.
- **Library code.** `lib/remake/`:
  - `source.ts`: YouTube URL, X API or upload.
  - `x.ts`: the X API client.
  - `breakdown.ts`: video to JSON, plus the checks.
- **API.**
  - `POST /api/xcreate/remake/breakdown`.
  - `POST /api/xcreate/remake`: starts a film row.
  - Progress and settling reuse `/api/xcreate/film/[id]` and the film cron.
- **Migration 129 (additive)** on `xcreate_films`: `mode` (`'brief'` or
  `'remake'`), `source` jsonb (kind, url) and `breakdown` jsonb. Service key
  only, like 111.
- **Env.** `X_BEARER_TOKEN`.
- **Engine.** The Film v2 pieces in `lib/film/` (sheets, edits, chained clips,
  per-shot model choice, review), shared with Film. 同款 is their first user.

## Phases
0. **Probe, about $1.**
   - 5 links: 2 YouTube, 2 X through the API, 1 upload.
   - A breakdown for each, checked by hand against the real video (shot count
     and timing).
   - Confirm the X token and its cost.
   - The owner reviews the breakdowns.

   Oct 10 status:
   - **Done** for YouTube ×2 and the upload: $0.52 across 10 runs (two models,
     two frame rates).
   - **X done the same day** once the owner added `X_BEARER_TOKEN`.
     - `GET /2/tweets/:id` with media variants returned each post's MP4: 4–5
       variants, the best 960x720 and 1920x1080.
     - Two posts: the owner's Oct 7 reference (the Jensen Huang / Michael
       Jackson parody, 12,088 likes) and the top trending video ("India
       Simulator", 11,649 likes).
     - Gemini 3.8 Flash at 5 fps matched 21 of 25 and 19 of 20 hard cuts
       (found by frame difference), with mean errors of 0.05 s and 0.12 s.
     - Its extra splits sit mostly at soft transitions.
     - For X videos and uploads we have the pixels, so a frame-difference pass
       could snap cut times exactly. YouTube relies on Gemini alone.
   - **Phase 0 total:** $0.66 in Gemini plus 2 X post reads. The downloaded
     videos were deleted after the probe.
1. **Tab, breakdown and swaps, no generation,** on dev.

   Oct 10: **built** on branch `claude/remake-tab`; committed, not pushed.
   - **Server.** `POST /api/xcreate/remake/breakdown`:
     - Sign-in required; 10 free reads per user per 24 h, counted in
       `activity_logs` (event `remake_breakdown`), so no migration.
     - YouTube by URL, X through `lib/remake/x.ts`, uploads from the
       user's own folder.
     - Gemini through the logged `analyzeVideo` in `lib/providers`, with
       `uploadVideoFile` / `deleteVideoFile`. The source and the temp file are
       deleted before the response.
   - **Words.** The shot list comes back in the reader's language. Framing and
     transitions stay English words the page translates.
   - **Long videos are read in one-minute pieces.** On the 86 s Jensen video,
     one read was right for 58 s, then its times jumped about 40 s ahead.
     - Read in pieces, each told who has already appeared: 45 shots, ending at
       85.2 s of 85.6 s.
     - 34 of 37 real cuts matched at 0.09 s, all 12 after the first minute,
       and the same person kept one id. Cost $0.10.
     - A 3-minute YouTube read is about $0.12.
   - **Page** (`RemakeStudio.tsx`, phone first, five languages):
     - Paste or upload, an optional start second.
     - Shot cards: the first 6, then "see all". "C1" in the model's words
       becomes the character's name.
     - Lines folded.
     - Length with a price each (15 s, 30 s, 60 s, the whole read) and the
       start shot.
     - Characters ordered by shots: one-shot extras fold into "other
       characters". Each one: keep, my photo (with a consent tick), describe,
       or famous person.
     - Theme, setting, look, language, a product photo.
     - The make button is disabled, with "comes next".
   - **Checked:** at 375 px wide in the browser (signed out; the shot list
     loaded into the page), 401 when signed out, real reads of YouTube and X
     run directly through the same code, `tsc` and `npm run build`.
   - **Not checked:** a signed-in read through the page. Local sign-in only
     returns to :3000. Test it on dev once pushed, with `X_BEARER_TOKEN` in
     Vercel.
2. **Generation on the v2 engine.**
   - 3 remakes of 15–30 s, about $30 of tests.
   - The owner judges each against its original.
3. **Polish.** Music, voices, text redraw, the 「做同款」 button on trending
   posts, platform export.

## Decisions for the owner
1. ~~Length cap in v1~~ Decided Oct 10: sources up to 3 minutes; the user sets
   the remake's length.
2. Free breakdowns, 10 a day per user: the default built Oct 10 (owner did not object).
3. Default look: the original's, or ours.
4. Music until a music model is chosen: none, or the user's own track.
5. Price: per second, quoted up front (estimate: about $5 for 15 s).
6. Shot thumbnails cut from X videos and uploads, shown during the session:
   yes or no.
