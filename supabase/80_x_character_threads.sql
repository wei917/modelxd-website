-- 80_x_character_threads.sql — multiple chat threads per character
-- (owner, Aug 12: "I cannot create multiple chats with this agent").
--
-- DESIGN OF RECORD
--   A thread is an EPISODE; memory stays with the CHARACTER. Threads change
--   which messages ride in the prompt's verbatim window — the critical file
--   and the memoir chapters are per-character and cross threads untouched,
--   so she remembers you in a brand-new chat, without the new chat drowning
--   in the old one's transcript. Consolidation also stays per-character:
--   it walks x_character_messages by id regardless of thread, so calls and
--   threads all feed one memory.
--
--   Rollout: run this, then the code change teaches /api/xcharacter/chat a
--   threadId param (window + insert scoped to it), history returns the
--   thread list, and the room grows a thread rail + New chat button. Until
--   the code lands, nothing reads these columns — additive and safe.
--
-- Access model: same as x_character_messages — server-only via service
-- role; no RLS policies needed here because no browser client touches it.

create table if not exists x_character_threads (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references x_characters(id) on delete cascade,
  title        text not null default 'New chat',
  created_at   timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists x_character_threads_char
  on x_character_threads (character_id, last_at desc);

alter table x_character_messages
  add column if not exists thread_id uuid references x_character_threads(id);
create index if not exists x_character_messages_thread
  on x_character_messages (thread_id, id);

-- Backfill: every existing character gets one thread holding its whole
-- history, so nothing ever renders as "no thread". Idempotent: skips
-- characters that already have one.
insert into x_character_threads (character_id, title, created_at, last_at)
select c.id, 'First chat', c.created_at, coalesce(c.last_chat_at, c.created_at)
from x_characters c
where not exists (
  select 1 from x_character_threads t where t.character_id = c.id
);

update x_character_messages m
set thread_id = t.id
from x_character_threads t
where m.thread_id is null
  and t.character_id = m.character_id;
