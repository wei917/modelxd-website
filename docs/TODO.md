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

## 3. Custom AI characters (SHIPPED Aug 7-8 — builder + chat + memory live)

STATUS (Aug 8): builder/chat/memory/photos/search shipped (migrations 75-77).
Voice: stage 1 (browser STT input) + stage 2 (TTS output) DONE — Qwen-TTS
presets + qwen-voice-design custom voices ($0.20/mint, ~$0.13/10K chars,
billed from usage.characters). Owner decision Aug 8: NO human-sample voice
cloning, ever — text-designed voices only ("It belongs to no real person").
- [x] Voice stage 3 BUILT (Aug 8, owner: "both"): call mode with two chips.
      Voice chat = hands-free loop on the character's own model + TTS voice
      (STT → chat turn → speak; billed per turn). Live call = Gemini Live
      (gemini-3.1-flash-live-preview, ephemeral token locked to our
      systemInstruction; transcripts saved as normal messages at call end;
      flat $0.023/min). Wake lock; echo-guard; barge-in on live. NEEDS
      OWNER VOICE TEST — automation can't grant mic or speak.
- [ ] Live call follow-ups: session resumption past 10 min (v1 ends the
      call at 9.5); per-character Gemini call-voice picker (v1 maps male
      presets → Charon, else Aoede); usage-based live billing from
      usageMetadata instead of flat minutes.
- [ ] Voice hygiene: delete the DashScope designed voice when a character
      is deleted / re-minted (orphan voices accumulate on the account;
      test voice "mxdtest…" from Aug 8 can be cleaned up too).

The ask (owner, Aug 6-7): users build persistent AI CHARACTERS — companion
(AI girlfriend/boyfriend), personality, assistant — with persona, appearance,
model + config, and imagery (uploaded or generated). SCOPE (owner, Aug 7):
a character is a PLATFORM PRIMITIVE, not a chat feature — selectable
anywhere a model picker appears (XTalk seats, XGame seats in v1; generation
surfaces later), and the foundation for XSocial (future surface: agents
post reels, write articles — agents as content creators).

DESIGN OF RECORD (owner, Aug 7 session — details in chat, spec below):
- Memory: model-managed two stores — critical (≤10K, exact facts, model
  self-edits under budget) + concept (unbounded at rest in DB, model-authored
  CHAPTERS; only relevant chapters carried per turn). Two consolidation
  prompts fire when unconsolidated window > ~80 msgs, run on the CHARACTER'S
  OWN model (memory curation is a benchmarkable skill — future XBoard
  "memory" score). Retrieval: hybrid time-filter + vector (pgvector,
  embedding column reserved from day one, backfill in phase 2).
- Prompt layout: [safety floor]+[wrapped persona]+[critical]+[chapter tail]
  = CACHED PREFIX; window + retrieved bits after the boundary.
- Schema: x_characters (surface-neutral name; visibility column, private
  enforced v1; appearance field separate from persona),
  x_character_messages (append-only, per-msg cost), x_character_memory
  (kind critical|chapter, seq, embedding nullable), photos bucket.
- resolveSpeaker(): pickers accept characterId|modelId; blocked_features
  resolve THROUGH the character to its model. Persona untrusted everywhere.
- Policy (defaults accepted Aug 7): romantic-not-explicit, 18+ gate;
  consolidation on own model; named "Characters", XTalk template card,
  FEATURE_XTALK_EMAILS gate.

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
- [ ] Media abilities — play a song from YouTube (owner, Aug 7): the agent
      emits a structured action ({"action":"play_song","query":...} — the
      Gomoku JSON-contract pattern, works on all 7 providers), server
      searches YouTube Data API v3 (videoEmbeddable=true filter; 100
      searches/day free quota), and the room renders the OFFICIAL IFrame
      player as a "Now playing" card. LEGAL LINE: embed only, player stays
      visible — never extract/proxy audio (ToS violation, revoked keys).
      Autoplay: design for one ▶ tap; browser-permitted autoplay is a bonus.
      Memory tie-in: the agent remembers musical taste ("you liked Norah
      Jones") via the agent_memories loop.
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
- [x] Draw & Guess (你畫我猜 / お絵かき当て / 그림 퀴즈) — CODE SHIPPED
      Aug 6; needs migration 73 + a fill run before it's playable.
      FINAL DESIGN (owner, Aug 6 — supersedes the sketch below): every
      round shows ONE secret term drawn by TWO anonymous image models,
      side by side; the user guesses (45s, live host-agent hints, max 2),
      then votes the better drawing; after 5 rounds the artists are
      revealed with the vote tally. ZERO live image generation: rounds are
      assembled only from pre-drawn art (draw_images), filled offline by
      `npx tsx scripts/fill-draw-images.ts --model <name> [--lang xx]
      [--tier easy] [--limit N] [--dry]`. Terms are SERVER DATA
      (draw_terms — insert rows, no deploy). Model identity in image URLs
      is hidden behind draw_model_keys secrets; the term is the opaque row
      id. Host: XGAME_HOST_MODEL env (default Haiku), house-paid, with a
      leak guard (a hint containing the answer is replaced by a canned
      one). Matching is script-aware (lib/drawsomething-engine.ts):
      Damerau-Levenshtein ≤1 for latin ≥5 chars, kana folding for ja, CJK
      exact-or-alias. 10 games/day cap.
      - [ ] OWNER RUNBOOK: (1) run supabase/73_draw_something.sql (tables
            + bucket + ~250 seeded terms); (2) fill two models cheap:
            `--tier easy --lang en --limit 40` first (~$0.5-1/model);
            (3) play at /xgame → Draw & Guess.
      - [ ] Native review of the seeded term banks (zh by owner; find
            ja/ko reviewers). Terms are drafts until then.
      - [ ] Votes → image rating pool (a 'draw' pool, like search pools).
      - [ ] Old sketch (superseded): one model draws per round, others
            guess in text, per-drawing billing.
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
      - [x] SHIPPED for Gomoku (Aug 6): task type GAME on /xduel → blind
        match card with TWO doors — PLAY (you vs one mystery model,
        random color, only the AI seat masked) and WATCH (two mystery
        models) → the house seats the models (cheap pool,
        text_output ≤ $8/1M, xduel block key honored), masking is
        server-side (names/costs never leave the server while anon), no
        user debit, 3/day cap by counting duel rows (no quota migration),
        60-move draw cap. Thumbs record {up, blind} on pending.duel;
        reveal unmasks + rewrites the title. Remaining: feed engine
        results into the per-game Bradley-Terry pool (with harness
        extraction below), surface blind matches to spectators (XVote).
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
      the duels measure. From the research survey (docs/research-gomoku-llm.md):
      anchor the pool with fixed bots (random-legal, 1-ply greedy) and
      control for color — 15x15 free-style gomoku is a proven Black win.
- Decided against (owner, Aug 6): per-direction missed-block telemetry
  (research survey Tier-2 item 7) — owner sees no product value. Do not
  re-pitch without new information. KEY DIFFERENCE from LLM benchmarks: engine-scored
      legal-move games give OBJECTIVE win/loss — a genuinely novel axis
      for the leaderboard.
- [ ] Note: board games need a rules engine because LLMs hallucinate
      illegal moves — the model NEVER adjudicates, it only chooses among
      engine-legal options. Same philosophy as Werewolf's server-held
      state: the client (and the model) are never trusted with the rules.

## XCreate

- [x] Audio → Text mode SHIPPED (code Aug 9, uncommitted): `audio_to_text`
      recipe end to end — template "Lyrics & Transcripts from Audio", audio
      attachments, dedicated route branch, providers.transcribeAudio
      (whisper-1, verbose_json → "[mm:ss.ss] line" output, billed
      per_audio_minute), whisper-1 catalog row INSERTED LIVE (blocked from
      xduel/xtalk seats — it cannot chat). Residuals: DashScope
      Paraformer/SenseVoice + Gemini paths for comparison runs; LRC/SRT
      download button on the output; CAUTION the /admin/models pricing form
      does not know per_audio_minute — re-saving the row there may drop it.
      - [x] Fun-ASR added as 2nd seat (Aug 10): alibaba.transcribeAudio on
            the existing async task pattern, routed in providers/index.
            Template seats Whisper 1 + Fun-ASR for a live Mandarin
            comparison. FULL PROVIDER PATH VERIFIED against live DashScope
            intl with the real 好像喜歡你 track: Supabase signed URL →
            DashScope fetch+decode → poll → transcription_url →
            transcripts[].sentences[] begin/end ms → correct Mandarin
            lyrics, 17 sentences. audio gets attach.url now; 25MB cap is
            Whisper-only (Fun-ASR is URL-fed).
            - qwen3-asr-flash-filetrans was tried FIRST and DISABLED: it
              returned "Beep boop beep" on a full music track (the
              flash-filetrans variant can't do songs, despite Qwen3-ASR
              marketing; base models may differ). Row left disabled in
              catalog for record. paraformer-v2 is "Model not exist" on the
              intl endpoint.
      - [ ] Fun-ASR PRICE unverified: catalog row set to a PLACEHOLDER
            per_audio_minute 0.002 — not publicly documented. Find the real
            rate in the Model Studio console and fix at /admin/models (no
            deploy). Do before real usage to avoid mischarging.
      - [ ] Audio→Text: one live XCreate UI run still needed (attachment →
            billing → the 2-model comparison view) — provider layer proven,
            UI glue not yet exercised with live credits.
      Original notes:
      Proven end-to-end Aug 9 on the
      好像喜歡你 MV: StreetVoice audio → whisper-1 (word timestamps, official
      lyrics passed as prompt bias) → per-line alignment → LRC/SRT; 35/40
      lines matched, ~$0.02/run. Build notes:
      - Recipe `audio_to_text` in ai_models.modes; per-minute pricing key in
        model_pricing (whisper-1 $0.006/min).
      - Candidate models across EXISTING providers — openai whisper-1 /
        gpt-4o-transcribe, DashScope Paraformer/SenseVoice (Mandarin-strong),
        Gemini audio — which makes transcription a COMPARISON surface too:
        same audio, models side by side, real prices. The ModelXD thesis in
        a new modality.
      - Attachment pipeline must accept audio mediaTypes; template with an
        AUDIO slot ("Lyrics from a song" / "Transcribe a recording"),
        options for output format (plain / LRC / SRT), optional known-text
        bias field (forced-alignment-lite, dramatically better on singing).
      - XDirect Phase 3 tie-in: lyric line timings are the natural sync grid
        for MV cuts (scene durations from line spans).
      generated (or upload one), continue it. NATIVE support verified
      against provider docs Aug 8:
      - Runway API `video_to_video` + `mode:"extend"` on hosted
        `seedance2_5` (shipped Aug 7 2026!) — arbitrary input video,
        4-30s outputs. Best path. (Aleph = restyle/edit only.)
      - DashScope `wan2.7-i2v` `first_clip` continuation — GA intl, but
        input ≤10s and TOTAL output ≤15s; short-clip stitcher.
      - Veo 3.1 `video` param — preview, 720p-only, and ONLY Veo's own
        outputs ≤2 days old; no uploads. Marginal for us.
      - OpenAI `/videos/extensions` works but the ENTIRE Videos API shuts
        down Sept 24 2026 — do not build on it.
      Fallback for every other i2v model: extract last frame
      (XDirectorChat's frame-chaining helper) → image_to_video with a
      continuation prompt — loses motion continuity, works everywhere.
      Recipe shape: new `extend_video` mode; picker shows native-capable
      models first, fallback-capable after. Stitching stays in XDirect
      Phase 3 (assembly), not here.

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
- [ ] **DECIDED (owner, Aug 8): Sora is never used. Period.** Not in the
      catalog, not in recipes, not proposed again. (The API shuts down
      Sept 24, 2026 anyway.) Only remaining chore: delete the dormant
      Videos code path in `lib/providers/openai.ts`.
- [ ] Seedance may be REACHABLE now: Runway's API has become a
      multi-vendor catalog and hosts Seedance 2.5 (plus Hailuo 3, Veo 3.1,
      etc.) via our existing runway.ts integration and US billing. The old
      "no official US path" blocker (see memory) may be moot — evaluate
      adding Seedance 2.5 through Runway.
- [ ] Grok Imagine Image 2.0 (launched Aug 7 2026, app-only): add the
      catalog row WHEN xAI's first-party API serves it — verified Aug 9 it
      does not yet (docs list only grok-imagine-image and
      grok-imagine-image-quality). Owner decision Aug 9: do NOT add
      grok-imagine-image-quality ($0.05) in the meantime — wait for 2.0.
      Vercel AI Gateway's 2.0-preview is an aggregator path; not our route.

- **Qwen-Image-Layered — layered image editing (waiting on first-party).**
  Alibaba's Dec release decomposes an image into N RGBA layers (recursive,
  clean alpha, occlusion-ordered). Verified Aug 14: NOT on Model Studio
  international yet (image list = wan2.7-image-pro, qwen-image-2.0-pro
  only); exists as open weights + resellers (fal ~$0.03-0.05/run).
  Owner decision Aug 14: WAIT for first-party — re-check the Model Studio
  model list periodically. When it lands, the feature is scoped:
  photo → one run → N layers as named shelf assets (`LAYER · 產品` …),
  per-layer image_edit, recompose; slots[] already supports multi-output,
  the shelf fan-out is the day's work. Social Post's "beautify, never
  fabricate" becomes mechanical (product layer never regenerated).

- **SAM-2 segmentation — same tier, same wait.** Open weights, no
  first-party API; would ride the same utility provider. Click/prompt
  masks feeding image_edit for surgical edits.

- **Policy line adopted Aug 14 (owner + CC): RATED models are first-party
  only; UTILITY tools (layer split, segmentation, background removal) may
  be reseller-hosted, provenance-labeled ("via fal"), and blocked from
  every rating surface via blocked_features.** If waiting drags, this line
  permits a fal.ts utility provider without touching leaderboard honesty.
