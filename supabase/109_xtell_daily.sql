-- supabase/109_xtell_daily.sql — XTell's free daily fortune.
--
-- TODO item 2 (owner, Sep 27): a free daily reading from Western astrology
-- and the BaZi day, for visitors who choose to save their birth details.
--
--   xtell_profiles     one saved birth per user, stored only after explicit
--                      consent; viewable, editable and deletable by its owner
--                      (through /api/xtell/profile)
--   xtell_daily        the day's reading per method and language, keyed so
--                      that a reopen shows the same text and an edit or a zone
--                      change makes a new one; kept 30 days, and deleted with
--                      the profile
--   xtell_daily_usage  generations per user per UTC day: the cost cap, which
--                      a profile edit, deletion or zone change cannot reset
--
-- A paid follow-up question about a day's reading is an ordinary visit row
-- in xtell_readings (temple 'daily'), created by xtell_daily_followup under
-- the profile lock; deleting the profile deletes those rows too (the UI says
-- so before it happens) and no other temple's history.
--
-- Access: server only. RLS on, no policies, and every table and function
-- revoked from public, anon and authenticated BY NAME (pitfall 15: Supabase's
-- default privileges grant new objects to both). The routes verify the
-- session and pass that user's id into every query and function call.
--
-- Revisions: a profile's `revision` comes from one global sequence and is
-- taken again whenever the birth, place or repeated-hour choice changes, so it
-- is never reused, not even after a delete and a new save (Codex review: an
-- integer that restarted at 1 let a stale request match a re-created
-- profile). Every daily key and every claim and finish carries it.
--
-- Concurrency: the profile row is the lock. A claim and a finish each lock it,
-- so a generation cannot start against a profile that is being edited or
-- deleted, and its result is written only if its lease token still holds and
-- the profile still exists at the same version (compare-and-set): late work
-- can never overwrite a newer profile's day or bring deleted data back.
--
-- Deployment order: (1) run this file in the SQL editor; (2) run the checks
-- at the bottom (all false); (3) deploy the code. Before (1) the routes answer
-- 503 daily_unavailable and the street hides the daily section.
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

create table if not exists public.xtell_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  birth        jsonb not null,                   -- {y,m,d,h,mi,hourUnknown?}, Gregorian date, local clock time
  birth_place  text not null,                    -- lib/xtell-places key; the birth zone is the place's
  fold         smallint check (fold in (0, 1)),  -- a clock time that happened twice: 0 the first, 1 the second
  display_tz   text not null,                    -- IANA zone "today" is read in
  revision     bigint not null,
  consent_at   timestamptz not null,
  consent_text text not null,                    -- which consent wording was agreed to
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.xtell_daily (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.xtell_profiles(user_id) on delete cascade,
  local_date      date not null,
  display_tz      text not null,
  profile_revision bigint not null,
  method          text not null check (method in ('western', 'bazi')),
  rules_version   text not null,
  lang            text not null check (lang in ('en', 'zh-Hant', 'zh-Hans', 'ja', 'ko')),
  status          text not null check (status in ('pending', 'ready', 'failed')),
  lease_token     uuid,
  leased_at       timestamptz,
  basis           jsonb,
  reading         jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint xtell_daily_key unique (user_id, local_date, display_tz, profile_revision, method, rules_version, lang)
);
create index if not exists xtell_daily_user_date on public.xtell_daily (user_id, local_date);

create table if not exists public.xtell_daily_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,                     -- UTC
  generations integer not null default 0,
  primary key (user_id, day)
);

create sequence if not exists public.xtell_profile_revision;
revoke all on sequence public.xtell_profile_revision from public, anon, authenticated;

alter table public.xtell_profiles    enable row level security;
alter table public.xtell_daily       enable row level security;
alter table public.xtell_daily_usage enable row level security;
revoke all on table public.xtell_profiles, public.xtell_daily, public.xtell_daily_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.xtell_profiles, public.xtell_daily, public.xtell_daily_usage to service_role;

-- Save (create or edit). A profile is CREATED only with the visitor's consent
-- in this very call (p_consent), decided under the row lock: a route that saw
-- a profile a moment ago cannot re-create a deleted one without asking again
-- (Codex review). Null means consent is needed. An edit of the birth, place
-- or repeated-hour choice takes a new revision; a display-zone change does
-- not need one (the zone is part of every daily key itself).
create or replace function public.xtell_profile_save(
  p_user uuid, p_birth jsonb, p_place text, p_fold smallint, p_tz text, p_consent boolean, p_consent_text text
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.xtell_profiles%rowtype;
  v_rev bigint;
begin
  for attempt in 1..2 loop
    select * into v_row from public.xtell_profiles p where p.user_id = p_user for update;
    if found then
      update public.xtell_profiles p
         set birth = p_birth, birth_place = p_place, fold = p_fold, display_tz = p_tz,
             revision = case when (v_row.birth, v_row.birth_place, v_row.fold) is distinct from (p_birth, p_place, p_fold)
                             then nextval('public.xtell_profile_revision') else v_row.revision end,
             updated_at = now()
       where p.user_id = p_user
      returning p.revision into v_rev;
      return v_rev;
    end if;
    if p_consent is not true then return null; end if;
    insert into public.xtell_profiles (user_id, birth, birth_place, fold, display_tz, revision, consent_at, consent_text)
    values (p_user, p_birth, p_place, p_fold, p_tz, nextval('public.xtell_profile_revision'), now(), p_consent_text)
    on conflict (user_id) do nothing
    returning revision into v_rev;
    if v_rev is not null then return v_rev; end if;
    -- A concurrent first save won the insert: edit that one instead.
  end loop;
  return null;
end $$;

-- Delete: the profile, its daily readings (cascade), and the paid follow-up
-- conversations about them. The usage counter stays: it is the cap. The
-- profile lock comes first, the same lock xtell_daily_followup takes, so a
-- follow-up racing this delete either finished before it (and is deleted
-- here) or finds no profile and creates nothing.
create or replace function public.xtell_profile_delete(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.xtell_profiles where user_id = p_user for update;
  delete from public.xtell_readings where user_id = p_user and temple = 'daily';
  delete from public.xtell_profiles where user_id = p_user;
end $$;

-- Open a paid follow-up about one of the user's ready daily readings: reuse a
-- follow-up visit nothing has been asked in yet, or create one holding a copy
-- of that day's basis and free reading. Null when the profile or the reading
-- is gone (then nothing is created).
create or replace function public.xtell_daily_followup(p_user uuid, p_daily uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_daily public.xtell_daily%rowtype;
  v_id    uuid;
begin
  perform 1 from public.xtell_profiles p where p.user_id = p_user for update;
  if not found then return null; end if;
  select * into v_daily from public.xtell_daily d where d.id = p_daily and d.user_id = p_user and d.status = 'ready';
  if not found then return null; end if;
  select r.id into v_id from public.xtell_readings r
   where r.user_id = p_user and r.temple = 'daily' and r.deleted_at is null
     and r.subject->>'dailyId' = p_daily::text and jsonb_array_length(r.turns) = 0
   order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.xtell_readings (user_id, temple, subject, chart)
  values (p_user, 'daily',
          jsonb_build_object('dailyId', v_daily.id, 'method', v_daily.method, 'date', v_daily.local_date, 'tz', v_daily.display_tz, 'lang', v_daily.lang),
          jsonb_build_object('basis', v_daily.basis, 'reading', v_daily.reading))
  returning id into v_id;
  return v_id;
end $$;

-- Claim a day's reading for one method and language. Outcomes:
--   gone     the profile is missing or no longer at p_revision
--   ready    a finished reading (returned)
--   pending  someone else is generating it (lease still fresh)
--   failed   the last attempt failed within the cooldown
--   capped   this user's generations for the UTC day are used up
--   claimed  this caller holds the lease (token p_token) and must finish it
create or replace function public.xtell_daily_claim(
  p_user uuid, p_date date, p_tz text, p_revision bigint, p_method text, p_rules text, p_lang text,
  p_token uuid, p_stale_seconds integer, p_cooldown_seconds integer, p_max_per_day integer, p_keep_days integer
) returns table (outcome text, row_id uuid, basis jsonb, reading jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_revision bigint;
  v_row     public.xtell_daily%rowtype;
  v_found   boolean;
  v_used    integer;
  v_day     date := (now() at time zone 'utc')::date;
begin
  select p.revision into v_revision from public.xtell_profiles p where p.user_id = p_user for update;
  if not found or v_revision <> p_revision then
    return query select 'gone'::text, null::uuid, null::jsonb, null::jsonb; return;
  end if;
  delete from public.xtell_daily d where d.user_id = p_user and d.local_date < p_date - p_keep_days;
  select * into v_row from public.xtell_daily d
   where d.user_id = p_user and d.local_date = p_date and d.display_tz = p_tz and d.profile_revision = p_revision
     and d.method = p_method and d.rules_version = p_rules and d.lang = p_lang;
  v_found := found;
  if v_found then
    if v_row.status = 'ready' then
      return query select 'ready'::text, v_row.id, v_row.basis, v_row.reading; return;
    end if;
    if v_row.status = 'pending' and v_row.leased_at > now() - make_interval(secs => p_stale_seconds) then
      return query select 'pending'::text, v_row.id, null::jsonb, null::jsonb; return;
    end if;
    if v_row.status = 'failed' and v_row.leased_at > now() - make_interval(secs => p_cooldown_seconds) then
      return query select 'failed'::text, v_row.id, null::jsonb, null::jsonb; return;
    end if;
  end if;
  insert into public.xtell_daily_usage (user_id, day, generations) values (p_user, v_day, 0) on conflict (user_id, day) do nothing;
  select u.generations into v_used from public.xtell_daily_usage u where u.user_id = p_user and u.day = v_day for update;
  if v_used >= p_max_per_day then
    return query select 'capped'::text, v_row.id, null::jsonb, null::jsonb; return;
  end if;
  update public.xtell_daily_usage u set generations = u.generations + 1 where u.user_id = p_user and u.day = v_day;
  if v_found then
    update public.xtell_daily d set status = 'pending', lease_token = p_token, leased_at = now(), updated_at = now() where d.id = v_row.id;
    return query select 'claimed'::text, v_row.id, null::jsonb, null::jsonb; return;
  end if;
  insert into public.xtell_daily (user_id, local_date, display_tz, profile_revision, method, rules_version, lang, status, lease_token, leased_at)
  values (p_user, p_date, p_tz, p_revision, p_method, p_rules, p_lang, 'pending', p_token, now())
  returning id into v_row.id;
  return query select 'claimed'::text, v_row.id, null::jsonb, null::jsonb;
end $$;

-- Finish a claimed reading: written only while the lease is this caller's and
-- the profile still exists at the revision the reading was computed for.
create or replace function public.xtell_daily_finish(
  p_user uuid, p_id uuid, p_token uuid, p_revision bigint, p_ok boolean, p_basis jsonb, p_reading jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_revision bigint;
  v_n        integer;
begin
  select p.revision into v_revision from public.xtell_profiles p where p.user_id = p_user for update;
  if not found or v_revision <> p_revision then return false; end if;
  update public.xtell_daily d
     set status = case when p_ok then 'ready' else 'failed' end,
         basis = p_basis,
         reading = case when p_ok then p_reading else null end,
         lease_token = null, leased_at = now(), updated_at = now()
   where d.id = p_id and d.user_id = p_user and d.lease_token = p_token and d.status = 'pending' and d.profile_revision = p_revision;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

revoke all on function public.xtell_profile_save(uuid, jsonb, text, smallint, text, boolean, text) from public, anon, authenticated;
revoke all on function public.xtell_profile_delete(uuid) from public, anon, authenticated;
revoke all on function public.xtell_daily_claim(uuid, date, text, bigint, text, text, text, uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.xtell_daily_finish(uuid, uuid, uuid, bigint, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.xtell_daily_followup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.xtell_profile_save(uuid, jsonb, text, smallint, text, boolean, text) to service_role;
grant execute on function public.xtell_profile_delete(uuid) to service_role;
grant execute on function public.xtell_daily_claim(uuid, date, text, bigint, text, text, text, uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.xtell_daily_finish(uuid, uuid, uuid, bigint, boolean, jsonb, jsonb) to service_role;
grant execute on function public.xtell_daily_followup(uuid, uuid) to service_role;

commit;

-- Checks after running (every value must be false):
-- select has_table_privilege('anon', 'public.xtell_profiles', 'select'), has_table_privilege('authenticated', 'public.xtell_profiles', 'select'),
--        has_table_privilege('anon', 'public.xtell_daily', 'select'), has_table_privilege('authenticated', 'public.xtell_daily', 'select'),
--        has_table_privilege('authenticated', 'public.xtell_daily_usage', 'select'),
--        has_function_privilege('anon', 'public.xtell_daily_claim(uuid,date,text,bigint,text,text,text,uuid,integer,integer,integer,integer)', 'execute'),
--        has_function_privilege('authenticated', 'public.xtell_daily_claim(uuid,date,text,bigint,text,text,text,uuid,integer,integer,integer,integer)', 'execute'),
--        has_function_privilege('authenticated', 'public.xtell_daily_finish(uuid,uuid,uuid,bigint,boolean,jsonb,jsonb)', 'execute'),
--        has_function_privilege('authenticated', 'public.xtell_profile_save(uuid,jsonb,text,smallint,text,boolean,text)', 'execute'),
--        has_function_privilege('authenticated', 'public.xtell_profile_delete(uuid)', 'execute'),
--        has_function_privilege('authenticated', 'public.xtell_daily_followup(uuid,uuid)', 'execute');
-- And with the publishable key: GET /rest/v1/xtell_profiles and POST /rest/v1/rpc/xtell_daily_claim must be refused.
