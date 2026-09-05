# Adding a model to XEval — what runs, what it costs (2026-09-01)

Worked for **Claude Fable 5.1** (`claude-fable-5-1`, $10/M in, $50/M out,
$0.25/M cached). Every number below is derived from what the existing entries
actually cost in `xeval.db`, not from list-price guesswork.

## Which ladders apply

| ladder | tasks | applies to | scoring |
|---|---|---|---|
| GDPval | 27 | text models | pairwise, 4-judge panel minus own family, BT fit |
| Terminal-Bench 2.1 | 21 | text models (agentic) | verifier, no judges |
| Harvey LAB | 19 | text models (agentic, long docs) | 482 rubric criteria × 2 judges |
| Text Rendering | 24 | **image models only** | PaddleOCR, no judges |

Fable 5.1 is a text model: three ladders. Text Rendering does not apply.

## GDPval — ~$440

| item | basis | cost |
|---|---|---|
| 27 runs @max | Fable 5 @max cost **$277.71** at the identical rate | **~$280** |
| judging | 20 complete entries × 27 tasks = **540 new pairs**. The no-self-judging rule is by **exact model, not vendor** (`judge.py:518`; Opus 5 judged 536 of Fable 5's pairs), so all four panel judges apply: Opus $0.127 + Sol $0.080 + Qwen $0.066 + Grok $0.022 = **$0.295/pair** | **~$159** |
| rubric pass | 27 Grok calls (one per task, ~44 items each) | ~$3 |

Judging grows with the ladder: the 21st entry costs 567 pairs, the 25th 675.
Wall clock: Fable 5 averaged 20.6 min/task → ~9 h sequential, parallelisable.

## Terminal-Bench 2.1 — ~$40–80, guard-capped

Opus 5 @max billed **$187**, but **$169 of it was two runaway tasks**:
`crack-7z-hash` ($113.89 on 465 output tokens — pure context replay) and
`break-filter-js-from-html` ($55.03 on **zero** output). The other 19 tasks
cost ~$18, i.e. **~$0.95/task**.

Fable 5.1 at 2× Opus's rate → ~$2/task → **~$40** for the 19 well-behaved
tasks. The two runaway tasks hit the **$20/task runaway guard** → at most
+$40. No judges. Sequential on the Colima VM (concurrency polluted TB 2.0);
~15 min/task → **~5 h**.

## Harvey LAB — $250 to $1,450, and this is the whole decision

Input tokens dominate, and they depend on how much of the client-matter DMS
the model chooses to read:

| entry | input tok / task | at Fable 5.1's $10/M, × 19 tasks |
|---|---|---|
| GPT-5.6 Sol @xhigh | 0.96 M | ~$180 |
| Grok 4.6 @xhigh | 1.25 M | ~$240 |
| **Claude Opus 5 @max** | **6.9 M** | **~$1,310** |

Plus output (~$115 if Opus-like) and judging (482 criteria × Qwen + Gemini
3.7 Flash, ~12K tok/call → **~$25**).

Fable is Anthropic; assume **Opus-like reading (~$1,450)** unless proven
otherwise. Two levers before spending that:

1. **Check whether the harvey adapter sends `cache_control`.** Cache reads are
   $0.25/M against $10/M — **40×**. The DMS is re-read across turns, so a
   cached run could land nearer **$150–300**. Read
   `harvey-labs/harness/adapters/anthropic.py` before launching; this one
   check is worth ~$1,000.
2. **Run 2 tasks first** and measure input tokens. If it reads like Sol, the
   full run is ~$250; if like Opus, decide with the real number in hand.

## Total for Fable 5.1

| | low | high |
|---|---|---|
| GDPval | $440 | $440 |
| TB 2.1 | $40 | $80 |
| LAB | $250 | $1,450 |
| **total** | **~$730** | **~$1,970** |

The $1,200 spread is entirely LAB input tokens. GDPval + TB are predictable
(**~$520**) and should run first.

## Onboarding gotchas (learned adding Fable 5.1, 2026-09-01)

- **`run_one` refuses undeclared entries.** `ai_models.eval_config` must list
  the effort: `{"efforts": ["max"]}`. Without it: `SKIP: (model, effort) not
  declared`. Shared table — declare only the efforts actually approved.
- **Register in `xeval/run_one.py` MODELS** with the `ai_models.id` UUID and
  **`price_cached`** — the Anthropic entries never carried one, so cached
  reads were costed at the full input rate. Fable 5.1's smoke cell was 95%
  cache reads; with `price_cached=0.25` the run cost matched to the cent
  ($5.62). Fable 5 / Opus 5 / Sonnet 5 still lack it, so their published
  $/task is overstated by the cached share — owner decision whether to
  restate.
- **litellm handles the thinking shape**: `reasoning_effort="max"` goes out as
  `thinking: {type: adaptive}` + `output_config: {effort: max}`. Verified by
  capturing the request body, not by reading our own label.
- **`--max-cost` is a HARD per-leg cap** (`aborted:budget`). Fable 5's $77
  cell finished only as a three-leg chain at $30/leg. A lane must resume
  repeatedly, not once; a $25 cap would have broken complete rows on two of
  the 27 tasks.
- **Judge idempotence is real** (`skip (already judged)`), so judging a new
  entry is just "run every judge on every task" — only the new pairs cost.
- **Check Supabase after publish, not the upsert count.** The count read 690
  while zero text-rendering rows landed (NULL-effort dedup bug, pitfall 13).

- **stirrup's default output ceiling is 64k tokens per turn, not per run.**
  Fable 5.1 emitted a single >64k turn on task 8c823e32 twice — two dead legs,
  ~$26 — while Fable 5 had cleared the same task under 64k. The registry now
  takes `max_output` (Fable 5.1: 128_000, its real cap; the anthropic path
  streams so it is safe), and `XEVAL_MAX_OUTPUT` overrides it for one process.
  The cap is a rail, not a budget: a low one destroys output already paid for.
- **Never SIGKILL a cell.** `--resume` restores from the checkpoint cache
  (`work/cache/<model>/<effort>/<task8>/*/state.json`), not from DB status —
  but a killed leg leaves its `runs` row stuck at `running`, the lane's leg
  loop reads that as "resume again", and the next leg can die on the
  half-written checkpoint. If a leg must be stopped: `kill` (TERM), wait, then
  mark the row `aborted` with an error note, validate `state.json` parses, and
  relaunch the resume OUTSIDE the lane so the lane keeps moving.
- **The lane's leg loop retries a structural failure identically.** A length
  failure at 64k will fail at 64k again; the loop must raise the ceiling on the
  resume leg (see `fable51_lane.sh`), not just retry.

- **Wall clock (owner rule, 2026-09-02): keep raising it while the model is
  doing real work; cut only a loop.** `XEVAL_MAX_WALL_S` is OURS (default 45
  min, lanes pass 2 h) — GDPval has no time limit. Tell the cases apart by
  tokens per second, not by elapsed time: leg 5 of 8c823e32 billed ~$2 (~40k
  output tokens) over 2 h after its tool results had returned = **6 tok/s**
  against Fable 5.1's ~94 — a stalled stream (VPN `bad record mac` class), so
  resume with a bigger clock; a leg that blows 64k in ONE turn is real work
  that needs the 128k ceiling, not a kill. Fable 5 finished the same task in
  63 turns for $7.94, so a cell many times that is worth one fresh (non-resume)
  attempt only after the resume-with-room path has been tried.

- **There is a PER-TURN timeout too: `XEVAL_TURN_TIMEOUT_S`, default 900 s.**
  It wraps every model call, and until 2026-09-02 its `TimeoutError` was
  re-labelled by the outer handler as "wall-clock cap … exceeded" — two legs
  of 8c823e32 died at ~15 min and were misdiagnosed as the 2 h / 4 h wall
  clock. Now labelled "turn timeout". The rail exists for true hangs (Opus
  once sat 80 min streaming nothing), but 900 s cannot even fit the 128k
  ceiling: at ~94 tok/s a full 128k turn is ~23 min. A model that writes
  long single turns (Fable 5.1 on research tasks) needs
  `XEVAL_TURN_TIMEOUT_S=3600` on its resume legs; the lane scripts now set it
  automatically after a turn-timeout or wall-clock error. Better: declare it
  once in the registry entry (`turn_timeout=3600`, same mechanism as
  `max_output`) so every fresh process for that model — lane cells and resume
  legs alike — gets it without touching a running driver. Env still wins.

- **Resume chains could double-count cost (fixed 2026-09-02).** A leg that
  died in an abort path stored the chain total in `cost_usd` but left
  `own_cost_usd` NULL; the next resume's `coalesce(own, cost_usd)` then
  re-added that inherited total as fresh spend. 8c823e32 recorded $68.40 for
  $40.10 real. Fixed both ways (prior legs sum `coalesce(own, 0)`; a dead leg
  writes own 0.0). Two published entries carried it and are restated on the
  next publish: Fable 5 @max 27-task total $277.71 → **$272.87** (−$4.84, one
  task), Kimi K3 @low $3.10 → **$2.85**. Verify a chain's cost by summing its
  legs' `own_cost_usd`, never by reading the finished row's `cost_usd` alone.

- **Transport drops must not consume resume legs.** On the owner's VPN the
  Anthropic stream dies intermittently (`SSLV3_ALERT_BAD_RECORD_MAC`, `Broken
  pipe`, surfaced as litellm `InternalServerError`). 105f8ad0 lost two lane
  legs to it in a row on 2026-09-02 while the API answered handshakes in
  20 ms between drops. The checkpoint keeps the work, so a transport failure
  is just "resume again"; only rail/budget failures should count toward a leg
  limit. `fable51_resume_105f8ad0.sh` is the pattern.

- **Process guards: match on args, then filter by executable name.** Plain
  `pgrep -f` matched operator and watcher shells whose command TEXT mentioned
  the pattern; an anchored `^[^ ]*python…` pattern then proved unreliable on
  macOS (missed live judges). What works: `pgrep -f '<args>'` piped through
  `ps -o comm=` keeping only `python` (`_procs()` in `fable51_*.sh`). Each
  judge/run_one invocation shows as python + a `caffeinate` child — not a
  duplicate. (Original note follows.)
- **Anchor every `pgrep -f` guard to a real interpreter (`^[^ ]*python[^ ]* -u -m …`).**
  The judge lane refused twice at 27/27 with "cells still running" and zero
  real processes: the guard matched the *launching shell's own command text*,
  which mentioned the pattern. A `/bin/zsh -c "…"` wrapper can never match an
  anchored pattern.
- **`run_one` processes can outlive their own rows.** After 105f8ad0's last two
  legs had written `failed`/`finished`, both python processes were still alive
  (stuck past teardown), blocking the guard and holding two sandboxes. Verify
  the rows are terminal, TERM (not KILL), prune sandboxes, then launch.
- **Actual Fable 5.1 GDPval cost: $403.01 runs + $178.31 judging + ~$3 rubric ≈ $585** (runs: 27 cells ($14.93/task,
  max cell $60.28, 19.1 wall-hours, two multi-leg chains) against the $280
  projection from Fable 5's $277.71 — the heaviest tasks needed resumes and 5.1
  ran ~45 min/cell versus Fable 5's ~20. Budget the successor of a model at
  ~1.4× its predecessor's spend, not 1.0×.

- **"Run every judge on every task" back-fills every pair that judge never
  covered — not just the new entry's pairs.** Opus/Sol/Grok had covered the
  old pairs and skipped them; Qwen (trialled on only 243 pairs historically)
  started judging ~135 old pairs per task — ~3,600 verdicts, ~$240, ~10 h of
  unplanned work — caught after ~$9. `judge.py --involving <model@effort>`
  now restricts a judge to pairs with the new entry on at least one side.
  Use it for every judge when adding one entry; `fable51_judge.sh` does.

- **Check the Anthropic credit balance BEFORE a flagship round, and watch it
  during.** The $403 Fable 5.1 run plus judging drained the account mid-way;
  the Opus judge then returned `400 credit balance is too low` on every pair
  for two hours — invisible, because `_judge_anthropic` read the body off an
  already-consumed stream and logged `(unreadable)`. Fixed: the body is
  captured at stream-open, and ACCOUNT-class messages (credit balance,
  billing, organization_on_hold, spend/usage limit) fail the pair at once
  instead of burning the retry ladder. The same outage hits production: the
  house-paid paths fall over to OpenAI, but a user who picked a Claude model in
  XCreate gets the ACCOUNT message.
- **Never `pkill -f <pattern>` while your own watchers are running** — their
  command text contains the pattern and they die with exit 144 (two did on
  2026-09-02). Kill by PID, or by PPID for a lane's subshell.

- **A slow judge can be parallelised by task, not by concurrency alone.**
  With `--involving`, a second loop over the tasks the first loop has not
  reached is safe: pairs are disjoint by task, and `judge.py` skips
  already-judged pairs when the first loop arrives later. Keep total
  concurrency within provider precedent (fill round: Grok 4, Qwen 8, Sol 4,
  Opus 2). Gate the finish on EVERY loop's DONE marker, not just "no judge
  processes" — loops have 1s gaps between tasks. Each judge invocation shows
  as two python processes (wrapper + child); that is not duplicate judging.

## Recipe (any new text model)

1. **Catalog row** at `/admin/models` with list price — done for Fable 5.1.
2. **GDPval**: `run_one` × 27 → `judge --entries <new>` (panel minus family)
   → `rubric` → `ratings` refit → Autopilot row → `publish`.
3. **TB 2.1**: lane script at `timeout_multiplier 1.0`, runaway guard on
   (150 episodes / $20), `tb_import`, publish. **Never raise the multiplier**
   — every published entry ran at 1.0.
4. **LAB**: check caching → 2-task probe → full 19 → `judge` (2 judges outside
   family) → `lab_import` → publish. LAB and TB cannot share the VM.
5. **Complete rows only** — nothing publishes until all tasks in the set are
   covered. Refusals count as fails with spend excluded.
6. An image model instead runs **Text Rendering** (~$1–3 for 24 images) and
   nothing else today.

## Standing costs to remember

- Every existing entry makes the next one's GDPval judging ~$4.50 dearer.
- Anthropic entries always lose Opus as a judge; OpenAI entries lose Sol (the
  most expensive judge, so they are cheaper to add).
- The TB runaway guard is the only thing standing between a context-replay
  task and a three-figure bill on a single cell.

## GPT-6 Astra (2026-09-04) — what it took to get one cell to run

Owner approved GDPval on the 9 most-played tasks only ("if it's only $100").
Three harness facts, each of which failed a cell at $0 before the fix:

1. **An entry must be declared in `ai_models.eval_config`** (`{"efforts":
   [...]}` on the catalog row) or `run_one` refuses it as "retired or never
   added". GPT-6's row had none; set to `{"efforts": ["low", "xhigh"]}`.
2. **litellm does not know the id** and treats it as a legacy model: it sends
   `max_tokens`, which GPT-6 rejects ("use max_completion_tokens"). The
   direct chat/completions client sends the right field — but:
3. **GPT-6 refuses function tools on /v1/chat/completions unless
   `reasoning_effort` is `none`, and GPT-6 does not accept `none`.** So no
   agent run at a chosen effort is possible on that endpoint. `/v1/responses`
   takes tools + `reasoning.effort` (probed with xhigh). `run_one` gained a
   third transport, `responses` (`CappedResponsesClient` over stirrup's
   `OpenResponsesClient`): same per-call cost cap and per-turn timeout, but
   the SDK call is blocking, not streamed — the VPN idle cut (~260 s) is a
   risk on long turns; 600 s timeout, one SDK retry.

Also verified on the wire the same day: litellm 1.97 (the gdpval-xd venv)
routes **gpt-5.6-sol to /v1/responses with `reasoning: {effort: "xhigh"}`**
when tools are present, so the published Sol @xhigh runs were genuinely at
xhigh. (The SOTOPIA venv's litellm drops xhigh on chat/completions — that lane
sends it in `extra_body`, checked with `probe_wire.py`.)

GPT-6 efforts are low/medium/high/xhigh; `none` and `max` are rejected, so
the catalog's `thinking_levels` "max" for this model is wrong.
