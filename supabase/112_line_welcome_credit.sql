-- 112_line_welcome_credit.sql — LINE sign-ups get the same start as Google
-- ones (Sep 29, DRAFT: the owner decides whether to run it).
--
-- LINE Login arrived as Supabase custom OIDC providers, one per LINE region:
-- 'custom:line-jp' (live) and 'custom:line-tw' (not created yet). Without
-- this, handle_new_user (68) grants the $10 welcome credit to provider
-- 'google' only, so a LINE sign-up starts at $0 while the sign-in dialog
-- promises "$10, no card".
--
-- Also: an OIDC provider fills the standard claims (name, picture), not
-- Google's full_name/avatar_url, so the profile photo now falls back to
-- 'picture'. And a LINE account may have no email (the channel allows it),
-- so the display name no longer ends on split_part(null) alone.
--
-- Same function, same guards as 68: never anonymous, at most one welcome per
-- user. Not backfilled: a LINE account created before this runs keeps $0.
--
-- Verify after running:
--   select pg_get_functiondef('public.handle_new_user'::regproc) ~ 'custom:line-jp';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_verified boolean;
begin
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
