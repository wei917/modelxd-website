-- 148: XGame table chat (Oct 21, 2026). NOT RUN YET: the owner runs it by
-- hand in the Supabase SQL editor.
--
-- Owner: "similar to XSports chat room but this is private and human can
-- invite AI to be commenter"; "inviter pays and they can give hints". The
-- chat of a table where people play (lib/xgame-chat.ts): the players' own
-- messages and the AI commentators' remarks. Private to the table: the
-- server reads and writes it with the service key after checking the seat
-- (lib/xgame-duo.ts seatOf); nobody else, not even a player's own browser,
-- reads it directly, and nothing of it travels over Realtime (the table's
-- channel only says "something changed"). Additive.

create table if not exists public.xgame_messages (
  id            bigint generated always as identity primary key,
  table_id      uuid not null references public.xtalk_sessions(id) on delete cascade,
  kind          text not null check (kind in ('human', 'ai')),
  -- The person who wrote it (human), or who invited the commentator and pays
  -- for it (ai).
  user_id       uuid references auth.users(id) on delete set null,
  -- Copied at the time of writing, as X體育's rooms do: names change, a
  -- message keeps the name it was written under.
  author_name   text not null check (char_length(author_name) between 1 and 80),
  author_handle text,
  author_avatar text,
  -- A commentator's model (ai only).
  model_id      uuid,
  model_name    text,
  content       text not null check (char_length(content) between 1 and 1000),
  cost_usd      numeric(10, 6) not null default 0 check (cost_usd >= 0),
  deleted       boolean not null default false,
  created_at    timestamptz not null default now(),
  check ((kind = 'ai') = (model_id is not null))
);
-- A table's chat in order, and "messages after this one".
create index if not exists idx_xgame_messages_table on public.xgame_messages (table_id, id);
-- The 2 s rate limit: a person's newest message.
create index if not exists idx_xgame_messages_user on public.xgame_messages (user_id, created_at desc) where kind = 'human';

alter table public.xgame_messages enable row level security;
-- No policies: nobody but the server (service role) reads or writes it.
revoke all on public.xgame_messages from public, anon, authenticated;
grant all on public.xgame_messages to service_role;

-- The table's AI commentators (lib/xgame-chat.ts Commentator[]): their own
-- column, not part of `pending`, because a move's save rewrites `pending`
-- from what it read at the start of the request, so an invite landing
-- mid-move would vanish (and an invite rewriting `pending` could drop a
-- move). Written by the server only (147 left the browser update on title
-- alone).
alter table public.xtalk_sessions add column if not exists chat_ais jsonb not null default '[]'::jsonb;

-- Checks after running:
--   publishable key: select / insert on xgame_messages -> 42501
--   service key: an 'ai' row without model_id -> 23514; content of 1001
--   characters -> 23514; a negative cost -> 23514; a valid row for a made-up
--   table -> 23503 (nothing stored); xtalk_sessions.chat_ais exists, '[]' on
--   every row; the publishable key cannot update it (42501)
