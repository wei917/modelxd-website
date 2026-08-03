-- 64_xcreate_search_pool.sql
--
-- Give the text_search rating pool a source again.
--
-- The pool was fed by XDuel. XDuel's search toggle has since been removed —
-- a search duel measured 164x a normal one, so it can never sit inside the
-- free quota, and a credit-gated control on the free front door is the wrong
-- first impression. Search now lives in XCreate and XTalk, where the user is
-- already paying and picked the models on purpose.
--
-- XCreate is a legitimate replacement source: it runs models side by side and
-- asks which one won — the same comparison signal a duel produces.
--
-- THE RULE:
--
--   every slot searched      -> text_search
--   no slot searched         -> text
--   some searched, some not  -> NEITHER
--
-- A run where one model could look things up and another could not says
-- nothing about the models, only about the settings we handed them.
-- Recording it in either pool would poison that pool with a comparison
-- nobody made fairly. Dropping it costs one data point; keeping it costs the
-- meaning of the column.
--
-- WHY A TEXT COLUMN AND NOT A BOOLEAN: a boolean forces 'mixed' and 'this row
-- predates the feature' to share NULL. They are different facts with
-- different handling — one must be excluded, the other is a perfectly good
-- non-search run — and a schema that cannot tell them apart guarantees the
-- distinction gets lost the first time someone writes a query against it.
--
-- Requires 62 (xd_pool for duels). Idempotent.

-- ── 1. the flag ─────────────────────────────────────────────────────────────

alter table xcreates
  add column if not exists search_mode text
  check (search_mode in ('all', 'none', 'mixed'));

comment on column xcreates.search_mode is
  '''all'' = every slot had web search on; ''none'' = no slot did; ''mixed'' = some did and some did not (excluded from every rating pool); NULL = the run predates the setting, counted as ''none''.';

-- ── 2. pool derivation ──────────────────────────────────────────────────────

create or replace function xd_xcreate_pool(x xcreates) returns text
language sql immutable as $$
  select case when x.search_mode = 'all' then x.mode || '_search' else x.mode end
$$;

-- ── 3. reverse under the OLD key, BEFORE the function changes ──────────────
--
-- Same ordering trap as 62: reversing afterwards subtracts from a pool that
-- never received the contribution and strands the original forever.

do $$
declare x xcreates;
begin
  for x in select * from xcreates where search_mode is not null loop
    perform xd_xcreate_contribution(x, -1);
  end loop;
end $$;

-- ── 4. route by pool; drop mixed runs entirely ─────────────────────────────

create or replace function xd_xcreate_contribution(x xcreates, p_sign numeric)
returns void language plpgsql as $$
declare ids uuid[]; distinct_ids uuid[]; chosen uuid; other uuid; i int; pool text;
begin
  -- Not a rating signal in any pool. Checked first, before any work.
  if x.search_mode = 'mixed' then return; end if;

  chosen := xd_safe_uuid(x.chosen_model_id::text);
  if chosen is null then return; end if;
  if not exists (select 1 from ai_models m where m.id = chosen) then return; end if;

  pool := xd_xcreate_pool(x);

  ids := xd_slot_ids(x.slots);
  if array_length(ids, 1) is null or array_length(ids, 1) < 2 then return; end if;

  -- Dedupe (legacy Set semantics), preserving first-seen order.
  select coalesce(array_agg(u.mid order by u.first_ord), '{}') into distinct_ids
  from (
    select mid, min(ord) as first_ord
    from unnest(ids) with ordinality as t(mid, ord)
    group by mid
  ) u;
  if array_length(distinct_ids, 1) < 2 then return; end if;

  for i in 1 .. array_length(distinct_ids, 1) loop
    perform xd_add_stats(pool, distinct_ids[i], p_sign, 0, 0, null);
  end loop;

  foreach other in array distinct_ids loop
    if other <> chosen then
      perform xd_add_win(pool, 'quality', chosen, other, 1.0 * p_sign);
    end if;
  end loop;

  if p_sign > 0 then
    perform xd_apply_price_labels(pool, x.slots);
  end if;
end $$;

-- ── 5. the trigger must notice search_mode changing ────────────────────────

create or replace function xd_xcreates_trigger() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform xd_xcreate_contribution(new, 1);
    return new;
  elsif tg_op = 'UPDATE' then
    if (old.chosen_model_id, old.slots, old.mode, old.search_mode)
       is distinct from
       (new.chosen_model_id, new.slots, new.mode, new.search_mode) then
      perform xd_xcreate_contribution(old, -1);
      perform xd_xcreate_contribution(new, 1);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform xd_xcreate_contribution(old, -1);
    return old;
  end if;
  return null;
end $$;

-- ── 6. re-apply under the new key ──────────────────────────────────────────

do $$
declare x xcreates;
begin
  for x in select * from xcreates where search_mode is not null loop
    perform xd_xcreate_contribution(x, 1);
  end loop;
end $$;

-- ── verify ─────────────────────────────────────────────────────────────────
--
-- Nothing should change yet: no run has a search_mode until the route below
-- starts writing one. Any negative row means the reverse/re-apply ran out of
-- order.

select mode, signal, count(*) as pairs, sum(wins) as total_wins
  from model_pairwise_wins
 group by mode, signal
 order by mode, signal;
