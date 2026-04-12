-- ModelXD: xcreates table (private studio sessions)
--
-- Stores one row per finished XCreate run (prompt + chosen model + slot
-- results). The user's live studio state while a job is running lives in
-- xcreate_jobs / xcreate_job_slots — this table is the append-only
-- history that the profile page reads.
--
-- Renamed from `creates` → `xcreates` in migration 13_rename_to_xcreate.sql.
-- Fresh installs go straight to `xcreates` — the rename migration is only
-- needed for databases seeded before the rename.

create table if not exists xcreates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  mode            text not null check (mode in ('text', 'image', 'video')),
  prompt          text not null,
  chosen_model_id text,
  slots           jsonb not null default '[]',
  attachment_id   uuid,
  created_at      timestamptz not null default now()
);

create index if not exists xcreates_user_id_idx    on xcreates(user_id);
create index if not exists xcreates_created_at_idx on xcreates(created_at desc);

alter table xcreates enable row level security;
create policy "xcreates: owner read"   on xcreates for select using (auth.uid() = user_id);
create policy "xcreates: owner insert" on xcreates for insert with check (auth.uid() = user_id);
create policy "xcreates: owner delete" on xcreates for delete using (auth.uid() = user_id);
