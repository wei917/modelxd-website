-- 113_line_one_account.sql — one LINE person, one account (Sep 29).
--
-- LINE needs one Login channel per region, so Supabase has two providers,
-- custom:line-jp and custom:line-tw. Both channels are under the same LINE
-- provider, and LINE gives a person the same user id on every channel under
-- one provider ("If the provider is the same, the user ID is the same
-- regardless of the channel type"). Supabase finds an account by (provider,
-- id), so the same person signing in through the other channel (another
-- phone, another browser, the other language) would get a SECOND account
-- and a second $10.
--
-- handle_new_user now refuses that sign-up. GoTrue answers "Database error
-- saving new user", and /auth/callback, seeing it for a LINE attempt,
-- restarts the sign-in once through the other channel, which lands in the
-- existing account. Everything else is 112 unchanged.
--
-- Verify after running (both should be true):
--   select pg_get_functiondef('public.handle_new_user'::regproc) ~ 'line_twin'
--      and pg_get_functiondef('public.handle_new_user'::regproc) ~ 'custom:line-tw';
-- And after the first real LINE sign-up, that the id the check reads is there:
--   select raw_user_meta_data ? 'sub' or raw_user_meta_data ? 'provider_id'
--     from auth.users where raw_app_meta_data->>'provider' like 'custom:line-%' limit 5;

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

  -- Verified == not an anonymous session AND signed in through Google or a
  -- LINE channel. Scalar 'provider' or the 'providers' array, as in 68.
  v_verified :=
        coalesce((to_jsonb(new)->>'is_anonymous')::boolean, false) = false
    and (
         new.raw_app_meta_data->>'provider' in ('google', 'custom:line-jp', 'custom:line-tw')
      or coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb) ?| array['google', 'custom:line-jp', 'custom:line-tw']
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
