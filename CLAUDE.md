# CLAUDE.md — ModelXD Project Guide

## What is ModelXD?

ModelXD (modelxd.com) is an AI model comparison platform. Users run "duels" between AI models — they enter a prompt, two random models respond blindly, the user votes on which is better, then prices and model identities are revealed. The core thesis: you're probably overpaying for AI, and ModelXD proves it with community-validated blind tests.

## Tech Stack

- **Framework**: Next.js 14 App Router (React 18)
- **Hosting**: Vercel (with cron jobs)
- **Database + Auth**: Supabase (PostgreSQL + Google OAuth)
- **AI Providers**: OpenAI API (Responses API for text, Images API, Videos API), Google Gemini API
- **Styling**: CSS variables in `app/globals.css`, inline styles. Light theme only (no dark mode).

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
├── vote/page.tsx               # Vote on archived duels
├── create/page.tsx             # Multi-model prompt runner (text/image/video)
├── leaderboard/page.tsx        # Model rankings from community votes
├── feed/page.tsx               # Public duel feed
├── profile/page.tsx            # User profile + duel history
├── profile/[userId]/page.tsx   # Public profile view
├── duel/[id]/page.tsx          # Individual duel permalink
├── auth/callback/route.ts      # OAuth callback — exchanges code, reads auth_redirect cookie
├── login/                      # Login page (legacy, AuthModal is primary)
└── api/
    ├── duel/route.ts           # POST — runs XDuel (picks random models, streams SSE)
    ├── duel/vote/route.ts      # POST — saves vote1/vote2 to DB
    ├── create/route.ts         # POST — single-shot multi-model generation
    ├── create/chat/route.ts    # POST — chat continuation (SSE streaming)
    └── cron/sync-models/route.ts # GET — weekly model sync (LLM parses pricing pages)

lib/
├── models.ts                   # DB queries: getModelsByMode (uses output_modalities)
├── providers/
│   ├── types.ts                # ModelInfo, TextResult, ImageResult, VideoResult interfaces
│   ├── index.ts                # Provider router: dispatches to openai.ts or google.ts
│   ├── openai.ts               # OpenAI: text (Responses API streaming), image, video
│   ├── google.ts               # Google: text (generateContentStream), image, video
│   └── log.ts                  # Logging helper (strips binary data)
├── supabase-client.ts          # Browser Supabase client
├── supabase-server.ts          # Server Supabase client
├── AuthModalContext.tsx         # React context for auth modal (show/hide with nextPath)
├── useRequireAuth.ts           # Hook: shows auth modal if not logged in
└── attachment.ts               # Process uploaded files for AI providers

supabase/
├── 01_models.sql               # ai_models table + seed data (RUN THIS to populate)
├── 02_duels.sql                # duels table
├── 03_creates.sql              # creates table
├── 04_attachments.sql          # attachments table
├── 05_profiles.sql             # profiles + activity_logs tables
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

### Model Sync (app/api/cron/sync-models/route.ts)
- Runs weekly (Monday 6am UTC) via Vercel cron
- Fetches OpenAI/Google pricing pages, sends HTML to gpt-4.1-mini for structured extraction
- Per-provider fail-safe: if parse fails, no DB changes for that provider
- If parse succeeds: disables all models for that provider, upserts parsed models as enabled

## Database: ai_models Table

Key columns:
- `provider`: 'openai' | 'google'
- `model_name`: exact API string (e.g., 'gpt-5.4', 'gemini-3.1-pro-preview')
- `name`: display name
- `modes`: legacy — use `output_modalities` instead
- `input_modalities`: what the model accepts ['text', 'image', 'video']
- `output_modalities`: what the model generates ['text'] | ['image'] | ['video']
- `input_price` / `output_price`: per 1M tokens (for text models)
- `image_pricing`: jsonb per-quality prices {"low": 0.009, "medium": 0.034, "high": 0.133}
- `video_pricing`: jsonb per-resolution prices {"720p": 0.10}
- `enabled`: only enabled models are picked for duels

**IMPORTANT**: `getModelsByMode()` queries `output_modalities` (not `modes`) to pick models for duels. A model with `input_modalities: ['text','image']` and `output_modalities: ['text']` is a text model that can see images — NOT an image generator.

## OpenAI Provider Notes

- **Text**: Uses Responses API (`/v1/responses`) with streaming for ALL models. NOT Chat Completions.
- Stream events: `response.output_text.delta` for text chunks, `response.completed` for usage/tokens
- Some models like `gpt-5.4-pro` ONLY work with Responses API (not Chat Completions)
- **Image**: Uses Images API (`images.generate` / `images.edit`). Quality hardcoded to 'medium'.
- **Video**: Uses Videos API (polling-based). Sora 2 models deprecated Sep 2026.

## Google Provider Notes

- **Text**: Uses `generateContentStream` from `@google/genai` SDK
- **Image**: Uses `generateContent` with `responseModalities: ['IMAGE', 'TEXT']`
- `gemini-3-pro-image-preview` and `gemini-3.1-flash-image-preview` are the image models
- Models ending in `-preview` may change. Check Google's deprecation page.
- `gemini-2.5-flash-lite` does NOT support streaming — only basic text output

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

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_AI_API_KEY=xxx
CRON_SECRET=xxx          # Protects /api/cron/sync-models
```

## Dev Commands

```bash
npm install
npm run dev              # Local dev server on :3000
npm run build            # Production build
npx tsc --noEmit         # Type check (run before packaging)
```

## Packaging Convention

When creating a zip for deployment:
```bash
cd /path/to/project
rm -rf .next node_modules package-lock.json tsconfig.tsbuildinfo
zip -r modelxd.zip . -x "*.git*" -x ".DS_Store"
```
Files start at `app/`, `lib/`, etc. — no wrapper folder.
