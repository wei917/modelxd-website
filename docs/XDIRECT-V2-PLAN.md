# XDirect v2: plan (Oct 7)

Owner, Oct 7: "let's make two changes, one for improving Film and another is
to improve XDirect to match Updream", then "yes to both, go ahead". Film's
plan is `docs/FILM-V2-PLAN.md`. The two share one storyboard format, one
library of characters and looks, voice-first timing, the art-director review
and the production engine, so each piece is built once.

## What we learned from updream (credit: Bilibili)

updream is Bilibili's AI video studio for creators. It was announced 31 Mar
2026 and is invite-only. The viral Jensen Huang "Beat It" MV
(Bilibili BV1VRHr6AEZ6) is tagged updream. From public pages (some features
appear only in its web app's code, so they may be gated):

- **Agent:** "/" calls a skill and "@" pulls in an asset. A pre-filled card
  asks for confirmation before each generation (or auto mode). It has a plan
  mode and sub-agents.
- **Per-project memory:** versioned scripts parsed into shots, and a style
  guide.
- **Skills in SKILL.md** (the same open format as ours). Users upload them and
  publish them free, paid or private. The most used are script planning and
  script-to-shot-prompts.
- **Canvas:** nodes for text, image, video, audio, music and the agent;
  three-view sheets, multi-angle shots, 9-panel boards; team canvases. Since
  17 Aug, 3D white-box previs.
- **Models:** Seedance 2.0/2.5 (480p draft, then a 1080p final), Kling, Wan,
  H3, Veo 3.1, Vidu, Seedream 5.0, GPT Image 2, Midjourney, music, TTS and
  voice cloning; automatic model picking; bring your own key.
- **Timeline:** multi-track, and it can regenerate up to 5 ranges inside a
  clip.
- **Credits:** Free, Pro, Max and Ultra tiers, which gate models and how many
  jobs run at once.

Where XDirect is already ahead:
- Models are chosen by blind-vote scores, and the reason is stated.
- A USD list price is shown per scene, with nothing gated by tier.
- A YouTube reference sets the style and cut rhythm, and the song is sliced to
  scenes.
- 5 languages.
- It refuses real people's likenesses (`lib/xdirector-prompt.ts`, "Real
  people").

Sources: pingwest.com/w/312613, ai-bot.cn/updream-hands-on/,
docs.apiyi.com/en/scenarios/agent/updream.md, jiemian.com/article/14193899.html,
qbitai.com/2026/08/475476.html.

## XDirect today (code)

- **Director:** Sonnet 5, house-paid (`app/api/xdirector/route.ts`). Its tools
  are `list_models`, `ask_user`, `start_generation`, `set_storyboard` and
  `read_skill_file` (`lib/xdirector-tools.ts`).
- **Board:** the storyboard sits on `xdirector_conversations.storyboard`, as
  editable scene cards with a price per scene (`SceneStrip.tsx`). Cast assets
  must be three-view sheets (`lib/cast-sheet.ts`), but only within one board.
- **Skills:** 5 in-house skills in `skills/`, read by `lib/skills.ts` from the
  repo only.
- **XCut:** one video track, ONE audio track and one subtitle track
  (`lib/xcut-timeline.ts`). No speech or music is generated inside XDirect.
- **Access:** live and open on dev.modelxd.com/xdirect (checked Oct 7); www
  `/xdirect` still goes to /coming-soon (the site password).

## The plan, in order

**1. A library of characters, looks, voices and places across boards.**
- Save a cast sheet, a look (style string and palette), a voice (model, voice
  id and delivery) or a place once. Use it on any board with "@" in the chat,
  or in Film.
- New table `creative_assets` (owner-only; migration number at build time):
  `kind`, `name`, `canon` text, image paths, `source`.
- "Save to library" on a board's asset. A library drawer.
- New director tools `list_assets` and `use_asset`. The three-view guard is
  reused.
- Film v2's character canons and style strings are stored the same way, and
  its keyframes can take the saved sheet as a reference picture.
- Test: make a character on board A, reuse it on board B, and compare
  likeness.

**2. Voices and music as storyboard tracks.**
- Scenes get `lines` (speaker → a voice asset, text, delivery) and the board
  gets a music cue sheet (BPM, sections), the same fields as Film v2.
- Lines are spoken with the existing TTS rows (Gemini 3.8 Flash TTS with
  style, MiniMax). Their measured lengths size the scenes; a voice is never
  sped up.
- Music needs a music model in the catalog. First check MiniMax, since its API
  is already integrated, and compare it with alternatives. This needs a small
  paid probe, so ask first. Then the Music Video skill can make a song instead
  of requiring an upload. Lyric timing already exists (Fun-ASR).
- XCut gets separate audio lanes for dialogue, music and effects (timeline
  version 2).

**3. "Produce film".**
- After the storyboard and its stills are approved, the board maps into Film
  v2's storyboard schema and starts a Film v2 production session: user-paid,
  with the budget reserved like Film.
- Progress shows on the board. The film lands as a node and opens in XCut for
  manual edits.
- Notes in the chat go back to the same session for a second cut (Escape
  Velocity's v1 → v2).
- Depends on Film v2 stage B.

**4. User skills.**
- Upload a SKILL.md (and optional small files) as a private skill, checked by
  `parseSkillMd` and wrapped by `wrapSkillForPrompt` (untrusted text; nothing
  is executed).
- "My skills" in the skill picker.
- "Make a skill from this board": the director writes a SKILL.md from the
  conversation and the board.
- A shared gallery comes later, after review.

**5. A cheap draft before the final render, and redoing part of a clip.**
- Approve motion at 480p (Seedance $0.10/s, HappyHorse $0.07/s), then
  re-render the approved scene at 720p/1080p from the same keyframe, prompt
  and seed where the model takes one.
- Redo seconds a–b by continuing from the frame at a and splicing in XCut.

**6. Previs, later.** Start with code-made camera-move presets used as
reference motion; 3D blocking only if creators ask.

## Decisions for the owner
- The director is house-paid Sonnet 5. Heavier planning (Opus, judges) would
  cost more per board: keep it house-paid with limits, or bill it?
- Which music model, after the probe.

## Not now
Team canvases, a paid skill marketplace, voice cloning (consent and abuse
questions first), bring-your-own-key.
