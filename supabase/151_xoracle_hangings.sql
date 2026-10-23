-- 151: 觀音廟's wall outside the temple (Oct 22, 2026). NOT RUN YET: the
-- owner runs it by hand in the Supabase SQL editor.
--
-- Owner: 「一般廟裡如果抽到不好的簽 會讓用戶掛在廟外。有些廟則是可以讓用戶付錢許願，
-- 然後也是掛在廟外。」 Design: docs/GUANYIN-HANGING-PLAN.md.
--
--   xoracle_hangings          one row per stick tied outside (free, 30 days on
--                           the wall) or wish plaque hung (paid, one year).
--                           A stick carries only its number, edition and grade
--                           as printed; a wish carries its text (1-60
--                           characters), a stamp and whether it is sealed
--                           (only the back shows). Both need an account.
--   xoracle_hanging_reports   one report per person per plaque, from a fixed
--                           reason list.
--   xoracle_report_hanging()  stores a report and hides the plaque from others
--                           at 3, under the plaque's row lock.
--
-- Named xoracle_ after the app (XTell became XOracle, 65cf9e84); the tables
-- from before the rename keep xtell_ (xtell_readings, below).
--
-- Server only, like 147/148: the wall is public, but the browser reads it
-- through /api/xoracle/wall, which sends no user id (pitfall 16). RLS on with
-- no policies, every right revoked from public, anon and authenticated BY
-- NAME, the function included (pitfall 15). Additive; safe to re-run.

begin;

create table if not exists public.xoracle_hangings (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('stick', 'wish')),
  temple        text not null default 'guanyin' check (temple in ('guanyin')),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- The visit the stick was drawn in (the route requires it for a stick and
  -- copies the number, edition and grade from it). A deleted account takes
  -- the visit with it, so this goes null rather than blocking the delete.
  reading_id    uuid references public.xtell_readings(id) on delete set null,
  edition       text check (edition in ('yibai', 'gansan')),
  stick_no      smallint check (stick_no between 1 and 100),
  -- As the slip prints it (上上, 凶, …); '' for the 26 一百籤 slips that print none.
  luck          text check (char_length(luck) <= 8),
  wish_text     text check (char_length(wish_text) between 1 and 60),
  wish_for      text check (wish_for in ('peace', 'health', 'study', 'love', 'work', 'wealth', 'other')),
  -- Sealed: others see only the back (the stamp and the date).
  sealed        boolean not null default false,
  price_cents   integer check (price_cents >= 0),
  fulfilled_at  timestamptz,                 -- 還願
  lang          text not null check (lang in ('en', 'zh-Hant', 'zh-Hans', 'ja', 'ko')),
  created_at    timestamptz not null default now(),
  -- When it leaves the wall: a stick 30 days on, a wish a year (set by the route).
  down_at       timestamptz not null,
  taken_down_at timestamptz,                 -- the visitor took it down
  hidden_at     timestamptz,
  hidden_by     text check (hidden_by in ('reports', 'admin')),
  report_count  integer not null default 0 check (report_count >= 0),
  constraint xoracle_hangings_shape check (
    (kind = 'stick' and edition is not null and stick_no is not null and luck is not null
       and wish_text is null and wish_for is null and price_cents is null
       and not sealed and fulfilled_at is null)
    or
    (kind = 'wish' and wish_text is not null and price_cents is not null
       and edition is null and stick_no is null and luck is null)
  ),
  constraint xoracle_hangings_hidden check ((hidden_at is null) = (hidden_by is null)),
  constraint xoracle_hangings_down check (down_at > created_at)
);

-- One tie per visit.
create unique index if not exists xoracle_hangings_one_tie
  on public.xoracle_hangings (reading_id) where kind = 'stick' and reading_id is not null;
-- The wall, newest first (the query also asks down_at > now()).
create index if not exists xoracle_hangings_wall
  on public.xoracle_hangings (temple, created_at desc) where taken_down_at is null and hidden_at is null;
-- A visitor's own sticks and wishes, and the daily limits.
create index if not exists xoracle_hangings_user
  on public.xoracle_hangings (user_id, created_at desc);

create table if not exists public.xoracle_hanging_reports (
  hanging_id  uuid not null references public.xoracle_hangings(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('personal_info', 'harassment', 'hate', 'sexual', 'spam', 'other')),
  details     text check (details is null or char_length(details) <= 300),
  created_at  timestamptz not null default now(),
  primary key (hanging_id, user_id)
);

alter table public.xoracle_hangings enable row level security;
alter table public.xoracle_hanging_reports enable row level security;
-- No policies: nobody but the server (service role) reads or writes them.
revoke all on public.xoracle_hangings from public, anon, authenticated;
revoke all on public.xoracle_hanging_reports from public, anon, authenticated;
grant all on public.xoracle_hangings to service_role;
grant all on public.xoracle_hanging_reports to service_role;

-- A report on a wish: one per person (a second one changes nothing), never on
-- one's own, and the plaque is hidden from others once 3 people reported it.
-- Returns the plaque's report count and whether it is hidden now.
create or replace function public.xoracle_report_hanging(p_id uuid, p_user uuid, p_reason text, p_details text default null)
returns table (reports integer, is_hidden boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  select h.user_id into v_owner
    from public.xoracle_hangings h
   where h.id = p_id and h.kind = 'wish'
     for update;
  if not found then
    raise exception 'hanging_not_found' using errcode = 'P0002';
  end if;
  if v_owner = p_user then
    raise exception 'own_hanging' using errcode = '22023';
  end if;

  insert into public.xoracle_hanging_reports (hanging_id, user_id, reason, details)
  values (p_id, p_user, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  on conflict (hanging_id, user_id) do nothing;

  select count(*)::integer into v_count
    from public.xoracle_hanging_reports r
   where r.hanging_id = p_id;

  return query
  update public.xoracle_hangings h
     set report_count = v_count,
         hidden_at    = case when h.hidden_at is null and v_count >= 3 then now() else h.hidden_at end,
         hidden_by    = case when h.hidden_at is null and v_count >= 3 then 'reports' else h.hidden_by end
   where h.id = p_id
  returning h.report_count, h.hidden_at is not null;
end
$$;

revoke all on function public.xoracle_report_hanging(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.xoracle_report_hanging(uuid, uuid, text, text) to service_role;

commit;

-- Checks after running (nothing is stored by any of them):
--   publishable key: select and insert on xoracle_hangings and on
--     xoracle_hanging_reports -> 42501; rpc xoracle_report_hanging -> 42501
--   service key: a wish of 61 characters -> 23514; a stick without its number
--     -> 23514; temple 'guandi' -> 23514; a valid wish for a made-up account
--     -> 23503; a report on a made-up plaque -> P0002 (hanging_not_found)
--   has_function_privilege('anon' / 'authenticated',
--     'public.xoracle_report_hanging(uuid, uuid, text, text)', 'execute') -> false
