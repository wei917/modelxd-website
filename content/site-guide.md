# ModelXD — site guide

This file is the ModelXD agent's knowledge of its own product. It is read on
every question asked in the omnibox. Keep it factual and current: if a feature
moves, changes name, or ships, edit this file — the agent has no other source
of truth about the site, and a stale line here becomes a confident wrong
answer to a user.

Written as answers to the questions people actually ask, not as a feature
matrix, because that is the shape the agent has to reply in.

---

## What ModelXD is

ModelXD is an AI application platform with model routing underneath.
Eyebrow: "AI apps that run winning models." Headline: "The best AI
for every task." You come here to make and do things — films, stories,
analysis, chats, gaming, benchmarks, or your own agents — and ModelXD sends each job to
whichever model earns it, decided by two independent kinds of evidence:
real blind votes, and XEval runs on public benchmark datasets (GDPval).
Prices are always in the open. Developers get the same routing inside their own agents through
XDev (API keys; docs at /xdev/docs). Two surfaces on one key: an
OpenAI-compatible text API — POST /api/v1/chat/completions, point any OpenAI
SDK at the base URL; `model` takes `provider/model_name` or the routing verbs
`xd/auto` (best by blind votes) / `xd/cheap` (good enough, cheapest); JSON
schema output is enforced server-side; every response reports its real
`cost_usd` — and an MCP server (/api/mcp: `get_leaderboard`, `pick_model`,
`generate_image`, `generate_video`, `check_job`, `get_balance`) for image and
video generation from agents. Keys are server-side only and spend-capped.
The votes come from people comparing models on their own prompt and
voting **before** the price is revealed; those votes feed XBoard and the
XEval benchmark page.

The core belief: the most expensive model is very often not the one you would
have picked, and you can only discover that if the price is hidden while you
judge.

## The surfaces

### XDuel — `/xduel`
The free front door. Enter one prompt; two anonymous models answer side by
side. You vote for the better answer, **then** the prices are revealed, then
you vote again knowing the cost. Both votes feed the leaderboard rating.
Free to use, with a per-mode daily quota. Supports text, image and video.
No web search here by design — it is meant to be a clean like-for-like test.

If one of the drawn models is unavailable (a provider outage, or a model
temporarily out of service), XDuel quietly draws a different one from another
provider and runs it instead, so you get a real comparison rather than a
broken half-duel. You never picked the two models — the site draws them — so
a swap is just a different draw. Your vote is always credited to the model
that actually answered. If no replacement is available, the duel is marked
failed and your daily quota is refunded.

### XCreate — `/xcreate`
Your private studio. Pick up to four models and run the same prompt through
all of them at once, then keep working with whichever won. Supports text,
image and video, plus recipes like image-to-video, reference-to-video,
start-and-end-frames, and video editing. Per-seat settings let you choose a
model's thinking depth and switch web search on. Costs real credits.

**One-click tools and templates.** XCreate ships presets for the tasks people
actually arrive with — removing or replacing a background, upscaling, erasing
strangers from a photo, retouching skin, sticker sheets, virtual try-on,
product shots, style transfers (Ghibli, pixel art, oil painting, cyberpunk and
more), outfit swaps in video, start-and-end-frame clips, and document
summarising or earnings analysis. Picking one sets the mode, chooses suitable
models, and writes a starting prompt for you; you can edit any of it before
running. If someone describes one of these tasks, send them straight to that
preset rather than to an empty studio.

### XDirect — `/xdirect`
A director you talk to, working beside a live canvas board. Describe the
video you want — "an ad for my sneakers", "a product video from these
photos" — and the director first puts a **storyboard on the board**: scene
cards with a script, a shot plan, a duration and a model pick with its real
price, chosen from the leaderboard's actual scores. Drafting is free.
You edit the scenes right on the cards — rewrite the script, change the
length, reorder, add or delete — then generate scene by scene (each card
shows its price) or all at once. Finished clips fill their cards and land
as nodes on the board, wired together so you can see how the piece was
built. Still images skip the storyboard and generate directly. Every
generation bills and appears in your history like a normal run. Available
to every signed-in account.

Templates on the XDirect start screen set up a whole production: **Music
Video** (a song or lyrics in; cast locked, cut to the music), **Animation**
(one art style, character model sheets, still-first), **Story to Video** (a
novel, a chapter or any story — PDF, .txt or pasted text, any length — is
summarized into at most ten scenes that matter, every recurring character
cast as a three-view sheet first, then storyboarded in one style), **Social
Post** and a product-video pipeline. In every template the recurring
characters are locked as three-view character sheets (front, three-quarter,
profile) before a scene is shot, so the same face carries through the film. (Old `/xdirector` and "Agent Mode" links land
here.)

The **Music Video** setup can also take a **reference video**: paste a public
YouTube link and ModelXD watches it, pulls its look — palette, grade, lens,
lighting, location — into real style frames, and reads its cutting rhythm so
the scenes are timed the way that video cuts. Reading the link is free. It
borrows the look, not the video: it will not recreate its shots, its
performers or any text on screen. With a link there is no need to pick a
style preset. Attach the song itself and the lyrics are transcribed with
timings automatically, so you don't have to type them — correct any line it
mishears and your wording is used from then on. You can also say how the song
FEELS (upbeat, ballad, rock, country and so on), which drives cutting energy
rather than the look. For the cast, the shelf card asks rather than assumes:
attach 1-3 photos of the person you want as the lead, or have an original one
created — either is one click.

### XCut — `/xcut`
The cutting room. A video editor with three tracks — video, audio,
subtitles — where every shot knows which model made it and what it cost.
Open an XDirect board's storyboard as a **rough cut** with one click
(**Assemble film** on the storyboard), or start blank and drop in clips, stills and
audio from your own generations (XDirect, XCreate, XDuel) or upload your
own video, music and images. Trim clips by dragging their edges, split at
the playhead, reorder by dragging, choose a hard cut or a dissolve between
clips, lay a music track with fades over the clips' own sound (or mute
them), and write subtitles — a board's scene scripts arrive as subtitles
already. A rough cut made from a **Music Video** board arrives ready: the song
is already laid on the audio track, the clips' own generated sound is muted so
only the track plays, and subtitles are left off (a scene's script is the
director's note, not a caption). Play the whole film in the browser, then **Export** renders one
MP4 (720p or 1080p, 16:9 / 9:16 / 1:1) on ModelXD's servers: it lands as a
FINAL CUT node on the source board, in your history, and as a download.
Exporting is free — it is compute, not a model. Available to every
signed-in account.

### XTalk — `/xtalk`
Put several AI models in one room together. Available to every signed-in
account. Two formats today:

- **Discussion** — 2 to 8 models talk about a topic you set. You choose the
  speaking order (in order, auto-bidding for the floor, or manual pick), can
  give each seat a character, and can join in or add and remove models at any
  time.
- **Characters** — build your own persistent AI character: a persona and
  appearance you write, photos you upload or generate, and — the ModelXD
  angle — your choice of the model it runs on, with the real price of a
  conversation shown up front. Characters remember past chats. They can
  speak: pick a preset voice or design a custom one from a text description
  (voices are text-designed only — never cloned from a real person's
  recording), then talk hands-free in voice chat or a live call.
- **Werewolf moved** — the Werewolf game now lives on XGame (`/xgame`).

Formats have a "how to play / how it works" sheet behind the **?** on
their card.

### XGame — `/xgame`
The AI game arena. AI models play full games against each other and you can
take a seat yourself. Games get a permanent URL and appear in your history.
Today:

- **Werewolf** — a 7-player social-deduction game (2 werewolves, 1 seer,
  1 doctor, 3 villagers) where seven AI models play each other, or you join
  and request a role.
- **Gomoku (五子棋)** — five in a row on a real board; every seat can be a
  human or an AI, moves are rule-checked by the engine, and each move shows
  the model's reasoning. Gomoku also runs as a blind **game duel** on XDuel:
  play a mystery model yourself or watch two mystery models fight, vote,
  then see who they were and what each move cost.
- **Draw & Guess** — one secret word, drawn by two anonymous image models
  side by side. You guess against the clock with hints from a host, then
  vote the better drawing; after five rounds the artists are revealed.

Coming to the arena: Chess, 中國象棋, and 麻將.

### XDev — `/xdev`
For developers and agents. Create an API key, and point any
OpenAI-compatible client at ModelXD's own endpoint
(`/api/v1/chat/completions`) to reach every model in the catalog through one
key and one bill. Keys can carry a **spend cap**, and there is an **MCP
server** so an agent can query the leaderboard and run models as tools. Full
reference at `/xdev/docs`.

Address a model as `provider/model_name` — for example
`google/gemini-3.6-flash` — or let ModelXD choose: **`xd/auto`** picks the
highest XD Score, **`xd/cheap`** picks the cheapest model that still clears a
quality bar (measured about 10× cheaper than `xd/auto`). The headline feature
is **structured output** — ask for JSON matching a schema and you get it back
filled in, across providers that each express schemas differently. Tool
calling is deliberately not supported.

Calls bill at the model's **list price** — the same number XBoard publishes.
Billing over it would make the leaderboard false.

### XVote — `/xvote`
Judge other people's duels. You see two anonymous answers, vote for the one
you prefer, and your vote feeds the same leaderboard. This is how the ratings
get enough data to be meaningful. Unlike XDuel there is no reveal step here —
you are judging the answers, not the names.

The models really are hidden: their names and prices are not sent to your
browser until you have voted, so they cannot be found by inspecting the page.
Voting requires being signed in. You can open any duel's shareable link and
read it without an account, but you cannot vote on it until you sign in.

### XBoard — `/xboard`
The leaderboard. Models ranked by **XD Score**, a Bradley-Terry rating
computed from real blind head-to-head votes — not a vendor benchmark. Filter
by text, image or video, and by sub-type. Separate boards exist for
search-enabled models and for Werewolf results (Werewolf is scored as its own
pool and deliberately kept out of the main XD Score, because talking six
models into mislynching a villager is not the skill the duels measure).

### XEval — `/xeval`
ModelXD's benchmark replication lab, now multi-benchmark: a switcher at the
top selects the task set. (1) OpenAI's GDPval gold tasks (real professional
work: memos, spreadsheets, analyses) run through an open-source agent
harness and scored by anonymized pairwise comparison with a fully disclosed
LLM judge panel — this ladder also carries the ModelXD Router @ auto row,
ModelXD's own service measured: for every task in the library it serves the
entry that measured best there. (2) Terminal-Bench 2.1 (real terminal/agent
tasks in Docker), scored by each task's own verifier tests — binary pass
rate and $-per-solved-task, no judges. Two things make it different from other leaderboards: every entry
is a (model × reasoning-effort) pair with its real measured cost per task,
and the whole protocol (judge identity, effort, verdict counts) is public.
XEval is separate from XBoard: XBoard ranks models by real human blind
votes cast on ModelXD; XEval republishes benchmark work under our own
transparent protocol. Public page, no sign-in needed. Numbers are not
comparable to GDPval-AA's leaderboard (different judges and anchors).

### XTell（X算命）— the temple street

`/xtell`, signed-in. Two temples in phase 1: **八字廟** (BaZi, four pillars)
and **紫微斗數廟** (Zi Wei Dou Shu, twelve palaces). The honest split to
explain when asked: the CHART is computed exactly by open calendar engines
(lunar-typescript for 八字 — solar-term correct, so an early-January birth
belongs to the previous 干支 year; iztro for 紫微) and is shown for the user
to verify against any 排盤 site. Casting the chart is free. The READING is
interpretation: the user picks any text model with the standard picker, can
turn on web search where that model supports it, and pays that model's
listed price. Readings are for reflection and entertainment, never advice —
health, money and legal questions belong with professionals.

## Accounts, credits and pricing

Sign in with Google. New verified accounts get **$10 of free credit**.
XDuel is free within its daily quota; XCreate, XDirect and XTalk spend
credits at the model's real rate, always shown per run before and after.
Top up from your Profile. Your balance and a full itemised activity ledger
live at `/profile` — the ledger groups charges by session, so a whole
Werewolf game or one generation and its follow-ups read as a single row you
can expand.

### Inviting people

Everyone gets the $10 on signup, with no card. On top of that, share your
referral link from `/profile`: someone who joins through it gets **$5 extra**
(so $15 to start), and you get **$5** as well. Both are released when they
verify a payment card.

The card check is a real card, but it is **never charged** — it only proves
one person is not collecting the bonus with a stack of fresh Google accounts.
There is no limit on how many people you can invite. Signing up without a
referral link never requires a card; the link is always an upgrade, never a
demand.

## Common questions, short answers

- **Where is Werewolf?** On XGame (`/xgame`) — it moved there from XTalk.
- **Where do I compare models?** XDuel for a free blind test, XCreate to run
  up to four at once yourself.
- **Which model is best / cheapest?** XBoard ranks by XD Score with prices;
  filter by medium.
- **How do I make a video?** XCreate, set Generate to Video. For something
  complex — an ad, several shots, a small production — go to XDirect and
  describe it to the director.
- **How do I talk to an agent / the director?** XDirect (`/xdirect`).
- **Where are my past generations and games?** In the left nav history, and
  in full at `/profile`.
- **Is it free?** XDuel is, within a daily quota. Everything that runs a model
  for you costs credits; new Google accounts start with $10.
- **A model said it was unavailable — was I charged?** No. When a model fails,
  nothing is billed for it: XCreate refunds the reserved amount, and a broken
  XDuel refunds the daily quota. "Unavailable right now" usually means our
  account with that provider has hit a limit, which is on our side and not
  yours; pick another model and it will run. On XDuel the site swaps in a
  different model by itself.
- **How do I invite someone / do you have referrals?** Yes — your link is on
  `/profile`. They get $15 instead of $10 and you get $5, once they verify a
  card. The card is never charged.
- **Can I use ModelXD from my own code or agent?** Yes — XDev (`/xdev`) gives
  you an API key for an OpenAI-compatible endpoint, plus an MCP server.
- **Can you answer questions about other things?** No. This guide is only
  about ModelXD — it does not answer general questions, write things, or do
  work for you. The surfaces above are where the models do that.
