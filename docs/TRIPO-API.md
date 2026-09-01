# TRIPO-API.md — the Tripo3D proxy (`/api/v1/tripo/*`)

> Built 2026-08-30 to a game developer's request spec (their file:
> SPEC-modelxd-tripo.md). One ModelXD key instead of a ModelXD key + a Tripo
> key. Pricing verified against docs.tripo3d.ai the same day.

## Endpoints

Auth: ModelXD API key (`Authorization: Bearer <key>`, same as /api/v1/chat/
completions) or a signed-in session.

| route | proxies | billed at create |
|---|---|---|
| `POST /api/v1/tripo/text-to-model` | `/v3/generation/text-to-model` | P1: $0.30 / $0.40 (texture); H-tier: $0.10 / $0.20 |
| `POST /api/v1/tripo/image-to-model` | `/v3/generation/image-to-model` | P1: $0.40 / $0.50; H-tier: $0.20 / $0.30 |
| `POST /api/v1/tripo/rig-check` | `/v3/animations/rig-check` | free (Tripo's own price list) |
| `POST /api/v1/tripo/rig` | `/v3/animations/rig` | $0.25 |
| `GET /api/v1/tripo/tasks/{id}` | `/v3/tasks/{id}` | free |
| `GET /api/v1/tripo/tasks` | — (ModelXD ledger) | free |

## The promises the spec asked for, and how each is kept

- **"Give me the task id, and let me poll it."** Create returns Tripo's
  `task_id` verbatim inside Tripo's own response shape; nothing blocks on
  generation. Poll separately.
- **"Task ids must chain."** We never rewrite ids — the id you get IS Tripo's,
  so `{"input": "<task_id>"}` chains with no mapping to lose. The only added
  rule: the input task must be YOURS (created through ModelXD), otherwise 404 —
  ids chain, so an unowned id would let anyone walk your pipeline.
- **"A lost connection must be recoverable."** Every created task lands in a
  ledger (`tripo_tasks`); `GET /api/v1/tripo/tasks` lists your recent 50.
  Never resubmit on a client timeout — find the task and keep polling.
- **"Surface cost per call."** Every create returns `usage.cost_usd`; every
  poll returns the current settled figure.
- **"Pass errors through intact."** Tripo error bodies are returned verbatim
  with Tripo's status code — `riggable=false`, quota exhaustion, all of it.
  The proxy adds two errors of its own: 401/404 ownership, and 503 when
  `TRIPO_API_KEY` is not configured.
- **`model`, `face_limit`, `texture`, `rig_type`, `spec` all pass through**
  on an allowlist with sanity bounds only. Nothing is defaulted server-side —
  `spec: "mixamo"` reaches Tripo exactly as sent.

## Billing (honest by construction)

Debited at create from Tripo's published table ($1 = 100 credits, so 1 credit
= 1¢). Unknown `model` strings are billed at the P1 (higher) rate. Then, on
the FIRST poll that sees a terminal status, the charge is reconciled against
the task's own `credits_consumed` (live-verified name; the docs say `consumed_credit` and we read both): overcharge refunds, undercharge debits the
difference, a failed task that consumed nothing refunds in full. One
reconciliation per task, race-guarded. The ledger row keeps the final figure.

## Live-verified quirks (Aug 30 smoke test, $0.20)

- `model` is REQUIRED on create; the API enumerates the allowed values:
  `P1-20260311, P2-20260801, v2.5-20250123, v3.0-20250812, v3.1-20260211`.
  An omitted model returns Tripo's own 1004 error through the proxy, undebited.
- **`rig` has its OWN model enum, disjoint from generation**:
  `v1.0-20240301, v2.5-20260210`. And Tripo defaults an omitted rig `model`
  to its GENERATION default (`v2.5-20250123`) and then rejects it against
  the rig enum — so a rig request without `model` always fails with an
  error naming a value the caller never sent. The proxy briefly dropped the
  caller's `model` on this route and every rig failed exactly that way
  (customer bug report, Sep 1 — fixed same day: `model` now passes through
  here like everywhere else). Always send one of the two rig values.
- `image-to-model` takes Tripo's `file` OBJECT, not an `image_url` string:
  `{"model":"P1-20260311","face_limit":5000,"texture":true,
    "file":{"type":"png","url":"https://…"}}`.
  The 400 for a missing file now carries this example. The URL can be a
  signed URL straight from `/api/v1/images/generations` — image → 3D with
  no upload step.
- Tripo can OVERRIDE parameters: a `texture:false` request on v2.5 came back
  `texture:true, pbr:true` and consumed 20 credits against our 10-credit
  estimate. The settle-time reconciliation exists precisely for this.
- Tasks really do sit at 99% for around a minute. Keep polling; never resubmit.
- A failed task that reports no consumption figure refunds in full.

## Ops

- Env: `TRIPO_API_KEY` (owner's Tripo account; routes answer 503 without it).
- Migration: `supabase/89_tripo_tasks.sql` (owner runs by hand, as always).
- Smoke test once the key exists: `npx tsx scripts/tripo-smoke.ts "a test cube"`
  — creates the cheapest no-texture H-tier task, polls to terminal, prints the
  reconciled cost.
- Not wired into XCreate/XBoard: this is an API-only surface for agents/games.
  No ai_models rows — Tripo isn't a votable model, it's a proxied service.
