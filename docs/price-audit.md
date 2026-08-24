# Model Price Audit — procedure

> How to verify `ai_models` pricing against each provider's official pages
> and fix stale rows. Written 2026-08-19 after the first audit found
> gpt-5.6-luna 5× and gpt-5.6-terra 25% above OpenAI's real prices —
> stale prices flow into XBoard display, XDuel's price-aware vote, and
> XCreate billing, so this audit matters beyond cosmetics.

## Rules

1. **The provider's official pricing page is the only source of truth.**
   Never trust litellm's community price map, aggregator blogs, or model
   memory — a third-party number that happens to be right is still
   unverified. Check the page.
2. **`ai_models` is what the site believes.** After the audit, the table
   must equal the official page. Prices are **per 1M tokens** everywhere.
3. **LIST (original) prices ONLY — never discounts** (owner rule,
   2026-08-19, emphatic). Limited-time promos ("40% off"), dated intro
   prices ("$0.75 through Dec 31, 2026"), and launch discounts are all
   skipped: record the permanent/list price the page states or reverts to.
   A price cut only counts when it IS the new list price with no
   expiration attached (e.g. Sonnet 5's $2/$10 became permanent —
   that one is real).
4. Audit **only rows with `enabled = true`** first; disabled rows are
   lower priority.
5. **Log the date** you verified each provider (bottom of this file).

## Step 1 — read the catalog

The Supabase MCP connection is **read-only**. Read with it freely:

```sql
select model_name, enabled, model_pricing
from ai_models
where provider = '<provider>'
order by model_name;
```

Pricing shape (see `docs/ai_models-schema.md` for the full spec):
- Text rates: `model_pricing.tokens.text_input` / `text_output` /
  `cached_input` (per 1M USD). `text_output` may be an object
  `{ default, by_level: { <thinking_level>: rate } }`.
- Media rates: `tokens.image_input` / `image_output` / `audio_input` /
  `video_input`, plus `per_image` and `per_video_second` maps.

## Step 2 — read the official pages

Exact URLs verified working on 2026-08-19 (several providers moved domains;
these are the pages that actually load, not the historical ones):

| Provider | URL that works | Gotchas |
|---|---|---|
| openai | platform.openai.com/docs/pricing → redirects to developers.openai.com; per-model pages at `/docs/models/<id>` | openai.com itself is Cloudflare-walled — use the platform docs. Use the **Standard / short-context** column, NOT Batch/Flex/Fast-mode or long-context. |
| anthropic | docs.anthropic.com/en/docs/about-claude/pricing (renders at platform.claude.com) | Whole table in one page load, easiest audit. Cache **writes** cost more than reads; catalog's `cached_input` = cache **read** rate (0.1× input). Sonnet 5's $2/$10 intro price became permanent (Sep 2026 increase cancelled). |
| google | ai.google.dev/gemini-api/docs/pricing | **Tables live in Standard/Batch/Flex/Priority tab panels that `get_page_text` misses** — extract with JS over `document.querySelectorAll('table')` mapping each to its nearest h2/h3 (see Method). Bill from the **Standard** tab. Dated intro prices ("$X through Dec 31, 2026") are promos — per rule 3, carry the permanent price and log the promo. Per-model capability pages at `/gemini-api/docs/models/<id>` (thinking levels differ between siblings — 3.7 Flash rejects `minimal`). |
| alibaba | alibabacloud.com/help/en/model-studio/model-pricing; web-search fee at `/help/en/model-studio/web-search` | Use the **Singapore** tab (intl endpoint) — Beijing prices differ. Page is huge (~50k chars): pull remainder via JS `innerText.indexOf(...)` slices. "List price $X **Limited-time N% off**" rows: catalog carries **list** (their doc: "This document only lists standard prices"); log the promo. Search fee: agent policy, Singapore = $10/1k = $0.01. |
| xai | **docs.x.ai/developers/pricing** (full tables incl. Imagine); docs.x.ai/docs/models is summary-only, old /docs/… paths 404 | Imagine rows bill per image/second + a **media input** charge per reference image — 2.0's input price (0.01) differs from 1.0's (0.002). Text = short-context column. |
| moonshot | **platform.kimi.ai/docs/pricing/chat-k3** (moonshot.ai redirects to kimi.ai; per-model pages linked from `/docs/pricing/chat`) | Table has cache-HIT and cache-MISS input columns — `text_input` = miss, `cached_input` = hit. |
| minimax | **platform.minimax.io/docs/guides/pricing-paygo** (one page: LLM + video + audio) | H3 video: input images beyond the first 5 bill $0.04 each, input video bills at output rates — we don't model input charges (fine ≤5 refs). |
| runway | docs.dev.runwayml.com/guides/pricing/ | Credits at **$0.01/credit** → USD. Watch per-resolution splits (seedance2_5 is 20/30/68 credits for 480p/720p/1080p, NOT flat), minimums (80-credit floor), and input/reference-video surcharges we don't model. |

## Method (what actually works)

- Use the in-app browser: `preview_start {url}` once, then `navigate` +
  `get_page_text` per provider. NOT WebFetch (weekly limit) and never memory.
- When `get_page_text` returns blurbs without numbers, the prices are in
  tabbed/collapsed DOM — run `javascript_tool` extracting every `<table>`
  with its nearest preceding h2/h3 and the enclosing `[role=tabpanel]` id,
  then read only the Standard/Singapore/short-context panel.
- Write step (service-role): `npx tsx - < script.mts` **from the repo root**
  (stdin resolves `@supabase/supabase-js` from the repo's node_modules; a
  script file in the scratchpad fails as CJS / module-not-found).
- Fixes that touch non-`tokens` keys (`per_image`, `per_video_second`,
  `per_audio_minute`) need targeted merges per key — don't reuse the
  tokens-only loop from the original template.

## Step 3 — compare

Build a row-by-row table: catalog vs official (input / output / cached,
plus media keys where present). Anything that differs is a finding.
Exact multiples (5×, 1.25×) usually mean a launch-price row that the
provider later cut.

## Step 4 — update (writes)

The MCP tool cannot write (read-only transaction). Use the service-role
client from the repo root — this is the same mechanism the app's own
server code uses:

```bash
npx tsx - <<'EOF'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// EDIT THIS LIST — [model_name, corrected tokens object]
const fixes = [
  ['some-model', { text_input: 0.2, text_output: 1.2, cached_input: 0.02 }],
] as const

for (const [name, tokens] of fixes) {
  const { data: row, error: e1 } = await sb.from('ai_models')
    .select('model_pricing').eq('model_name', name).single()
  if (e1) throw e1
  const pricing = { ...row.model_pricing, tokens }   // preserves per_image etc.
  const { error: e2 } = await sb.from('ai_models')
    .update({ model_pricing: pricing }).eq('model_name', name)
  if (e2) throw e2
  console.log(name, '->', JSON.stringify(tokens))
}
EOF
```

**Careful:**
- The spread preserves non-token keys (`per_image`, `per_video_second`) —
  if you're fixing those, merge them explicitly instead.
- If official pricing varies by thinking level, write the
  `{ default, by_level }` object shape, not a flat number.
- dev and prod share ONE Supabase project: the change is live on
  production the moment it runs. That's expected — prices should be
  correct everywhere immediately.

## Step 5 — verify + record

1. Re-select the rows (MCP read) and eyeball against the official page.
2. **Stamp `pricing_audited_at` on EVERY row you checked** — the fixed
   ones AND the verified-correct ones (migration 83; the stamp is the only
   DB trace that a correct row was ever audited):

```ts
await sb.from('ai_models')
  .update({ pricing_audited_at: new Date().toISOString() })
  .in('model_name', checkedNames)   // every row compared, not just fixes
```

3. Append a line to the audit log below.
4. If XEval's runner (`~/Documents/Claude/Projects/XEval/gdpval-xd/`)
   has the model in its `PRICES` dict, update it there too and recompute
   stored `cost_usd` from the stored token counts.

Price CHANGES need no manual record beyond the log line: migration 83's
trigger writes old→new into `ai_model_price_history` on every
`model_pricing` write, whatever the write path (audit script, admin UI).
Price at a past date = latest history row with `changed_at <= date`.
Stale-audit check:
`select model_name, pricing_audited_at from ai_models where enabled order by pricing_audited_at nulls first;`

## Downstream effects of a fix (know, don't skip)

- **XBoard** shows the new price immediately.
- **XCreate** bills at the new price for future runs; past charges used
  the stale price (owner decides if any remedy is owed).
- **XDuel vote2** (price-aware) showed the stale price historically —
  those votes can't be honestly retro-edited; the rating refit will
  slowly re-weight as new votes arrive.

## Promos observed (NOT listed, per rule 3 — recheck that they ended)

- Gemini 3.6 + 3.7 Flash: $0.75/$3.75 dated intro through Dec 31, 2026
  (list 1.5/7.5/0.15 — that's what we carry).
- HappyHorse 1.1: 40% off list; HappyHorse 1.0: 20% off list.
- **gpt-5.6-sol: promo 4/20/0.4 "at least through Nov 21, 2026"** (seen
  2026-08-20; list 5/30/0.5 — that's what we carry). If OpenAI later drops
  the expiry (Sonnet-5-style), adopt the new number then.

## Open items for the owner (not price errors)

- HappyHorse 1.1 has a **480P tier ($0.07 list)** the catalog doesn't carry.
- Unmodeled input-side charges (we bill output only): MiniMax H3 images
  beyond 5 ($0.04 ea) and input video; Runway seedance2_5 input/reference
  video (15/34/10 cr/s) and 80-credit minimum; HappyHorse video-edit and
  Wan r2v/video-edit bill input duration too.

## Audit log

| Date | Provider | Checked by | Result |
|---|---|---|---|
| 2026-08-19 | openai | Claude | 6 rows checked; 4 correct; fixed gpt-5.6-luna (1/6/0.1 → 0.2/1.2/0.02) and gpt-5.6-terra (2.5/15/0.25 → 2/12/0.2) |
| 2026-08-19 | anthropic | Claude | 4 rows, all correct (Fable 5 10/50/1, Opus 5 + 4.8 5/25/0.5, Sonnet 5 2/10/0.2; $0.01/search). Sonnet 5 intro price now permanent. |
| 2026-08-19 | google | Claude | 10 enabled rows; fixed **gemini-2.5-flash-image** text_output (3 → 2.5). gemini-3.6-flash was briefly set to the 0.75/3.75 dated intro price, then **reverted to list 1.5/7.5/0.15 same day when the owner set rule 3** (list only). **Added gemini-3.7-flash** at list 1.5/7.5/0.15 (thinking levels low/med/high only — `minimal` errors). All per-image maps, veo-3.1 tiers, omni-flash, flash-lites correct. |
| 2026-08-19 | xai | Claude | 4 rows; fixed **grok-imagine-image-2.0** input_image (0.002 → 0.01). All output rates correct. |
| 2026-08-19 | moonshot | Claude | kimi-k3 correct (3/15/0.3). |
| 2026-08-19 | minimax | Claude | MiniMax-H3 correct (768P 0.08, 2K 0.13). |
| 2026-08-19 | runway | Claude | 3 rows; fixed **seedance2_5** (flat 0.45 → 480p 0.2 / 720p 0.3 / 1080p 0.68, default 0.3). gen4_turbo 0.05 and gen4.5 0.12 correct. |
| 2026-08-19 | alibaba | Claude | 11 enabled rows; fixed **fun-asr** (0.002 → 0.0021/min). qwen3.6-plus, qwen-image-2.0-pro, all HappyHorse (list), wan2.7-i2v, $0.01/search correct. Disabled qwen3-asr row already correct. |
| 2026-08-20 | openai (gpt-image-2, whisper-1) | Claude | Re-verified the 2 rows the Aug-19 "6 rows" log left ambiguous: gpt-image-2 token rates correct (text 5/1.25, image in 8, image out 30); whisper-1 correct at $0.006/min — **dropped from the pricing index page but its per-model page is live** (not deprecated). |
| 2026-08-20 | — (migration 83 backfill) | Claude | All 46 rows stamped `pricing_audited_at` at their real audit times; 9 `source='backfill'` history events inserted for the pre-trigger Aug-19 changes (7 fixes + 3.6-flash promo flip/revert + 3.7-flash creation). History is complete from Aug 19 onward. |
| 2026-08-20 | openai (owner-triggered recheck) | Claude | 7 rows re-audited after OpenAI's adjustment. Only **gpt-5.6-sol** moved — promo 4/20/0.4 thru ≥Nov 21 2026; per rule 3 catalog keeps list 5/30/0.5, **no writes**. gpt-5.5 (5/30) and gpt-5.5-pro (30/180) unchanged → landing $7,800 + 120× derivations stand. New on page, not added: gpt-5.3-codex ($1.75/$14, coding specialist), chat-latest, gpt-5.4 family (older gen). |
