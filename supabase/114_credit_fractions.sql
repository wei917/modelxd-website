-- 114_credit_fractions.sql — charges under a cent are carried, not dropped
-- (Sep 29; run by the owner the same day and checked live).
--
-- The wallet is whole cents. An XTell answer from the default teacher costs
-- $0.0002 to $0.0007, and the reading route rounded each to the nearest
-- cent: zero. A test round asked 18 questions and was charged nothing; the
-- house paid them all. Rounding up instead would overbill 25 times over
-- ($0.0004 → 1¢), and billing is at list price.
--
-- So the part of a charge below a cent is kept per user, in millionths of a
-- dollar, and a whole cent is billed when the carried parts add up to one.
-- Over any run of charges the user pays the sum rounded DOWN to the cent,
-- never more than the list prices added up; what is left is under a cent.
--
-- accrue_fraction(user, micros) adds to the carry and returns the whole
-- cents now due (the caller debits them with debit_credits), atomically:
-- the upsert takes the row lock, so two answers finishing together cannot
-- both bill the same cent. Service role only; the table has RLS on and no
-- policy.
--
-- Code without this migration keeps the old rounding (lib/credits.ts
-- accrueFraction returns null), so the order of deploy and migration does
-- not matter.
--
-- Verify after running:
--   select has_function_privilege('anon', 'public.accrue_fraction(uuid,bigint)', 'execute'),
--          has_function_privilege('authenticated', 'public.accrue_fraction(uuid,bigint)', 'execute');   -- f, f
--   and with the publishable key: GET /rest/v1/credit_fractions must return no rows or be refused.

create table if not exists public.credit_fractions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- Millionths of a dollar charged but not yet billed; always under one cent
  -- (10000) once accrue_fraction returns.
  micros     bigint not null default 0 check (micros >= 0),
  updated_at timestamptz not null default now()
);

alter table public.credit_fractions enable row level security;
revoke all on public.credit_fractions from public, anon, authenticated;

create or replace function public.accrue_fraction(p_user uuid, p_micros bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_cents integer;
begin
  if p_user is null then raise exception 'accrue_fraction: user required'; end if;
  if p_micros is null or p_micros <= 0 then return 0; end if;
  -- One call is one model answer: $100 is far past any of them.
  if p_micros > 100000000 then raise exception 'accrue_fraction: amount out of range'; end if;

  insert into public.credit_fractions (user_id, micros)
  values (p_user, p_micros)
  on conflict (user_id) do update
    set micros = public.credit_fractions.micros + excluded.micros, updated_at = now()
  returning micros into v_total;

  v_cents := (v_total / 10000)::integer;
  if v_cents > 0 then
    update public.credit_fractions set micros = v_total - v_cents::bigint * 10000 where user_id = p_user;
  end if;
  return v_cents;
end;
$$;

revoke all on function public.accrue_fraction(uuid, bigint) from public, anon, authenticated;
grant execute on function public.accrue_fraction(uuid, bigint) to service_role;
