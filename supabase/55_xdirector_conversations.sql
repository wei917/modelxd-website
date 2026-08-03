-- 55: XDirector conversations (CC, July 28 2026)
--
-- Agent Mode chats lived in React state only, so a reload lost the whole
-- session and there was no link to come back to. Without this table
-- /api/xdirector/conversation answers 503 and every save is silently
-- dropped — while the client still writes ?c=<id> into the address bar,
-- which makes it look like persistence is working when it is not.
--
--   protocol  the verbatim Anthropic message array the agent loop needs to
--             resume the conversation.
--   bubbles   the visible transcript, so the UI can repaint without
--             replaying the model.
--   skill     the Agent Skill active for this chat, so a resumed chat
--             carries on under the same instructions.

create table if not exists xdirector_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  protocol   jsonb not null default '[]'::jsonb,
  bubbles    jsonb not null default '[]'::jsonb,
  skill      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Defensive, in case an earlier copy of this file was already applied.
alter table xdirector_conversations add column if not exists skill text;

create index if not exists idx_xdirector_convos_user
  on xdirector_conversations (user_id, updated_at desc)
  where deleted_at is null;

alter table xdirector_conversations enable row level security;

drop policy if exists "xdirector: owner read"   on xdirector_conversations;
drop policy if exists "xdirector: owner insert" on xdirector_conversations;
drop policy if exists "xdirector: owner update" on xdirector_conversations;

create policy "xdirector: owner read"
  on xdirector_conversations for select using (auth.uid() = user_id);
create policy "xdirector: owner insert"
  on xdirector_conversations for insert with check (auth.uid() = user_id);
create policy "xdirector: owner update"
  on xdirector_conversations for update using (auth.uid() = user_id);
