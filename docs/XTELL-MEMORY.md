# XTell masters' memory (agreed Oct 3, 2026)

Owner, Oct 2-3: a master must remember the whole conversation ("continue
and read all"); each master summarizes its own memory with its own model,
"since we want to test each model's summarization capability"; no search,
no recall; keep the design simple. Built for 1:1 conversations now (a
visitor and the masters seated in a temple, each master in its own thread);
the 大師會談 rooms reuse it later.

## What a master receives on each reply, in this order

| | Part | Source | Changes |
|---|---|---|---|
| a | System prompt: persona and temple rules, shared rules (`TONE`), language, length, closing | Code (`MASTERS`, `TONE`, `DAILY_TEACHER`, the reading route's lines) | When the code changes |
| b | User basic info: the saved birthday, time and place | The account (`xtell_profiles`), read on each reply. The master is told not to recite it back. The personality type stays opt-in (the per-room tick, Oct 1) and is part of c when ticked | When the visitor edits it |
| c | Conversation info set at the start: c1 what was entered, with the opening question; c2 the chart; c3 live facts (date, 流年, 目前的天象, 干支); c4 reference texts (籤 poem, 解夢 and 孫子 lines, 古籍 passages) | Saved on the conversation. Only c3 is recomputed, when the visitor's local date differs from the date it was computed for; the master then gets one line saying the facts were updated | c3 at most once a day |
| d | The master's newest memo | `xtell_memories` | When that master summarizes |
| e | The messages after the memo, word for word; the last one is what the master replies to. 1:1: only its own thread (questions put to it or that it answered, and its own answers). Rooms: every message | `xtell_messages` | Grows |

a to d stay the same between replies and e only grows, so the providers
bill the repeated part at their cached rate. Rooms add the roster (masters,
temples, speaking order) after c.

## Storage (migration 126, run by the owner)

- `xtell_messages`: `id`, `reading_id`, `seq` (one database-wide
  auto-increment number: inserts need no lock; gaps do not matter, order
  does), `role`, `content`, `model_id`, `qid`, `to[]`, `input_tokens`
  (answers: what the master actually read), `cost`, `created_at`. Index and
  unique on `(reading_id, seq)`; the visitor's message is unique per
  `(reading_id, qid)` so masters answering together store it once.
- `xtell_memories`: `id`, `reading_id`, `model_id`, `through_seq` (the last
  message folded in), `text`, `input_tokens`, `output_tokens`, `cost`,
  `created_at`. Index and unique on `(reading_id, model_id, through_seq)`.
  Rows are never updated; old ones stay for comparing models.
- `xtell_readings.context`: c3 with the date and time zone it is for, and c4.
  c1 and c2 are already `subject` and `chart`.
- `ai_models.context_window`: editable in `/admin/models`; 100k when empty.
- Visitors read only their own conversations; only the server writes.
- No Redis: the reads are a few indexed milliseconds next to a model answer
  of seconds, a cache could hand a master a stale memo, and Postgres keeps
  one source of truth. Redis may come later for shared rate limits.

## One reply

1. Read the conversation: c1, c2, c4, and c3 with its date.
2. If the visitor's local date changed, recompute c3, save it, add the
   "updated" line.
3. Read b from the account.
4. Newest memo: `where reading_id and model_id order by through_seq desc
   limit 1` → d and `through_seq` (0 if none).
5. Messages: `where reading_id and seq > through_seq order by seq` → e,
   filtered to the master's thread in 1:1.
6. Send a, b, c, d, e; stream the answer.
7. The visitor's message is inserted when the request starts (so it sorts
   before the answers); the answer is inserted with its `input_tokens` and
   cost.
8. In the background: if that answer read more than 70% of the master's
   window, the master summarizes.

## Summarizing

- Who: the master's own model.
- Input: the memo instructions, its previous memo, and the messages after
  it, except the newest ones filling about 40% of the window, which stay
  word for word.
- The memo has fixed sections: the visitor's situation, every question
  asked, chart points used, readings and advice given, open threads. It
  keeps concrete details (dates, names, options), in the conversation's
  language.
- Saved as a new row, `through_seq` = the last message folded in.
- If it fails: the old memo stays and it is tried again after the next
  answer; only if the context would pass the window are the oldest raw
  messages left out, and that is logged.
- Billed like an answer: the master's list price, charged to the visitor,
  logged in `provider_calls` with a memory tag (so the models' summaries can
  be compared on cost and length too).

## On screen

- A 「記憶」 bar per master: its last answer's `input_tokens` against its
  window.
- 「大師的筆記」: that master's newest memo.

## Rollout

0. Done Oct 3, no migration: the reading route builds each master's whole
   thread from the saved conversation (`lib/xtell-thread.ts`), up to 100k
   tokens, instead of the last 20 messages the page sent; the page's copy
   only for a conversation that is not saved; the answer reports
   `inputTokens`. Test: `scripts/test-xtell-thread.ts`.
1. Migration 126: the tables and columns above, and existing conversations
   copied into `xtell_messages` (safe to re-run; nothing removed).
2. Code: write both `turns` and the new tables; read from the new tables;
   the c3 date check; b; summaries; the 記憶 bar and 「大師的筆記」.
3. Later: stop writing `turns`.
