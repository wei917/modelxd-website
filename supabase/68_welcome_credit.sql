-- 68_welcome_credit.sql — one-time $10 welcome credit for verified signups.
--
-- New Google accounts get $10 to start; anonymous / guest sessions get
-- nothing. ModelXD's only real sign-in is Google OAuth, so "verified" means a
-- non-anonymous user whose auth provider is google. The grant is written from
-- the existing handle_new_user trigger (which already seeds the profile +
-- wallet), guarded so it can fire at most once per user even if the trigger
-- somehow re-runs.
--
-- Deliberately NOT backfilled (CC, Aug 4): existing users are not paid
-- retroactively. Only accounts created after this migration receive it.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_is_google boolean;
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_credits (user_id, balance_cents)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  -- Verified == not an anonymous session AND signed in through Google. The
  -- provider lands in raw_app_meta_data at creation time; check both the
  -- scalar 'provider' and the 'providers' array so either shape counts.
  -- Read is_anonymous via to_jsonb so a project without that column (or an
  -- older auth schema) can't raise and block the signup — a missing key just
  -- reads as null → not anonymous, and the provider check below still gates.
  v_is_google :=
        coalesce((to_jsonb(new)->>'is_anonymous')::boolean, false) = false
    and (
         new.raw_app_meta_data->>'provider' = 'google'
      or coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
    );

  if v_is_google
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
