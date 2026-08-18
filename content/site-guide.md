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

ModelXD helps you find the AI model that gives you the best result for the
money. Rather than trusting a vendor benchmark, you compare real models on
your own prompt, vote on the output **before** seeing the price, and then see
what each one actually cost. Those blind votes feed a public leaderboard.

The core belief: the most expensive model is very often not the one you would
have picked, and you can only discover that if the price is hidden while you
judge.

## The seven surfaces

### XDuel — `/xduel`
The free front door. Enter one prompt; two anonymous models answer side by
side. You vote for the better answer, **then** the prices are revealed, then
you vote again knowing the cost. Both votes feed the leaderboard rating.
Free to use, with a per-mode daily quota. Supports text, image and video.
No web search here by design — it is meant to be a clean like-for-like test.

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
to every signed-in account. (Old `/xdirector` and "Agent Mode" links land
here.)

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

### XVote — `/xvote`
Judge other people's duels. You see two anonymous answers, vote for the one
you prefer, and your vote feeds the same leaderboard. This is how the ratings
get enough data to be meaningful.

### XBoard — `/xboard`
The leaderboard. Models ranked by **XD Score**, a Bradley-Terry rating
computed from real blind head-to-head votes — not a vendor benchmark. Filter
by text, image or video, and by sub-type. Separate boards exist for
search-enabled models and for Werewolf results (Werewolf is scored as its own
pool and deliberately kept out of the main XD Score, because talking six
models into mislynching a villager is not the skill the duels measure).

## Accounts, credits and pricing

Sign in with Google. New verified accounts get **$10 of free credit**.
XDuel is free within its daily quota; XCreate, XDirect and XTalk spend
credits at the model's real rate, always shown per run before and after.
Top up from your Profile. Your balance and a full itemised activity ledger
live at `/profile` — the ledger groups charges by session, so a whole
Werewolf game or one generation and its follow-ups read as a single row you
can expand.

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
- **Can you answer questions about other things?** No. This guide is only
  about ModelXD — it does not answer general questions, write things, or do
  work for you. The surfaces above are where the models do that.
