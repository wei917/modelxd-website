-- 75_x_characters.sql — AI Characters (owner design, Aug 7)
-- A character is a PLATFORM PRIMITIVE (persona + appearance + model +
-- config + imagery), created in XTalk but designed to be seatable anywhere
-- a model picker appears, and later to author content in XSocial. Tables
-- are deliberately surface-neutral (x_, not xtalk_).
--
-- Memory design of record: two model-managed stores —
--   critical: ONE doc (≤~10K tokens), exact facts, the model rewrites it
--             whole under budget at each consolidation;
--   chapter:  append-only conceptual memoir, one chapter per consolidation;
--             unbounded at rest, only the tail is carried per turn.
-- embedding is reserved for phase-2 retrieval (pgvector) — null until then.

create extension if not exists vector;

create table if not exists x_characters (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  name            text not null,
  avatar_path     text,
  persona         text not null default '',   -- user-authored, UNTRUSTED
  appearance      text not null default '',   -- for image consistency later
  model_id        uuid not null references ai_models(id),
  thinking        text,
  visibility      text not null default 'private'
                  check (visibility in ('private','public')),
  msg_count       integer not null default 0,
  consolidated_to bigint not null default 0,  -- last message id folded into memory
  last_chat_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists x_characters_user on x_characters (user_id, created_at desc);

create table if not exists x_character_messages (
  id           bigint generated always as identity primary key,
  character_id uuid not null references x_characters(id) on delete cascade,
  role         text not null check (role in ('user','character')),
  text         text not null,
  cost_usd     numeric not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists x_character_messages_char on x_character_messages (character_id, id desc);

create table if not exists x_character_memory (
  character_id uuid not null references x_characters(id) on delete cascade,
  kind         text not null check (kind in ('critical','chapter')),
  seq          integer not null default 0,   -- 0 for critical; 1..n chapters
  content      text not null,
  tokens       integer,
  embedding    vector(1536),                 -- phase 2; null until backfilled
  updated_at   timestamptz not null default now(),
  primary key (character_id, kind, seq)
);

-- Owner-read RLS (writes go through the API with the service key).
alter table x_characters         enable row level security;
alter table x_character_messages enable row level security;
alter table x_character_memory   enable row level security;

create policy "own characters" on x_characters
  for select to authenticated using (user_id = auth.uid());
create policy "own character messages" on x_character_messages
  for select to authenticated using (
    exists (select 1 from x_characters c
            where c.id = character_id and c.user_id = auth.uid()));
create policy "own character memory" on x_character_memory
  for select to authenticated using (
    exists (select 1 from x_characters c
            where c.id = character_id and c.user_id = auth.uid()));

-- Avatars/photos: public bucket (URLs are unguessable uuid paths; XSocial
-- will need public imagery anyway). Users may upload only into their own
-- folder; public read comes with the bucket.
insert into storage.buckets (id, name, public)
  values ('x-characters', 'x-characters', true)
  on conflict (id) do nothing;

create policy "xchar upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'x-characters'
              and (storage.foldername(name))[1] = auth.uid()::text);
