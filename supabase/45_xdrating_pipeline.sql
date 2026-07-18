-- ModelXD: XDRating pipeline — incremental aggregates + ratings snapshot.
-- Run in Supabase SQL Editor. See docs/xdrating-pipeline.md.
--
-- After running this file, bootstrap once:
--   select xd_rebuild_aggregates();
-- then hit /api/xdrating/refit?force=1 (or wait for the next vote/cron).

-- ── Aggregate tables ────────────────────────────────────────────────────────

create table if not exists model_pairwise_wins (
  mode       text    not null,          -- 'text' | 'image' | 'video'
  signal     text    not null,          -- 'quality' | 'value'
  winner_id  uuid    not null,
  loser_id   uuid    not null,
  wins       numeric not null default 0, -- fractional: ties add 0.5
  updated_at timestamptz not null default now(),
  primary key (mode, signal, winner_id, loser_id)
);

create table if not exists model_vote_stats (
  mode        text    not null,
  model_id    uuid    not null,
  votes       numeric not null default 0,  -- participation count (matches legacy `votes`)
  voted1      int     not null default 0,  -- stickiness denominator
  retained    int     not null default 0,  -- stickiness numerator
  price_label text,                        -- last seen slot priceLabel (XBoard display)
  updated_at  timestamptz not null default now(),
  primary key (mode, model_id)
);

create table if not exists model_ratings (
  mode           text not null,            -- 'text' | 'image' | 'video' | 'all'
  model_id       uuid not null,
  quality_rating int,
  value_rating   int,
  stickiness     numeric,                  -- retention rate 0..1, null if no data
  xd_score       int  not null,
  total_votes    numeric not null default 0,
  price_label    text,
  updated_at     timestamptz not null default now(),
  primary key (mode, model_id)
);

create table if not exists xdrating_refit_log (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  source      text,                        -- 'vote' | 'cron' | 'manual' | 'bootstrap'
  duration_ms int
);
create index if not exists xdrating_refit_log_ran_at on xdrating_refit_log (ran_at desc);

-- RLS: server-only writes; snapshot readable by anon (XBoard is public).
alter table model_pairwise_wins enable row level security;
alter table model_vote_stats    enable row level security;
alter table model_ratings       enable row level security;
alter table xdrating_refit_log  enable row level security;
drop policy if exists model_ratings_read on model_ratings;
create policy model_ratings_read on model_ratings for select using (true);

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Slot ids in slot order: `model_id || id`, uuid-parseable, existing in
-- ai_models. Mirrors the legacy route's validModelIds filter.
create or replace function xd_slot_ids(p_slots jsonb)
returns uuid[] language sql stable as $$
  select coalesce(array_agg(v.mid order by v.ord), '{}')
  from (
    select ord, mid::uuid as mid
    from (
      select ordinality as ord,
             coalesce(s.value->>'model_id', s.value->>'id') as mid
      from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) with ordinality as s(value, ordinality)
    ) raw
    where raw.mid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (select 1 from ai_models m where m.id = raw.mid::uuid)
  ) v
$$;

create or replace function xd_safe_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then p::uuid end
$$;

create or replace function xd_add_win(p_mode text, p_signal text, p_winner uuid, p_loser uuid, p_wins numeric)
returns void language sql as $$
  insert into model_pairwise_wins as w (mode, signal, winner_id, loser_id, wins)
  values (p_mode, p_signal, p_winner, p_loser, p_wins)
  on conflict (mode, signal, winner_id, loser_id)
  do update set wins = w.wins + excluded.wins, updated_at = now()
$$;

create or replace function xd_add_stats(p_mode text, p_model uuid, p_votes numeric, p_voted1 int, p_retained int, p_price_label text)
returns void language sql as $$
  insert into model_vote_stats as s (mode, model_id, votes, voted1, retained, price_label)
  values (p_mode, p_model, p_votes, p_voted1, p_retained, p_price_label)
  on conflict (mode, model_id)
  do update set votes       = s.votes + excluded.votes,
                voted1      = s.voted1 + excluded.voted1,
                retained    = s.retained + excluded.retained,
                price_label = coalesce(excluded.price_label, s.price_label),
                updated_at  = now()
$$;

-- One pairwise signal pass over slot ids. Mirrors the legacy loops exactly:
-- for i<j: tie or winner-not-in-pair → 0.5 each way; else 1 to the winner.
-- Every participating id gets votes += sign.
create or replace function xd_apply_signal(
  p_mode text, p_signal text, p_ids uuid[],
  p_is_tie boolean, p_winner uuid, p_sign numeric
) returns void language plpgsql as $$
declare i int; j int; a uuid; b uuid;
begin
  if array_length(p_ids, 1) is null or array_length(p_ids, 1) < 2 then return; end if;
  for i in 1 .. array_length(p_ids, 1) loop
    perform xd_add_stats(p_mode, p_ids[i], p_sign, 0, 0, null);
  end loop;
  for i in 1 .. array_length(p_ids, 1) - 1 loop
    for j in i + 1 .. array_length(p_ids, 1) loop
      a := p_ids[i]; b := p_ids[j];
      if p_is_tie or (p_winner is distinct from a and p_winner is distinct from b) then
        perform xd_add_win(p_mode, p_signal, a, b, 0.5 * p_sign);
        perform xd_add_win(p_mode, p_signal, b, a, 0.5 * p_sign);
      elsif p_winner = a then
        perform xd_add_win(p_mode, p_signal, a, b, 1.0 * p_sign);
      else
        perform xd_add_win(p_mode, p_signal, b, a, 1.0 * p_sign);
      end if;
    end loop;
  end loop;
end $$;

-- Last-seen price label per model from a slots jsonb (display-only).
create or replace function xd_apply_price_labels(p_mode text, p_slots jsonb)
returns void language plpgsql as $$
declare s jsonb; mid uuid;
begin
  for s in select value from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    mid := xd_safe_uuid(coalesce(s->>'model_id', s->>'id'));
    if mid is not null and coalesce(s->>'priceLabel', '') <> ''
       and exists (select 1 from ai_models m where m.id = mid) then
      perform xd_add_stats(p_mode, mid, 0, 0, 0, s->>'priceLabel');
    end if;
  end loop;
end $$;

-- ── Row contributions (whole-row apply/un-apply) ────────────────────────────

create or replace function xd_duel_contribution(d duels, p_sign numeric)
returns void language plpgsql as $$
declare ids uuid[]; v1_winner uuid; v2_winner uuid;
begin
  ids := xd_slot_ids(d.slots);
  if array_length(ids, 1) is null or array_length(ids, 1) < 2 then return; end if;

  v1_winner := xd_safe_uuid(d.vote1_model_id::text);
  v2_winner := xd_safe_uuid(d.vote2_model_id::text);

  if d.vote1 is not null then
    perform xd_apply_signal(d.mode, 'quality', ids, d.vote1 = 'T', v1_winner, p_sign);
  end if;
  if d.vote2 is not null then
    perform xd_apply_signal(d.mode, 'value', ids, d.vote2 = 'T', v2_winner, p_sign);
  end if;

  -- Stickiness: legacy rule — vote1 present + non-tie + vote2 present.
  if d.vote1 is not null and d.vote2 is not null and d.vote1 <> 'T'
     and v1_winner is not null
     and exists (select 1 from ai_models m where m.id = v1_winner) then
    perform xd_add_stats(d.mode, v1_winner, 0, (1 * p_sign)::int,
      case when coalesce(d.vote_changed, false) then 0 else (1 * p_sign)::int end, null);
  end if;

  if p_sign > 0 then
    perform xd_apply_price_labels(d.mode, d.slots);
  end if;
end $$;

create or replace function xd_xcreate_contribution(x xcreates, p_sign numeric)
returns void language plpgsql as $$
declare ids uuid[]; distinct_ids uuid[]; chosen uuid; other uuid; i int;
begin
  chosen := xd_safe_uuid(x.chosen_model_id::text);
  if chosen is null then return; end if;
  if not exists (select 1 from ai_models m where m.id = chosen) then return; end if;

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
    perform xd_add_stats(x.mode, distinct_ids[i], p_sign, 0, 0, null);
  end loop;

  foreach other in array distinct_ids loop
    if other <> chosen then
      perform xd_add_win(x.mode, 'quality', chosen, other, 1.0 * p_sign);
    end if;
  end loop;

  if p_sign > 0 then
    perform xd_apply_price_labels(x.mode, x.slots);
  end if;
end $$;

-- ── Triggers ────────────────────────────────────────────────────────────────

create or replace function xd_duels_trigger() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform xd_duel_contribution(new, 1);
    return new;
  elsif tg_op = 'UPDATE' then
    if (old.vote1, old.vote2, old.vote1_model_id, old.vote2_model_id,
        old.vote_changed, old.slots, old.mode)
       is distinct from
       (new.vote1, new.vote2, new.vote1_model_id, new.vote2_model_id,
        new.vote_changed, new.slots, new.mode) then
      perform xd_duel_contribution(old, -1);
      perform xd_duel_contribution(new, 1);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform xd_duel_contribution(old, -1);
    return old;
  end if;
  return null;
end $$;

create or replace function xd_xcreates_trigger() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform xd_xcreate_contribution(new, 1);
    return new;
  elsif tg_op = 'UPDATE' then
    if (old.chosen_model_id, old.slots, old.mode)
       is distinct from
       (new.chosen_model_id, new.slots, new.mode) then
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

drop trigger if exists xd_duels_aggregate on duels;
create trigger xd_duels_aggregate
  after insert or update or delete on duels
  for each row execute function xd_duels_trigger();

drop trigger if exists xd_xcreates_aggregate on xcreates;
create trigger xd_xcreates_aggregate
  after insert or update or delete on xcreates
  for each row execute function xd_xcreates_trigger();

-- ── Rebuild (repair / bootstrap) ────────────────────────────────────────────

create or replace function xd_rebuild_aggregates() returns void
language plpgsql security definer as $$
declare d duels; x xcreates;
begin
  -- `where true` satisfies pg_safeupdate (enabled on Supabase), which
  -- rejects unqualified DELETEs even inside functions.
  delete from model_pairwise_wins where true;
  delete from model_vote_stats where true;
  for d in select * from duels loop
    perform xd_duel_contribution(d, 1);
  end loop;
  for x in select * from xcreates where chosen_model_id is not null loop
    perform xd_xcreate_contribution(x, 1);
  end loop;
end $$;

-- ── Nightly rebuild via pg_cron (best-effort) ───────────────────────────────
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if found then
    perform cron.unschedule(jobid) from cron.job where jobname = 'xd-nightly-rebuild';
    perform cron.schedule('xd-nightly-rebuild', '0 3 * * *', 'select xd_rebuild_aggregates()');
    raise notice 'pg_cron: xd-nightly-rebuild scheduled (03:00 UTC daily)';
  else
    raise notice 'pg_cron extension not enabled — enable it in Dashboard → Database → Extensions, then re-run this DO block';
  end if;
end $$;
