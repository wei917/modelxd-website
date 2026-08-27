# CLAUDE.md — ModelXD Project Guide

> Last verified against the code on **2026-08-26** (branch `dev`).
> Companion docs: `docs/XEVAL-PAGE.md` — everything about the `/xeval`
> page and the eval pipeline behind it (read before touching XEval).
> `docs/STATE-2026-08-19.md` — a running snapshot of what
> changed recently and what is still open (incl. the UNPUSHED commit queue
> and the in-flight headline task). Read that second.

## What is ModelXD?

ModelXD (modelxd.com) is an AI model comparison platform. The core thesis:
**you're probably overpaying for AI**, and you can only discover that if the
price is hidden while you judge. Users run blind comparisons, vote on quality
*before* seeing cost, then vote again knowing cost. Those votes feed a public
rating system (XDRating) surfaced on XBoard.

## Tech Stack

- **Framework**: Next.js 16 App Router (React 18)
  - The Edge network gate is `proxy.ts` at the repo root — Next 16 renamed
    `middleware.ts` to `proxy.ts`. Same behavior, canonical name.
- **Hosting**: Vercel (2 cron jobs in `vercel.json`)
- **Database + Auth**: Supabase (PostgreSQL + Google OAuth + anonymous sessions)
- **Payments**: Stripe (credit top-ups)
- **AI Providers**: 7 direct integrations — OpenAI, Google, Alibaba DashScope,
  xAI, Anthropic, Runway, Moonshot
- **Styling**: CSS variables in `app/globals.css`, inline styles.
  **Light theme only** — see "Styling" for the dead-code caveat.
- **Fonts**: Barlow (body + display), JetBrains Mono (code/scores),
  Archivo Black (logo), Noto Sans TC (Chinese). CSS vars: `--font-body`,
  `--font-display`, `--font-mono`, `--font-logo`, `--font-zh`
- **i18n**: 5 languages via `lib/i18n.tsx` (en / zh-Hant / zh-Hans / ja / ko).
  Target markets are Taiwan and Japan. The product is **desktop-first**.

## Environments

- **Production**: `www.modelxd.com` (main branch)
- **Beta**: `dev.modelxd.com` (dev branch) — wears a BETA sticker in the Nav
  with an exit link to the official site. Detected by hostname at runtime
  (`h.startsWith('dev.') || localhost`), not env vars, because SSR must render
  identical markup on every host.
- **Both environments share ONE Supabase project.** A migration applied for
  dev is immediately live for production. Additive columns are safe;
  destructive ones are not.
- Migrations are run **by hand** by the owner in the Supabase SQL editor.
  Latest applied: `87_referrals.sql`.

## The Surfaces

Seven creation/consumption surfaces. The beta gates on XDirect, XTalk,
XGame and the canvas were REMOVED outright on Aug 18 (code and env vars,
not just `*`). XDev followed on Aug 24 — **no surface is email-gated any
more**, and the per-user feature system is gone with it.

| Surface | Route | Auth | Notes |
|---|---|---|---|
| **XDuel** | `/xduel` | required | Free front door. Daily quota per mode. |
| **XCreate** | `/xcreate` | required | Paid studio, up to 4 models. |
| **XTalk** | `/xtalk` | required | Discussion rooms. Open. |
| **XGame** | `/xgame` | required | AI game arena (Werewolf; more coming). Open. |
| **XVote** | `/xvote` | required | Judge other people's duels. |
| **XBoard** | `/xboard` | public | The leaderboard. |
| **XDirect** | `/xdirect` | required | The director + canvas stage. Open. |
| **XCut** | `/xcut` | required | The cutting room: rough-cut an XDirect board, trim, add music, burn subtitles, export an MP4. Open. |
| **XDev** | `/xdev` | required | API keys + MCP for agents. Open since Aug 24. |
| **XEval** | `/xeval` | public | Our benchmark lab: GDPval + Terminal-Bench 2.1 ladders with measured $/task. **See `docs/XEVAL-PAGE.md`.** |

### XDuel — `/xduel`
One prompt, two anonymous models, 5-step flow: run → vote blind → reveal
price → vote again → unmask identities and show savings. Free within a daily
per-mode quota (`lib/duel-quota.ts`). Text / image / video.
**No web search here by design** — it's meant to be a clean like-for-like test.

### XCreate — `/xcreate`
The paid studio. Up to 4 models side by side on the same prompt, plus recipes
(`image_to_video`, `reference_frames`, `start_end_frames`, `video_edit`).
Per-seat thinking level and web search toggle. Spends real credits.

Server shell (`page.tsx`) resolves feature flags before the client renders, so
gated entrances are correct on first paint and never flash for a user who
isn't entitled. All the actual UI is in `client.tsx`.

**The canvas board** (`WorkflowCanvas.tsx`)
is a ComfyUI-style node editor: source photos, generated angles, resulting
videos, wired together. Multi-select nodes to feed several images into one
generation — that's how a product-video pipeline gets built. Toggle between
`strip` and `canvas` views.

### XDirect — `/xdirect` (the director + canvas stage)
A real page since Aug 5: the director chat (`XDirectorChat`) beside the live
canvas board (`WorkflowCanvas`), two views of one entity — **the board id IS
the conversation id**. Describe what you want; the director picks a model
from live leaderboard scores, writes the prompt, generates through the normal
XCreate pipeline (billing, jobs, gallery — it can't bypass any of it), and
each output lands as a node on the board. `?q=<request>` prefills the
composer (never auto-sends — it spends credits); `?c=<id>` resumes a
conversation/board.

**Phase 2 shipped Aug 6 — storyboard-first video.** Every video request gets
a `set_storyboard` from the director before any generation: scene cards
(`SceneStrip.tsx`) render above the canvas — script, shot prompt, duration,
per-scene model + price — and the user edits them in place. Sequence lives
on the strip, derivation on the canvas; same stage, two grammars. Generation
stays explicit: ▶ on a card *arms* that scene id so the resulting
`start_generation(scene_id)` skips the plan bubble (the card was the confirm);
unarmed generations still hit the gate. The storyboard state lives on the
page, flows to the chat (which sends it as CURRENT STORYBOARD context — user
edits outrank the director's draft) and persists on
`xdirector_conversations.storyboard` (**migration 71 — pending until the
owner runs it; saves degrade gracefully to in-session until then**). Stills
keep the direct flow. The director runs Sonnet 5 (`XDIRECTOR_MODEL`
overrides). **Phase 3 (assembly) shipped as XCut** — `/xcut?from=<board>` is
the rough cut; the storyboard header's **Assemble film** button goes there.
The differentiator to protect: per-shot model choice with real prices from
votes, not editing chrome.

**Reference video (Aug 26).** The Music Video setup takes a public YouTube
link. `/api/xdirector/reference` is house-paid and runs two passes on it:
`gemini-3.1-flash-image` returns real **style frames** (pixels — they join
`committedRef` as ordinary `role:'style'` attachments, so `use_files` handles
them with no second code path), and `gemini-3.1-flash-lite` returns the
**cut rhythm** as text, because no still can carry time. Gemini is the only
provider that can be pointed at a URL — **Google fetches the video, we never
download it**, which is what keeps this inside YouTube's terms. Frames are
pinned to the chosen aspect: HappyHorse/Wan I2V take their output shape from
the first frame, so an unpinned still silently decides the video's ratio.
YouTube-URL input is **free in preview**, so the $0 video term in
`calcTextCost` is correct — see `docs/price-audit.md` before "fixing" it.
Style is borrowed; the reference's shots, performers and on-screen text are
not (enforced in the frame prompt and restated to the director).

**Cast placeholders.** A cast asset with `cast_source: 'ask'` renders
"👤 My photos" beside "✨ Create one" on the shelf instead of a bare ▶, so
the user picks before a face exists. It stays an OFFER — AI is one click,
nothing is gated. `cast_source` round-trips through the storyboard sanitiser
like `still_row_id`, so a later `set_storyboard` can't re-ask.

**Lip-sync exists** (H3 and Wan 3.0 `audio_to_video`) — the MV skill's SYNC
mode covers it. On BOTH models `first_frame` and `reference_audio` are
mutually exclusive (probed Aug 26: *"first_frame cannot be combined with
other media types except last_frame"*), so a sung take costs the pinned
frame. That is the provider's rule, not ours.

Entrances: nav item (beta-gated), omnibox row, the site agent
(`/xdirect?q=…`). Legacy `/xdirector` and `/xcreate?agent=1`/`?c=` all
forward here with query intact.

### XCut — `/xcut` (the cutting room)
Turns a board into a film. `?from=<board>` builds the ROUGH CUT of an XDirect
board (scenes in strip order, each shot scene trimmed to its card, unshot
scenes held on their key still, subtitles from the scripts); `?p=<project>`
opens a saved cut. Projects live in `xcut_projects` (migration 83).

- **Render** (`/api/xcut/render`) runs ffmpeg-static inside the function:
  every clip is scaled/padded to one size, concatenated, subtitles burned from
  a generated ASS file, audio mixed, encoded `libx264 -preset veryfast -crf 22`.
  Measured Aug 25: **71s of wall clock for a 59s film** (10 clips, 720p) — one
  vCPU, and the clips download one at a time.
- **Subtitles** need a CJK font on the server (`public/fonts/`); the ASS
  `Fontname` must match the font's real family name or libass silently draws
  nothing.
- **`maxDuration` is 800s but the route accepts 30-minute films** — anything
  past ~10 minutes is killed mid-render. Known, unfixed.
- Download and preview go through `GET /api/xcut/render?projectId=…&download=1`,
  which signs on demand and 302s. Never link `render.url` directly: it is a 24h
  signed URL and dies the next day (see Common Pitfalls).

### XTalk — `/xtalk`
Multi-model rooms. Two templates:
- **Discussion** — 2–8 models on a topic. Speaking order is in-order,
  auto-bid, or manual pick. Per-seat character. Bid mode runs a speaking-credit
  economy (`WALLET_START=6 / REGEN=2 / CAP=8`).
- **Werewolf** — fixed 7-player board (2 wolves, 1 seer, 1 doctor, 3
  villagers). Server-held state. Games get a permanent URL and appear in nav
  history.

### XVote — `/xvote`
Judge archived duels. Feeds the same ratings.

### XBoard — `/xboard`
Models ranked by XD Score. Filter by mode and sub-type. Separate pools exist
for search-enabled runs and for Werewolf.

## The Site Agent

`/api/agent/ask` + `content/site-guide.md`. Answers questions about the SITE —
what it is, where a feature lives, what it costs — and returns an optional
route so the UI can offer to take you there.

- **Claude Sonnet 5** (Haiku fallback), no tools, never generates, never bills the user.
  **The owner pays** (no `debitCredits` call), using `ANTHROPIC_API_KEY`.
- `content/site-guide.md` is its **only** knowledge of the product, read from
  disk per request (60s cache) so a product change ships by editing markdown
  rather than redeploying a prompt. **A stale line there becomes a confident
  wrong answer — update it when features move.**
- `route` is validated against a hardcoded allow-list (`ROUTES` in the route
  file), so a hallucinated path can never become a dead link in the UI.
- Answers in the reader's chosen site language, regardless of the question's
  language.
- Public + unauthenticated by necessity → in-memory rate limit (12/min/IP).
  **This is a floor, not a wall** — per serverless instance. Move to a shared
  store before real traffic.

Two front ends, one API:
- **`LandingAgent.tsx`** — the big dialog in the middle of the landing page.
  Fixed-height panel *above* the input so answering never reflows the page
  under a reader. The intro is the agent's real first turn, not a placeholder.
  Multi-turn, persisted in `sessionStorage` (per-tab, so Back returns you to
  your thread but a 3-day-old conversation doesn't reappear), with a
  Start-over button.
- **`Omnibox.tsx`** — ⌘K palette + sticky bar on app surfaces only (route
  allow-list; NOT on landing/marketing pages). Searches pages, models, your
  generations, your XTalk rooms. Never guesses search-vs-ask: the agent is an
  explicit pinned last row, so an ambiguous keystroke cannot spend money.

## Project Structure

```
app/
├── page.tsx                    # Landing page (marketing + LandingAgent)
├── layout.tsx                  # Root layout: fonts, LangProvider,
│                               #   AuthModalProvider, PageTitleProvider,
│                               #   Nav, Omnibox, GlobalCursor
├── globals.css                 # ALL styles — CSS variables, components
├── components/
│   ├── Nav.tsx                 # Left sidebar: links, XCreate/XTalk history,
│   │                           #   auth, beta sticker, mobile overlay
│   ├── Omnibox.tsx             # ⌘K palette + sticky search bar
│   ├── LandingAgent.tsx        # Landing-page agent dialog
│   ├── XDirectorChat.tsx       # The director chat (lives on /xdirect)
│   ├── WorkflowCanvas.tsx      # Node-graph board editor (canvas beta)
│   ├── SceneStrip.tsx          # Storyboard scene cards + ASSETS shelf
│   ├── XCutEditor.tsx / XCutLibrary.tsx   # The cutting room and its asset bin
│   ├── ModelPickerDialog.tsx   # Model picker (takes feature= for blocks)
│   ├── TemplatePicker.tsx      # XTalk / XCreate template chooser
│   ├── LabeledSlotsPicker.tsx  # Recipe input slots
│   ├── AuthModal.tsx           # Fullscreen login overlay (Google OAuth)
│   ├── AttachmentButton.tsx    # File upload for prompts
│   ├── GlobalCursor.tsx        # Default custom cursor for every page
│   └── ProviderLogo.tsx / ModeIcon.tsx / MatchResult.tsx
├── xduel/page.tsx              # XDuel 5-step flow
├── xduel/[id]/page.tsx         # Duel permalink
├── xcreate/page.tsx            # Server shell — resolves feature flags
├── xcreate/client.tsx          # The whole studio UI (large)
├── xcreate/templates.ts        # XCREATE_TEMPLATES
├── xtalk/page.tsx              # Room setup (Discussion / Werewolf)
├── xtalk/[id]/page.tsx         # Werewolf game permalink
├── xvote/page.tsx              # Community voting
├── xboard/page.tsx             # Leaderboard
├── xdirect/page.tsx            # XDirect server shell (auth/feature gate)
├── xdirect/client.tsx          # Chat rail + canvas stage (Phase 1)
├── xcut/page.tsx  xcut/client.tsx   # XCut: project list; ?p= / ?from= open a cut
├── xeval/page.tsx              # Benchmark ladders (see docs/XEVAL-PAGE.md)
├── xdirector/page.tsx          # Legacy redirect → /xdirect (keeps ?c=)
├── profile/page.tsx            # Balance, ledger, referral panel, and a tab
│                               #   per surface (XDuel/XCreate/XDirect/XCut/
│                               #   XTalk/XGame/XVote) — this is where users
│                               #   look for their own work, so every surface
│                               #   that makes something belongs here
├── admin/models/               # Admin catalog editor
├── methodology/page.tsx        # How XDRating works
├── coming-soon/page.tsx        # SITE_PASSWORD gate form
├── terms/ privacy/ feed/ login/ auth/
├── models/  vote/  duel/[id]/  # Legacy redirects (see below)
└── api/
    ├── agent/ask/              # Site agent (Claude Haiku)
    ├── xduel/{route,vote,quota,community-vote}
    ├── xcreate/{route,chat,node,inputs,source,job/[id],jobs/active}
    ├── xdirector/{route,conversation,transcribe,digest,reference,refs}
    ├── xtalk/{route,game,werewolf}
    ├── xboard/{route,werewolf}
    ├── xdrating/refit/         # Rating refit (cron every 5 min)
    ├── credits/ensure-daily/   # Locale/last-seen logging (see Credits)
    ├── stripe/{checkout,webhook}
    ├── features/               # Client-visible beta flags
    ├── skills/                 # Agent Skills listing
    ├── snapshot/  site-auth/
    ├── profile/{delete,delete-account,xcreates}
    ├── xcut/{projects,projects/[id],render,assets}
    ├── referral/{route,claim}  # code + status; claim attaches a signup
    ├── admin/{models,models/[id],test-model}
    ├── cron/sweep-orphans/     # Daily orphan cleanup
    └── dev/grant-credits/

lib/
├── providers/                  # 7 providers + router, pricing, call-log
├── xdrating.ts                 # Bradley-Terry rating pipeline
├── credits.ts                  # Wallet: grant/debit RPCs (server-only)
├── stripe.ts                   # Checkout + webhook helpers
├── features.ts                 # Per-user beta gating (email allowlist)
├── model-features.ts           # Per-surface model blocks (DB-driven)
├── admin.ts                    # getAdminUser() / assertAdmin()
├── models.ts                   # getModelsByMode (queries output_modalities)
├── board-nodes.ts              # useBoardNodes(boardId) — board → CanvasNode[]
├── skills.ts                   # Agent Skills loader (open spec)
├── i18n.tsx                    # 5-language string table + LangProvider
├── werewolf-engine.ts          # Game rules/state machine
├── werewolf-lang.ts            # Werewolf per-language strings
├── xdirector-prompt.ts         # Director system prompt
├── site-token.ts               # HMAC cookie for SITE_PASSWORD gate
├── duel-quota.ts               # Daily per-mode XDuel quotas
├── xcreate-discount.ts         # Pricing discount logic
├── referral.ts                 # Referral credits (server-only; see Referrals)
├── xcut-timeline.ts            # Timeline model, rough cut, ASS/SRT subtitles
├── xcut-render.ts              # ffmpeg arg builder + bundled-font lookup
├── xcut-media.ts / xcut-upload.ts   # Signing timeline media; resumable upload
├── pdf-extract.ts              # Server-side PDF text extraction
├── provider-errors.ts          # Provider error → user message mapping
├── attachment.ts  matchScore.ts  ime.ts
├── supabase-client.ts / supabase-server.ts
├── AuthModalContext.tsx  PageTitleContext.tsx  useRequireAuth.ts
└── ThemeContext.tsx            # DEAD CODE — not mounted anywhere

content/site-guide.md           # The site agent's entire product knowledge
proxy.ts                        # Edge gate (was middleware.ts pre-Next 16)
vercel.json                     # Cron schedules
docs/                           # Schema, API guides, state snapshots
scripts/                        # Read-only surveys + one-off helpers
supabase/                       # Numbered SQL migrations (01 → 70)
```

### Legacy redirects
- `/models` → `/xboard`
- `/vote` → `/xvote`
- `/duel/<id>` → `/xduel/<id>`
- `/xdirector` → `/xdirect` (preserves `?c=`/`?q=`)
- `/xcreate?agent=1` / `/xcreate?c=…` → `/xdirect` (client-side, query intact)

## Providers

Seven, all direct (`lib/providers/index.ts` routes on `model.provider`):

| Provider | File | Notes |
|---|---|---|
| `openai` | `openai.ts` | Responses API (streaming) for ALL text. Images API. Videos API (polling). |
| `google` | `google.ts` | `generateContentStream` from `@google/genai`. Image via `responseModalities`. |
| `alibaba` | `alibaba.ts` | DashScope. Text via `/compatible-mode/v1`, native API for image/video. |
| `xai` | `xai.ts` | Grok models. |
| `anthropic` | `anthropic.ts` | Messages API. Also powers the site agent + XDirector. |
| `runway` | `runway.ts` | Video generation. |
| `moonshot` | `moonshot.ts` | Kimi models. |
| `minimax` | `minimax.ts` | MiniMax H3 / Hailuo video (Global endpoint, async task pattern). |

### Native PDF handling
`PROVIDERS_WITH_NATIVE_PDF = {openai, google}`. A model takes the native path
only when it *also* declares `pdf_to_text` in its `modes`. Everything else
falls back to server-side extraction (`lib/pdf-extract.ts`), so **every** text
model handles PDFs — native is purely a fidelity upgrade. A PDF whose
estimated tokens exceed the provider's context window fails fast with a clear
message instead of a wasted upstream 400.

### OpenAI notes
- Text uses the **Responses API** (`/v1/responses`) with streaming, NOT Chat
  Completions. Some models only work with Responses.
- Stream events: `response.output_text.delta`, `response.completed`.

### Google notes
- `-preview` model IDs may change; check Google's deprecation page.
- Some Flash-Lite models don't support streaming.
- **Image multi-turn history is persisted as storage markers, not base64**
  (Aug 15). Gemini image editing replays a history whose parts inline every
  image (~1.5MB each) plus a ~700KB `thoughtSignature` per model turn;
  persisting that verbatim made `xcreates.slots` rows weigh 11-12MB and the
  board query run 15.6s. `lib/providers/history-storage.ts` swaps
  `inlineData` ↔ `{ storageImage: { bucket, path, mimeType } }` and big
  signatures ↔ `{ thoughtSignatureRef }` (signature objects live in
  `xcreate-user-images` — the ai-images bucket's mime allowlist rejects
  `text/plain`). The provider router rehydrates markers transparently before
  `google.generateImage`, so routes, DB, and the client only ever carry
  markers. Backfill for pre-Aug-15 fat rows:
  `npx tsx scripts/dehydrate-conversation-history.ts` (dry-run; `--apply`
  to write — owner runs it by hand, dev+prod share one Supabase project).

### Alibaba / DashScope notes
- Region: International (Singapore), `https://dashscope-intl.aliyuncs.com`
- **Full API guide: `docs/DASHSCOPE-API-GUIDE.md`**
- Image size format uses an asterisk: `1024*1024` (not `1024x1024`)
- Image responses contain a temporary URL (expires 24h) — download immediately
- Video is an async task pattern (create → poll) with `X-DashScope-Async: enable`

## Database: ai_models

Hand-curated. **The table is the single source of truth** — no sync scripts,
no cron, no scraping. See `docs/ai_models-schema.md` for the canonical column
list and jsonb shapes.

Key columns:
- `provider` — one of the seven above
- `model_name` — exact API string; unique together with `provider`
- `display_name` (no nickname column — verified Aug 13)
- `input_modalities` / `output_modalities` — `['text'|'image'|'video']`
- `model_pricing` — jsonb; text rates live at `tokens.text_input` /
  `tokens.text_output` / `tokens.cached_input` (per 1M; `text_output` may
  be a `{ default, by_level }` object), media rates under their own keys.
  There are NO flat `input_price`/`output_price` columns — verified Aug 6.
- `modes` — text[] of input-shape patterns (`text_to_video`, `image_to_video`,
  `start_end_frames`, `pdf_to_text`, …). A **set**, not a single value.
- `input_config` / `output_config` — jsonb per-modality options
- `blocked_features` — text[] of surfaces this model must NOT be offered for
- `released_at`, `tags`, `is_popular`, `enabled`

**IMPORTANT**: `getModelsByMode()` queries `output_modalities`. A model with
`input_modalities: ['text','image']` and `output_modalities: ['text']` is a
text model that can *see* images — NOT an image generator.

### Per-feature model availability

`ai_models.blocked_features` + `lib/model-features.ts`. Keys in use:
`xtalk_werewolf`, `xtalk_discussion`, `xduel`, `xcreate`.

Enforced in three places so a stale tab cannot slip past: the picker
(`ModelPickerDialog` takes `feature=`), the surface's own model list
(`allowedFor(models, FEATURE.x)`), and the API. **Werewolf's create route
REFUSES rather than filtering** — silently seating 6 at a 7-seat table deals
the wrong board.

Current rule: **Kimi K3 is blocked from Werewolf** (~26 tok/s with a large
default reasoning budget, measured 75s+/turn against the 90s ceiling; its
timeouts were changing who got lynched). Still available everywhere else.

Blocking a model is a **data change, not a deploy**:
```sql
update ai_models set blocked_features = blocked_features || '{xtalk_discussion}'
 where model_name = 'some-model';
```
NOTE: Discussion's picker does not yet pass a `feature` key — an
`xtalk_discussion` block wouldn't be enforced until that one line is wired.

## XDRating (rating pipeline)

`lib/xdrating.ts` + `docs/xdrating-pipeline.md`. Bradley-Terry MLE,
`BASE_RATING = 1000`, `PRIOR_MATCHES = 2`, 50 iterations,
`rating = 1000 + 400·log10(strength)`.

**XD Score** = `quality × 0.4 + value × 0.4 + stickiness × 0.2`, where
stickiness is mapped `600 + rate × 800`. Quality = blind vote (vote1),
Value = price-aware vote (vote2), Stickiness = retention rate.

Pools partition `model_ratings` / `model_pairwise_wins` / `model_vote_stats`
by mode:
- `MODES = text | image | video`, plus aggregate `all`
- `SEARCH_MODES = text_search` — search-on runs only (mixed-search runs
  contribute to neither pool)
- `GAME_MODES = werewolf` — quality-only (no value/stickiness), team outcome
  decomposed into winner×loser pairwise events. **Excluded from `all`** —
  social deduction is not the skill the duels measure.

Data flow: votes → DB triggers → aggregate tables → `/api/xdrating/refit`
(cron every 5 min) → `model_ratings` snapshot → `/api/xboard` thin indexed
read. If the snapshot is empty or the table doesn't exist, `/api/xboard` falls
back to a full-scan live computation so XBoard never blanks.

## Credits & Payments

Wallet system in `supabase/11_credits.sql`, typed helpers in `lib/credits.ts`
(**server-only** — uses the service-role key to call `grant_credits` /
`debit_credits` RPCs). Client code reads `user_credits` /
`credit_transactions` directly via the browser client; owner-read RLS
guarantees users only see their own rows.

- **Welcome credit: $10** for new verified Google signups, written from the
  `handle_new_user` trigger (`68_welcome_credit.sql`). Anonymous sessions get
  $0. **Not backfilled** — only accounts created after the migration.
- **The daily $1 grant was removed** (July 20). Free XDuels are the free tier.
  `/api/credits/ensure-daily` survives for locale/last-seen analytics only —
  it upserts the user's language and Vercel geo country onto `profiles`.
- Top-ups via Stripe (`/api/stripe/checkout` + `/api/stripe/webhook`).
- The Profile activity ledger groups charges **by session** — a whole Werewolf
  game, or a generation plus its follow-ups, is one expandable row.

### Referrals (migration 87, Aug 25)

`lib/referral.ts` + `/api/referral` + the panel on `/profile`.

- Any new user gets **$10** (the existing welcome credit, no card).
- A **referred** user gets **+$5** and the **referrer $5**, both released when
  the referred user verifies a payment card.
- Verification is a Stripe Checkout session in **`mode: 'setup'`** — the card is
  validated and **never charged**, no Stripe fee.

**The card is the point.** Google's `email_verified` proves someone controls a
Google account, not that they are a distinct person (Gmail is free; a domain
owner gets ~50 free Cloud Identity accounts), and phone verification never
appears in the OAuth token. A Stripe `card.fingerprint` is the same string for
the same physical card across every account, so *one card, one referral* is
enforceable — by a partial unique index on paid rows plus `payment_fingerprints`,
so a card first seen on an ordinary account still counts as used.

The $10 stays card-free deliberately: a referral link must always be an
upgrade, never a demand for a card. Gating the whole $15 would make the link
worse than signing up directly.

- **Credits are granted only in the Stripe webhook**, never from a
  client-callable route — a route that can pay a referral can pay its caller.
  The webhook branches on `session.mode === 'setup'`.
- **No cap** on referrals (a celebrity bringing 1,000 real users is the win);
  a weekly threshold logs an alert instead.
- `?ref=CODE` is parked in localStorage by `Nav.tsx` and spent after sign-in —
  Google's OAuth round-trip drops query params.
- Accepted: one person with one card and two Google accounts collects the pair
  ONCE ($30, not $10). Not repeatable, and stopping it would mean asking every
  referrer for a card.

## Feature Gating

Three independent systems — don't confuse them.

**1. Per-user beta gates — GONE (Aug 24).** `lib/features.ts` and
`/api/features` were deleted when XDev opened; the canvas/xdirector/xtalk
gates had already gone on Aug 18. Every surface is now public or auth-only.
`ADMIN_EMAILS` still exists, but only for `/admin/*` (see Admin).

> If a new beta ever needs a gate, do NOT resurrect a client flag that pages
> read to decide whether to render. Twice now a flag outlived the API that
> supplied it and silently hid working features from everyone: the profile's
> XDirect/XTalk/XGame tabs and XDuel's Game chip both vanished for six days
> in August because they were gated on keys `/api/features` had stopped
> returning. Gate server-side, fail loudly, and delete the gate the day the
> beta ends.

**2. Per-surface model blocks** (`lib/model-features.ts`) — see the ai_models
section above. Data-driven, no deploy.

**3. Whole-site password gate** (`proxy.ts` + `lib/site-token.ts`) — if
`SITE_PASSWORD` is set, `modelxd.com` / `www.modelxd.com` require an HMAC
cookie or get redirected to `/coming-soon`. localhost, `dev.modelxd.com`, and
Vercel preview URLs always pass through. Unset = gate disabled (the default
locally). The cookie never contains the password; the password *is* the HMAC
secret, so rotating it invalidates every cookie — which is correct.

## Agent Skills

`lib/skills.ts` reads the **open** Agent Skills format
(agentskills.io/specification) — a directory containing `SKILL.md` with YAML
frontmatter — rather than a bespoke format, so a director skill authored in
Claude Code or Codex drops in unchanged, and ours travel back out. The
frontmatter parser is hand-rolled on purpose: the spec's field set is tiny and
the format's whole selling point is needing no runtime or build step.

**SECURITY**: skill bodies are UNTRUSTED TEXT. A skill can shape style and
craft; it must never override pricing honesty, model selection, or refusals.
See `wrapSkillForPrompt()`. Nothing under `scripts/` is ever executed.

## Provider Call Logging

Every AI invocation produces **two rows** in `provider_calls`, paired by
`request_id`: a `start` event when the call goes out and an `end` event when
it returns. Both are inserted by the `log-provider-call` Supabase Edge
Function, called fire-and-forget from `lib/providers/index.ts` — zero added
latency, and logging never blocks or fails the user-facing request.

**Why two rows?** Append-only event log: no UPDATE path means no race. If the
end POST is dropped (Vercel freezing a non-streaming Lambda after the response
closes), the start row survives as a breadcrumb that the request happened.

`startCall(descriptor)` returns a `request_id` immediately; `endCall()` adds
`status`, `latency_ms`, `error_message?`, tokens, and `cost_usd`. Descriptors
are duplicated on the end row so analytics queries need no self-join.

Route handlers pass `{ userId }` explicitly to `streamText` / `generateImage` /
`generateVideo`. Calls without context log `user_id: null`.

Tokens/cost: text pulls from `TextStreamCallbacks.onDone` (all providers
populate these); image/video record `cost` only — token columns stay null
because those providers don't surface usage uniformly.

Deploy: `supabase functions deploy log-provider-call`. Run
`supabase/23_provider_calls.sql` first.

```sql
-- Orphan starts (request began but no end recorded)
select s.request_id, s.provider, s.model_name, s.created_at
from provider_calls s
where s.event='start'
  and not exists (select 1 from provider_calls e
                  where e.request_id = s.request_id and e.event='end')
  and s.created_at < now() - interval '10 minutes';

-- Success rate per provider+model, last 24h
select provider, model_name,
       count(*) filter (where status='success') as ok,
       count(*) filter (where status='failed')  as fail,
       round(avg(latency_ms))                   as avg_ms
from provider_calls
where event='end' and created_at > now() - interval '24 hours'
group by 1,2 order by ok+fail desc;
```

## Admin

Hidden catalog editor at **`/admin/models`**. Email allowlist (`ADMIN_EMAILS`)
on top of the normal Google OAuth login; anyone else is redirected to `/`.
`lib/admin.ts` provides `getAdminUser()` (server components) and
`assertAdmin()` (API routes). Both admin API routes call `assertAdmin()` first
— **never trust client-side flags for admin gating.**

UI (`app/admin/models/AdminModelsClient.tsx`): filterable table of every
`ai_models` row, inline `enabled` toggle, edit/delete per row, "+ Add model".
The form auto-shows the right pricing section based on the `output_modalities`
checkboxes. Saves go through `POST /api/admin/models`, which upserts by
`(provider, model_name)` and returns the canonical row. `model_name` is locked
on edit so you can't rename into another row's identity.

`/api/admin/test-model` runs a live smoke test against a single model.

Workflow: edit a row → Save → it's live. No deploy, no commit, no script.

### Why hand-curation

The Playwright-scraping + API-discovery infrastructure was removed in May 2026.
Pricing is small data (~50–60 rows, changing a handful of times per quarter);
no major provider exposes a pricing API, so scrapers broke on doc-page
restructures and produced *silently wrong prices on the leaderboard*; and
decisions like "which qwen variants to surface" are judgment calls a scraper
can't make.

For a backup snapshot before a big edit pass: `npx tsx scripts/survey-models.ts`.

## Styling

- **Light theme only.** CSS variables in `:root` of `globals.css`.
- Core vars: `--bg`, `--surface`, `--surface2`, `--border`, `--border2`,
  `--white`, `--muted`, `--muted2`, `--red`, `--blue`, `--green` (+ `-dim` /
  `-glow` variants)
- Provider identity colors: `--provider-openai`, `--provider-google`,
  `--provider-anthropic`, `--provider-alibaba`, `--provider-xai`
- XD Score heatmap: `--score-poor` → `--score-elite` (5 stops)
- **DO NOT** hardcode dark colors (`#080808`, `#0d0d0d`, …) — always use vars.
- `lib/ThemeContext.tsx` exists but is **dead code**: it is not mounted in
  `layout.tsx`, and `globals.css` has no `[data-theme]` blocks. Either wire it
  up properly or delete it — don't assume dark mode works because the file is
  there.

## Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx

# Providers
OPENAI_API_KEY=sk-xxx
GOOGLE_AI_API_KEY=xxx
DASHSCOPE_API_KEY=sk-xxx
DASHSCOPE_BASE_URL=                   # optional; defaults to dashscope-intl
ANTHROPIC_API_KEY=sk-ant-xxx          # site agent + XDirector + Claude models
XAI_API_KEY=xxx
MOONSHOT_API_KEY=xxx
RUNWAYML_API_SECRET=xxx
MINIMAX_API_KEY=                      # api.minimax.io (Global) — H3 video; unset = MiniMax rows stay unusable

# Payments
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Music (XTalk/Characters room player — YouTube embeds, full songs)
YOUTUBE_API_KEY=                      # Google Cloud → enable YouTube Data API v3
                                      #   → API key; unset = link-out cards only.
                                      # Spotify was tried and dropped (Aug 13):
                                      # their policy walls (owner+listener
                                      # Premium, 5-user dev cap, 250K-MAU quota
                                      # review) block agent-played full songs.

# Access control
ADMIN_EMAILS=wei917@gmail.com         # comma-separated; passes every gate
# (no FEATURE_* vars any more — the last beta gate, XDev, opened Aug 24)
SITE_PASSWORD=                        # unset = site gate disabled

# Ops / tuning
CRON_SECRET=                          # guards /api/cron/* and refit
SITE_AGENT_MODEL=                     # override the site agent's model
XDIRECTOR_MODEL=                      # override the director's model
XCREATE_MOCK=                         # dev: fake generations, no spend
```

## Dev Commands

```bash
npm install
npm run dev              # local dev server on :3000
npm run build            # production build
npx tsc --noEmit         # type check — run before packaging
```

## Common Pitfalls

1. **Model picked for wrong mode** — check `output_modalities`, not `modes` or
   `tags`. "Vision" = can *see* images, not generate them.
2. **New model not surfacing** — `ai_models` is hand-edited at `/admin/models`.
   Also check `enabled` and `blocked_features`.
3. **Scientific notation in prices** — always `toFixed()`, never
   `toExponential()`. Prices are per 1M tokens.
4. **Image duel shows a broken image** — if a delta has `isImage: true` but no
   `text`, show a loading state; don't render `<img src="">`.
5. **Supabase `getPublicUrl` returns undefined** — use `data?.publicUrl` with a
   fallback URL construction.
6. **OAuth redirect goes to the wrong domain** — `redirectTo` must be clean (no
   query params). Supabase OAuth strips query params; the `auth_redirect`
   cookie is the workaround.
7. **Editing `middleware.ts`** — it's `proxy.ts` now (Next.js 16).
8. **A migration "just for dev"** — dev and prod share one Supabase project.
   There is no such thing.
9. **Supabase auth lock contention** — `supabase-js` serializes auth through a
   `navigator.locks` lock shared across tabs. Background tabs polling every 5s
   can steal the lock from a freshly loading tab hard enough to crash
   hydration. Gate polling on `!document.hidden` (see `Nav.tsx`).
10. **Hooks before early returns** — `Nav.tsx` returns `null` on
    `/coming-soon`; that return must stay below every hook or React throws
    "Rendered fewer hooks than expected".
11. **A stored signed URL is dead in 24 hours.** Every generated file lives
    behind a Supabase signed URL with a 24h TTL, and we persist those URLs into
    long-lived rows. Three bugs came from this in one day (Aug 24): XDirect
    asset thumbnails (`still_url` was never re-signed), and XCut's download and
    preview links (`render.url` persisted at export). Symptom on the wire is
    `"exp" claim timestamp check failed`. Fix by signing on demand behind our
    own route, not by re-signing at every read site — the read sites that
    forget fail silently.
12. **`download` on a cross-origin link does nothing on mobile Chrome.** The
    attribute is ignored cross-origin, so the browser opens the file instead of
    saving it. Supabase turns `?download=<name>` into a Content-Disposition
    attachment — that is the only reliable path (XCut export, XDuel lightboxes).
13. **A judge/rating query joining on `effort` must use `is`, not `=`.** The
    human-baseline entry has `effort = NULL`, and `NULL = NULL` is false in SQL,
    so it was silently dropped from every fit.
14. **Stale `.git/index.lock`** — git writes through the device bridge leave a
    lock that can't be unlinked. Run git from a real terminal;
    `rm .git/index.lock` if a commit fails with "Another git process seems to
    be running."

## XTalk Werewolf Specifics

The server holds the game (`app/api/xtalk/werewolf/route.ts`); the client knows
nothing and renders only what comes back — that is the **only** reason a human
can sit at the table honestly. One act per request; the client loops.

- Night order is wolf → seer → doctor → dawn, so the doctor acts **after** the
  wolves have chosen; a correct protect produces a quiet morning.
- Every living player speaks once per day in a rotating `turn_order`. There is
  **no speaking-credit economy here** — that exists only in Discussion's bid
  mode.
- Per-model timeout is **90s** (`MODEL_TIMEOUT_MS`), one retry for an empty
  reply, no retry after a timeout. Timeouts become visible ⚠ abstentions,
  never silent skips.
- **`askModel()` field extraction is a SECURITY boundary**: a reply that looks
  structured but yields no clean field is DROPPED, never printed raw — the raw
  text contains the model's private `reasoning`. (A human doctor once saw a
  wolf's whole plan through this path.)
- The same model may take several chairs; duplicates get "name (2)", "name (3)".

## Decisions Taken (don't re-litigate without new information)

- **Apple + LINE sign-in: dropped.** Desktop OS share in TW/JP is ~81%/76%
  Windows, so the iPhone-majority argument doesn't apply to a desktop product.
  Sign in with Apple on Windows is worse than Google and costs $99/yr plus a
  6-month secret rotation. If a mobile push ever happens, LINE is the
  higher-value one for these markets (~94% penetration in TW) and needs a
  custom OAuth bridge — Supabase has no LINE provider.
- **Werewolf ratings stay out of `all`.**
- **HappyHorse 1.0 ranks above 1.1** and that is not a bug: 1.0 follows prompt
  instructions (e.g. shallow DoF) more faithfully, while 1.1 optimises for
  scene detail and runs slower for the same price.
- **Catalog stays hand-curated.** See "Why hand-curation".
- **No Studio/Agent toggle in XCreate.** Superseded Aug 5: the director got
  its own page (`/xdirect`) once it owned a stage — "a mode, not a
  destination" was true only while it was a bare chat. XCreate remains the
  single studio surface; the toggle itself stays gone.
- **Landing savings figures** — developers ~$7,800/mo at 1B tokens (volume
  raised 500M → 1B on owner call, Aug 18; per-token logic unchanged from the
  Aug 5 re-derivation); "FOR AI USERS" ~$176/mo on 100 video clips (Veo 3.1
  $0.40/s vs HappyHorse 1.1 $0.18/s, 8s clips). Derivations are in comments
  in `app/page.tsx` — **re-derive before changing any number.**
- **Landing hero, Aug 25** (current): eyebrow "AI apps that run winning
  models", headline "The best AI for every task.", sub "Films, stories,
  analysis, chats, gaming, benchmarks, or bring your own agents. ModelXD sends
  each job to whichever model earns it, decided by real blind votes and public
  benchmark data, with the prices in the open." No model count in the copy so
  it cannot go stale, and **no em dashes** — they read as machine-written
  (owner, Aug 25; the 9 landing-visible i18n keys were swept too).
- **Landing repositioned Aug 18** (owner: "not a blind test website
  anymore"): hero sells the APPS ("Make real things with every AI model"),
  the apps grid is the star section (template cards wear real generated
  loops), primary CTA → /xdirect, blind testing demoted to secondary CTA
  and trust layer.

## Known Debt (open)

1. **Site-agent rate limiting is per-instance.** Move to a shared store before
   real public traffic.
2. **Discussion's picker doesn't pass a `feature` key**, so
   `xtalk_discussion` blocks aren't enforced there yet. One line.
3. **XBoard is badly broken in mobile portrait** — the table has
   `minWidth: 820/830`, ~640px of overflow at 390px. XCreate/Profile are fine;
   XTalk and home are ~10–15px out. Desktop-first, so this is deliberate debt.
4. **XTalk attachments** are still not accepted by `/api/xtalk`.
5. **`lib/ThemeContext.tsx` is dead code** — wire it up or delete it.
6. **Owner has TWO account ids — SOLVED (Aug 6):** they are two real Google
   accounts, `wei917@gmail.com` (`247efcdb…`) and `founder@modelxd.com`
   (`c9a73e58…`), signed into different browsers. Not anonymous-auth
   rotation. Consequence stands: history, boards and credits don't cross
   between them — decide whether to consolidate or live with it.
7. **Naming**: `/methodology` calls the system **XDRating** and links to
   `/xboard`, which is titled **XBoard**. The system/page split is intentional
   but reads oddly; nobody has decided whether to unify them.

## Packaging Convention

```bash
cd /path/to/project
rm -rf .next node_modules package-lock.json tsconfig.tsbuildinfo
zip -r modelxd.zip . -x "*.git*" -x ".DS_Store"
```
Files start at `app/`, `lib/`, etc. — no wrapper folder.
