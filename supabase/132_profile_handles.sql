-- supabase/132_profile_handles.sql — an @ID for every account (owner, Oct 13:
-- "we need user to pick an id right? not just for chatroom?"). Shown after
-- the website name, small, like X ("A seems better"), in rooms first.
--
--   profiles.handle             a-z, 0-9, _ and . (3-20), unique on the site.
--                               We assign it (owner: "assign an id from their
--                               google or x or line info"): the X username when
--                               the account signed in with X, else an English
--                               website name the person chose, else two words
--                               and digits (swift_otter_482). Never the email
--                               or the Google / LINE name: an ID is on every
--                               chat line, and those are the person's address
--                               and often their real name.
--   profiles.handle_changed_at  when the person last changed it; null while it
--                               is still the one we assigned. One change every
--                               30 days (owner: "at most once per month");
--                               replacing the assigned one can happen at once.
--   profile_handle_holds        an ID someone left stays theirs for 30 days, so
--                               nobody can take it to pose as them.
--   xsports_room_messages.author_handle   copied in when a message is sent,
--                               like the name; readable by everyone.
--
--   assign_profile_handle(uid, words_only)  gives an account with no ID its
--                               ID. With words_only it replaces an assigned
--                               (never changed) ID with words: the server does
--                               that when moderation refuses an X username.
--                               Every account gets one below; a new account
--                               gets one from the server after it signs in.
--   change_profile_handle(uid, handle)  the only way a person changes it: the
--                               30-day rule, the holds and uniqueness in one
--                               transaction. The server checks the ID itself
--                               first (characters, reserved words, moderation;
--                               lib/handle.ts).
--   handle_is_reserved(h)       the reserved words, as lib/handle.ts has them.
--
-- Functions and holds are for the service role only (pitfalls 15 and 16); a
-- person reads their own handle through the existing "profiles: owner read".
-- Additive; safe to re-run. Run by hand. Dev and prod share this database.

begin;

alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists handle_changed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_handle_format' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_handle_format
      check (handle is null or (handle ~ '^[a-z0-9_.]{3,20}$' and handle !~ '(^\.|\.$|\.\.)'));
  end if;
end $$;

create unique index if not exists profiles_handle_key on public.profiles (handle);

create table if not exists public.profile_handle_holds (
  handle   text primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  until    timestamptz not null
);
alter table public.profile_handle_holds enable row level security;
revoke all on public.profile_handle_holds from public, anon, authenticated;
grant all on public.profile_handle_holds to service_role;

alter table public.xsports_room_messages add column if not exists author_handle text
  check (author_handle is null or author_handle ~ '^[a-z0-9_.]{3,20}$');
grant select (author_handle) on public.xsports_room_messages to anon, authenticated;

-- Reserved: the words below exactly (separators and trailing digits ignored,
-- so ai_1 and support7 count), anything starting with a model maker's name,
-- admin / official / moderator at either end, modelxd anywhere; each also with
-- look-alike digits read as letters (0 o, 1 l or i, 3 e, 4 a, 5 s, 7 t) and
-- "rn" read as "m". Keep in step with lib/handle.ts.
create or replace function public.handle_is_reserved(h text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  with words as (select array[
    'admin','administrator','root','system','sysadmin','support','help','helpdesk','official','staff',
    'team','mod','mods','moderator','security','safety','info','contact','billing','payment','payments',
    'api','www','web','app','mail','email','null','undefined','anonymous','anon','guest','user','users',
    'me','you','everyone','all','here','ai','bot','xd','owner','founder','ceo','legal','privacy','terms',
    'abuse','report','verify','verified','login','logout','signin','signup','register','account',
    'accounts','settings','profile','home','news','blog','press','jobs','status',
    'xtell','xcreate','xsports','xduel','xtalk','xgame','xpersona','xvote','xboard','xdirect','xcut',
    'xworld','xarch','xdev','xeval','xchat',
    'gemini','grok','qwen','kimi','luna','sol','terra','astra','fable','opus','sonnet','haiku','deepseek',
    'minimax','hailuo','seedance','happyhorse','wan','veo','runway','midjourney','llama','mistral','sora',
    'nanobanana','commentator'
  ]::text[] as w),
  base as (select replace(replace(lower(coalesce(h, '')), '.', ''), '_', '') as s),
  forms as (
    select f, regexp_replace(f, '[0-9]+$', '') as bare
    from base, unnest(array[
      s,
      translate(replace(s, 'rn', 'm'), '013457', 'oleast'),
      translate(replace(s, 'rn', 'm'), '013457', 'oieast')
    ]) as f
  )
  select exists (
    select 1 from forms, words
    where f = any (w) or bare = any (w)
       or f ~ '^(gpt|chatgpt|openai|claude|anthropic)'
       or f ~ '^(admin|official|moderator)' or bare ~ '(admin|official|moderator)$'
       or position('modelxd' in f) > 0
  )
$$;

-- A name copied from a sign-in (Google / LINE / X name or user name, or the
-- email's first part), on the account or any of its identities.
create or replace function public.handle_is_signin_name(uid uuid, nm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with names as (
    select u.raw_user_meta_data as d, u.email as e from auth.users u where u.id = uid
    union all
    select i.identity_data, i.identity_data->>'email' from auth.identities i where i.user_id = uid
  )
  select exists (
    select 1 from names, unnest(array[d->>'full_name', d->>'name', d->>'preferred_username', d->>'user_name',
                                       split_part(coalesce(e, ''), '@', 1)]) as v
    where v is not null and lower(trim(v)) = lower(trim(nm))
  )
$$;

-- Sets cand as the account's assigned ID when it is valid, not reserved, not
-- held for someone else and not taken; null otherwise.
create or replace function public.try_profile_handle(uid uuid, cand text, cur text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if cand is null or cand !~ '^[a-z0-9_.]{3,20}$' or cand ~ '(^\.|\.$|\.\.)' or public.handle_is_reserved(cand) then
    return null;
  end if;
  if exists (select 1 from public.profile_handle_holds where handle = cand and until > now() and user_id <> uid) then
    return null;
  end if;
  begin
    update public.profiles set handle = cand
     where id = uid and handle is not distinct from cur and handle_changed_at is null;
    if not found then return null; end if;
  exception when unique_violation then
    return null;
  end;
  return cand;
end $$;

create or replace function public.assign_profile_handle(uid uuid, words_only boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur text; changed timestamptz; dname text; base text; cand text; got text; n int; d int;
  adj  text[] := array['brave','calm','swift','lucky','sunny','bright','happy','quiet','gentle','clever',
                       'bold','kind','merry','noble','quick','witty','jolly','cozy','fresh','eager','keen',
                       'lively','mellow','silver','golden','misty','starry','snowy','steady','cheery',
                       'breezy','nimble'];
  noun text[] := array['otter','tiger','panda','falcon','eagle','dolphin','fox','owl','koala','lynx',
                       'heron','crane','maple','pine','cedar','river','comet','harbor','island','lotus',
                       'bamboo','kite','lantern','pebble','breeze','cloud','ember','sparrow','swan',
                       'whale','puffin','robin'];
begin
  -- One assignment per account at a time.
  select handle, handle_changed_at, display_name into cur, changed, dname
    from public.profiles where id = uid for update;
  if not found then return null; end if;
  if cur is not null and not (words_only and changed is null) then return cur; end if;

  if not words_only then
    -- 1. The X username, already public on X.
    select lower(coalesce(i.identity_data->>'user_name', i.identity_data->>'preferred_username')) into base
      from auth.identities i where i.user_id = uid and i.provider in ('x', 'twitter')
     order by i.created_at limit 1;
    if base is not null and base !~ '^[a-z0-9_]{1,20}$' then base := null; end if;
    -- 2. An English website name the person chose (one word: "Chris Wei" is
    --    more likely a real name than a nickname), not one copied from a sign-in.
    if base is null and dname ~ '^[A-Za-z0-9_.-]{3,20}$' and not public.handle_is_signin_name(uid, dname) then
      base := trim(both '_.' from regexp_replace(replace(lower(dname), '-', '_'), '[_.]{2,}', '_', 'g'));
    end if;
    if base is not null and public.handle_is_reserved(base) then base := null; end if;
    -- The name itself, then with 2, 3 or 4 digits after it.
    if base is not null then
      for n in 0..6 loop
        d := (n + 3) / 2;
        cand := case when n = 0 then base
                     else left(base, 20 - d) || lpad(floor(random() * power(10, d))::int::text, d, '0') end;
        got := public.try_profile_handle(uid, cand, cur);
        if got is not null then return got; end if;
      end loop;
    end if;
  end if;

  -- 3. Two words and three digits: about 920,000 of them.
  for n in 1..30 loop
    cand := adj[1 + floor(random() * array_length(adj, 1))::int] || '_'
         || noun[1 + floor(random() * array_length(noun, 1))::int] || '_'
         || (100 + floor(random() * 900))::int::text;
    got := public.try_profile_handle(uid, cand, cur);
    if got is not null then return got; end if;
  end loop;
  return public.try_profile_handle(uid, 'user_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), cur);
end $$;

create or replace function public.change_profile_handle(uid uuid, h text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur text; changed timestamptz;
begin
  select handle, handle_changed_at into cur, changed from public.profiles where id = uid for update;
  if not found then return jsonb_build_object('error', 'no_profile'); end if;
  if h is not distinct from cur then return jsonb_build_object('handle', cur, 'changed_at', changed); end if;
  if h is null or h !~ '^[a-z0-9_.]{3,20}$' or h ~ '(^\.|\.$|\.\.)' then
    return jsonb_build_object('error', 'handle_chars');
  end if;
  if changed is not null and changed > now() - interval '30 days' then
    return jsonb_build_object('error', 'handle_too_soon', 'next', changed + interval '30 days');
  end if;
  if exists (select 1 from public.profile_handle_holds where handle = h and until > now() and user_id <> uid) then
    return jsonb_build_object('error', 'handle_taken');
  end if;
  begin
    update public.profiles set handle = h, handle_changed_at = now(), updated_at = now() where id = uid;
  exception when unique_violation then
    return jsonb_build_object('error', 'handle_taken');
  end;
  -- The new ID is in use (a hold of one's own on it ends); old holds go.
  delete from public.profile_handle_holds where handle = h or until <= now();
  if cur is not null then
    insert into public.profile_handle_holds (handle, user_id, until) values (cur, uid, now() + interval '30 days')
      on conflict (handle) do update set user_id = excluded.user_id, until = excluded.until;
  end if;
  return jsonb_build_object('handle', h, 'changed_at', now());
end $$;

revoke all on function public.handle_is_reserved(text) from public, anon, authenticated;
revoke all on function public.handle_is_signin_name(uuid, text) from public, anon, authenticated;
revoke all on function public.try_profile_handle(uuid, text, text) from public, anon, authenticated;
revoke all on function public.assign_profile_handle(uuid, boolean) from public, anon, authenticated;
revoke all on function public.change_profile_handle(uuid, text) from public, anon, authenticated;
grant execute on function public.handle_is_reserved(text) to service_role;
grant execute on function public.handle_is_signin_name(uuid, text) to service_role;
grant execute on function public.try_profile_handle(uuid, text, text) to service_role;
grant execute on function public.assign_profile_handle(uuid, boolean) to service_role;
grant execute on function public.change_profile_handle(uuid, text) to service_role;

-- Every account gets its ID now, oldest first.
do $$
declare r record;
begin
  for r in select id from public.profiles where handle is null order by created_at, id loop
    perform public.assign_profile_handle(r.id);
  end loop;
end $$;

commit;

-- Check after running:
--   select count(*) filter (where handle is null) as without, count(*) as accounts from public.profiles;  → 0, all
--   publishable key: POST /rest/v1/rpc/assign_profile_handle  → 401/42501
--                    POST /rest/v1/rpc/change_profile_handle  → 401/42501
--                    GET  /rest/v1/profile_handle_holds        → 401/42501
--                    GET  /rest/v1/xsports_room_messages?select=author_handle&limit=1 → 200
