# XTell standalone UI handoff

Implemented by Codex, 2026-09-23, for `xtell.modelxd.com`.

## Integration

Source clone: `/Users/cwei/Documents/ModelXD_ChatGPT/xtell-site`
Branch: `codex/xtell-ui`

This branch already includes local cherry-picks of Claude's `df1e8a9` and `92a632b`. Cherry-pick only the UI commit that follows them; do not merge the duplicate routing commits.

`XTellClient` now consumes `useSite()` by default, so Claude's root page can render `<XTellClient />` unchanged. `/xtell` also passes its server-resolved site explicitly. The existing ModelXD rendering branch is retained.

## UI delivered

- Dedicated XTell top navigation, immediate language picker, account link, seal wordmark and legal footer.
- Public temple street using all ten existing commissioned covers, with responsive cards and native keyboard activation.
- Temple rooms with compact illustrated headers, clear progression, accessible birth-field names, grouped date/time fields, mobile form layouts, mobile stacked reader replies and a visible composer.
- Sign-in styled for XTell, with existing Google OAuth unchanged. Focus trapping, Escape dismissal and scroll locking on the XTell modal.
- One-time entry auth prompt (`XTellAuthGate`). The pre-existing `useRequireAuth` effect depends on the unstable `show` context function and reopens a dismissed modal. The standalone gate avoids that loop without changing the shared auth library. Server auth remains authoritative.
- Account surface retains the existing wallet, purchase flow, regional monthly-plan prices, referral controls and account deletion. Other product tabs are hidden on XTell. XTell activity is queried from the existing owner-scoped `credit_transactions` table using `reference_type = xtell`; the UI explicitly says transcripts are not saved.
- New copy translated into English, Traditional Chinese, Simplified Chinese, Japanese and Korean.
- Existing API payloads, subject serializers, ritual state machine, chart visibility, provider selection, costs and no-auto-send behavior retained.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- `npm run test:xtell` passed (golden charts and Western astrology).
- `git diff --check` passed.
- Chrome desktop visual review.
- At 400px: street, all ten temple entry forms and signed-out account page have `scrollWidth === innerWidth === 400`.
- All five languages render on the mobile street without missing keys or horizontal overflow.
- Sign-in dialog can be closed; the form remains accessible. Native form controls and date field labels verified.
- After Claude's server-site fix: no new hydration errors in the browser.
- Cookie off: ModelXD navigation returns, standalone nav is absent, original ten-card XTell page remains.

## Remaining system validation / launch

Claude owns domain setup, deployment and authenticated integration checks. The local preview has no signed-in account: Google callback round-trip, real account wallet/history rendering, and a live streamed reading were not exercised by Codex. No paid inference or checkout was submitted.

The UI does not change API authorization, OAuth configuration, subscription terms, or billing. Verify the Supabase callback allow-list and Vercel/DNS configuration for the final domain, then check authenticated account and reading flows there.

A development server is running on `http://127.0.0.1:4317/`. The open Chrome preview has the local `modelxd_site=xtell` cookie. The temporary cookie-switching QA helper was removed before the production build and is not committed.

## Navigation follow-up

Final navigation QA caught a same-path Next Link retaining the selected temple after returning to `/`. The standalone brand/home links now use document navigation so the street resets reliably. The skip link focuses the main region without replacing the temple hash, and XTell OAuth return paths preserve that hash. Desktop browser verified: home returns to street; skip stays in the room.
