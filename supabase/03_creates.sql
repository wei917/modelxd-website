-- ModelXD: creates table (private studio sessions)

create table if not exists creates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  mode            text not null check (mode in ('text', 'image', 'video')),
  prompt          text not null,
  chosen_model_id text,
  slots           jsonb not null default '[]',
  attachment_id   uuid,
  created_at      timestamptz not null default now()
);

create index if not exists creates_user_id_idx    on creates(user_id);
create index if not exists creates_created_at_idx on creates(created_at desc);

alter table creates enable row level security;
create policy "creates: owner read"   on creates for select using (auth.uid() = user_id);
create policy "creates: owner insert" on creates for insert with check (auth.uid() = user_id);
create policy "creates: owner delete" on creates for delete using (auth.uid() = user_id);
