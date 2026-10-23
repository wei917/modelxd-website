# XFilm and XKit: plan (Oct 17)

Owner, Oct 16–17: one app per letter ("too many C and D"); "XCreate XDirect
XCut can merge into two"; "advanced video/audio multimedia should go XFilm";
"XDev to XKit make sense". Oct 19: two apps, XCreate and XFilm, and the line
between them: "文字, 圖片, 影片, 音訊 in XCreate, others in XFilm". Oct 22:
the name XFilm is confirmed (XMontage was the runner-up; XStudio clashes with
XSports on S and with XCreate being "the studio"), and the owner will build
it in a new conversation. Phase 1 is built on branch `claude/xfilm` (Oct 22,
not pushed); see the STATE entry of that day.

XKit and XOracle are done (pushed Oct 20): `lib/renamed-apps.js` is the
redirect list XFilm's old addresses go into (`subpaths` true or false; see
its header for the /xoracle pictures lesson). Migration 143 already reserves
the @ID `xfilm`.

## What changes

| Today | After | Letter |
|---|---|---|
| XCreate (X創作) | XCreate: 文字, 圖片, 影片, 音訊, each with its one-tap tools and single-output templates; runs still continue on the canvas | C |
| XDirect (X導演) + XCut (X剪輯) + X創作's 成片 and 同款 tabs | **XFilm**: directed, automatic and remade films (同款 with its templates, e.g. 風扇變裝), and their editing | F |
| XDev (X開發者) | **XKit** (X開發者 kept) | K |

The line: one generation is XCreate; a video made of several shots that are
planned, made and cut together is XFilm. (A canvas is not the line: XCreate's
own runs continue on one.)

Afterwards C, D and T still need one look: D keeps XDuel only; T still has
XTalk and XOracle (XTalk's new name is open).

## The model: updream, not CapCut (owner, Oct 17)

- **What to learn from.** "I don't need so many features like CapCut so
  updream should be the one we can learn." updream (Bilibili) puts an agent,
  a canvas, a storyboard and a simple multi-track timeline in one app. What
  we know of it is in `docs/XDIRECT-V2-PLAN.md`.
- **The editor stays simple.** It does what a film made from generated shots
  needs: order and trim the shots, add voice, music and subtitles, regenerate
  part of a shot, and export. No effects suite.
- **Direct and Edit are desktop-first.** "Editing file will be on desktop,
  don't worry about phone or desktop." This is the exception to the site's
  phone-first rule. **Auto and Remake stay phone-first** (Oct 22): they are
  fill-in-and-wait flows, and 同款 comes from social video trends, where
  people are on phones.

## XFilm's shape

One app at `/xfilm`, under the same kind of top bar as /profile (X先知's
embedded bar, XDuel's red), with four places. Oct 22, owner: no Projects
tab ("my projects should be inside Direct"); `/xfilm` opens on Direct, whose
first screen is your boards with + New.

| Tab | What it is today | Address |
|---|---|---|
| 導演 Direct | XDirect: your boards first, then director chat + canvas + storyboard | `/xfilm/direct` (boards), `?new=1` (start screen), `?c=<board>`, `/xfilm/direct/<template>` |
| 剪輯 Edit | XCut: the multimedia editor | `/xfilm/edit?p=<cut>`, `?from=<board>` |
| 自動成片 Auto | X創作's 成片: a brief becomes a film, run by Claude | `/xfilm/auto?film=<id>` |
| 同款 Remake | X創作's 同款: a video link or upload remade with your swaps, and its templates (風扇變裝) | `/xfilm/remake` (`?remake=<id>`, `?fan=new` / `?fan=<id>`) |

The story bible moves with Direct: `/xfilm/bible/<id>`.

## Phase 1: one app in name and place (no behaviour change)

1. **Pages move**, with `git mv` so history follows: `app/xdirect` →
   `app/xfilm/direct`, `app/xcut` → `app/xfilm/edit`, `app/xcreate/FilmStudio.tsx`
   (+ `film-copy.ts`) → `app/xfilm/auto`, `app/xcreate/RemakeStudio.tsx` and
   `FanTemplate.tsx` (+ `remake-copy.ts`, `fan-copy.ts`) → `app/xfilm/remake`. The components (XDirectorChat,
   SceneStrip, WorkflowCanvas, XCutEditor, XCutLibrary) stay where they are;
   WorkflowCanvas and `lib/xcut-render.ts` are shared with X創作, XSports and
   platform export.
2. **The boards list** (new, small; Oct 22: inside Direct, boards only):
   `xdirector_conversations`, newest first, via `/api/xdirector/boards`.
3. **Every old address forwards**, query kept, temporary at first so they
   can be changed: the paths through `lib/renamed-apps.js` (built Oct 20 for
   XKit and XOracle; next.config.js turns it into redirects), and X創作's
   `?type=film` / `?film=` / `?type=remake` / `?remake=` / `?fan=` links by a
   query-matched redirect (`has: [{ type: 'query', ... }]`), since that list
   moves whole paths only:

   | Old | New |
   |---|---|
   | `/xdirect` (`?c=`, `?q=`) | `/xfilm/direct` (same query) |
   | `/xdirect/<template>` | `/xfilm/direct/<template>` |
   | `/xdirect/bible/<id>` | `/xfilm/bible/<id>` |
   | `/xdirector` | `/xfilm/direct` |
   | `/xcreate?agent=1`, `/xcreate?c=` | `/xfilm/direct` (code in X創作 today) |
   | `/xcut` (`?p=`, `?from=`) | `/xfilm/edit` (same query) |
   | `/xcreate?type=film`, `/xcreate?film=<id>` | `/xfilm/auto` (`?film=<id>`) |
   | `/xcreate?type=remake`, `/xcreate?remake=<id>`, `/xcreate?fan=<id>` | `/xfilm/remake` (same query) |

4. **Menus and words:**
   - Left menu: X導演 and X剪輯 become one entry, XFilm. X創作's top bar keeps
     文字, 圖片, 影片, 音訊; 成片 and 同款 move.
   - Elsewhere: Omnibox, the landing cards (`HomeClient.tsx`), the site agent's
     ROUTES and `content/site-guide.md`, and the hand-off links (Assemble
     film → Edit, Edit → back to the board).
   - i18n: a new `nav.xfilm` in 5 languages. The old keys stay until nothing
     uses them.
5. **/profile Library:** one XFilm section holding boards, cuts and films
   (today xdirects + xcuts, and films and 同款 makes sit inside X創作). The saved section
   choice (`modelxd.library.sections`) maps the old keys, so nobody loses
   theirs.
6. **What does NOT change:**
   - API routes (`/api/xdirector/*`, `/api/xcut/*`, `/api/xcreate/film*`,
     `/api/xcreate/remake/*`; the
     film cron is in `vercel.json` and passes the gate through `proxy.ts`).
   - Tables and storage paths.
   - The managed agent's name (`XCreate film director`; renaming it would make
     a new agent).
   - `public/xdirect/*` pictures (skills link to them).
   - Stored values: `credit_transactions.reference_type` (`xdirector`, `xcut`,
     `xcreate_film_*`) and site-visit history.
7. **Reading old data under the new name:**
   - The Profile spending groups map `xdirector`, `xcut` and `xcreate_film_*`
     to XFilm.
   - /admin/traffic shows old `xdirect` / `xcut` visits under XFilm (display
     only).
   - Handles: `xfilm` and `xkit` are already reserved (migration 143, run
     Oct 20, and `lib/handle.ts`).

## Phase 2: one project

- A film from Auto can open in Edit (its clips on the timeline) and as a board
  in Direct.
- A board's cuts and films show together in Projects.
- Needs one additive column (e.g. `xcreate_films.board_id`), a migration run by
  the owner.

## Phase 3: the work already planned continues inside XFilm

`docs/XDIRECT-V2-PLAN.md` and `docs/FILM-V2-PLAN.md` (Oct 7) carry on
unchanged:
- a library of characters, looks, voices and places;
- voice and music tracks (timeline v2, with separate dialogue, music and
  effects lanes);
- Produce film;
- user skills;
- drafts before final renders.

That is the "advanced video and audio" part.

Another session has uncommitted Film v2 work (`ModelXD-film-v2`:
`lib/film/engine/`). Phase 1 moves files only under `app/`, not `lib/film/`, so
the two should not collide; still, agree the order with that session first.

## XKit: DONE Oct 20 (another session; `/xdev` forwards to `/xkit`, XOracle too)

- `app/xdev` → `app/xkit`. The page title becomes "XKit — API keys & docs".
  `/xdev` and `/xdev/docs` forward to `/xkit` (`#docs`).
- Names: `nav.xdev` en "XDev" → "XKit" (X開發者 / X开发者 / Xデベロッパー /
  X개발자 stay).
- Addresses we hand to developers: the "modelxd.com/xdev" strings in
  `/api/v1/chat/completions`, `/api/mcp` and `/api/xcreate` messages.
- Also: `docs/API-V1.md`, the site guide, the agent's ROUTES, Omnibox and the
  landing link.
- Unchanged: `/api/v1/*`, `/api/mcp`, `/api/xdev/tokens` (developers' code calls
  them), and the `api` model-block key.

### XKit in other companies' assistants (owner, Oct 19)

Owner: "in XKit, we should also build ChatGPT plugin and other similar tools
for other companies". Today's assistant "plugins" are mostly MCP, and XDev
already runs an MCP server (`/api/mcp`).

| Where | How it works | What we need |
|---|---|---|
| ChatGPT | Apps in ChatGPT: the Apps SDK, which is an MCP server plus optional in-chat UI, listed in the app directory after review | OAuth sign-in, a few well-made tools, small UI cards (a reading, a picture or video result) |
| Claude | Connectors directory: a remote MCP server with OAuth | The same server, submitted for listing |
| Microsoft Copilot | Copilot Studio takes MCP servers | The same server |
| Cursor, VS Code, other coding tools | One-click MCP install links | Install buttons on the XKit page |
| LINE (Taiwan, Japan) | Not MCP: an Official Account chatbot or a LIFF mini app | A separate build; X先知 as a LINE fortune bot fits best |

- **The shared piece: OAuth on the MCP server.** Developers paste an API key
  today. Directory users sign in with their ModelXD account, and charges come
  from their own credits at list price, as on the site. This is built once.
- **Which tools to offer.**
  - X先知: a reading.
  - X創作: make a picture or a video with a chosen model.
  - Compare: one prompt, two models, prices shown.
  - Model list with prices.
- **Order.**
  1. OAuth.
  2. The ChatGPT app.
  3. The Claude connector.
  4. Install links for the coding tools.
  5. The LINE bot for X先知.
- **Check before building.** These platforms change their rules often. Read
  each one's current submission requirements first: review, privacy and
  support pages, and content rules for fortune telling.

## Size

- XKit: about half a day.
- XKit's OAuth plus the ChatGPT app: to size after reading the current Apps
  SDK rules.
- XFilm phase 1: 1–2 days.
- Phase 2: 1–2 days plus one migration.

Each step is checked on :3000 at desktop and phone width, then pushed only on
the owner's word.

## Decided (Oct 22)

1. Chinese name X影音; ja X映像, ko X영상.
2. Tabs 導演 / 剪輯 / 自動成片 / 同款 (no Projects tab).
3. `/xfilm` opens on 導演, which opens on your boards. (Oct 23: 同款 is the
   first tab and `/xfilm` opens on it; a board or director link still goes to 導演.)
4. /profile Library: one XFilm section.
5. Phase 1 went ahead: the Film v2 work (`lib/film/engine/`, untouched
   since Oct 7) is outside `app/`, so the two do not collide.

Still open: XTalk's new letter (T is shared with XOracle).
