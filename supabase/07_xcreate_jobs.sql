-- ModelXD: xcreate_jobs table
-- Persists in-progress multi-model generations so they survive navigation.
-- The client POSTs /api/xcreate, the server inserts an xcreate_jobs row, runs the
-- generation to completion (Node.js serverless keeps running after client
-- disconnect), and writes progress into xcreate_job_slots. The client polls.
--
-- Renamed from create_jobs/create_job_slots in migration 13_rename_to_xcreate.sql.
-- Fresh installs go straight to xcreate_jobs/xcreate_job_slots.

create table if not exists xcreate_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  mode            text not null check (mode in ('text', 'image', 'video')),
  prompt          text not null,
  attachment_id   uuid,
  status          text not null default 'running' check (status in ('running', 'completed', 'failed')),
  xcreate_id      uuid,  -- FK to xcreates table once the finished run is saved
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists xcreate_jobs_user_status_idx on xcreate_jobs(user_id, status);
create index if not exists xcreate_jobs_created_at_idx  on xcreate_jobs(created_at desc);

alter table xcreate_jobs enable row level security;
create policy "xcreate_jobs: owner read"   on xcreate_jobs for select using (auth.uid() = user_id);
create policy "xcreate_jobs: owner insert" on xcreate_jobs for insert with check (auth.uid() = user_id);
create policy "xcreate_jobs: owner update" on xcreate_jobs for update using (auth.uid() = user_id);
create policy "xcreate_jobs: owner delete" on xcreate_jobs for delete using (auth.uid() = user_id);

-- One row per slot. Each slot updates independently so parallel generations
-- don't clobber each other's progress.
create table if not exists xcreate_job_slots (
  job_id          uuid not null references xcreate_jobs(id) on delete cascade,
  slot_index      int  not null,
  model_id        uuid not null,
  provider        text not null,
  model_name      text not null,
  name            text not null,
  options         jsonb not null default '{}'::jsonb,
  text            text not null default '',
  is_image        boolean not null default false,
  is_video        boolean not null default false,
  streaming       boolean not null default true,
  done            boolean not null default false,
  cost            numeric not null default 0,
  response_time   int     not null default 0,
  progress        int     not null default 0,  -- 0..100 for video polling
  error           text,
  updated_at      timestamptz not null default now(),
  primary key (job_id, slot_index)
);

create index if not exists xcreate_job_slots_job_idx on xcreate_job_slots(job_id);

alter table xcreate_job_slots enable row level security;
create policy "xcreate_job_slots: owner read" on xcreate_job_slots for select
  using (exists (select 1 from xcreate_jobs j where j.id = xcreate_job_slots.job_id and j.user_id = auth.uid()));
create policy "xcreate_job_slots: owner insert" on xcreate_job_slots for insert
  with check (exists (select 1 from xcreate_jobs j where j.id = xcreate_job_slots.job_id and j.user_id = auth.uid()));
create policy "xcreate_job_slots: owner update" on xcreate_job_slots for update
  using (exists (select 1 from xcreate_jobs j where j.id = xcreate_job_slots.job_id and j.user_id = auth.uid()));

-- Touch updated_at on any update
create or replace function touch_xcreate_jobs_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists xcreate_jobs_touch on xcreate_jobs;
create trigger xcreate_jobs_touch before update on xcreate_jobs
  for each row execute function touch_xcreate_jobs_updated_at();

drop trigger if exists xcreate_job_slots_touch on xcreate_job_slots;
create trigger xcreate_job_slots_touch before update on xcreate_job_slots
  for each row execute function touch_xcreate_jobs_updated_at();
