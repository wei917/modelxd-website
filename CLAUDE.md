# CLAUDE.md — ModelXD Project Guide

## What is ModelXD?

ModelXD (modelxd.com) is an AI model comparison platform. Users run "duels" between AI models — they enter a prompt, two random models respond blindly, the user votes on which is better, then prices and model identities are revealed. The core thesis: you're probably overpaying for AI, and ModelXD proves it with community-validated blind tests.

## Tech Stack

- **Framework**: Next.js 14 App Router (React 18)
- **Hosting**: Vercel
- **Database + Auth**: Supabase (PostgreSQL + Google OAuth)
- **AI Providers**: OpenAI API, Google Gemini API, Alibaba DashScope API
- **Styling**: CSS variables in `app/globals.css`, inline styles. Light theme only (no dark mode).
- **Fonts**: Barlow (body/UI), Barlow Condensed (display headings), JetBrains Mono (code/scores). CSS vars: `--font-body`, `--font-display`, `--font-mono`

## Environments

- **Production**: `www.modelxd.com` (main branch)
- **Preview**: `dev.modelxd.com` (dev branch)
- Vercel deployment protection is on for dev — use production URL for testing endpoints directly, or access dev through Vercel dashboard.

## Project Structure

```
app/
├── page.tsx                    # Landing page (marketing)
├── layout.tsx                  # Root layout (fonts, AuthModalProvider)
├── globals.css                 # ALL styles — CSS variables, components
├── components/
│   ├── Nav.tsx                 # Top nav bar — auth-gated links, login button
│   ├── AuthModal.tsx           # Fullscreen login overlay (Google OAuth)
│   └── AttachmentButton.tsx    # File upload for prompts
├── xduel/page.tsx              # XDuel — the core 5-step blind comparison flow
├── vote/page.tsx               # XVote — vote on archived duels (route stays /vote, branded as XVote)
├── xcreate/page.tsx            # XCreate — multi-model prompt runner (text/image/video)
├── leaderboard/page.tsx        # Unified Leaderboard — catalog + XD rankings
├── feed/page.tsx               # Public duel feed
├── profile/page.tsx            # User profile + duel history
├── profile/[userId]/page.tsx   # Public profile view
├── duel/[id]/page.tsx          # Individual duel permalink
├── models/page.tsx             # Redirect to /leaderboard (legacy URL)
├── methodology/page.tsx        # How XD scoring works
├── auth/callback/route.ts      # OAuth callback — exchanges code, reads auth_redirect cookie
├── login/                      # Login page (legacy, AuthModal is primary)
├── admin/models/               # Admin-only catalog editor — table + form for ai_models
└── api/
    ├── duel/route.ts           # POST — runs XDuel (picks random models, streams SSE)
    ├── duel/vote/route.ts      # POST — saves vote1/vote2 to DB
    ├── leaderboard/route.ts    # GET — Bradley-Terry MLE ratings from duel/xcreate votes
    ├── xcreate/route.ts        # POST — single-shot multi-model generation
    ├── xcreate/chat/route.ts   # POST — chat continuation (SSE streaming)
    ├── admin/models/route.ts          # POST — admin upsert ai_models row
    ├── admin/models/[id]/route.ts     # DELETE — admin delete ai_models row
    └── dev/grant-credits/route.ts     # Dev-only: top up a user's credit balance

lib/
├── admin.ts                    # getAdminUser() / assertAdmin() — email allowlist
├── models.ts                   # DB queries: getModelsByMode (uses output_modalities)
├── providers/
│   ├── types.ts                # ModelInfo, TextResult, ImageResult, VideoResult interfaces
│   ├── pricing.ts              # calcTextCost / calcImageCost / calcVideoCost / headlinePrice
│   ├── index.ts                # Provider router: dispatches to correct provider
│   ├── openai.ts               # OpenAI: text (Responses API streaming), image
│   ├── google.ts               # Google: text (generateContentStream), image
│   ├── alibaba.ts              # Alibaba DashScope: text, image, video
│   └── log.ts                  # Logging helper (strips binary data)
├── supabase-client.ts          # Browser Supabase client
├── supabase-server.ts          # Server Supabase client
├── AuthModalContext.tsx         # React context for auth modal (show/hide with nextPath)
├── useRequireAuth.ts           # Hook: shows auth modal if not logged in
└── attachment.ts               # Process uploaded files for AI providers

scripts/
├── survey-models.ts            # Read-only DB survey: per-row flags for cleanup
├── survey-columns.ts           # Read-only DB survey: per-column null/empty/distinct counts
└── migrate-storage-paths.ts    # One-off storage-bucket reorg helper

supabase/
├── 01_models.sql               # SCHEMA ONLY — modality columns. No INSERTs.
│                               # Models are managed via /admin/models.
├── 02_duels.sql                # duels table
├── 03_xcreates.sql             # xcreates table
├── 04_attachments.sql          # attachments table
├── 05_profiles.sql             # profiles + activity_logs tables
├── 23_provider_calls.sql       # provider_calls table (telemetry for every AI call)
├── 24..27_*.sql                # ai_models schema evolution: drop redundant cols,
│                               # consolidate pricing jsonbs, rename name→display_name
├── functions/log-provider-call # Supabase Edge Function — writes provider_calls rows
└── storage.sql                 # Storage buckets (xduel-ai-images, xduel-ai-videos, etc.)
```

## Key Flows

### XDuel Flow (app/xduel/page.tsx + app/api/duel/route.ts)
1. User enters prompt, picks mode (text/image/video), picks model count (2-4)
2. API picks N random models from `ai_models` where `output_modalities` contains the mode
3. Models run in parallel, streaming results via SSE
4. **Step 2 (Vote)**: User votes blind (doesn't know which model is which)
5. **Step 3 (Reveal Price)**: Prices shown on each card — green for cheapest, red for expensive
6. **Step 4 (Vote Again)**: User votes again knowing the prices
7. **Step 5 (Reveal)**: Model identities unmasked, savings calculated

### Auth Flow
- Protected pages (XDuel, Vote, Create) require login
- Nav links for protected pages show auth modal when clicked by logged-out users
- Landing page "Start XDuel" button checks auth, shows modal if needed
- Auth modal triggers Google OAuth → callback reads `auth_redirect` cookie → redirects to intended page
- Cookie-based redirect because Supabase OAuth strips query params from redirectTo

## Database: ai_models Table

Key columns:
- `provider`: 'openai' | 'google' | 'alibaba' (xAI and OpenRouter removed — all models are direct-provider now)
- `released_at`: timestamp — when the model was released. Hand-entered through `/admin/models`.
- `model_name`: exact API string (e.g., 'gpt-5.4', 'gemini-3.1-pro-preview')
- `name`: display name
- `input_modalities`: what the model accepts ['text', 'image', 'video']
- `output_modalities`: what the model generates ['text'] | ['image'] | ['video']
- `input_price` / `output_price`: per 1M tokens (for text models)
- `cached_input_price`: per 1M cached input tokens (OpenAI/Google)
- `image_pricing`: jsonb `{ rates: {...} }` — per-quality prices (e.g. `{"medium": 0.034}`)
- `video_pricing`: jsonb `{ rates: {...} }` — per-resolution per-second rates (e.g. `{"720p": 0.10}`)
- `modes`: text[] — input-shape patterns this model supports (set, not single). e.g. `['text_to_video', 'image_to_video', 'video_to_video', 'start_end_frames']` for Veo 3. The XCreate UI shows a mode picker from this set; the user's choice determines slot rendering.
- `input_config`: jsonb — per-modality count override + capability flags (only when `mode` doesn't fully imply them). Optional.
- `output_config`: jsonb — per-modality output options (sizes, aspect ratios, durations, capability flags). Optional.
- `tags`: small free-form set ('vision', 'reasoning', etc.)
- `is_popular`: powers the POPULAR badge
- `enabled`: only enabled models are picked for duels

**IMPORTANT**: `getModelsByMode()` queries `output_modalities` to pick models for duels. A model with `input_modalities: ['text','image']` and `output_modalities: ['text']` is a text model that can see images — NOT an image generator.

**Schema reference**: see `docs/ai_models-schema.md` for the canonical column list, jsonb shapes, and example rows.

**Population**: rows are managed by hand through the admin UI at **`/admin/models`**. There are no automated sync scripts in the repo — the previous Playwright-scraping + API-discovery infrastructure was removed in May 2026 in favor of hand-curation. See the "Admin" section below.

## OpenAI Provider Notes

- **Text**: Uses Responses API (`/v1/responses`) with streaming for ALL models. NOT Chat Completions.
- Stream events: `response.output_text.delta` for text chunks, `response.completed` for usage/tokens
- Some models like `gpt-5.4-pro` ONLY work with Responses API (not Chat Completions)
- **Image**: Uses Images API (`images.generate` / `images.edit`). Quality hardcoded to 'medium'.
- **Video**: Uses Videos API (polling-based). Sora 2 models deprecated Sep 2026.
- **Catalog management**: rows in `ai_models` are managed manually via `/admin/models`.

## Google Provider Notes

- **Text**: Uses `generateContentStream` from `@google/genai` SDK
- **Image**: Uses `generateContent` with `responseModalities: ['IMAGE', 'TEXT']`
- `gemini-3-pro-image-preview` and `gemini-3.1-flash-image-preview` are the image models
- Models ending in `-preview` may change. Check Google's deprecation page.
- `gemini-2.5-flash-lite` does NOT support streaming — only basic text output
- **Catalog management**: rows in `ai_models` are managed manually via `/admin/models`.

## Styling

- Light theme only. CSS variables defined in `:root` of `globals.css`.
- Key variables: `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--white`, `--muted`, `--muted2`, `--red`, `--green`
- Nav: solid white `#ffffff` background
- **DO NOT** use hardcoded dark colors (`#080808`, `#0d0d0d`, `#1a1a1a`, etc.) — always use CSS variables
- No noise overlay, no scanlines, no decorative hero lines

## Common Pitfalls

1. **Image duel shows broken image**: If delta event has `isImage: true` but no `text`, don't render `<img src="">`. Show loading state instead.
2. **Supabase `getPublicUrl` returns undefined**: Use `data?.publicUrl` with fallback URL construction.
3. **OAuth redirect goes to wrong domain**: `redirectTo` must be clean (no query params). Use `auth_redirect` cookie for post-login destination.
4. **Model picked for wrong mode**: Check `output_modalities`, not `modes` or `tags`. "Vision" = can see images, not generate them.
5. **Scientific notation in prices**: Always use `toFixed()`, never `toExponential()`. Prices per 1M tokens.
6. **Supabase OAuth strips query params**: Known limitation. Cookie-based redirect is the workaround.
7. **New model not surfacing**: rows in `ai_models` are managed by hand at `/admin/models`. Add the new model there. The table is the single source of truth — no sync scripts, no cron, no scraping.

## Alibaba / DashScope Provider Notes

- **Region:** International (Singapore). Base URL: `https://dashscope-intl.aliyuncs.com`
- **Full API guide:** `docs/DASHSCOPE-API-GUIDE.md`
- **Text**: Direct via `/compatible-mode/v1/chat/completions` (OpenAI-compatible, streaming). Models: `qwen3-max`, `qwen3.5-plus`, `qwen-plus`, `qwen3.5-flash`, `qwen-flash`
- **Image**: DashScope native API. Endpoint: `POST /api/v1/services/aigc/multimodal-generation/generation`
- Size format uses asterisk: `1024*1024` (not `1024x1024`)
- Response contains a temporary URL (expires 24hrs) — download immediately
- Image models: `qwen-image-2.0-pro`, `qwen-image-2.0`, `qwen-image-max`, `qwen-image-plus`, `wan2.6-image`, `wan2.7-image-pro`
- **Video**: Async task pattern (create → poll). Endpoint: `POST /api/v1/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`
- T2V models: `wan2.6-t2v`, `wan2.6-t2v-turbo`, `happyhorse-1.0-t2v`
- I2V models: `wan2.7-i2v`, `wan2.6-i2v`, `wan2.6-i2v-flash`, `happyhorse-1.0-i2v`
- Other: `wan2.2-kf2v-flash` (keyframe), `wan2.2-s2v` (speech/lip-sync), `wan2.6-vace` (video edit)
- **HappyHorse 1.0**: Alibaba's top-ranked video model. 15B params, native 1080p, 3-15s, joint video+audio. Pricing: $0.14/sec (720p), $0.24/sec (1080p)
- Catalog management: rows in `ai_models` are managed manually via `/admin/models`.

## Admin

There's a hidden admin catalog editor at **`/admin/models`** for hand-curating
the `ai_models` table — no cron, no API discovery, no scraping. The
deliberate end-state for keeping the table fresh.

### Auth

Email allowlist on top of the existing Supabase Google OAuth login. Anyone
signed in whose email matches `ADMIN_EMAILS` (comma-separated env var)
gets through; anyone else is redirected to `/`.

```
ADMIN_EMAILS=wei917@gmail.com
```

The check lives in `lib/admin.ts` (`getAdminUser()` for server components,
`assertAdmin()` for API routes). Both API routes (`POST /api/admin/models`
and `DELETE /api/admin/models/[id]`) call `assertAdmin()` first; never
trust client-side flags for admin gating.

### UI

Single-file client component (`app/admin/models/AdminModelsClient.tsx`):

- Filterable table of every row in `ai_models` (provider tab + search).
- Inline enabled toggle per row (one click).
- Edit / Delete buttons per row.
- "+ Add model" opens the same form in create mode.
- Form auto-shows the right pricing section based on the
  `output_modalities` checkboxes — text models show input/output rate
  inputs, image models show low/medium/high quality rates + sizes
  textarea, video models show 720p/1080p/4k rates + sizes + durations.
- All saves go through `POST /api/admin/models` which upserts via
  `(provider, model_name)` and returns the canonical row, which the
  client merges into local state.

### Workflow

Edit a row in the form → Save → it's live. No deploy, no commit, no
script. The `model_name` field is the unique key together with
`provider`; the form locks it on edit so you don't accidentally rename
into a different row's identity.

If you want a backup copy of the catalog (e.g. before a big edit pass),
run `npx tsx scripts/survey-models.ts` and save the output, or query the
table directly.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_AI_API_KEY=xxx
DASHSCOPE_API_KEY=sk-xxx              # Alibaba DashScope — image/video generation
DASHSCOPE_BASE_URL=                   # Optional; defaults to https://dashscope-intl.aliyuncs.com

ADMIN_EMAILS=wei917@gmail.com         # Comma-separated allowlist for /admin/models access
```

## Dev Commands

```bash
npm install
npm run dev              # Local dev server on :3000
npm run build            # Production build
npx tsc --noEmit         # Type check (run before packaging)
```

## Catalog Management

The `ai_models` table is hand-curated through the **`/admin/models`** UI.
There are no automated sync scripts — the previous Playwright-scraping
+ API-discovery infrastructure (`lib/sync-{openai,google,dashscope}.ts`,
the matching CLI wrappers in `scripts/`, and the `app/api/cron/sync-models`
Vercel cron) was removed in May 2026 in favor of hand-curation. Reasons:

- **Pricing is small data, slow to change.** The full surfaced catalog is
  ~50–60 rows across four providers, updated maybe a handful of times
  per quarter. Manual entry is faster than maintaining scrapers.
- **No major provider exposes a pricing API.** OpenAI, Google, and
  Alibaba all publish prices as docs pages. Scrapers break when those
  pages restructure, and silent breakage produced wrong prices on the
  leaderboard.
- **Hand-tuning matters.** Decisions like "which qwen variants to
  surface" or "what to label the start vs end frame slot for kf2v" are
  judgment calls a scraper can't make.

Workflow: open `/admin/models`, edit a row, save. Done. No deploy, no
script. See the "Admin" section for the auth/UI details.

If you need a backup snapshot (e.g. before a big edit pass), run
`scripts/survey-models.ts` and save the output, or query `ai_models`
directly through the SQL editor.

## Leaderboard (unified catalog + ranking)

`/leaderboard` is the single page for browsing models and their XD scores.
The old separate `/models` catalog was merged into Leaderboard in May 2026;
`/models` now server-redirects to `/leaderboard`.

### Data flow
- Page loads all enabled models from `ai_models` (Supabase) — every model appears, voted or not.
- Page also calls `/api/leaderboard?mode=all` to fetch XD scores, merged in by `modelId`.
- Models with no votes show an empty XD Score cell and sort to the bottom regardless of direction.

### Scoring (unchanged)
- Uses **Bradley-Terry MLE** to compute pairwise ratings from duel/xcreate votes.
- **XD Score** = Quality BT × 0.4 + Value BT × 0.4 + Stickiness × 0.2.
  - Quality = blind vote (vote1), Value = price-aware vote (vote2), Stickiness = retention rate.
- Base rating is 1000 (like Elo). Above 1000 = green, below = red, blank cell if unscored.
- Mode-aware scoring is implicit: text models only ever duel text models, etc., so calling the API once with `mode=all` gives correct per-model scores.
- Leaderboard API filters historical duel slots through `validModelIds` to skip deleted/obsolete models.

### UI
- Search bar, provider filter tabs (with counts), mode filter (all/text/image/video).
- **Seven columns**: Model · XD Score · Provider · Released · Input · Output · Price.
- **Sortable** headers: Model / XD Score / Provider / Released / Price. Click to sort, click again to flip direction. Active column shows a green ▲ or ▼.
- **Default sort**: XD Score DESC. Nulls always sort to the bottom regardless of direction. Switching to a new sort key picks DESC for score/price/released, ASC for alphabetical fields.
- **Price column** shows industry-standard rates with slash-aligned formatting (fixed widths so slashes line up across rows): text → `$X / 1M`, image → `$X / image`, video → `$X / sec`.
- Modality badges with color coding (text=gray, image=purple, video=amber, audio=cyan). Same badges in Input and Output columns — the column header is the discriminator.
- POPULAR badge for flagship models.
- "HOW SCORING WORKS →" link in the subhead → `/methodology`.
- Linked from Nav and XCreate page ("BROWSE ALL MODELS →" — points to `/leaderboard`).

## Recent Major Changes (May 2026)

1. **Catalog management moved to admin UI** — All sync scripts (`lib/sync-{openai,google,dashscope}.ts`, CLI wrappers, the Vercel cron route, the legacy `populate-release-dates` route) deleted. `ai_models` is now hand-edited at `/admin/models`. Schema is fixed: see `docs/ai_models-schema.md`.
2. **Models merged into Leaderboard** — The standalone `/models` catalog page was merged into `/leaderboard` so the latter is now the single destination for browsing models. The unified page lists every enabled model with an XD Score column (blank for unvoted), and inherits the catalog's search, provider filter, mode filter, and sortable headers. Default sort is XD Score DESC. Nav drops to 5 items (HOME · XDUEL · XCREATE · XVOTE · LEADERBOARD). `/models` server-redirects to `/leaderboard` to preserve old links. XCreate's "BROWSE ALL MODELS →" CTA now points to `/leaderboard`. See "Leaderboard" section.
3. **Vote → XVote rebrand** — Nav label and `/vote` page header now read "XVote" to match the X-family (XDuel/XCreate). Route stays `/vote`. Nav order: XDUEL · XCREATE · XVOTE · LEADERBOARD (the explicit Home link was removed; the logo doubles as home). Verb usage of "vote" in body copy stays unchanged.
4. **Nav: removed dimming on protected links** — XDuel/XCreate/XVote render at full opacity for logged-out users. Clicking still triggers the auth modal.
5. **OpenRouter removed entirely** — all Alibaba text models now go direct through DashScope's OpenAI-compatible endpoint. Files deleted: `lib/providers/openrouter.ts`, `lib/sync-openrouter.ts`, `scripts/sync-openrouter.ts`, `app/api/dev/sync-openrouter/route.ts`. SQL migration: `supabase/21_drop_openrouter.sql`
6. **Release dates** — now hand-entered through `/admin/models` like everything else.
7. **Leaderboard fixed** — filters out deleted models, shows release dates, uses canonical model info from ai_models table
8. **Font fix** — leaderboard changed from Barlow Condensed to Barlow for better readability
9. **Data reset** — `supabase/22_reset_all_data.sql` truncates duels, xcreates, activity_logs, attachments, provider_calls for fresh start
10. **Provider call logging** — Every AI model invocation is now logged to a new `provider_calls` table via a Supabase Edge Function (`log-provider-call`). Captures provider, model, mode, status (success/failed), latency, error message, user_id, and tokens/cost where the provider surfaces them. See "Provider Call Logging" section.

## Known UI Inconsistencies (open)

- **"View XDRating →" CTA on `/methodology`** links to `/leaderboard`, but the leaderboard page is titled "Leaderboard" — so XDRating is the *system* name on methodology and Leaderboard is the *page* name. Either rebrand the destination as XDRating or rename the methodology CTA to "View Leaderboard". Not yet decided.
## Provider Call Logging

Every AI model invocation produces **two rows** in the `provider_calls`
table — one for the start event and one for the end event, paired by a
shared `request_id`. Both rows are inserted by the
`supabase/functions/log-provider-call/index.ts` Edge Function, called
fire-and-forget from `lib/providers/index.ts`.

### Why two rows?

Append-only event log. No UPDATE path means no race between insert and
update. If the end POST is dropped (e.g. Vercel freezes a non-streaming
Lambda after the response closes), the start row is still in the table
as a debugging breadcrumb that the request happened. Pairing queries
that find a start without a matching end surface those cases.

### Lifecycle

Both helpers are **synchronous and fire-and-forget**. The Next.js side
generates `request_id` with `crypto.randomUUID()` and returns it
immediately; the HTTP POST to the Edge Function runs in the background.
The provider call begins on the very next instruction.

1. **Before** the request, `startCall(descriptor)` (in
   `lib/providers/call-log.ts`) returns a `request_id` and fires
   `{ action: 'start', request_id, provider, model_name, model_id, mode, user_id }`.
   Edge Function INSERTs `event='start'`.
2. **After** the request resolves, `endCall(requestId, descriptor, outcome)`
   fires `{ action: 'end', request_id, ...descriptor, status,
   latency_ms, error_message?, input_tokens?, output_tokens?, cost_usd? }`.
   Edge Function INSERTs `event='end'` as a separate row.

If the Edge Function is unreachable or rejects the body, the helper logs
a stdout warning and drops the row. Logging never blocks or fails the
user-facing request.

### Schema (supabase/23_provider_calls.sql)

`id` (PK), `request_id` (correlates start↔end), `event` (`start`/`end`),
`created_at`, `provider`, `model_name`, `model_id` (FK to `ai_models`),
`mode`, `user_id` (FK to `auth.users`, nullable), and end-only fields
`status` (`success`/`failed`), `error_message`, `latency_ms`,
`input_tokens`, `output_tokens`, `cost_usd`.

Descriptors are duplicated on the end row so analytics queries don't
need a self-join (`select count(*) from provider_calls where event='end'
and provider='openai'` works directly).

Indexes on `request_id`, `(provider, model_name)`, `created_at desc`,
`user_id`, `(event, created_at desc)`. RLS enabled with no public
policies — all reads/writes go through the service role.

### Querying

```sql
-- Start↔end pairs in the last hour, with computed pairing status
select s.request_id, s.provider, s.model_name, s.created_at as started,
       e.created_at as ended, e.status, e.latency_ms, e.cost_usd
from provider_calls s
left join provider_calls e
  on e.request_id = s.request_id and e.event = 'end'
where s.event = 'start' and s.created_at > now() - interval '1 hour'
order by s.created_at desc;

-- Calls per provider+model + success rate (uses end events only)
select provider, model_name,
       count(*) filter (where status='success') as ok,
       count(*) filter (where status='failed')  as fail,
       round(avg(latency_ms))                   as avg_ms
from provider_calls
where event='end' and created_at > now() - interval '24 hours'
group by 1,2 order by ok+fail desc;

-- Orphan starts (request started but no end recorded — usually means
-- Vercel killed the Lambda or the provider hung past maxDuration)
select s.request_id, s.provider, s.model_name, s.created_at
from provider_calls s
where s.event='start'
  and not exists (
    select 1 from provider_calls e
    where e.request_id = s.request_id and e.event='end'
  )
  and s.created_at < now() - interval '10 minutes';
```

### Wiring

The router (`lib/providers/index.ts`) accepts an optional `CallContext`
param (`{ userId? }`) on `streamText`, `generateImage`, `generateVideo`. Route
handlers pass it explicitly:

- `app/api/duel/route.ts` — `runSlot()` takes `userId` and forwards it.
- `app/api/xcreate/route.ts` — `runSlot()` already had `userId`; now forwards it.
- `app/api/xcreate/chat/route.ts` — passes `{ userId: user.id }` directly.

Calls without a context (e.g. unauthenticated paths, if any) log `user_id: null`.

### Tokens / cost

Captured automatically:
- **Text** — pulled from `TextStreamCallbacks.onDone` (`inputTokens`,
  `outputTokens`, `cost`). All four providers populate these.
- **Image / Video** — `cost` from the result object. Token columns stay null
  for now (image/video providers don't surface token usage uniformly).

### Deployment

The Edge Function lives at `supabase/functions/log-provider-call/`. To deploy:

```
supabase functions deploy log-provider-call
```

Required env on the Edge Function side: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
(Supabase injects both automatically). Required on the Next.js side:
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (already set).

Run `supabase/23_provider_calls.sql` in the SQL editor before first deploy.

### Performance + caveats

Both calls are fire-and-forget so the provider request sees zero added
latency on the hot path. The two HTTP POSTs run alongside the provider
request and complete in the background.

The one situation to watch is **Vercel freezing non-streaming Lambdas**
after the response closes. SSE handlers (duel + initial xcreate) keep
the response open across the provider call and the end POST, so the
Lambda stays alive long enough for both inserts. Non-streaming handlers
(`xcreate/chat` for image/video) close the response when the provider
returns; the end POST may or may not finish before Vercel freezes the
function. If those rows go missing in production, the fix is one line:
wrap the endCall in `after()` from `next/server` so the platform keeps
the Lambda alive until the background fetch completes.

The deliberate non-fix is the start row's safety net — even if the end
POST is killed, the start row is in the table.

## Planned: Add Anthropic as Provider

User wants to add Anthropic/Claude models as a 5th provider. Needs:
- Get Anthropic API key from console.anthropic.com
- Create `lib/providers/anthropic.ts` — Messages API (`POST https://api.anthropic.com/v1/messages`)
  - Auth: `x-api-key` header (not Bearer), `anthropic-version: 2023-06-01`
  - Streaming: SSE with `content_block_delta`, `message_stop` events
  - Models: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
- Add `'anthropic'` to `SUPPORTED_PROVIDERS` in provider router
- Seed models into `ai_models` table
- Add `ANTHROPIC_API_KEY` env var

## Packaging Convention

When creating a zip for deployment:
```bash
cd /path/to/project
rm -rf .next node_modules package-lock.json tsconfig.tsbuildinfo
zip -r modelxd.zip . -x "*.git*" -x ".DS_Store"
```
Files start at `app/`, `lib/`, etc. — no wrapper folder.
