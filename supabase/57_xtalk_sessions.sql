-- 57: server-held werewolf sessions (CC, Aug 1 2026)
--
-- Until now the browser was the moderator: it dealt the roles, resolved the
-- night and decided who could see what. That is fine while the human is an
-- audience — they are meant to see everything — but it makes human PLAY
-- impossible, because the roles are sitting in React state and one devtools
-- panel tells you who the wolf is.
--
-- So the state moves here. The client becomes a screen and an input box; it
-- asks the server to advance one step at a time and receives only what its
-- own seat is entitled to see. `human_seat` null means the caller is
-- watching and gets the god view, which is how spectating stays good.
--
-- One step per request, deliberately: a serverless function cannot hold a
-- whole game open, and a game with a person in it has to be able to wait
-- indefinitely for them to type.

create table if not exists xtalk_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'over')),

  -- null = the caller is watching and may see every private turn.
  -- an integer = the caller occupies that seat and sees only their own.
  human_seat  int,

  -- [{seat, modelId, name, provider, role, alive, isHuman}]
  players     jsonb not null,

  phase       text not null default 'night_wolf',
  day         int  not null default 1,
  -- Position within the current phase's actor order.
  cursor      int  not null default 0,
  -- Whose turn it is this phase, as an array of seat numbers. Stored rather
  -- than recomputed because the day order rotates and must stay stable if a
  -- request is retried.
  turn_order  jsonb not null default '[]'::jsonb,

  -- [{seat, speaker, text, reasoning, privateTo, kind, cost, system}]
  -- privateTo is an array of SEAT NUMBERS. Filtering happens on the server,
  -- so a private turn never crosses the wire to a client that may not read it.
  transcript  jsonb not null default '[]'::jsonb,

  -- In-flight phase data: the night's kill target, votes cast so far.
  pending     jsonb not null default '{}'::jsonb,

  winner      text check (winner in ('wolves', 'village')),
  cost_usd    numeric(10,6) not null default 0,
  game_id     uuid references xtalk_games(id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_xtalk_sessions_user
  on xtalk_sessions (user_id, updated_at desc);

alter table xtalk_sessions enable row level security;

-- Owner-only, and note what this policy does NOT do: it stops another user
-- reading the row, but the row still holds every role. The redaction that
-- makes play fair happens in the API, not here.
drop policy if exists "xtalk sessions: owner all" on xtalk_sessions;
create policy "xtalk sessions: owner all"
  on xtalk_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
