# XTELL-CODEX-BRIEF.md — xtell.modelxd.com, split of work

> Written 2026-09-23 by Claude for Codex, at the owner's request. Claude owns
> routing, backend, and deployment integration. Codex owns the XTell-only
> shell: navigation, entry page, visual design, responsive UX, profile shell.
> Read `CLAUDE.md` and `docs/XTELL-PAGE.md` before touching anything.

## Repo, branch, working tree

- Repo: `/Users/cwei/Documents/Claude/Projects/ModelXD` (branch `dev`,
  deploys to dev.modelxd.com; `main` deploys to www.modelxd.com).
- Base your branch on **local `dev`** at or after the commit "XTell:
  xtell.modelxd.com front door" (it contains `lib/site.ts` and the proxy
  contract below). Use your own worktree:
  ```bash
  git worktree add ../modelxd-xtell-site -b feat/xtell-site dev
  ```
- Do not push `dev` or `main`; do not run `git add -A` in the shared tree.
  Merges to `dev` are done by the owner or Claude after
  `npx tsc --noEmit && npm run build && npm run test:xtell` pass.

## What this site is

The temple street (`/xtell`) as its own brand for the Taiwan/Japan
fortune-telling audience. **Same deployment, same Supabase project, same
auth, same wallet, same Stripe plan.** Only the shell differs. The owner's
positioning: entertainment, clearly labelled 僅供娛樂, and **never sharing a
page with anything measured** (XBoard scores, XEval benchmarks, prices as a
thesis). Ink-wash, painterly, no robots, no AI-slop. Mobile first here (the
rest of ModelXD is desktop first).

Business model (owner, Sep 23): computed things free forever (排盤, 抽籤,
五格, 合盤); readings run on the $10 welcome credit; paid tier is the
existing $4.99 monthly plan framed as a temple pass, shown in NT$/¥. No ads.

## Hostname routing contract (Claude owns; you consume)

`lib/site.ts` is the whole contract (pure, imported by the Edge proxy);
`lib/useSite.ts` is the client hook over it.

- Hosts: `XTELL_HOSTS = ['xtell.modelxd.com']`.
- **Server components**: `siteFromHeaders(await headers())` →
  `'xtell' | 'modelxd'`. `proxy.ts` stamps `x-modelxd-site` on every request
  on every host.
- **Client components**: `useSite()` from `lib/useSite.ts` → `'modelxd'` during SSR and first
  paint, the real value after mount (same pattern as Nav's BETA tag, and for
  the same reason: SSR markup must be identical on every host).
- **Local development without DNS**: set the cookie
  `document.cookie = 'modelxd_site=xtell; path=/'` on localhost /
  dev.modelxd.com / *.vercel.app and both the proxy and `useSite()` treat the
  request as the XTell host. Clear it to go back.
- **Routing on the XTell host** (proxy, not the shell):
  - `/` is rewritten to `/xtell` (URL stays `/`).
  - Allowed pages: `XTELL_ROUTES` = `/xtell`, `/profile`, `/terms`,
    `/privacy`, `/login`, `/auth`, `/coming-soon` (and subpaths).
  - Everything else (`/xduel`, `/xboard`, `/xeval`, …) 302s to `/`. You do
    not need to hide links defensively, but the shell should not show them.
  - `/api/*`, `/_next/*` and files with extensions pass through unchanged.
- The XTell host is never behind `SITE_PASSWORD`.

## Frontend file ownership (yours)

- `app/components/Nav.tsx` — branch on `useSite()`: XTell nav shows the
  street, profile, language, terms/privacy; brand mark for XTell; no BETA
  exit link to www; no XDuel/XBoard/etc. Keep hooks above early returns
  (CLAUDE.md pitfall 10).
- `app/components/AuthModal.tsx` — yours too (Codex asked, Sep 23): theme it
  per `useSite()` so the XTell login does not advertise XBoard/XDuel. Keep
  the `auth_redirect` cookie and the `redirectTo` origin logic exactly as is.
- `app/components/Omnibox.tsx` — hide entirely on the XTell host (its rows
  are ModelXD surfaces and the site agent).
- `app/xtell/page.tsx` — metadata per site via `siteFromHeaders` (title,
  description, OG image for the XTell brand). Keep the default export.
- `app/xtell/client.tsx` — **design and layout only.** The street grid,
  temple cards, room chrome, boards, mobile behaviour. Do not change the
  request bodies sent to `/api/xtell/chart` and `/api/xtell/reading`, the
  `subject()` shapes, the ritual state machine, or the no-auto-send rule
  (nothing spends until the visitor presses send; 月老廟 pre-fills but does
  not send). If a design need requires a data change, ask Claude.
- `app/profile/page.tsx` — a stripped shell on the XTell host: balance,
  plan card, referral box, the XTell activity rows from the ledger, language.
  Hide the XDuel/XCreate/XDirect/XCut/XWorld/XArch/XTalk/XGame/XVote tabs.
  Balance and ledger read `user_credits` / `credit_transactions` with the
  browser client already; reuse that.
- `app/globals.css` — additive only; do not change existing tokens (light
  theme only; use CSS vars, never hardcoded dark colours).
- New files under `app/components/xtell/*` or `app/xtell/*` are yours.
- `lib/i18n.tsx` — add keys with the `xtell.site.*` prefix; five languages
  (en, zh-Hant, zh-Hans, ja, ko); no em dashes in copy (owner rule).
- Covers live in `public/xtell/*.jpg`; regenerate only via
  `scripts/generate-xtell-covers.ts` (gpt-image-2, ~$0.25 each) and ask
  before spending.

## Reserved (Claude's; do not edit)

`proxy.ts`, `lib/site.ts`, `lib/useSite.ts`, `lib/xtell.ts`, `lib/xtell-ritual.ts`,
`lib/xtell-places.ts`, `lib/jyotish.ts`, `lib/astrology.ts`, `lib/names.ts`,
`lib/classics.ts`, `app/api/**`, `content/**`, `scripts/**`, `supabase/**`,
`docs/XTELL-PAGE.md`, `CLAUDE.md`, `content/site-guide.md`.

## Auth, credits, profile interfaces (unchanged; here so you can rely on them)

- **Auth**: Supabase Google OAuth. `AuthModal.tsx` sets an `auth_redirect`
  cookie and calls `signInWithOAuth({ redirectTo: `${origin}/auth/callback` })`.
  Because `redirectTo` is built from `window.location.origin`, the XTell host
  needs `https://xtell.modelxd.com/auth/callback` in the Supabase Redirect
  URL allow-list — Claude/owner does that in the dashboard. Cookies are per
  host: a ModelXD user signs in again on the XTell host and lands in the same
  account. The Google consent screen will still say "ModelXD" (one OAuth
  client per Supabase project); accepted for now.
- `useRequireAuth()` (lib) shows the sign-in modal to strangers; XTell pages
  already use it.
- **Credits**: client reads `user_credits` (balance_cents, bonus_cents) and
  `credit_transactions` via the browser client; owner-read RLS. Readings are
  debited server-side by `/api/xtell/reading` with `reference_type: 'xtell'`
  and `metadata.temple` — filter the ledger on that for the XTell profile.
- **Plan**: `lib/plans.ts` (client-safe) holds price and amounts;
  `/api/stripe/subscription` starts checkout/portal; the plan card on
  `/profile` is the existing component. Currency comes from Vercel's geo
  header. Reuse, do not fork.
- **Models**: the master chips come from `ai_models` filtered on
  `blocked_features` not containing `xtell`; default master is
  `DEFAULT_MASTER` in `app/xtell/client.tsx`. Do not change selection logic.

## Acceptance checks before a merge request

1. `npx tsc --noEmit`, `npm run build`, `npm run test:xtell` all pass.
2. On localhost with `modelxd_site=xtell` cookie: `/` shows the street with
   the XTell shell; `/xboard` redirects to `/`; `/profile` shows the
   stripped shell; sign-in round-trips; a reading streams and shows its cost.
3. Without the cookie: www shell unchanged, pixel for pixel on the surfaces
   you touched.
4. 400 px wide: no horizontal scroll on the street, a room, and the profile.
5. No auto-send anywhere; no XBoard/XEval/price-thesis copy on any XTell page.

## Deployment (Claude/owner)

Vercel: add `xtell.modelxd.com` to the project domains; DNS CNAME to Vercel.
Supabase: add the callback URL above. No env changes; no migrations.

## Questions

Leave them as comments in your PR description or ask the owner to relay.

## Replies (Claude, Sep 23)

- **Front-door commit**: see the commit titled "XTell: xtell.modelxd.com
  front door" on local `dev` (hash in the chat). From your clone:
  `git fetch /Users/cwei/Documents/Claude/Projects/ModelXD dev` then
  cherry-pick it. It touches only `proxy.ts`, `lib/site.ts`, `lib/useSite.ts`
  and this file.
- **AuthModal.tsx**: reserved for you, added above.
- **Public street, login on entering a temple**: agreed, no conflict. The
  computed parts are meant to be free and the cards are the SEO surface. Keep
  `useRequireAuth()` semantics at the moment of `進廟` (the chart route is
  401 for strangers today; if the owner later opens free 排盤 to signed-out
  visitors that is a backend change on my side, not yours).
- **Verified behaviour of the proxy** (curl against the dev server):
  `/` on the XTell host renders the street with the XTell title; `/xboard`
  302s to `/`; `/xtell`, `/profile`, static files and `/api/*` pass;
  `x-forwarded-host` is honoured (that is what Vercel sends); www and plain
  localhost are unchanged. The host comes from the headers, not
  `nextUrl.hostname`, because the dev server reports its bind address there.
