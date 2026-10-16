-- supabase/137_xsports_cheer_jobs.sql — what admins ask 晴晴 to make, which
-- model made it, and fans' 👍 / 👎 on her pictures and clips (owner, Oct 16:
-- "we should always have a list and randomly use one to generate image or
-- video. and user can thumb up or down or report? so we know which models
-- are better").
--
--   xsports_cheer_jobs    one row per admin ask (lib/xsports-cheer-fresh):
--                         what was asked, every model tried, the one that
--                         made it (and a clip's first-frame model), how long
--                         it took, what it cost, the file, and the message it
--                         was posted as
--   xsports_media_votes   one 👍 (1) or 👎 (-1) per person per message (her
--                         pictures and clips); reports stay in
--                         xsports_room_reports (131, 133)
--
-- Both are read and written by ModelXD only (service role), like the
-- reports: fans never see which model made a picture, so a vote is on the
-- picture, not the name. The model lists are not here: they are a JSON file
-- in her folder of the public x-characters bucket (cheer/models.json),
-- edited without a deploy. Additive; safe to re-run. Run by hand. Dev and
-- prod share this database.

begin;

create table if not exists public.xsports_cheer_jobs (
  id                 text primary key,
  created_at         timestamptz not null default now(),
  admin_id           uuid references auth.users(id) on delete set null,
  league             text not null,
  game_id            text not null,
  lang               text not null,
  action             text not null check (action in ('selfie', 'dance', 'cheer', 'shout')),
  name               text check (name is null or length(name) <= 60),
  kind               text not null check (kind in ('image', 'video')),
  seconds            smallint check (seconds is null or seconds between 1 and 30),
  status             text not null default 'working' check (status in ('working', 'done', 'failed')),
  model              text,
  frame_model        text,
  tried              text[] not null default '{}',
  url                text check (url is null or url ~ '^https://'),
  ms                 integer,
  usd                numeric(10, 4),
  error              text check (error is null or length(error) <= 500),
  finished_at        timestamptz,
  posted_message_id  bigint references public.xsports_room_messages(id) on delete set null
);
create index if not exists xsports_cheer_jobs_created on public.xsports_cheer_jobs (created_at desc);
create index if not exists xsports_cheer_jobs_posted on public.xsports_cheer_jobs (posted_message_id) where posted_message_id is not null;

create table if not exists public.xsports_media_votes (
  message_id  bigint not null references public.xsports_room_messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  vote        smallint not null check (vote in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.xsports_cheer_jobs enable row level security;
alter table public.xsports_media_votes enable row level security;
revoke all on public.xsports_cheer_jobs from public, anon, authenticated;
revoke all on public.xsports_media_votes from public, anon, authenticated;
grant all on public.xsports_cheer_jobs to service_role;
grant all on public.xsports_media_votes to service_role;

commit;

-- Check after running (publishable key; each must be refused, 42501):
--   GET  /rest/v1/xsports_cheer_jobs?select=id&limit=1
--   GET  /rest/v1/xsports_media_votes?select=vote&limit=1
--   POST /rest/v1/xsports_media_votes
-- and with the service key: a job with action 'sing' is refused (23514), and
-- a vote of 2 is refused (23514).
