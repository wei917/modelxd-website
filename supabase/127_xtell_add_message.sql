-- 127_xtell_add_message.sql — store an XTell message once, without an error
-- (Oct 4).
--
-- Owner, Oct 3: the Supabase dashboard showed 27 Postgres errors in a day;
-- 20 were `duplicate key value violates unique constraint
-- "xtell_messages_one_question"`. Several masters answer one question at the
-- same moment and each one's request stores the visitor's question: the first
-- insert wins and the others were refused by 126's unique index. That was the
-- intended outcome (lib/xtell-memory.ts skipped the refusal), but Postgres
-- logs every refusal as an ERROR, so the dashboard's error count stopped
-- meaning anything.
--
-- xtell_add_message inserts with ON CONFLICT DO NOTHING and no conflict
-- target, which covers every unique index on the table, the two partial ones
-- included: a question or an answer already stored is skipped quietly and the
-- function returns null; otherwise it returns the new seq. Any other failure
-- (a bad role, a missing conversation) is still an error.
--
-- Server only: /api/xtell/reading calls it with the service role. Security
-- invoker, so it runs with the caller's own rights; execute is revoked from
-- public, anon and authenticated by name (pitfall 15).
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over. Until it runs, the code keeps the plain
-- insert (and its logged duplicates).
--
-- Verify after running (false, false, true):
--   select has_function_privilege('anon', 'public.xtell_add_message(uuid, text, text, text, text[], text[], text, text, text, integer, numeric)', 'execute'),
--          has_function_privilege('authenticated', 'public.xtell_add_message(uuid, text, text, text, text[], text[], text, text, text, integer, numeric)', 'execute'),
--          has_function_privilege('service_role', 'public.xtell_add_message(uuid, text, text, text, text[], text[], text, text, text, integer, numeric)', 'execute');

begin;

create or replace function public.xtell_add_message(
  p_reading_id   uuid,
  p_role         text,
  p_content      text,
  p_qid          text    default null,
  p_to           text[]  default null,
  p_seats        text[]  default null,
  p_model_id     text    default null,
  p_model_name   text    default null,
  p_provider     text    default null,
  p_input_tokens integer default null,
  p_cost         numeric default null
) returns bigint
language sql
security invoker
set search_path = public
as $$
  insert into public.xtell_messages
    (reading_id, role, content, qid, "to", seats, model_id, model_name, provider, input_tokens, cost)
  values
    (p_reading_id, p_role, p_content, p_qid, p_to, p_seats, p_model_id, p_model_name, p_provider, p_input_tokens, p_cost)
  on conflict do nothing
  returning seq;
$$;

revoke all on function public.xtell_add_message(uuid, text, text, text, text[], text[], text, text, text, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.xtell_add_message(uuid, text, text, text, text[], text[], text, text, text, integer, numeric)
  to service_role;

commit;

notify pgrst, 'reload schema';
