# XEval — the page, the pipeline, and every decision behind it

> Handoff doc. Last updated **2026-08-26**. If you are a new session touching
> `/xeval`, read this first, then `~/Documents/Claude/Projects/XEval/gdpval-xd/README.md`
> (the eval runbook) and `.../gdpval-xd/OPEN.md` (open eval decisions).
>
> **Two repos, one product.** The PAGE lives in this repo
> (`app/xeval/page.tsx`). The EVAL MACHINERY and all raw data live in a
> separate, non-git-tracked-by-ModelXD project:
> `~/Documents/Claude/Projects/XEval/gdpval-xd/` (its own git repo). They meet
> at three Supabase tables.

## 1. What the page is

`/xeval` publishes ModelXD's own benchmark operation: public benchmark task
sets, run in open-source harnesses, scored with a fully disclosed protocol,
with **measured cost per task** and **(model × reasoning-effort) as the unit**
— two things no other leaderboard publishes. It is separate from XBoard
(XBoard = human blind votes cast on ModelXD; XEval = benchmark replication).

Public, no sign-in. Desktop-first. 5 languages (all strings via `lib/i18n.tsx`,
keys prefixed `xeval.`).

### Live state (2026-08-26)

**Benchmark 1 — GDPval** (fit `716d77dd`, 12,402 games, 22 rating rows):

| # | entry | rating | $/task |
|---|---|---|---|
| 1 | **ModelXD Autopilot @ auto** | **1970** | 5.76 |
| 2 | Grok 4.6 @ xhigh | 1699 | 2.38 |
| 3 | Claude Opus 5 @ max | 1686 | 5.28 |
| 4 | Claude Fable 5 @ max | 1664 | 10.29 |
| 5 | GPT-5.6 Sol @ xhigh | 1631 | 1.64 |
| … | (20 model entries total) | | |
| 22 | **Human expert** | **1000** (anchor) | — |

**Benchmark 2 — Terminal-Bench 2.1** (21 tasks, verifier-scored, no judges):

| # | entry | solved | pass | $/task | $/solved |
|---|---|---|---|---|---|
| 1 | **ModelXD Autopilot** | 18/21 | 86% | 0.50 | 0.58 |
| 2 | GPT-5.6 Sol @ xhigh | 15/21 | 71% | 0.57 | 0.79 |
| 3 | Claude Opus 5 @ max | 15/21 | 71% | 0.86 | 1.20 |
| 4 | Grok 4.6 @ xhigh | 14/21 | 67% | 0.45 | 0.68 |

Lifetime eval spend ≈ $1,900 (runs + judging + rubric, both benchmarks).

## 2. Data flow

```
gdpval-xd/xeval.db  (SQLite: tasks, runs, judgments, ratings, rubric_scores, deliverables)
        │  scripts/publish.py   (owner-triggered, service-role key, NEVER automatic)
        ▼
Supabase: xeval_ratings · xeval_runs · xeval_judgments   (public read RLS)
        ▼
app/xeval/page.tsx   (client-side fetch on mount; no API route)
```

- **Migrations**: `83_xeval.sql` (tables), `85_xeval_router_row.sql`
  (`xeval_ratings.avg_cost_usd` — the Autopilot row has no runs of its own, so
  its cost travels on the rating row), `86_xeval_multibench.sql`
  (`xeval_runs.score` + `.harness` — TB is verifier-scored).
  Owner runs migrations by hand in the Supabase SQL editor.
- `publish.py` pushes only the **latest panel fit**, the latest finished run
  per (task, model, effort), and the verdicts that fit used; it then **prunes**
  superseded/disabled rows so the page never averages stale costs.
- The page's methodology text is **client-rendered** — `curl | grep` will not
  see it. Verify with the browser tools, not curl.

## 3. Protocol (what the methodology paragraph promises)

- **Entries** are (model, reasoning-effort) pairs. Membership comes from the
  catalog: `ai_models.eval_config = {"efforts": [...]}` (migration 84).
- **Judging**: pairwise, anonymized, order-randomized, forced choice (no ties),
  by a **4-judge panel at high effort** — `claude-opus-5`, `gpt-5.6-sol`,
  `grok-4.6`, `qwen3.8-max` (Qwen added Aug 23 as the outside judge; it is
  also a contestant, and its own row sits mid-ladder).
- **No self-judging**: a judge never scores a pair containing its own model
  (`ratings.py` panel fit drops such verdicts; `judge.py` never buys them).
  Reason: Opus-as-judge went 8-1 for Opus@max vs Grok@xhigh while the other
  two judges saw it ~even.
- **Rule forfeits**: an entry submitting no deliverables loses by rule
  (`method='rule:no_deliverables'`), counted once per judge.
- **Ratings**: Bradley-Terry (same math as `lib/xdrating.ts`),
  `BASE=1000, PRIOR_MATCHES=2, ITER=50`, **anchored** with
  `--anchor human-expert` so 1000 = the GDPval professional whose deliverables
  ship with the dataset and which we enter as a contestant. Without the anchor
  the scale is mean-normalised and every rating moves when the pool changes.
  The anchor is why our numbers read 1600-1900 like AA's GDPval-AA.
- **Costs**: measured from actual token usage at catalog list prices, cached
  input at the cached rate. (Runs before 2026-08-22 were cache-blind and
  overstated 2-3x; everything published now is season-2 re-measured.)

## 4. ModelXD Autopilot — the row that is the product

`gdpval-xd/xeval/router_row.py` appends it to any fit.

**What it is**: for every task in the library, ModelXD serves the entry that
**measured best on that task** (ties → the cheaper run). Its games and costs
are those served runs' real verdicts and real costs. It is a *measured
selection over completed runs* — the methodology says so in one sentence,
in 5 languages — while every other entry ran blind.

**How it is rated**: 1-D Bradley-Terry best response against the fit's
**frozen** opponent strengths, so appending the row never moves the published
ratings.

**Effort label is honest by construction**: `@ auto` when the picks span
several effort levels (they do now: 9 different entries across max/xhigh/high),
`@ max` when they don't.

**Naming history** (do not re-litigate): "ModelXD Router @ table-v1" (a
predictive bucket rule — RETIRED, it lost) → "ModelXD Router @ auto" →
**"ModelXD Autopilot"** (owner, Aug 25). Mark: a four-point **sparkle ✦**
(`PROVIDER_SHAPE.modelxd = 'sparkle'`), the only one on the chart.

**Why the oracle IS the product** (owner, Aug 24 — this is the core thesis):
> "We should classify each user task to one of the tasks we benchmarked, and
> use the best model for that task. So what we claim is actually the oracle."

Three attempts to *compress* the library into a predictive rule (sector→model,
prompt-shape→model, embedding nearest-neighbour) all failed out-of-sample —
see `gdpval-xd/docs/eval2-route.md` and `docs/similarity-loo.md` (NN winner
transfer 30% vs 52% baseline at 27 tasks). The conclusion is **not** that
routing is worthless: the library lookup works, it just needs **density**.
Library size is therefore the growth axis, and LOO-transfer-vs-baseline is
the metric to watch as tasks are added.

## 5. Page structure (`app/xeval/page.tsx`, ~700 lines, one file)

- **Benchmark switcher** — tabs are derived from the published data
  (`runs.task_set`), so a new benchmark appears the moment its rows publish.
  `bench === 'gdpval'` renders the BT ladder; anything else renders
  `<TBSection>` (pass rate + $/solved, its own methodology).
- **Filters**: PROVIDER (shape) · EFFORT (color) · **TIER**. "Tier" is the
  official level-3 vocabulary — OpenAI: *"Sol, Terra, and Luna identify
  durable capability tiers"*; Anthropic uses Opus/Sonnet/Fable the same way.
  Derived from `model_name` patterns (`tierOf`); the catalog has no tier column.
- **Frontier chart**: rating vs $/task, **log cost axis by default** (LIN/LOG
  toggle — OpenAI's price-performance charts use log), zoom/pan both axes,
  shape=provider, color=effort, labels with hover-to-front.
- **Table**: sortable; "Top 10" by default with "Show all N"; "Best per model"
  = each model's highest effort. Heatmap chips use **quintiles of the fit's own
  rating spread** — absolute cutoffs painted everything 'elite' once the ladder
  became anchored (1000-2000).
- **Run-less entries** (Autopilot, Human expert) have no `xeval_runs` row, so
  they need `SPECIAL_DISPLAY` names, an `avg_cost_usd` fallback, and a tier
  label; they are easy to break — check both when touching the table or chart.

## 6. Standing rules (owner decisions — do not silently change)

1. **Complete rows only** (Aug 25): an entry appears on the ladder only with
   full coverage of the enabled task set. `publish.py` enforces it and removes
   stale partial rows. Cost: adding a task means running it for every listed
   entry (~$20-40/task) before the ladder updates.
2. **Hybrid scoring** (Aug 25) — retires O(N) re-pairing:
   (a) rubric-score every run once (absolute 0-1, `xeval/rubric.py`, ~$0.03/run);
   (b) large rubric gaps decide those pairs for free (`rule:rubric_gap` — TO
   IMPLEMENT in `judge.py`); (c) a new entry joins via ~3 **anchored** pairwise
   comparisons per task (~$15/entry, constant) instead of fighting the whole
   pool (`judge.py --anchors` — TO IMPLEMENT).
3. **No self-judging** (Aug 22), **list prices only**, **runaway spend excluded
   from reports** (the task still counts as a fail).
4. **Never publish or push without explicit owner approval**, per push. A bug
   report is approval to fix locally, not to deploy.
5. www/main is **not** an open item (owner, Aug 26) — `main` has no `/xeval`
   and that is fine; dev is the working surface.

- **Autopilot rule stays quality-first (owner, 2026-09-02): sector leader by
  mean per-task WIN RATE (equal-games), cheapest only on an exact tie.** Raw
  net score was replaced the same day — see §8c. A cost-aware variant
  (cheaper entry that ties/beats the leader head-to-head takes the sector) was
  computed and declined; on the Fable 5.1 fit it would have moved one sector
  (Government → Opus 5) for $14.93 → $12.88. When one entry wins every sector
  the Autopilot row IS that entry's 27 runs; its rating differs by ~1 Elo
  because it is fitted as a frozen-opponent append rather than jointly. That
  is expected noise, not a lead — leave it.

## 7. Gotchas that cost real time

- **Parallel sessions collide.** On Aug 25-26 another session built the human
  anchor (commit `16fe682`) while this one added Qwen as 4th judge. Each looked
  like a bug to the other; I deleted its live human row believing it a leak.
  **Check `git log` in gdpval-xd before "fixing" a surprise**, and coordinate
  through `OPEN.md`.
- **A `tail -F` monitor never exits** — TaskStop it when its job finishes.
- **Concurrent judge streams race on SQLite**: each pass ends with a throwaway
  mini-refit that can raise `Traceback` when another writer holds the DB.
  Verdicts are committed before that point; the official refit runs alone.
- **`--max-pair-verdicts N`**, not "only unjudged pairs": sequential judges each
  skipping already-covered pairs gives every new pair ONE verdict, not two.
- **Judges are per-provider** — run them as parallel streams (3x faster).
- **`caffeinate`** wraps every entry point (the Mac idle-sleeps mid-call).
- **Docker/Colima is 2 CPU** — TB cells must run strictly sequentially; three
  concurrent lanes caused the TB 2.0 timeout pollution.
- **Cost guards**: per-cell `--max-cost`, plus an episode+dollar runaway guard
  on TB lanes (Opus once spent $114 on one TB cell, $55 on another).

### Gotcha: a benchmark whose entries have `effort = NULL` vanishes at publish (2026-09-01)

`scripts/publish.py` picks each cell's latest run with a correlated subquery
that compared `r2.effort = r.effort`. `NULL = NULL` is false in SQL, so every
run with a NULL effort matched nothing and was dropped — the text-rendering
set imported 216 rows locally and published **zero**, with no error. Fixed to
`r2.effort is r.effort`. This is CLAUDE.md pitfall 13 and it has now bitten
twice (the human-baseline row in the GDPval fit, then this). Any new lane
whose entries carry no effort label (image models, Qwen's native thinking)
must be checked in Supabase after publish, not trusted from the upsert count —
the count was 690 both times and looked fine.

## 8c. Fable 5.1 on GDPval + the Autopilot router bug (2026-09-02)

**Fable 5.1 @ max published: 1946 Elo, #1.** 27/27 tasks, $403.01 runs
($14.93/task; two multi-leg chains), $178.31 judging (4 judges; 312 pairs with
4 verdicts, 251 with 3 where a judge shared the entry's model), rubric ~$3.
Total ≈ $585 against a $440 quote — see `docs/XEVAL-NEW-MODEL.md` for why.

**Router bug, fixed the same day.** `router_row.py` keyed entries on
`(latest[rid][1], latest[rid][2])`, but column 1 of its SELECT is `task_id`,
so every "entry" was unique to one task, no sector winner could match any
other task, and every task fell back to its own per-task best. The published
Autopilot since Aug 29 (1859 Elo, $4.09/task, "@ auto") was therefore the
per-task ORACLE, not the owner's sector-best rule — and its `params` even
said so (`ROUTER=full-pool-winner-per-task`). Key is now `(model, effort)`,
the label reads `sector-best`, and the per-sector picks are printed and
stored in `params` (`PICKS=…`).

**Under the real rule, Fable 5.1 wins all 9 sectors**, so the Autopilot IS
Fable 5.1: **1947 Elo, $14.93/task, "@ max"** (one effort → label "max").
The 1922/$9.31 "@ auto" row that the buggy path produced on the same fit was
deleted from Supabase by hand (publish only upserts; an entry rename leaves
the old row behind — now pruned by `publish.py`).

Consequence for the product story: on GDPval today the Autopilot no longer
beats the best single model on price, because one model is best everywhere.
The sector rule still pays off on TB 2.1 (86% vs 81%) and LAB (47% vs 39%),
where winners differ by category. Any copy claiming GDPval savings from the
Autopilot must not be written until a sector is won by a cheaper model.

## 8d. Social (SOTOPIA-hard): two dots per model (2026-09-03)

The fifth ladder, `task_set = 'sotopia-hard'`, tab **Social (SOTOPIA)**,
`/xeval?b=social`. CMU's SOTOPIA-hard: 20 scenarios, 70 env-agent combos,
two characters with private goals (craigslist bargains, social chemistry,
social IQa, persuasion, deal-or-no-deal). The tested model sits in chair 1,
Gemini 3.7 Flash at default is the fixed partner in chair 2, an LLM judge
outside the tested family scores the 7 SOTOPIA-Eval dimensions (Sol for
everyone, Opus 5 for the Sol entries). `runs.score = goal/10`,
`spec_pct = overall/10` (mean of the 7 dims, shown as Coverage), sector =
the scenario's source dataset, `model_s` = mean per-call latency of the
tested chair.

**Effort is a run dimension (owner, Sep 3): every model plays the same 70
scenes twice, at the lowest and the highest thinking setting its API
accepts**, labelled with the provider's own value. Provider defaults were
probed and every model thinks by default — so "default" is neither
comparable nor reproducible and was dropped. The ends: Sol none/xhigh;
Opus 5 none (disabled)/high; Fable 5.1 low/high (cannot disable); Grok 4.6
low/xhigh (none rejected); Gemini 3.7 Flash low/high (minimal rejected);
Qwen 3.8 Max enable_thinking false/true. Judges and partner stay at default.

Run 2026-09-03, 12 entries × 70 scenes, **$130.69** (quote $115, +14%),
two lanes, ~2.8 h wall:

| entry | goal (0–10) | overall (7-dim mean) | s/turn (median) | $/entry |
|---|---|---|---|---|
| Opus 5 @none | 5.97 | 3.27 | 4.5 | 13.42 |
| Fable 5.1 @high | 5.99 | 3.18 | 6.7 | 18.49 |
| Fable 5.1 @low | 5.71 | 3.19 | 6.6 | 17.48 |
| Opus 5 @high | 5.90 | 3.17 | 4.6 | 14.22 |
| Gemini 3.7 Flash @low | 5.73 | 2.89 | 2.8 | 5.89 |
| Qwen 3.8 Max @high | 5.71 | 2.86 | 23.3 | 9.06 |
| Gemini 3.7 Flash @high | 5.76 | 2.84 | 6.0 | 7.53 |
| Sol @xhigh | 5.74 | 2.83 | 3.9 | 11.97 |
| Sol @none | 5.39 | 2.74 | 2.0 | 10.38 |
| Qwen 3.8 Max @none | 5.43 | 2.73 | 2.3 | 6.29 |
| Grok 4.6 @low | 5.36 | 2.49 | 6.1 | 6.72 |
| Grok 4.6 @xhigh | 5.11 | 2.48 | 24.6 | 9.24 |

**Low-end pair (owner, Sep 3: "people waste so much money"), run the same
evening, $12.14 (quote $10; the judge is ~95% of it — agent tokens were
$0.10 and $0.17):**

| entry | goal | overall | s/turn | $/entry |
|---|---|---|---|---|
| Gemini 3.5 Flash-Lite @none (does not think by default) | 4.86 | 2.54 | 0.8 | 5.08 |
| GPT-5.6 Luna @none | 4.76 | 2.52 | 1.5 | 7.06 |

Both sit significantly below their bigger siblings on the same scenes
(Flash-Lite vs Flash@low: goal −0.87 [−1.43, −0.36]; Luna vs Sol@none: goal
−0.63 [−1.04, −0.21]) and below Opus@none (−1.11 goal). So on SOTOPIA-hard
the model tier moves the score and the thinking level does not. Imported;
publication of these two rows is the owner's call.

**The curve is flat.** Paired on the same 70 scenes, no model's low→high
difference is significant on goal or overall (all six 95% bootstrap CIs
include 0; e.g. Sol goal +0.36 [−0.11, +0.86], Grok goal −0.24 [−0.69,
+0.19]). What the high setting buys is latency: Grok 6→25 s per turn, Qwen
2→23 s. Between models (same judge, Opus@none as reference) Gemini, Qwen and
Grok are significantly below on overall (−0.38, −0.41, −0.78); Fable@high
is level (+0.01 goal, −0.08 overall). The Sol entries were judged by Opus,
so Sol-vs-others is a cross-judge comparison; treat it as indicative.

Caveats recorded in the run: SOTOPIA drops a turn when a model returns an
empty action and the repair pass cannot parse it — 16 such turns across the
three Claude entries (~1–2% of turns), none elsewhere; and 2 repair calls on
the Opus entries failed because the pilot leaked Anthropic thinking kwargs
onto SOTOPIA's OpenAI repair model (fixed the same day, `2841c29` in
gdpval-xd: the effort now applies only to calls to the tested model).

Harness: `gdpval-xd/scripts/sotopia_pilot.py` (two-lane launch in the
docstring), `xeval/sotopia_import.py`; wire-level lessons in
`docs/XEVAL-MEDIA-PLAN.md` Phase S. **Published 2026-09-03 (fit fd1ad35c,
owner: "publish to dev and www"), live on both hosts.** Publishing it took
`xeval_runs` past 1,000 rows and exposed a page bug: the runs query had no
paging and Supabase silently caps a request at 1,000 rows, so every tab was
truncated for a few minutes (Social showed 37 of 70 scenes). The page now
pages the query in 1,000-row chunks — keep it that way. The page gained an
**effort-curve chart** under every verifier/rubric table (`EffortCurveChart`
in `app/xeval/page.tsx`): x = $/task (log), y = mean score, the efforts of
one model joined in effort order; it renders only when some model has two or
more efforts, so today it appears nowhere until Social is published.

## 8. Open items

- **Per-task library view** (designed, not built, zero new spend): a section
  showing every benchmarked task → what ModelXD serves → cost → rubric spec
  score → what a flagship would have cost. This is the Autopilot row's receipts
  and the library as a storefront. Needs one published column (rubric coverage).
- **Rubric-gap auto-verdicts** and **anchored joins** (rule 2b/2c above).
- **Library growth**: 199 unrun GDPval tasks ≈ $1,660 all-in — inventory, not
  eval spend. Track LOO transfer as it grows.
- **TB routing test**: TB's eval/test split (11 category pairs) can score a
  frozen category→entry rule for free from existing results.
- **Image/video benchmarking**: owner's item, not started — where ModelXD's own
  blind votes are the differentiator.
- Parked: TB 3.0 (74 tasks; only 12 fit this Mac, 4 need H100s — awaits
  funding), JobBench (no vendor citations).

## 8c. RESOLVED 2026-09-02: sector score is now win rate (equal-games), not raw net

`router_row` scores a task as raw **wins − losses** over all panel verdicts and
averages that per sector. It is never divided by the number of games, so an
entry whose pairs were judged by more judges scores higher for the same win
rate. Fable 5.1's pairs carry ~70 verdicts/task (full 4-judge panel) against
~52 for older entries, and that alone decided two sectors on fit fd1ad35c:

- Government: Opus 5 won 2 of 3 tasks by win rate (100%, 95% vs Fable's 82%,
  87%) yet Fable took the sector on net score (71–75 games vs 40–55).
- Health Care: Sol @none ties Fable on mean win rate (79%) at $0.21 vs $11.91.

Same rule, normalised (net ÷ games = win rate): Government → Opus 5, Health
Care → Sol @none, Autopilot **$10.89/task at 93.0%** instead of $14.93 at
92.2%. Owner's call on seeing the Government numbers: "why not let them play
the same times?" — `router_row` now defaults to `--metric winrate`; the row
was rebuilt on fit fd1ad35c and published: **Autopilot 1998 Elo, $10.89/task**
(Fable 5.1 in 7 sectors, Opus 5 in Government, Sol @none in Health Care).

## 8a. Coverage is capped by what the grader can SEE (found 2026-09-02)

`render_submission` (judge.py) shows judges and the rubric grader at most
**30,000 characters per file**. xlsx/pptx renderers announce the cut; docx,
pdf and text were cut **silently** — a 100 KB docx rendered to exactly 30,067
chars and read as a complete document. Both the pairwise Elo and the rubric
Coverage were computed on that truncated text.

Impact on the 27-task GDPval ladder (latest run per entry, files over the cap):
Grok 4.6 11/27 runs, **Fable 5.1 10/27 (37% of its text unseen)**, Opus 5
7/27, Qwen 6/27, Fable 5 5/27, Sol 4/27. Long-form writers are under-measured
most. It is symmetric in rule (everyone is cut at 30k) but not in effect.

What it does and does not mean:
- The ranking stands — judges compared what they saw, and the longest-form
  entry still won 1889 of 2037 games. Coverage for long deliverables is a
  floor, not a measurement.
- The **80% Coverage ceiling** shared by Fable 5.1, Grok and Qwen is partly
  this cap and partly the metric (44-item checklists graded by Grok @high).
- Spreadsheet tasks grade lowest ladder-wide (xlsx 65% vs pdf 82%): a row
  dump loses the structure the rubric asks about. 1752cb53 is 14–25% for
  EVERY model — the task, not any entry.

Fixed now: every file type announces truncation ("… (truncated: N more
characters not shown)"), so a grader no longer mistakes a cut for the end.
Not fixed: the cap itself. Raising it changes what judges see, so it belongs
to a new season with a full re-judge (~14k pairs, ~$1,000+), not a patch.

## 8b. Qwen3.8 Max on TB 2.1 — abandoned 2026-08-29 (do not re-run blind)

Ran 5 of 21 tasks, **1 pass**, ~$2, then stopped on owner call. Not published;
nothing was imported to `xeval.db`, so the TB ladder is untouched.

**Why it fails: slow generation with a fat tail — NOT verbosity.** The first
write-up here said "it thinks at length"; the comparison data disproved that
and it is corrected so nobody repeats the error:

| model | median tok/call | median tok/s | timeout rate |
|---|---|---|---|
| Gemini 3.7 Flash | 195 | 69 | 14% |
| Claude Opus 5 | 688 | 68 | 32% |
| Grok 4.6 | 304 | 56 | 21% |
| GPT-5.6 Sol | 505 | 43 | 10% |
| Qwen3.8 Max | 612 | 43 | 40% (n=5) |

- Qwen's tokens per call are **mid-pack** — below Opus, which scored 71%.
- Its generation speed is the **slow tier**, ~43 tok/s, roughly half Opus and
  Gemini. Opus writes more per turn and still finishes each turn in a third
  of the time.
- **Timeouts are TB-wide.** Opus times out on 32% of trials and still places
  second. Qwen's 40% on five trials is statistically indistinguishable from
  that; the CI runs roughly 5-85%.
- The typical Qwen turn (~14s) is close to Sol's, which scored 71%. What kills
  it is the tail: occasional 2,000-8,000-token turns at 43 tok/s land at
  50-190s each, and a few of those eat a 15-minute task budget.

Two independent measurements agree the time is generation on Alibaba's side,
not network: 10 of the 11 calls over 60s ran at 33-54 tok/s (normal
throughput for their length), and Model Studio's own console reported
**28.17s average call duration** against our **29.86s** end-to-end from the
Mac — a ~1.7s gap that is the 192ms RTT to Singapore plus TLS. A controlled
Singapore-vs-Virginia A/B (5 calls each, streaming) then showed identical
TTFT (1.54s vs 1.61s) and throughput (35.6 vs 36.0 tok/s): Alibaba's
"routing issue" explanation is not supported. Only ONE call in 107 was a
genuine anomaly (620s for 874 tokens).

**Do not raise the timeout multiplier to rescue it.** All four published
entries ran at 1.0, and timeouts hit every model — a 2x run would change
Opus's score most of all and invalidate the ladder. If Qwen is ever finished
it runs at 1.0 on the remaining 16 tasks (~$3) and publishes whatever it gets.

Setup facts worth keeping if it is ever re-run:

- **`DASHSCOPE_API_BASE` must point at the International endpoint** — litellm's
  dashscope default is the China host and 401s our key. Now pinned in `tb.sh`.
- **litellm rejects `reasoning_effort` for dashscope.** qwen3.8-max returns
  `reasoning_content` by default, so its native thinking IS its best effort and
  the entry lands with `effort` NULL — any join on it needs `is`, not `=`.
- **Alibaba's content inspection refuses some published TB tasks outright**
  (`DataInspectionFailed` on `break-filter-js-from-html`). Console showed 9
  failed calls of 132 (6.82%). Our convention already counts a refusal as a
  FAIL with spend excluded.
- **The dollar arm of the runaway guard is inert for dashscope** — per-step
  `cost_usd` is not populated in the trajectory, so the guard reads $0. The
  150-episode arm still holds.
- **No request IDs are recoverable.** Harbor discards litellm's response id, and
  Model Studio's audit/inference logs require SLS authorization that was never
  completed on this account — SLS is not retroactive, so nothing was captured.
  Its aggregate TTFT column is blank because we call non-streaming.

**Qwen's implicit cache is real and routine: 75–78% of input tokens hit.**
`ai_models.cached_input` for qwen3.8-max is still null. The rate IS published —
**$0.25/M for Singapore**, on the model's own info page, region-specific
(Beijing is $0.206/M implicit). The general pricing doc misleads: it says the
rate "is not 20% of the input_token unit price" and points at the console,
which reads as undisclosed — it is 12.5% of the $2/M input rate, stated
elsewhere. While the column stays null, any recomputed cost bills cached
tokens at full $2/M and **overstates Qwen's $/task**. Owner stays on the
Singapore endpoint (US Virginia rejected 2026-08-30 as not worth the
region-scoped key and `-us` model-suffix handling), so $0.25/M is the rate
to use if it is ever filled.

## 9. Cost-accounting audit (2026-08-27) — long-context tiers do NOT apply

The page advertises measured cost, so the catalog's flat per-model rates were
checked against every vendor's long-context schedule. Result: **all published
costs are correct**; no correction needed.

| vendor | long-context tier | our exposure |
|---|---|---|
| OpenAI (Sol/Terra/Luna) | >272K input tokens → **2x input, 1.5x output, applied to the WHOLE request** (not just the excess, and cached input too) | **Never triggered.** Largest single turn measured: Sol 202,907 · Terra 115,114 · Luna 115,560 |
| Anthropic (Opus/Fable/Sonnet) | **None.** Docs: *"the full 1M token context window at standard pricing — a 900k-token request is billed at the same per-token rate as a 9k-token request"* | Opus@max had 20 turns >272K; no surcharge exists |
| Google (Gemini Flash) | **None** — flat regardless of context; only Gemini *Pro* has the >200K jump | Gemini@high had 14 turns >272K; no surcharge exists |

Method: `work/runs/*/transcript.jsonl` records `token_usage.input` per assistant
turn (per REQUEST, which is what vendors bill on — not the run total). Re-run
that scan if a new provider or a much longer task set is added; the OpenAI
cliff is the one that would actually cost money.

**Known and deliberate**: Gemini 3.7 Flash bills $0.75/$3.75 today (promo
through 2026-12-31) but the catalog carries the $1.50/$7.50 list price, per the
owner's list-prices-only rule — so the page overstates Gemini's *current* real
cost ~2x. Sonnet 5 is the opposite case and is fine: its $2/$10 introductory
price became permanent, and that is what the catalog holds.

Spot-checked at the same time: GPT-5.6 Luna is genuinely $0.20/$1.20 (an 80%
cut on 2026-07-30, from $1/$6) — it is the cheapest judge available by ~8x,
but under all-pass rubric scoring one bad verdict zeroes a whole task, so it
belongs in a cross-check role, not as a primary judge.

## 10. Backups — the data exists in one place

`gdpval-xd` is a **local-only git repo with no remote**, by design (eval data
stays out of the ModelXD repo). Everything the eval operation has produced
lives on one Mac, so it is backed up to a **private Supabase Storage bucket
`xeval-backup`** by `gdpval-xd/scripts/backup.sh`.

Two tiers, because they differ 30x in size and in what losing them costs:

| tier | what | size | why it matters |
|---|---|---|---|
| `db` (default) | `xeval.db` gzipped | ~11 MB | 930 runs, 14,558 verdicts, 23,145 rubric marks, every cost. Without it no ladder can be rebuilt. |
| `--deliverables` | `work/runs` tarred + split into 40 MB parts | ~300 MB | The documents the models actually produced — **~$1,900 of runs**. Keeping them is what lets a NEW judge re-score old work without re-running a single model. |

`work/docker-tmp` (1.5 GB) is scratch and is never backed up.

```bash
scripts/backup.sh                 # db only — fast, safe, run it often
scripts/backup.sh --deliverables  # + the 300 MB tier
scripts/backup.sh --list          # what is already in the bucket
# restore deliverables:
cat runs-<stamp>.tar.gz.part-* | tar xzf -
```

Notes: the db is copied with sqlite `.backup` (not `cp`) because run/judge
lanes may be mid-write; uploads are `x-upsert` and date-stamped, so nothing is
ever overwritten; the bucket is **private** — it holds model deliverables and
the full verdict history. If the Supabase plan gets tight, move the
deliverables tier to R2/B2 and keep only the db here.

## 11. Command cheat-sheet (from `gdpval-xd/`)

```bash
# run one cell
XEVAL_MAX_WALL_S=7200 .venv/bin/python -m xeval.run_one --task <id> --model <key> --effort <e> --max-cost 10 --season 2 [--resume]
# judge one task with one judge (idempotent; skips covered pairs)
.venv/bin/python -m xeval.judge --task <id> --judge <model> --effort high --concurrency 4 --max-pair-verdicts 2
# rubric-score runs (absolute 0-1)
.venv/bin/python -m xeval.rubric --tasks enabled --entries all
# official refit (anchored, 4-judge panel) + Autopilot row
.venv/bin/python -m xeval.ratings --judge panel --effort high --tasks enabled --anchor human-expert
.venv/bin/python -m xeval.router_row --fit <fit_id>
# Terminal-Bench: run lane + import
../terminal-bench/tb21_lane.sh
.venv/bin/python -m xeval.tb_import ../terminal-bench/runs --tasks-root ../terminal-bench/tb21 --set terminal-bench-2-1
# publish (OWNER APPROVAL REQUIRED — dev and prod share one Supabase project)
.venv/bin/python scripts/publish.py
# ops dashboard
scripts/dashboard.sh   # http://localhost:9090
```
