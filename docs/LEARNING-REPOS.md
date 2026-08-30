# Learning from other repos

Studies of open-source projects adjacent to ModelXD. We learn and credit
plainly. Patterns get adapted to our stack; code is never lifted.

## The cross-cutting lesson: open-source video tools are API funnels

Owner call (2026-08-30): **this is how we attract users to our API.**

Look at who funds these repos. huobao-drama is literally chatfire's
acquisition funnel — the README headline is "获取 Huobao API Key →
api.chatfire.site", and Settings has a one-click "火宝快捷配置" that writes
three recommended provider configs pointing at their own resale API. Every
sponsor slot in MoneyPrinterTurbo's README is an API reseller (Kimi,
BytePlus, CCSub, APIMart, Infistar) paying to be the key users paste in.
The apps are free; the model traffic is the business.

ModelXD already has the product these funnels sell: `/api/v1` at list
price with margin from provider discounts, plus XDev keys. The play is to
**be the key that open-source video tools paste in**:

1. **Compat first.** Both apps take any OpenAI-compatible base URL for
   text. Smoke-test MPT and huobao pointed at `modelxd.com/api/v1`
   (structured output, streaming, error shapes). Fix what breaks — these
   apps are the real-world conformance suite.
2. **Docs recipes.** "Use ModelXD in MoneyPrinterTurbo / huobao-drama /
   n8n / …" pages: base URL, key from /xdev, recommended models with the
   XBoard price labels. Cheap SEO, exactly-right audience.
3. **Named-provider PRs.** MPT (MIT) accepts provider integrations —
   a PR adding ModelXD as a preset provider puts us in front of 118k
   stars' worth of installs. (huobao is CC BY-NC-SA — a PR is still fine,
   we're contributing config, not taking code.)
4. **One-click config pattern.** Copy the 火宝快捷配置 idea in reverse:
   an XDev page button that emits ready-to-paste config blocks
   (MPT config.toml stanza, huobao settings values) for the user's key.
5. **Media compat later.** Their image/video paths use per-vendor
   adapters (Ark/Seedance, OpenAI images), not one standard shape — text
   is the wedge today; an OpenAI-images-compatible surface is the future
   unlock if the funnel proves out.

Why we win in this crowd: resellers compete on discounts of one model;
we route on public blind-vote data with prices in the open. "The key that
picks the winning model" is a story none of the resellers can tell.

## MoneyPrinterTurbo — https://github.com/harry0703/MoneyPrinterTurbo

Read 2026-08-30 (118k stars, 18k forks, active daily). Topic in → finished
narrated short out: LLM script → search keywords → stock footage
(Pexels/Pixabay/Coverr) or generated (Seedance via Ark/WaveSpeed) → TTS →
subtitles → MoviePy/ffmpeg compose + BGM → optional auto-publish
(TikTok/IG/Shorts via upload-post.com). Python, Streamlit + FastAPI.

### Learnings, ranked

1. **Narration is the spine XCut is missing.** Their timeline is
   audio-driven: TTS narrates the script and the audio duration dictates
   clip cuts. The clever part: **subtitles come from the TTS engine's word
   timings** (edge-tts `SubMaker`) — perfectly synced, zero Whisper cost.
   We already have `synthesizeSpeech` in `lib/providers/alibaba.ts`; a
   narration track + TTS-timed ASS subtitles in XCut is a small lift.
   They gate Whisper behind explicit opt-in so a fallback can't silently
   download GBs of model — copy that discipline.
2. **Stock footage as the free B-roll layer.** Generic scenes get free
   Pexels/Pixabay clips; only hero shots need generation. A "stock" asset
   source in XCut/XDirect drops a 60s short from ~$10 to under $1 and makes
   per-shot model choice MORE meaningful. Their provenance care: persisted
   source URLs are stripped of tokens/creds; creator attribution kept.
3. **MPT users are /api/v1 customers.** Its provider list is a zoo of
   OpenAI-compatible gateways; every README sponsor is an API reseller —
   the exact market our list-price/discount-margin API sits in. An MPT
   install can point at `modelxd.com/api/v1` today (chat/completions
   shape). TODO: compat smoke test + a short docs recipe.
4. **They independently converged on our billing safeguards** (validation):
   paid Seedance/LoomLoom tasks need an explicit quote→confirm (our
   armed-scene-card gate), and a billed remote task's run-id is logged
   BEFORE anything else can fail — state-backend outages degrade
   observability, never abandon a paid task. Rule worth adopting verbatim:
   *the only identifier of a billed job must never live solely in a local
   variable.*
5. **Smaller ideas:** AI BGM behind a tiny provider-agnostic interface
   (`is_enabled` + `generate_bgm`); TwelveLabs embeddings to rerank
   footage so budget cuts drop the LEAST relevant clips; upload-post.com
   as a future XCut "Publish" last mile; batch-N-pick-one (our multi-seat
   DNA applied to whole videos).

### Not copying

- MoviePy composition core — codec-fallback and memory scar tissue our
  raw-ffmpeg XCut renderer avoids.
- 980-line per-provider LLM if/elif chain — what our provider router
  exists to prevent.
- Whisper-transcript-vs-script "subtitle correction" — only needed because
  of ASR; TTS timing sidesteps it.

## huobao-drama (火宝短剧) — https://github.com/chatfire-AI/huobao-drama

Read 2026-08-30 (14.4k stars, active daily). One sentence → complete short
DRAMA (短剧): novel/script rewrite → extract characters/scenes/props →
storyboard breakdown → canonical asset images → per-shot video (Seedance
2.0 multi-reference) → ffmpeg per-shot subtitles + episode concat.
TypeScript full stack: Nuxt 3 + Hono + Drizzle + Mastra agents +
ffmpeg-static (same renderer choice as XCut). **License: CC BY-NC-SA 4.0 —
non-commercial. Learn the craft, re-express in our own words; never reuse
their code OR their skill text.**

### Learnings, ranked

1. **Segments, not shots — the pacing/cost insight.** One generation = an
   8–15s SEGMENT carrying 2–4 sub-shots with HARD CUTS inside, described
   per-sub-shot in the prompt (【镜头1】…【镜头2】…). Modern video models
   cut internally; one clip per beat instead of one per shot = fewer
   generations per minute AND pacing that reads like TV, not a slideshow.
   XDirect scene cards are one-shot-per-card today.
2. **Deterministic guardrails inside the storyboard skill.** Dialogue-fit
   hard rule: segment duration ≥ dialogue chars ÷ 4.5/s + 2s acting
   margin (overflow splits to the next segment). Runtime anchor: total =
   script chars ÷ 500/min; segment count ≈ total ÷ 12s ± 20%. Pacing
   tiers (transition 8–10s / narrative 10–15s / climax 12–15s with slower
   sub-shots). Beat boundaries force segment cuts; never split a
   cause-effect chain. Our director skills should carry equivalents — the
   LLM must not be able to write an unfilmable card.
3. **The entity graph IS the consistency system.** Characters, scenes,
   props are first-class rows, each with ONE canonical image (character =
   three-view turnaround; scene = fixed viewpoint with fg/mid/bg; prop =
   white-background product shot) and a saved per-entity "final prompt"
   (agent-generated once, force-regenerable). Shots bind entity IDs via
   join tables validated against the episode's cast, and every shot's
   references auto-assemble in priority order: scene → characters → props
   → manual uploads, capped at 9. No compositing tricks — the model's
   multi-reference mode does the identity work. XDirect has cast assets
   but no scene/prop registry, no per-card entity binding, no automatic
   reference assembly. Strongest architectural learning here.
4. **Dialogue performed by the video model, not TTS.** No TTS service
   anywhere: lines are written into the video prompt as
   「角色名说：「台词」」 and Seedance 2.0 acts + voices them
   (generate_audio). The exact opposite of MoneyPrinterTurbo — and both
   belong in our director as an explicit either-or: narration → TTS
   track; performed dialogue → model audio (our Wan3.0/H3 SYNC path).
5. **Structured cinematography fields per shot**: shot_type / angle /
   movement / atmosphere / result as columns, plus SEPARATE image_prompt,
   video_prompt, bgm_prompt, sound_effect. Richer than our scene cards;
   structured fields survive regeneration and edit UIs better than prose.
6. **Skills in the open agentskills format, editable in the web UI** —
   same spec direction as lib/skills.ts (validation), plus live editing
   as a future idea.
7. **Ops touches worth stealing as habits**: pre-flight ffmpeg probe with
   an actionable error (fluent-ffmpeg's sync EFTYPE would crash the
   process); before concat, verify files exist and NAME the missing shots
   ("S3、S7") instead of surfacing ffmpeg's cryptic error; partial merge
   skips ungenerated shots but keeps order; per-episode locked model
   config falls back to the active config when the locked one was
   deleted (our per-scene model choice has the same stale-model hazard).

### Market signal

短剧 (vertical short drama) is a huge CN/TW category; a Drama template
for XDirect (novel → episodes → storyboard with the rules above) would sit
directly on our existing storyboard/cast machinery and matters for the
Taiwan market.

### Not copying

- Any code or skill text (CC BY-NC-SA — non-commercial license).
- The 6,000-line episode.vue — our client.tsx is already too big;
  that's a warning, not a pattern.
- MySQL/Mastra/Nuxt stack choices — nothing there beats what we run.

## Toonflow — https://github.com/HBAI-Ltd/Toonflow-app

Read 2026-08-30 (14.9k stars, Apache-2.0 — permissive, patterns AND code
referencable). Third 短剧 tool, different shape: an **Electron desktop app**
(local-first SQLite, express + socket.io, Vercel AI SDK for text
providers) that turns novels into ANIMATED short dramas on an
infinite-canvas workbench. Demo episode: ~2 hours end to end. Localized
READMEs include zh-TW/th/vi/ja — they are aiming at our markets.

### Learnings, ranked

1. **A supervision agent that reports but never edits.** Their 监制
   (producer) layer reviews storyboard output against a dimensions table
   with severity levels and red lines (R1–R4) and emits a structured
   review report — with the hard rule stated in the skill: *"you only
   raise issues and suggestions; every modification decision belongs to
   the user."* This maps perfectly onto XDirect: after `set_storyboard`,
   an optional producer-review pass that flags dialogue overflow,
   continuity breaks, unbound cast — as report cards, never as silent
   edits. Same honesty philosophy as our pricing rules.
2. **Art × genre skill matrix as the content roadmap.** 11 art-style
   skill packs (2D 90s anime, 国风, clay stopmotion, real-people urban…)
   × 12 story-genre packs (Xianxia, sweet romance, horror, workplace
   drama…), each a directory of Markdown skills loaded via an
   `activate_skill` progressive-disclosure tool — the agent's prompt
   carries only name+description; full craft loads on demand. Our
   lib/skills.ts already speaks this format; the lesson is the CONTENT
   strategy: genre/style craft shipped as data, no deploy. (Third repo
   in a row with editable Markdown agent skills — the open-skill bet is
   fully validated.)
3. **Sub-agents ARE tools, with per-layer memory.** The decision agent's
   tools are execution sub-agents (derive assets / director plan /
   storyboard gen / panel / table), each loading its own skill file and
   its own memory lane (execution vs supervision), writing to the
   workspace in typed XML tags (`<storyboardItem videoDesc prompt track
   duration associateAssetsIds>`). Keeps the top prompt small and each
   phase's craft isolated. Our director is one agent with flat tools;
   worth considering when xdirector-prompt.ts gets heavier.
4. **Local ONNX vector memory, all free.** MiniLM embeddings run
   in-process (@huggingface/transformers, no API cost): every 3 messages
   → LLM summary ≤500 chars; recall = 5 recent + 10 summaries + top-3
   RAG by cosine; a deep-retrieve path has the LLM pick relevant
   summaries then expand. Long XDirect projects would benefit from
   semantic recall; serverless caveat for us — an in-lambda ONNX model
   is heavy, provider embeddings are the cheap equivalent.
5. **Chapter event graph before adaptation.** Novels are cleaned into
   per-chapter structured EVENT lists (concurrent extraction, per-row
   state machine), and script adaptation reads the event graph instead
   of raw long text. The right shape if Story-to-Video ever takes novel
   input.
6. **Caution, not pattern: vm2-sandboxed user-programmable providers.**
   Users write provider TypeScript in Settings, live-effective — great
   desktop UX, but vm2 is deprecated with known escapes; acceptable in a
   local app, never server-side. If XDev ever does bring-your-own
   provider, it needs real isolation.

### Market note

Third 短剧 factory at ~15k stars in one sweep (MPT 118k, huobao 14.4k,
Toonflow 14.9k) — the category is validated and crowded on the TOOL side.
All three still paste in API keys; none owns model quality data. Our
leverage stays the same: be the key (api funnel section above), and let
XDirect compete on voted model choice + real prices, which no desktop
tool can replicate.

## Pixelle-Video — https://github.com/ATH-MaaS/Pixelle-Video

Read 2026-08-30 (27.5k stars, Apache-2.0; originally AIDC-AI — Alibaba
International Digital Commerce — later moved orgs; last push June 2026,
activity cooled). Topic → narrated short where every visual is
AI-GENERATED (no stock): script → per-sentence image (optionally
animated) → TTS → HTML-template frames → compose. Python + Streamlit-ish
web UI; extension pipelines for digital human, image-to-video, motion
transfer. Its two ideas are the keepers:

### Learnings, ranked

1. **Typography belongs to CSS, not the image model.** Frames are HTML
   templates (24 designed layouts per aspect ratio — quote cards, book
   pages, neon, psychology cards…) rendered headless via Playwright; the
   AI image drops into a declared slot (`template:media-width/height`
   meta) and the narration text gets real typographic treatment in CSS.
   Content and layout are SEPARATED — no praying the image model renders
   text. For XCut: styled caption/frame templates the same way (on
   Vercel, satori/resvg or sharp-composited overlays rather than
   Playwright-in-lambda). This is how text-heavy genres (quotes,
   listicles, 養生/psychology shorts) become reliably producible.
2. **Workflow-as-model: a ComfyUI workflow JSON is a capability.** Node
   titles renamed to `$param` placeholders (`"title": "$prompt.text"`)
   make any workflow callable with injected params; files named
   `image_*.json` / `video_*.json` / `tts_*.json` register by prefix as
   swappable implementations — self-hosted ComfyUI or cloud GPU
   (RunningHub) alike. Infinite model coverage, zero integration code.
   For us: NOT for voted surfaces (BYO workflow breaks price/quality
   comparability, and the catalog stays hand-curated), but "bring your
   ComfyUI workflow as a private model" is a plausible XDev/XCreate
   power feature someday. The `$param` node-title convention is the
   right interface if we ever do it.
3. **Asset-based scripting (e-commerce DNA).** "Custom Media" pipeline:
   upload photos/videos → VLM analyzes each → the LLM writes the script
   AROUND your assets → compose. The explicit analyze-first-then-script
   ordering is the generalized form of our product-board flow; worth
   making first-class in XDirect when a user arrives with a folder of
   assets rather than a brief.
4. **Pipelines as pluggable classes** (Template Method lifecycle:
   standard / linear / asset-based / custom) — their digital-human and
   motion-transfer "features" are just subclasses. Code-level cousin of
   our recipes/templates.
5. **Small knob worth having:** script split mode (paragraph / line /
   sentence) as the user's pacing control for narrated content.
6. **Funnel, again:** the partnership here is cloud GPU time
   (RunningHub) rather than API keys — every tool in this category
   monetizes someone else's compute. Their "Direct Model APIs" settings
   accept custom base URLs → another app where /api/v1 slots in for
   text (media stays per-vendor adapters; consistent with "media compat
   later").

## Jellyfish — https://github.com/Forget-C/Jellyfish

Read 2026-08-30 (6.2k stars, Apache-2.0, React + FastAPI). AI short-drama
workspace whose whole identity is PREPARATION discipline: script →
structured breakdown → shot prep → generation. Smaller than the others;
two ideas stand out.

- **Candidate → confirm → ready state machine per shot.** Extraction
  produces asset and dialogue CANDIDATES; a human accepts / ignores /
  links each one, and a unified readiness state decides whether a shot
  may generate at all — with "prepared" explicitly distinct from
  "generating". That's our arm-the-scene-card gate philosophy, applied
  one stage earlier to ASSET BINDING. For Story-to-Video: a scene card
  shouldn't be armable while its cast/scene bindings are unconfirmed.
- **Costume as a fourth first-class entity** (characters / scenes /
  props / costumes). Outfit changes are the #1 identity-drift source in
  drama; separating who from what-they-wear makes wardrobe continuity
  checkable. huobao's entity graph + this = the full registry.
- Also: one task center across text/image/video jobs with context-aware
  navigation back to project/chapter/shot; an AGENTS.md in the repo root
  (written for AI coding agents — nice convention).

## waoowaoo — https://github.com/waooAI/waoowaoo

Read 2026-08-30 (13.9k stars, **CC BY-NC-SA — patterns only, no code**,
solo developer, beta). Novel → short drama / COMIC video. Notable
because the stack is the closest to ours in the whole sweep: Next.js 15
+ React 19 + Prisma/MySQL + Redis + BullMQ + MinIO.

- **A real queue layer.** BullMQ queues per modality (image / video /
  voice / text), attempts: 5 with exponential backoff, bounded
  completed/failed retention. Our XCreate jobs live inside one function
  invocation with client polling; when that outgrows function lifetime
  (batch drama episodes), per-modality queues + workers is the shape.
- **Remotion for composition** (React components as the timeline,
  browser-previewable before render). Heavier than XCut's raw ffmpeg
  but it buys live preview-as-you-edit; worth knowing the option exists
  if XCut ever needs interactive timeline preview beyond <video> tags.
- **Multi-character dubbing as first-class tasks**: VOICE_DESIGN (create
  a voice per character — we have designVoice in alibaba.ts, unused),
  VOICE_LINE (per-dialogue-line TTS), LIP_SYNC. The task taxonomy is a
  ready-made checklist for what a drama audio pipeline needs.
- **Asset Hub** — cross-project shared asset library (characters/voices
  reused between projects). Our profile shows per-surface work but
  nothing is reusable across boards.
- Cautionary tale: "database is not compatible between versions, run
  docker down -v to upgrade" in the README of a 13.9k-star project.
  Solo-dev velocity, user-hostile persistence. Our one-shared-Supabase
  + additive-migrations rule is the opposite bet — keep it.

## ViMax — https://github.com/HKUDS/ViMax

Read 2026-08-30 (12.2k stars, MIT, HKU Data Science lab, arXiv
2606.07649). Research-grade agentic video: 13 single-purpose agents
(screenwriter, storyboard artist, character extractor, novel compressor,
reference/best-image selectors, camera image generator…) behind
Idea2Video / Script2Video / Novel2Video pipelines, plus AutoCameo (a
real person from one photo kept consistent through a generated story).
The most technically principled repo in the sweep.

- **The camera position tree** — the best consistency mechanism seen
  anywhere in this sweep. An agent infers a containment hierarchy
  between camera setups (the wide shot's field of view CONTAINS the
  close-up's), and a new shot's first frame is derived from its PARENT
  camera's footage rather than generated fresh — so cutting wide →
  close keeps positions, eyelines and layout coherent. XDirect
  storyboards treat every shot as independent today; deriving related
  shots' first frames from a parent shot's frames is implementable with
  our existing image-edit pipeline.
- **Best-of-N with a VLM judge.** Generate several candidates per key
  image, then a judge agent scores character consistency (gender /
  age / facial features / hairstyle…), spatial consistency, and
  description accuracy against references, and picks one. Quality
  through selection — the internal-pipeline cousin of our blind-vote
  DNA, and cheap to add wherever XDirect generates stills.
- **A consistency benchmark we can borrow the shape of** (MIT): 35
  stories in three types — A: one subject across varied conditions,
  B: one location across shots, C: multi-person interactions. That
  taxonomy is exactly the missing structure for XEval's media plan
  (own tasks + human votes): score models on A/B/C consistency, not
  just single-clip prettiness.
- Practical touches: a trailing-comma-tolerant Pydantic JSON parser
  (they hit the same LLM-JSON pain our lib/json-schema.ts tolerant
  extractor solves), PySceneDetect for shot splitting, tenacity retries
  around every agent.
