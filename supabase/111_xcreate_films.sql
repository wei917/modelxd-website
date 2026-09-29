-- 111_xcreate_films.sql — XCreate's fifth type: a film (owner, Sep 29:
-- "5th top bar", "$7").
--
-- A film is one Claude Managed Agents session (Claude Opus 5.5 with a Linux
-- sandbox) that plans a short film, asks OUR server for images, clips and
-- voice (custom tools, generated through the normal provider code at list
-- price), draws the titles and transitions in code and edits the whole thing
-- with ffmpeg. The session runs on Anthropic's side for 10 to 30 minutes, and
-- no Vercel function lives that long, so the open page (every few seconds)
-- and a per-minute cron DRIVE it: each drive reads the session's new events,
-- answers the tool calls it finds and, once the session is done, settles.
--
--   xcreate_films       one row per film: the brief, the budget and its
--                       split, the session, the progress lines, the outcome
--                       and the bill.
--   xcreate_film_calls  one row per tool call the agent made. The UNIQUE
--                       tool_use_id is the claim: the page and the cron can
--                       both see a call, and only the insert that wins runs it.
--
-- Money: the whole budget is RESERVED from the wallet at start (a debit). The
-- film is charged what it used at list price (the session's list cost plus
-- each generation's list price), never more than the budget, and the rest is
-- refunded. A film that produced nothing is refunded in full.
--
-- Both tables are read and written only by the API routes with the service
-- key: RLS on and NO policies (Common Pitfall #16). The finished film is also
-- an ordinary xcreates row (mode 'video'), which is how it reaches the Library.
--
-- Additive only. Run by hand in the Supabase SQL editor (dev + prod share the
-- project).

create table if not exists public.xcreate_films (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  xcreate_id       uuid references public.xcreates(id) on delete set null,
  status           text not null default 'starting'
                   check (status in ('starting', 'running', 'finishing', 'done', 'failed')),
  brief            text not null check (char_length(brief) between 1 and 4000),
  aspect           text not null check (aspect in ('9:16', '16:9', '1:1')),
  seconds          integer not null check (seconds between 5 and 120),
  budget_cents     integer not null check (budget_cents > 0),
  claude_cap_cents integer not null check (claude_cap_cents > 0),
  gen_cap_cents    integer not null check (gen_cap_cents > 0),
  reserved_cents   integer not null default 0,
  session_id       text unique,
  agent_version    integer,
  last_event_at    timestamptz,                 -- processed_at of the newest event read
  progress         jsonb not null default '[]', -- [{at, kind, text}], oldest first, capped
  lock_until       timestamptz,                 -- a driver's short lease on read-and-claim
  interrupted_at   timestamptz,                 -- when the wall clock stopped the session
  nudges           integer not null default 0,  -- "nobody will answer, finish" messages sent
  claude_cents     integer,                     -- the session's list cost, updated as it runs
  gen_cents        integer,                     -- the generations' list price at the end
  charged_cents    integer,                     -- what the wallet paid in the end
  output_path      text,                        -- film.mp4 in xcreate-ai-videos
  duration_seconds numeric,
  notes            text,                        -- the agent's notes.md
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists xcreate_films_user_idx
  on public.xcreate_films (user_id, created_at desc);
create index if not exists xcreate_films_active_idx
  on public.xcreate_films (updated_at) where status in ('starting', 'running', 'finishing');

create table if not exists public.xcreate_film_calls (
  id             uuid primary key default gen_random_uuid(),
  film_id        uuid not null references public.xcreate_films(id) on delete cascade,
  tool_use_id    text not null unique,
  tool           text not null,
  name           text,                          -- the asset name the agent chose
  input          jsonb not null default '{}',
  status         text not null default 'running'
                 check (status in ('running', 'done', 'failed', 'refused')),
  estimate_cents integer not null default 0,
  cost_usd       numeric(10, 4),                -- list price of what ran
  result         text,                          -- the text sent back to the agent
  sent_at        timestamptz,                   -- when that text reached the session
  bucket         text,
  path           text,
  claimed_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists xcreate_film_calls_film_idx
  on public.xcreate_film_calls (film_id, claimed_at);

alter table public.xcreate_films      enable row level security;
alter table public.xcreate_film_calls enable row level security;
-- No policies on purpose, and no table grants either: the routes use the
-- service key, and the publishable key has no business here.
revoke all on public.xcreate_films      from anon, authenticated;
revoke all on public.xcreate_film_calls from anon, authenticated;

-- Verify (expect false, false):
-- select has_table_privilege('anon', 'public.xcreate_films', 'select'),
--        has_table_privilege('authenticated', 'public.xcreate_film_calls', 'select');
