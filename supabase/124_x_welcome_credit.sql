-- 124_x_welcome_credit.sql — X sign-in gets the $10 welcome credit (Oct 2).
--
-- Owner, Oct 2: "we should also support X login for all markets", and "$10
-- too". X is Supabase's built-in X / Twitter (OAuth 2.0) provider, so an
-- account made through it has raw_app_meta_data->>'provider' = 'x'. Until
-- this runs, handle_new_user (113) makes the account but grants nothing,
-- because its verified list is Google and the two LINE channels.
--
-- Two changes to 113, nothing else:
--   1. 'x' joins the providers that get the $10.
--   2. The profile's display name falls back to the X username
--      (preferred_username, user_name) before the email, because an X
--      account may have no email.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over.
--
-- Verify after running (should be true):
--   select pg_get_functiondef('public.handle_new_user'::regproc) ~ '''x'''
--      and pg_get_functiondef('public.handle_new_user'::regproc) ~ 'line_twin';
-- And after the first real X sign-up, that it was named 'x' and paid:
--   select u.raw_app_meta_data->>'provider', p.display_name, c.balance_cents
--     from auth.users u
--     join public.profiles p on p.id = u.id
--     join public.user_credits c on c.user_id = u.id
--    where u.raw_app_meta_data->>'provider' = 'x' or u.raw_app_meta_data->'providers' ? 'x'
--    order by u.created_at desc limit 5;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_verified boolean;
  v_line_id  text;
  v_twin     boolean := false;
begin
  -- One LINE person, one account. Both LINE channels sit under one LINE
  -- provider, so LINE gives a person the SAME user id on both, but Supabase
  -- keys an account on (sign-in provider, id), and custom:line-jp and
  -- custom:line-tw are two providers. Refuse the second account; the
  -- callback (app/auth/callback) sends the person through the channel that
  -- already has theirs. The lookup can only ever find a twin: any error in
  -- it reads as "no twin", so it can never block an ordinary sign-up.
  if new.raw_app_meta_data->>'provider' in ('custom:line-jp', 'custom:line-tw') then
    v_line_id := coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub');
    if v_line_id is not null and v_line_id <> '' then
      begin
        select exists (
          select 1 from auth.identities i
          where i.provider in ('custom:line-jp', 'custom:line-tw')
            and i.provider <> new.raw_app_meta_data->>'provider'
            and i.provider_id = v_line_id
        ) into v_twin;
      exception when others then
        v_twin := false;
      end;
      if v_twin then
        raise exception 'line_twin: this LINE account already has a ModelXD account through the other LINE channel';
      end if;
    end if;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'preferred_username',
      new.raw_user_meta_data->>'user_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;

  insert into public.user_credits (user_id, balance_cents)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  -- Verified == not an anonymous session AND signed in through Google, a
  -- LINE channel or X. Scalar 'provider' or the 'providers' array, as in 68.
  v_verified :=
        coalesce((to_jsonb(new)->>'is_anonymous')::boolean, false) = false
    and (
         new.raw_app_meta_data->>'provider' in ('google', 'custom:line-jp', 'custom:line-tw', 'x')
      or coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb) ?| array['google', 'custom:line-jp', 'custom:line-tw', 'x']
    );

  if v_verified
     and not exists (
       select 1 from public.credit_transactions
       where user_id = new.id and reference_type = 'welcome'
     )
  then
    perform public.grant_credits(
      new.id,
      1000,                                   -- $10.00
      'grant',
      'welcome',
      new.id::text,
      'Welcome bonus — $10 to get started',
      null
    );
  end if;

  return new;
end;
$$;
