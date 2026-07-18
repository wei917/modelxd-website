# XDRating pipeline — incremental aggregation + snapshot ratings

*July 2026. Replaces the compute-on-every-XBoard-view design.*

## Why

The original `/api/leaderboard` refit Bradley-Terry over **every raw vote on
every page view**. Fine at zero scale, dead at real scale (fetch-all-votes per
view), and it left nothing computed at vote time — so a duel/creation result
screen had no rating delta to show (the 傳說對決 "+19 模型戰力" moment).

## Shape

```
votes (duels, xcreates)          raw, append-only — SOURCE OF TRUTH
        │  AFTER INSERT/UPDATE/DELETE trigger (same transaction)
        ▼
model_pairwise_wins              (mode, signal, winner, loser) → wins   [models², tiny]
model_vote_stats                 (mode, model) → votes, voted1, retained, price_label
        │  refit: BT over the matrix — O(models²·50), ms, INDEPENDENT of vote volume
        ▼
model_ratings                    (mode, model) → quality_r, value_r, stickiness, xd_score
        ▲
   XBoard + result screens read this. One indexed SELECT per view.
```

## Write paths

1. **DB triggers** (`45_xdrating_pipeline.sql`) on `duels` and `xcreates`
   maintain the aggregates. Strategy: a row's whole contribution is one
   function; UPDATE = un-apply(OLD) + apply(NEW); DELETE = un-apply(OLD).
   Exactly mirrors `/api/leaderboard`'s aggregation semantics:
   - duel vote1 → quality signal, vote2 → value signal
   - tie ('T') or neither-of-pair-won → 0.5 wins each way
   - xcreate: chosen beats every other **distinct** model (ids deduped,
     <2 distinct → no signal)
   - stickiness: vote1 non-tie + vote2 present → voted1++, retained++ if
     !vote_changed
   - slots ids: `model_id || id`, must parse as uuid AND exist in ai_models
2. **Refit** (`POST /api/xdrating/refit`) reads aggregates, runs BT per mode
   (`text`, `image`, `video`) + `all` (summed aggregates), and upserts
   `model_ratings`. Guarded by a 10s throttle (`xdrating_refit_log`), `force=1`
   bypasses. Called:
   - awaited from `/api/xduel/vote` after each vote write
   - fire-and-forget from XCreate's `pickModel`
   - by cron as a backstop
3. **Rebuild** (`select xd_rebuild_aggregates()`) wipes and replays the
   aggregates from raw votes. Nightly via pg_cron + on demand. Heals any
   drift; raw votes stay authoritative.

## Read path

`GET /api/leaderboard?mode=` now reads `model_ratings` joined with `ai_models`
(same response shape as before — XBoard unchanged). If the snapshot table is
missing/empty it falls back to the legacy live computation
(`computeLiveLeaderboard` in `lib/xdrating.ts`), so the site can't break on a
half-applied migration.

## Cron

- **Vercel cron** (`vercel.json`): `*/5 * * * *` → `/api/xdrating/refit?source=cron`.
  Backstop only — the vote path keeps ratings fresh. NOTE: Vercel Hobby caps
  crons at daily; the 5-min schedule needs Pro. Daily is still an acceptable
  backstop since votes themselves trigger refits.
- **pg_cron** (in the migration, best-effort): nightly 03:00 UTC
  `xd_rebuild_aggregates()`. If the extension isn't enabled the migration
  skips it with a NOTICE — enable in Dashboard → Database → Extensions.

## Scale math

Thousands of votes/minute → thousands of O(1) upserts + at most 6 refits/min
(throttle) + one indexed select per XBoard view. The refit cost is bounded by
catalog size (~18 models → matrix ≤ 18²·2 signals·3 modes rows), never by vote
history.

## Result-screen delta (redesign, later)

At current volume the throttle almost never coalesces, so the screen can read
`model_ratings` before + after its own vote and show the true delta. If
coalescing becomes common post-launch, switch the display to an Elo-style
approximate delta (deterministic from the two ratings + K factor) — same as
what AoV shows — while the snapshot stays the truth.

## Operational notes

- XD formula: `0.4·qualityBT + 0.4·valueBT + 0.2·(600+retention·800)`.
- July 17: the BT fit carries a pseudo-count prior (`PRIOR_MATCHES = 2`
  virtual ties per model, spread across opponents — see lib/xdrating.ts).
  Fixes the zero-wins placeholder artifact ("model won but rating dropped"),
  parks unrated models at exactly 1000, fades as real votes accumulate,
  and is retroactive: changing it only needs `/api/xdrating/refit?force=1`.
- `price_label` rides on `model_vote_stats` (last seen in a vote's slots) to
  keep the XBoard response byte-compatible.
- Bootstrap after running the migration: `select xd_rebuild_aggregates();`
  then hit `/api/xdrating/refit?force=1`. Verify snapshot ≡ legacy output
  before trusting it (script: `scripts/verify-xdrating.ts`).
- Soft-deleted duels (deleted_at) still count — matching legacy behavior,
  which never filtered them. Hard DELETE un-applies.
