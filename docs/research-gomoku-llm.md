# Gomoku as an LLM benchmark — literature survey (Aug 6, 2026)

> Researched by a background agent during the XGame/game-duels build session.
> Question: has anyone published research using Gomoku (esp. with LLMs), and
> how do they do it? Answer: yes — small but direct literature. Summary and
> actionable takeaways below; links at the bottom.

## Executive summary

Gomoku is unusually well-understood academically — 15x15 free-style Gomoku
was PROVEN a first-player win in 1993 (Allis, threat-space + proof-number
search), and modern engines (Katagomo, Rapfi) are massively superhuman — so
an LLM arena operates far below "solved" and is purely a RELATIVE skill
measurement. Direct LLM-Gomoku literature:

- arXiv 2407.07796 ran 2,310 matches of TTT / Connect Four / Gomoku across
  7 frontier LLMs: a COORDINATE-LIST board representation beats an ASCII
  grid, which beats an image; Gomoku had the worst invalid-move rates; and
  models miss BLOCKS far more than WINS.
- "Qi Town" (arXiv 2508.04720): 20-LLM round-robin Elo incl. 15x15 Gomoku;
  found non-transitive win cycles (a warning for unanchored rating pools).
- LLM-Gomoku (arXiv 2503.21683): illegal-move mitigation via prompting works
  early-game but DEGRADES as the board fills; their fix moves candidate
  generation into code and lets the LLM only rank candidates.
- GTBench (NeurIPS 2024), TTT-Bench, ChessArena, LLM Chess: unanimous that
  LLMs — including reasoning models that ace AIME — are startlingly bad at
  complete-information board games; some score below random; ChessArena's
  headline is "no LLM beats Maia-1100".
- Spatial-grid research (arXiv 2510.20198): text-grid accuracy is strongly
  DIRECTION-dependent (horizontal best, vertical/diagonal worst) and decays
  sharply with grid size. Nobody has published a per-direction missed-block
  stat for Gomoku — our arena telemetry could produce a novel number.

Evaluation-design consensus: illegal-move rate as a first-class metric;
missed-win / missed-block counters; anchor model-vs-model ratings to fixed
bots (random-legal, 1-ply greedy, throttled engine) because pure round-robin
Elo/BT floats with no absolute scale; control for color (first-move
advantage is proven and large).

## What we should copy, ranked by effort

### Tier 1 — prompt-only (hours)
1. Append per-player OCCUPIED-COORDINATE LISTS to the state (keep the grid
   for debuggability): "Black: H8, I9 / White: G7". Strongest single result
   in the literature (2407.07796).
2. Reorder the reply JSON to REASONING-FIRST: {"why":"...","move":"H8"} —
   our current order makes the model commit to the move before thinking.
3. Ask the model to RESTATE salient lines before deciding ("list every line
   of 3+ for either player, including diagonals, then choose") — the
   'regurgitation' result from the chess work; the model does the work, so
   it still measures the model.
4. Do NOT enumerate legal moves (chess evidence: legal-move lists made play
   WORSE). Our server-side adjudication is the right design.
5. One or two fixed few-shot examples — including a diagonal block —
   outsized effect in chess experiments; keep identical across models.

### Tier 2 — telemetry + rating pool (days)
6. Illegal-move rate as a first-class per-model metric (attempt rate,
   retry-success, fallback rate). Consider excluding fallback-decided games
   from the rating pool, or cap fallbacks per game (disqualification=loss).
7. Missed-win / missed-block counters BY LINE DIRECTION (the engine already
   scans lines). The diagonal breakdown exists nowhere in the literature —
   publishable content for XBoard model pages.
8. Anchor the Bradley-Terry pool with fixed bots: random-legal; 1-ply greedy
   (win-if-possible, block-if-necessary, else adjacent); a throttled real
   engine (Gomocup piskvork protocol engine or Rapfi).
9. Control first-player advantage: pair every matchup (both colors), and/or
   a color term in the BT fit. Free-style 15x15 is a PROVEN Black win.
10. Plot failure metrics vs MOVE INDEX — mitigations fail as the board
    fills (LLM-Gomoku); expect fallback rate to climb late-game.

### Tier 3 — structural (weeks; separate pools, decide deliberately)
11. Scaffolded division: engine-computed neutral threat annotations injected
    into both prompts ("White has an open three on F6-J10"). Biggest lever
    for cheap-model watchability, but changes what is measured — run as a
    separate pool (like the search-on/off split), never a silent change.
12. Candidate-restriction variant (LLM-Gomoku): engine proposes top-N
    squares, model picks. Eliminates illegal moves; separate pool.
13. Smaller-board division (9x9/11x11) for budget models — on 15x15 cheap
    models mostly measure parsing failure; smaller boards discriminate
    strategy and cost less.
14. Skip image boards — consistently the worst representation.

### Framing note
An unscaffolded arena largely ranks "can the model read a grid and follow
instructions under a text interface" — legitimate and marketable (top
reasoning models do NOT saturate it), as long as the page says that's what
it measures. The Tier-2 metrics turn "cheap LLMs play badly" from an
anecdote into content nobody else has at Gomoku scale.

## Key sources
- Grid-Based Game Competitions: https://arxiv.org/abs/2407.07796
  (leaderboard: https://research-outcome.github.io/LLM-Game-Benchmark/)
- LLM-Gomoku: https://arxiv.org/abs/2503.21683
- Qi Town (LLM vs LLM Elo, incl. Gomoku): https://arxiv.org/abs/2508.04720
- Game Reasoning Arena: https://arxiv.org/abs/2508.03368
- GTBench (NeurIPS 2024): https://arxiv.org/abs/2402.12348
- TTT-Bench: https://arxiv.org/abs/2506.10209
- lmgame-Bench (ICLR 2026): https://arxiv.org/abs/2505.15146
- TextArena (chose TrueSkill for faster convergence): https://arxiv.org/abs/2504.11442
- ChessArena ("no LLM beats Maia-1100"): https://arxiv.org/abs/2509.24239
- LLM Chess leaderboard: https://maxim-saplin.github.io/llm_chess/
- dynomight chess prompt interventions: https://dynomight.net/more-chess/
- chess_gpt_eval / world models: https://github.com/adamkarvonen/chess_gpt_eval
- Stuck in the Matrix (direction-dependent grid reading): https://arxiv.org/html/2510.20198
- Allis 1993, Go-Moku solved: https://aaai.org/papers/0001-fs93-02-001-go-moku-solved-by-new-search-techniques/
- Rapfi (Gomocup 2024 winner): https://arxiv.org/abs/2503.13178
- Gomocup / piskvork protocol: https://gomocup.org
