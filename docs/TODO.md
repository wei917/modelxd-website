# ModelXD — Product TODO / Roadmap

> Written 2026-08-06. The three product streams the owner has committed to,
> plus cross-cutting items carried out of the Aug 6 working session.
> Companion docs: `CLAUDE.md` (the map), `docs/STATE-2026-08-05.md` (state).

## 1. The film surface — XDirect (in progress)

- [x] Phase 1 — chat + canvas on one stage; board id IS the conversation id (Aug 5)
- [x] Phase 2 — storyboard-first video: every video request becomes editable
      scene cards (script / shot prompt / duration / per-scene model + real
      price) before anything generates; server-enforced, not just prompted
      (Aug 6)
- [ ] Phase 3 — assembly: stitch scenes into one film (server-side ffmpeg),
      trim in/out per shot, audio track, export/share. The strip is already
      the timeline; this makes it renderable.
- [ ] Scene continuity — pinned references per project (character, product,
      style images) auto-fed into every scene generation. This is the hard
      problem in AI film; `reference_frames` is the mechanism. Design the
      scene entity around it.
- [ ] First real-spend validation of card-armed generation (wiring verified,
      never run with live credits).
- [ ] Generate-all polish: batch progress on the strip, resume mid-batch.

## 2. The super canvas (ComfyUI-style, image + video)

- [x] One board serves stills and motion; derivation DAG below, storyboard
      lane above — two grammars, one stage.
- [ ] Consolidate: move XCreate's canvas entrances into XDirect; retire
      `FEATURE_CANVAS_EMAILS` into the xdirector gate.
- [ ] Selection as wiring: multi-select nodes on /xdirect and hand the
      selection to the director as references for the next generation.
- [ ] Node actions on /xdirect (today read-mostly): delete, annotate.
- Decided against for now: manual node wiring / operation nodes. The
  director is the pipeline author; the user's wiring is selection + intent.
  Revisit only on demonstrated power-user demand.

## 3. Custom AI companions & agents in XTalk (new — not started)

The ask (owner, Aug 6): users custom-build a persistent AI agent — a
companion (AI girlfriend/boyfriend), a character, or an assistant — and keep
talking to it across sessions. Their agents are also seatable in Discussion
rooms.

- [ ] Agent builder: name, avatar, persona/system prompt, model choice with
      the real price shown — the ModelXD angle nobody else has: you know
      exactly which model your companion runs on and what a conversation
      costs, and you can move them to a cheaper model the leaderboard rates
      higher.
- [ ] Persistence: `xtalk_agents` table (owner RLS), a 1:1 chat surface with
      nav history (same pattern as XDirect's), memory across sessions —
      start with a rolling-summary column, consider an Agent-Skills-format
      persona file later (the open-format loader is already in `lib/skills.ts`).
- [ ] Seat integration: Discussion's seat picker offers "your agents"
      alongside raw models. Discussion already has per-seat characters — an
      agent is a persisted character + model + memory, so the seating
      plumbing mostly exists.
- [ ] Billing: 1:1 messages bill at the agent's model rate like Discussion
      turns; prompt caching from day one (persona + history is a textbook
      stable prefix — see the Aug 6 XDirector caching work for the pattern).
- [ ] Product decisions needed BEFORE building: naming (inside XTalk vs its
      own surface), content policy for romantic companions (age gating,
      boundaries — this is a real policy surface, decide it deliberately,
      not in code review), private-only vs shareable/public agents.
- [ ] Safety: a persona is user-authored text and therefore UNTRUSTED — fence
      it with the same `wrapSkillForPrompt` discipline so a persona can
      shape voice and character but can never override pricing honesty,
      model selection, or platform refusals.

## 4. XGame — AI game arena (new — not started)

The ask (owner, Aug 6): a new `/xgame` surface in the Werewolf style —
server-held state, models play each other, a human can take a seat, games
get permanent URLs and nav history. Werewolf MOVES here from XTalk; XTalk
keeps Discussion. Launch list: Werewolf, 五子棋 (Gomoku), Chess, 中國象棋
(Xiangqi), Draw Something, 麻將 (Mahjong).

- [ ] XGame shell + Werewolf move: `/xgame` page and nav item, game-card
      picker, `/xtalk/[id]` permalinks redirect, history list moves, i18n,
      site-guide + agent ROUTES. Engine and API stay as-is; while moving,
      extract the reusable harness (session table, one-act-per-request
      loop, 90s timeout → visible abstention, human seat, duplicate-model
      naming) so every game below is a plugin: rules engine + prompt
      protocol + board renderer.
- [x] 五子棋 SHIPPED Aug 6 — SVG goban, human or AI per seat, engine-
      validated moves with retry-on-illegal and marked fallbacks, per-move
      billing, permanent URLs. Requires migration 72. Rating pool still
      pending (with the harness extraction below).
- [ ] Chess — chess.js for rules/legality; models pick from legal moves.
- [ ] 中國象棋 — rules engine hand-rolled or lib; board renderer.
- [ ] Draw Something (你畫我猜 / お絵かき当て / 그림 퀴즈) — different kind:
      one model GENERATES an image of a secret word (through the normal
      billed pipeline), others guess in text. XCreate-pipeline crossover;
      per-drawing billing.
      - WORD BANKS ARE CONTENT, NOT TRANSLATION (owner, Aug 6): each site
        language gets its own culturally-popular subject list — zh-Hant
        draws 珍珠奶茶, 101大樓, 夜市; ja draws 桜, 新幹線, おにぎり; ko
        draws 김치, 한강, 지하철 — because "things everyone can draw AND
        guess" is a cultural fact. Never machine-translate one list.
      - Shape: one data file per language (easy/medium/hard tiers like the
        original game), mixing universal subjects (cat, moon, guitar) with
        culture-specific ones; draft lists can be model-generated but ship
        hand-reviewed by a speaker — a wrong subject here is a dead round.
      - Guessing must be language-aware too: accept the answer in the
        round's language, with fuzzy matching tuned per script (CJK exact
        or near-exact; latin allows minor typos).
- [ ] 麻將 — the heavyweight: 4 seats, big scoring engine, and a ruleset
      decision FIRST (Taiwanese 16-tile for the home market?). Do last.
- [ ] GAME DUELS — XDuel mode for every game (owner, Aug 6): two randomly
      picked ANONYMOUS models play each other; nobody knows which is which;
      users watch and vote / thumb up-down; then the reveal (identities +
      what each move cost), same dramatic arc as a prompt duel.
      - Objective games (gomoku, chess, xiangqi) score themselves: the
        ENGINE result feeds the game's Bradley-Terry pool directly — real
        wins are cleaner pairwise events than votes. The user's thumb then
        rates the performance (reasoning quality, watchability), a second
        signal, not the winner.
      - Subjective games (Werewolf, Draw Something) keep votes as the
        primary signal, like prompt duels.
      - Needs a free-tier design: a full game costs real tokens across
        20-60 moves, so blind game duels want short formats, cheap-model
        pools, or a tighter daily quota than prompt duels.
- [ ] Rating: one pool per game via GAME_MODES (werewolf precedent), all
      excluded from `all` — board-game strength is real but it is not what
      the duels measure. KEY DIFFERENCE from LLM benchmarks: engine-scored
      legal-move games give OBJECTIVE win/loss — a genuinely novel axis
      for the leaderboard.
- [ ] Note: board games need a rules engine because LLMs hallucinate
      illegal moves — the model NEVER adjudicates, it only chooses among
      engine-legal options. Same philosophy as Werewolf's server-held
      state: the client (and the model) are never trusted with the rules.

## Cross-cutting (carried from the Aug 6 session)

- [x] `cached_input` rates — RESOLVED Aug 6 against official pricing pages.
      Filled: gemini-3.6-flash 0.15, gemini-3.5-flash-lite 0.03,
      gemini-3.1-flash-lite 0.025, gpt-image-2 1.25. Verified correctly
      null (no cached tier exists): gpt-5.5-pro, qwen3.6-plus (model not
      cache-capable per DashScope's context-cache doc), and the four Gemini
      image models. No schema change was needed — `model_pricing.tokens.
      cached_input` is part of the existing jsonb shape.
- [ ] `cache_control` on user-billed Anthropic calls — XTalk Werewolf
      re-sends the whole game state every turn and never caches; biggest
      single user-cost win available.
- [ ] xAI has no text-cost path in `lib/providers/xai.ts` — required before
      any Grok text model is re-enabled.
