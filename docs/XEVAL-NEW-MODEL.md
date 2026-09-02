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

## GDPval — ~$375

| item | basis | cost |
|---|---|---|
| 27 runs @max | Fable 5 @max cost **$277.71** at the identical rate | **~$280** |
| judging | 20 complete entries × 27 tasks = **540 new pairs**, 1 verdict each. Anthropic family excludes Opus 5, leaving Sol $0.080 + Grok $0.022 + Qwen $0.066 = **$0.168/pair** | **~$91** |
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
| GDPval | $375 | $375 |
| TB 2.1 | $40 | $80 |
| LAB | $250 | $1,450 |
| **total** | **~$665** | **~$1,900** |

The $1,200 spread is entirely LAB input tokens. GDPval + TB are predictable
(**~$450**) and should run first.

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
