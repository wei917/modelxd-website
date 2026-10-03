# XTell masters' memory (agreed Oct 3, 2026; built Oct 3)

Owner, Oct 2-3: a master must remember the whole conversation ("continue
and read all"); each master summarizes its own memory with its own model,
"since we want to test each model's summarization capability"; no search,
no recall; keep the design simple. Built for 1:1 conversations now (a
visitor and the masters seated in a temple, each master in its own thread);
the 大師會談 rooms reuse it later.

Code, shared by every surface (owner, Oct 3: "this problem exists for all
subdomain not just XTell", "we should modularize now"):
`lib/conversation-memory.ts` (each model's limit and price jump from its
catalog row, what a reply read, the budget, the summary point, the summarize
step with storage passed in) and `app/components/ContextMeter.tsx` (current /
max, the summary point marked). XTell's own: `lib/xtell-thread.ts` (who sees
which message), `lib/xtell-memory.ts` (its tables and the wording its masters
read), the reading route (`app/api/xtell/reading/route.ts`), the page and
`app/components/xtell/MemoryDialog.tsx`. Tables: `supabase/126_xtell_memory.sql`.
Tests: `scripts/test-conversation-memory.ts`, `scripts/test-xtell-thread.ts`,
`scripts/test-xtell-memory.ts`. XTalk is the next surface to use the shared
part (it sends whole rooms with no limit); XCharacter keeps its own memory
work for now.

## What a master receives on each reply, in this order

| | Part | Source | Changes |
|---|---|---|---|
| a | System prompt: persona and temple rules, shared rules (`TONE`), language, length, closing | Code (`MASTERS`, `TONE`, `DAILY_TEACHER`, the reading route's lines) | When the code changes |
| b | The visitor's saved birth date, time and place, "for reference; this conversation's chart may be someone else's; never recite it back" | The account (`xtell_profiles`), read on each reply; not for 每日. The personality type stays opt-in (the per-room tick, Oct 1) and joins the facts only when ticked | When the visitor edits it |
| c | Set at the start: what was entered, the chart, today's date in the visitor's zone and the day's facts (流年, 目前的天象 at the day's local noon, 干支), the reference texts (籤 poem, 解夢 and 孫子 lines, 古籍 passages looked up for the OPENING question) | Computed by code on each reply from the saved chart and the visitor's local date (the page sends its time zone). Not stored: the same date gives the same text, so it stays cacheable all day, and nothing a visitor can write reaches the instructions. When the date moved on since the last answer, one line says so | Once a day |
| d | The master's newest summary | `xtell_memories` | When that master summarizes |
| e | The messages after the summary, word for word; the last one is what the master replies to. 1:1: only its own thread (questions put to it or answered by it after joining, and its own answers). Rooms: every message | `xtell_messages` (before 126: `xtell_readings.turns`) | Grows |

a to d stay the same between replies and e only grows, so the providers
bill the repeated part at their cached rate. Rooms add the roster (masters,
temples, speaking order) after c.

## Storage (migration 126, run by the owner)

- `xtell_messages`: `seq` (one database-wide identity: inserts need no
  lock; gaps do not matter, order does), `reading_id`, `role`, `content`,
  `model_id`, `model_name`, `provider`, `qid`, `to[]`, `seats[]`,
  `input_tokens` (answers: what the master read), `cost`, `created_at`.
  Index on `(reading_id, seq)`. The visitor's message is stored once per
  `(reading_id, qid)` however many masters answer; an answer once per
  `(reading_id, qid, model_id)`.
- `xtell_memories`: `id`, `reading_id`, `model_id`, `model_name`,
  `through_seq` (the last message folded in), `text`, `input_tokens`,
  `output_tokens`, `cost`, `created_at`. Unique on
  `(reading_id, model_id, through_seq)`. Never updated; old rows stay for
  comparing models.
- `ai_models.context_window`: max input tokens per request, filled for all
  27 chat models on Oct 3 by the models session from the providers' own
  sources (docs/price-audit.md) and edited in `/admin/models` (its field);
  100k when empty. A provider's price jump for long requests lives in
  `model_pricing.long_context.threshold_input_tokens` (shape agreed with the
  models session; not filled yet).
- Existing conversations are copied from `turns` by the migration (safe to
  re-run). The route keeps writing `turns` too, until everything reads the
  new table.
- Visitors read only their own conversations' rows; only the server writes
  (service role, after reading the conversation with the visitor's own
  session). Deleting a conversation or the account deletes them.
- No Redis: the reads are a few indexed milliseconds next to a model answer
  of seconds, a cache could hand a master a stale summary, and Postgres keeps
  one source of truth.

## One reply

1. Read the conversation with the visitor's session (own row, not deleted).
2. Newest summary: `where reading_id and model_id order by through_seq desc
   limit 1` → d and `through_seq` (0 if none).
3. With a summary, the messages `where reading_id and seq > through_seq order
   by seq`, filtered to the master's thread → e. Without one, the thread
   from `turns`. A read error falls back to `turns`, then to the page's copy.
4. b from the account; c from the chart and the visitor's date.
5. e is trimmed oldest-first only if it would pass 90% of the window less
   a, b, c, d and room for the answer (logged; with summaries it should not).
6. The visitor's message is inserted before the stream (so it sorts before
   the answers); the answer after it, with `input_tokens` and cost.
7. After the answer reaches the visitor: if it read past the summary point,
   the master summarizes (below). The function then finishes.

The summary point is 70% of the model's own limit, or 90% of its price jump
if that comes first (owner, Oct 3: "70% of each"; the jump guard keeps a
master from rereading at a doubled price). With today's numbers: Claude
700k, Gemini 734k, Qwen 694k, GPT-6 645k, and GPT-6 ~245k once OpenAI's 272k
tier is in the pricing data. The raw budget never passes the jump either.

`input_tokens` is what the provider says the master read, cache hits
included, on every provider (`tokensRead`). Anthropic reports its cache reads
apart; since Oct 3 (7688e02) its provider folds them back in, so they are
not added a second time here.

## Summarizing

The same idea as compacting a conversation in Claude Code: the older part
is replaced by a summary, the recent messages stay word for word. Here each
master summarizes its own thread with its own model (owner, Oct 3: call it
summarization).

- Who: the master's own model, its own thinking setting, up to 4,000
  tokens out, 120 s at most.
- Input: the summary instructions, its previous summary, and the messages after
  it except the newest ones (40% of the limit, in proportion when the price
  jump sets the point), which stay word for word.
- Five fixed sections: the visitor's situation, every question asked, chart
  points used, readings and advice given, open threads. Concrete details
  (dates, names, options, numbers) as they were; the conversation's
  language; no new readings.
- Saved as a new row, `through_seq` = the last message it covers.
- If it fails, nothing changes: the old summary stays and it is tried again
  after the next answer.
- Billed like an answer: the master's list price, to the visitor, as
  "XTell summary (<model>)". The call is in `provider_calls` like any other;
  the summary row keeps its tokens and cost for comparing models.

## On screen

- Each seat card: the master's logo sits in a ring that fills with its
  last answer's `input_tokens` (`ContextMeter`; owner, Oct 3: the bar "looks
  so bad", "an icon to fill the circle"), red past its summary point. Full =
  the most XTell lets it read (`maxInputOf`: its limit, or its price jump,
  so GPT-6 fills toward 272k). No numbers on the seat; tapping it opens the
  dialog. From the answer as it finishes, or from the stored answers when a
  conversation reopens. A plain logo until the master has answered.
- Each master's settings card shows it again beside the price per question
  (owner, Oct 3: "current vs max"); before the first answer, the expected
  size of the question, marked ~.
- Pressing it opens 「{name}的記憶」: a large ring with the percentage and
  「上次回答讀了 250k / 272k tokens」 (no summary-point text: owner, Oct 3), and
  「對話摘要」, the newest summary with when it was written (no explanation
  paragraph: owner, Oct 3, "you don't need to explain").
- 「立即摘要」 there (owner, Oct 3: "a button to force summarize now"), with
  its price, about one answer: summarizes that master's whole conversation
  so far, now, whatever its size, like compacting a chat (`now` in
  lib/conversation-memory.ts). It first kept the latest question and answer
  out of the summary; the owner's first real press found that summary
  missing a question ("the summarization is bad"), so a press folds
  everything. Automatic summaries still keep the newest messages. Route `app/api/xtell/memory`:
  the visitor's own conversation, an empty wallet refused before any call,
  billed like an answer, 409 when nothing is new since the last summary.
  Off until the master has answered twice here, and while an answer is
  coming in. Mostly for comparing models' summaries: at real limits an
  automatic one starts at 245k–734k tokens.

## Rollout

0. Done Oct 3 (7a68da0), no migration: each master's whole thread from the
   saved conversation, up to 100k tokens, instead of the last 20 messages.
1. The code (this change) first. Before 126 every memory call quietly does
   nothing and the route behaves as step 0, plus b, c and the bar for
   answers given in the open page.
2. Done Oct 3: the owner ran `supabase/126_xtell_memory.sql` (675 messages
   copied from 195 conversations); checked live, 42501 for the publishable
   key on GET and POST on both tables. It ran BEFORE the code deployed, so
   www conversations continued until then are only in `turns`; that matters
   only if one of them later grows long enough for a summary.
3. Later: stop writing `turns`.
