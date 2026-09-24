-- supabase/105_xtell_readings.sql — XTell readings are saved.
--
-- Until now nothing about a temple visit was written except the credit
-- charge: the chart was recomputed from the birth on every request and the
-- conversation lived in the tab. Owner, Sep 24: people paid for these, both
-- the chart and the conversation must be kept, and a saved reading must be
-- resumable — reopen it, the chart and every turn are back, and the next
-- question continues the same thread.
--
-- One row per temple visit. `subject` is exactly what the client sent to
-- /api/xtell/chart (birth, stick number, 稟告, wishes, place, name…), so the
-- server can recompute the chart and the facts for any later turn; `chart`
-- is the computed result as it was shown (the poem for a 籤, the pillars,
-- the star chart…) so history renders without recomputation and survives
-- an engine upgrade unchanged. `turns` is the conversation in the client's
-- own shape (user turns, and assistant turns with model + cost).
--
-- Written by the routes under the user's own session, so the policies are
-- the only gate: a user can create, read, update and delete their own rows
-- and nothing else. No `using (true)` anywhere (pitfall 16). Turn appends go
-- through xtell_append_turns so two masters answering the same question at
-- once cannot lose each other's write, and the user turn is stored once
-- (deduplicated on its qid) even though every master's request carries it.
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

create table if not exists public.xtell_readings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  temple      text not null,
  subject     jsonb not null,
  chart       jsonb,
  extras      jsonb,                         -- match / year / bazi shown beside the chart
  turns       jsonb not null default '[]'::jsonb,
  title       text,                          -- first question, for the list
  cost_cents  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists xtell_readings_user_created
  on public.xtell_readings (user_id, created_at desc)
  where deleted_at is null;

alter table public.xtell_readings enable row level security;

drop policy if exists "xtell_readings: owner read"   on public.xtell_readings;
drop policy if exists "xtell_readings: owner insert" on public.xtell_readings;
drop policy if exists "xtell_readings: owner update" on public.xtell_readings;
drop policy if exists "xtell_readings: owner delete" on public.xtell_readings;
create policy "xtell_readings: owner read"   on public.xtell_readings for select using (auth.uid() = user_id);
create policy "xtell_readings: owner insert" on public.xtell_readings for insert with check (auth.uid() = user_id);
create policy "xtell_readings: owner update" on public.xtell_readings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "xtell_readings: owner delete" on public.xtell_readings for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.xtell_readings to authenticated;
revoke all on public.xtell_readings from anon;

-- Append a question's turns atomically. SECURITY INVOKER: runs as the caller
-- under the policies above, so it can only touch the caller's own rows.
-- `user_turn` is appended only if no user turn with the same qid exists yet;
-- `assistant_turn` is always appended; cost accumulates; the first user turn
-- becomes the title.
create or replace function public.xtell_append_turns(
  p_id uuid, p_user_turn jsonb, p_assistant_turn jsonb, p_add_cents integer
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_user boolean;
begin
  select exists (
    select 1 from jsonb_array_elements(turns) t
     where t->>'role' = 'user' and t->>'qid' = p_user_turn->>'qid'
  ) into v_has_user
  from public.xtell_readings
  where id = p_id and user_id = auth.uid()
  for update;
  if v_has_user is null then
    raise exception 'reading not found';
  end if;
  update public.xtell_readings
     set turns = turns
                 || case when v_has_user then '[]'::jsonb else jsonb_build_array(p_user_turn) end
                 || jsonb_build_array(p_assistant_turn),
         cost_cents = cost_cents + coalesce(p_add_cents, 0),
         title = coalesce(title, left(p_user_turn->>'content', 80)),
         updated_at = now()
   where id = p_id and user_id = auth.uid();
end;
$$;

revoke all on function public.xtell_append_turns(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.xtell_append_turns(uuid, jsonb, jsonb, integer) to authenticated;

commit;

-- Verify (as the owner in the SQL editor):
--   select has_function_privilege('anon', 'public.xtell_append_turns(uuid,jsonb,jsonb,integer)', 'execute');  -- false
--   select has_table_privilege('anon', 'public.xtell_readings', 'select');                                    -- false
