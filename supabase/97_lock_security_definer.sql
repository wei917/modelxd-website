-- supabase/97_lock_security_definer.sql — close the browser's door to the
-- server-only functions. RUN THIS FIRST, before 98.
--
-- Found Sep 10 while writing the monthly plan. Every function below is
-- SECURITY DEFINER (it runs as its owner and bypasses RLS) and was only ever
-- meant for the service role. Migration 11 said so and ran
-- `revoke all ... from public` to enforce it. That does not work on Supabase:
-- the platform's default privileges grant EXECUTE on each new function in
-- public to `anon` and `authenticated` BY NAME, and a PUBLIC revoke does not
-- remove a named grant. PostgREST exposes public functions at /rest/v1/rpc/*,
-- so every one of these was callable by anyone holding the publishable key,
-- which ships in the browser bundle (live check, Sep 10: anon=true and
-- authenticated=true on all ten):
--
--   grant_credits(user, amount, ...)       mint credit into any account
--   debit_credits(user, amount, ...)       drain any account
--   refund_duel_quota(user, ...)           unlimited free duels, paid by the house
--   consume_duel_quota(user, ...)          burn someone else's daily duels
--   reserve/adjust/increment_token_spend   move an API token's spend cap
--   append_chat_turn(room, ...)            write into any chat room
--   bump_giveaway(kind, cents)             inflate the giveaway ledger
--   xd_rebuild_aggregates()                a full rating recompute, on demand
--
-- Every caller in the app uses the service role (lib/credits.ts,
-- lib/duel-quota.ts, lib/api-token.ts, app/api/xduel), checked Sep 10, and
-- the service role keeps its grant below, so nothing in the app changes.
-- Trigger functions are left alone: PostgREST does not expose them.
--
-- Run by hand in the Supabase SQL editor. Shared dev+prod project.

begin;

revoke all on function public.grant_credits(uuid, bigint, text, text, text, text, jsonb)          from public, anon, authenticated;
revoke all on function public.debit_credits(uuid, bigint, text, text, text, text, jsonb)          from public, anon, authenticated;
revoke all on function public.refund_duel_quota(uuid, text, integer)                              from public, anon, authenticated;
revoke all on function public.consume_duel_quota(uuid, text, integer, integer)                    from public, anon, authenticated;
revoke all on function public.reserve_token_spend(uuid, numeric)                                  from public, anon, authenticated;
revoke all on function public.adjust_token_spend(uuid, numeric)                                   from public, anon, authenticated;
revoke all on function public.increment_token_spend(uuid, numeric)                                from public, anon, authenticated;
revoke all on function public.append_chat_turn(uuid, text, uuid, text, numeric, integer, integer) from public, anon, authenticated;
revoke all on function public.bump_giveaway(text, bigint)                                         from public, anon, authenticated;
revoke all on function public.xd_rebuild_aggregates()                                             from public, anon, authenticated;

grant execute on function public.grant_credits(uuid, bigint, text, text, text, text, jsonb)          to service_role;
grant execute on function public.debit_credits(uuid, bigint, text, text, text, text, jsonb)          to service_role;
grant execute on function public.refund_duel_quota(uuid, text, integer)                              to service_role;
grant execute on function public.consume_duel_quota(uuid, text, integer, integer)                    to service_role;
grant execute on function public.reserve_token_spend(uuid, numeric)                                  to service_role;
grant execute on function public.adjust_token_spend(uuid, numeric)                                   to service_role;
grant execute on function public.increment_token_spend(uuid, numeric)                                to service_role;
grant execute on function public.append_chat_turn(uuid, text, uuid, text, numeric, integer, integer) to service_role;
grant execute on function public.bump_giveaway(text, bigint)                                         to service_role;
grant execute on function public.xd_rebuild_aggregates()                                             to service_role;

commit;

-- Verify (read-only; every row should read anon=false authenticated=false service_role=true):
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute')  as service_role
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
--    order by 1;
--
-- NOT run, for the owner to decide: Supabase keeps granting anon and
-- authenticated EXECUTE on every FUTURE function in public. This stops that
-- for functions created by postgres (the SQL editor's role):
--
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from anon, authenticated;
--
-- Until then, every new SECURITY DEFINER function needs its own revoke, by
-- name, the way 98_subscriptions.sql does it.
