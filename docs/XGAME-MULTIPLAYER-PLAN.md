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
