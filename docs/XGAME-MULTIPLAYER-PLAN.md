# XGame multiplayer: several people at one table

Plan, October 21, 2026. Nothing is built yet. The owner asked for the plan
for all seven games first, then to pick the order ("After push, the next
feature is multiple humans to play games together"; "Write the multiplayer
plan for all XGame games first, then we pick the order").

## Where we are

Every game is one row of `xtalk_sessions`, read and written only by our
server routes (service key). Live chat already works in X體育's rooms on
Supabase Realtime, so pushing a move to every player is solved; everything
around it is built for one person:

- **One human per table.** `human_seat` is a single number; every create
  route refuses a second person ("at most one human seat"); the seat menu
  (`SeatSlot`, `'me'`) allows one "me".
- **Only the creator can play or even look.** Each route loads the row and
  answers 404 unless `user_id` is the caller.
- **One page drives the game.** The page loops `step` (one AI act per
  request); its watchdog polls only while an AI is thinking, so nobody else's
  move would ever show up.
- **No clock for people.** Models get 90 s a move; a person can take
  forever (Draw & Guess has its 45 s round, the only exception).
- **Names.** Nobody's name or picture is readable by another user
  (`profiles` is owner-read); X體育 copies them into each message on the
  server. XGame tables say "You".

Found on the way, worth fixing whatever we decide:
1. **Poker and bridge charge a model's move before saving it.** Two pages
   stepping at once (already possible with two tabs) make two model calls
   and both are charged; only one move lands.
2. **Werewolf has no save check at all** (two steps can both advance the
   game), no wallet check before a step, and drops charges under a cent.
3. **Secrets in plain sight.** Werewolf's roles, private night turns and
   kill target, and Draw & Guess's secret word, are stored unsealed in a row
   the creator can read with the publishable key (RLS "owner all"). With one
   person that is cheating against models; with several it is cheating
   against people. Poker and bridge already seal theirs.

## The shared foundation (built once, used by every game)

**1. Seats belong to accounts.** Each seat gets `userId` (null for a model).
The caller's seat is looked up by account; `human_seat` goes. Every view
function takes "which seat is asking" instead of one fixed number, so each
person sees their own cards, roles and turn.

**2. Membership table** `xgame_members (table_id, user_id, seat, joined_at)`
(migration). It answers "may this account act at this table" and puts the
game in every player's history (today the history lists rows by creator).

**3. Lock the table rows.** Take away the browser's direct access to
`xtalk_sessions` (today the creator can read and even rewrite any column);
the menu's rename / delete / list and the Library go through API routes.
Seal Werewolf's and Draw & Guess's secrets the way poker and bridge are
sealed (`lib/game-seal.ts`).

**4. Invite and join.** The host sets up the table as today, with some seats
marked "invite" instead of a model or "me". The table waits in a lobby
(`pending.lobby`, no migration) and gives a link,
`/xgame/<id>?join=<token>`. A signed-in visitor with the link picks a free
seat; their name, @ID and picture are copied into the seat on the server.
The host can remove someone before the start, start when the seats are full,
or fill an empty seat with a model. Invite-only in the first version; a
public "open tables" list and matchmaking come later if wanted.

**5. Live updates.** After every save the server sends a Realtime broadcast
on `xgame:<tableId>` carrying only the new version number; each page then
fetches its own view through the API. Nothing secret ever travels over
Realtime. Presence on the same channel shows who is at the table. The 5 s
watchdog stays as a fallback, now also on people's turns.

**6. One driver for the models.** Any player's page may call `step`, but a
lease decides who acts: a conditional update on a new
`xtalk_sessions.step_until` column (X體育's `claimSpeaker` pattern). Only the
winner calls the model; the others get the current view. Charging happens
only after the move is saved (this also fixes found item 1).

**7. Clocks for people.** Each game gets a time rule for human turns
(proposed below). The deadline is stored on the server and enforced the way
Draw & Guess does it: any request after the deadline applies the timeout
(an automatic move, a fold, a pass, or a loss on time). A closed page does
not stop the clock; reopening the link rejoins the seat.

**8. Talking.** Anything one person writes that others read (poker table
talk, Werewolf speeches, a table chat) goes through `lib/moderation.ts`
like X體育's rooms: refused when the check cannot run, a short rate limit,
report and hide.

**9. Who pays.** Model seats at a shared table are charged to the host at
list price, as today; the host's wallet is checked before every model
move. People pay nothing to join. A table of people only costs nothing.
(Alternatives for the owner below.)

**10. Spectators.** At a table with hidden information and people seated,
a watcher sees only what is public (no hands, no roles), so nobody can peek
from a second account. AI-only tables keep today's full view.

**11. Ratings.** Only model results feed XBoard. Games between people are
not rated (a people leaderboard is a separate decision).

## Game by game

| Game | People | Hidden information | Proposed clock for people | On timeout | Size |
|---|---|---|---|---|---|
| Chess | 2 (or 1 + model) | none | 10 min each, +5 s a move | loses on time | S |
| 象棋 | 2 | none | 10 min each, +5 s a move | loses on time | S (same code as chess) |
| 五子棋 | 2 | none | 60 s a move | a marked automatic move | S |
| Draw & Guess | 2-8 guessers | the word | 45 s a round (exists) | round ends | M |
| Texas Hold'em | 2-9, mixed with models | hole cards | 30 s an action | check, else fold | M |
| Bridge | 2-4, mixed with models | four hands | 60 s a call or card | pass / lowest legal card | M-L |
| Werewolf | 2-8, mixed with models | roles, night actions | 60 s a speech, 30 s a vote or night act | silent turn / no vote / no act | L |

**Chess and 象棋.** The smallest step: two seats, nothing hidden, moves
already checked by the engine. Adds resign (exists), offer a draw, and
"opponent left" after their clock runs out. The two routes are the same
shape, so one change covers both.

**五子棋.** Two seats; the match is two games with colours swapped, so
"next game" waits until both players press it (today it auto-advances only
for models).

**Draw & Guess.** No model turns, so no lease or charging. Several people
guess the same pair of drawings at once against the shared 45 s deadline
(already on the server). Others see "Mei got it" but never the guess text,
so nobody is spoiled. Points by order of the right answer; the final vote
on the better drawing stays per person. The creator's daily cap of 10 tables
stays.

**Texas Hold'em.** Per-seat views exist (each sees only their own hole
cards). Adds people's table talk (`say`, moderated, 80 characters like the
models), a 30 s action clock, a busted person becomes a watcher (exists for
one person). The host ends the game for everyone.

**Bridge.** Partnerships of any mix (two people against two models, or four
people). The declarer plays the dummy, as now; when a person's partner
declares, that partner plays the person's dummy hand (correct bridge, but
say so on the table). Per-seat hand hiding exists.

**Werewolf.** The largest change. First seal its state (found item 3). Then:
several people may hold roles at once, so night acts are per role: two
human wolves see each other's suggestion and the first confirmed kill
counts; the seer and doctor act privately. Day speeches keep today's
rotating turn order with a 60 s clock; votes are private until the tally.
The engine already redacts the transcript per seat; it moves from "the one
human" to "each player".

## Suggested order

1. **Foundation with chess and 象棋** (items 1-7, 9; migration: members table,
   `step_until`, browser access to `xtalk_sessions` removed).
2. **五子棋.**
3. **Draw & Guess** (a party game; no model cost).
4. **Texas Hold'em** (adds moderated table talk, item 8).
5. **Bridge.**
6. **Werewolf** (sealing first).

Found items 1 and 2 (double charges, no save check) are worth fixing before
any of this, as a small change of their own.

## Decisions for the owner

1. **Who pays for model seats** at a shared table: the host (proposed),
   split between the people seated, or each person pays for "their" model?
2. **Invite links only** at first (proposed), or a public list of open
   tables from the start?
3. **The clocks** in the table above.
4. **Watchers** at tables with people: allowed with the public view
   (proposed), or not at all?
5. **A leaderboard for people**, or results between people stay unrated
   (proposed)?
6. **XTalk's multi-person rooms** (owner, Aug 23: "should come first",
   maybe renamed XChat) share this foundation (membership, presence, moderated
   talk): build it here first, or there?

## Migration and checks

- One migration, run by hand by the owner: `xgame_members`,
  `xtalk_sessions.step_until`, browser access to `xtalk_sessions` revoked
  (after the menu, Library and Werewolf page stop using it). Proven on PGlite
  first; checked live with the publishable key (another user and the creator
  both refused).
- Tested with two real accounts in two browsers (the owner's two Google
  accounts): join by link, both pages update within a second, each sees only
  their own hidden information, a closed page loses on time, a model seat
  charges the host once per move even with both pages open.

## Step 1: chess and 象棋, two people (proposed Oct 21, awaiting a yes)

**What two people see.**
1. The host opens 西洋棋 or 象棋, takes one seat (我來下) and picks
   「邀請朋友」 for the other, then starts. The table waits and shows its
   invite link with 複製 / 分享 (the phone's share sheet).
2. The friend opens the link (signing in if needed), sees the board and
   「入座（黑方）」, taps it, and the game starts on both screens.
3. Each sees their own side at the bottom (exists), both names, @IDs and
   pictures, and two clocks: 10 minutes each plus 5 s a move. A move shows on
   the other screen within a second.
4. Resign (exists) or lose on time. The game is in both players' history
   (menu and Library).
5. Not in step 1: offering a draw, a rematch, watchers, a model plus two
   people, a public list of open tables.

**Server.**
- `lib/xgame-table.ts`, shared by every game later: the seat of the asking
  account, the invite token (random, in `pending.lobby`, valid until the game
  starts), adding and removing members, copying name / @ID / picture from
  `profiles` at join, the Realtime ping (the server sends only the new
  version on `xgame:<id>`; each page then fetches its own view), and the
  clock arithmetic (pure, with a check script).
- The chess and 象棋 routes: `create` with an invite seat (no model, free),
  `join`, `leave` (before the start), `state` for members and link holders,
  `move` / `resign` only from the seat's owner, the clock applied on every
  request (loss on time), a ping after every save. One-person tables work as
  today.
- `/api/xgame/shared`: the tables I joined as a guest, for the menu and
  the Library.

**Migration 147** (`supabase/147_xgame_members.sql`; written as 146, applied by the owner Oct 21 and checked live): the members
table (server only), `step_until` for later games, and the browser's writes
to `xtalk_sessions` limited to renaming (it can read, rename and delete its
own rows, as every page does today, and nothing else). Proven on PGlite
against migration 57's original policy, 19 of 19: the hole reproduces
before (the creator rewrote `pending`), after it the creator renames and
deletes but cannot rewrite `pending`, `winner`, `day` or the lease (42501)
nor insert; nobody but the server reads members; one account cannot take two
seats, two accounts cannot share one; the lease is won once; deleting a
table removes its members; it runs twice cleanly.

**Order.** The owner runs 147 first (it stands alone: it only removes writes
no page makes); I check it live in the owner's Chrome; then I build step 1
on a branch, test it with scripts and the owner's account, and the last
check needs a second account: the owner's other Google account in another
browser or on a phone, opening the invite link. No model calls, no cost.

## Step 1b: the table's two chats (built Oct 21, not pushed)

Owner: "similar to XSports chat room but this is private and human can
invite AI to be commenter", then (replacing paid public commentators): "we
enable the chat room by default and have a low cost fast model to be as
commenter? it will 解說戰局 by default but users can hire private AI to help.
and opponent can only see you hire someone but don't know what they tell
you"; "private and public chat room in the same game page"; the house
commentator "is by system for sure"; GPT-6 Luna.

- **公開** (every two-person chess / 象棋 table, on by default): both
  players and the house commentator, GPT-6 Luna at its quickest, paid by the
  house up to `XGAME_HOUSE_DAILY_USD` a Taipei day ($5 unset; about $0.0001
  a remark, measured). It explains the game after every 4th ply, a check and
  the end, and answers @Luna / @AI. It never picks a move for either side
  (advice is the helper's job).
- **我的 AI 助手**: one helper per player, any model that passes the game's
  time rule, paid by the hirer at list price per remark (wallet checked
  first). It answers every message there; 問了才說 / 偶爾提醒 (every 3rd
  opponent move) / 對手每步後. The opponent sees only 「wei 請了 AI 助手」:
  never the model or a word of it.
- Server: `lib/xgame-chat.ts`, `/api/xgame/chat` (list · send · delete ·
  hire · dismiss · talk), the move routes call `remarkAfterMove` in `after`.
  One AI speaks at a time per table (the `step_until` lease). Messages are
  moderated and rate-limited (one per 2 s), stored in `xgame_messages`
  (migration 148; `private_to`, migration 149), server only; the helpers in
  `xtalk_sessions.chat_ais` (148), out of `pending` so a move's save can never
  drop one.
- Page: `app/xgame/TableChat.tsx` beside the board, two tabs with an unread
  dot, under the status line on phones.
- Not yet: a chat for games against models, watchers, muting the house
  commentator per viewer, the other games.
