-- supabase/135_xsports_ai_spend.sql — what ModelXD spends on X體育's AI
-- commentators each Taipei day, against the day's cap (owner, Oct 15: "so
-- we can cap $50 a day for sports? when it hits cap, how do I know?").
--
--   xsports_ai_spend           one row a day: dollars, remarks, and when the
--                              day reached the cap
--   add_xsports_ai_spend()     adds one remark's cost, atomically; the
--                              remark that crosses the cap stamps capped_at
--
-- ModelXD only: the server adds through the service role
-- (lib/xsports-ai-spend.ts) and /admin/traffic reads with it; the browser
-- keys get nothing (RLS on, no policies, every grant revoked by name;
-- pitfalls 15 and 16). Until this runs, the rooms keep the cheap pair (the
-- server cannot read the day, so it never uses the top models). Safe to
-- re-run. Run by hand. Dev and prod share this database.

begin;

create table if not exists public.xsports_ai_spend (
  day        date primary key,
  usd        numeric(12, 6) not null default 0,
  remarks    integer not null default 0,
  capped_at  timestamptz
);

alter table public.xsports_ai_spend enable row level security;
revoke all on table public.xsports_ai_spend from public, anon, authenticated;

create or replace function public.add_xsports_ai_spend(p_day date, p_usd numeric, p_cap numeric)
returns table (usd numeric, remarks integer, capped_at timestamptz)
language sql
security definer
set search_path = public
as $$
  insert into public.xsports_ai_spend as s (day, usd, remarks, capped_at)
  values (p_day, greatest(coalesce(p_usd, 0), 0), 1, case when greatest(coalesce(p_usd, 0), 0) >= p_cap then now() end)
  on conflict (day) do update
    set usd = s.usd + excluded.usd,
        remarks = s.remarks + 1,
        capped_at = coalesce(s.capped_at, case when s.usd + excluded.usd >= p_cap then now() end)
  returning s.usd, s.remarks, s.capped_at;
$$;

revoke execute on function public.add_xsports_ai_spend(date, numeric, numeric) from public, anon, authenticated;
grant execute on function public.add_xsports_ai_spend(date, numeric, numeric) to service_role;

commit;

-- Check after running:
--   publishable key: select on xsports_ai_spend and rpc add_xsports_ai_spend
--     both get 42501.
--   select has_function_privilege('anon', 'public.add_xsports_ai_spend(date, numeric, numeric)', 'execute');  -- false
--   service key: select * from xsports_ai_spend  -- rows, or none yet
