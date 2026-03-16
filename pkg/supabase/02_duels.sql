-- ModelXD: duels + duel_votes tables

create table if not exists duels (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  mode          text not null check (mode in ('text', 'image', 'video')),
  prompt        text not null,
  slots         jsonb not null default '[]',
  vote1          text,
  vote2          text,
  vote1_model_id text,
  vote2_model_id text,
  attachment_id  uuid,
  created_at    timestamptz not null default now()
);

create index if not exists duels_user_id_idx    on duels(user_id);
create index if not exists duels_mode_idx       on duels(mode);
create index if not exists duels_created_at_idx on duels(created_at desc);

alter table duels enable row level security;
create policy "duels: public read"  on duels for select using (true);
create policy "duels: owner insert" on duels for insert with check (auth.uid() = user_id);
create policy "duels: owner update" on duels for update using (auth.uid() = user_id);
