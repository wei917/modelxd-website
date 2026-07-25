-- ModelXD: free XDuel daily quotas per user/mode
--
-- XDuel is on the house — ModelXD pays the provider bills for every duel.
-- Video duels in particular cost $1–2 each, so a single bored user with
-- no cap can drain $10+/day from us. This table + RPC caps usage per
-- UTC day per mode.
--
-- Defaults (configurable in the route handler, not in SQL):
--   text  → 10/day
--   image → 3/day
--   video → 1/day
--
-- Race-safety: the consume_duel_quota function uses a WHERE clause that
-- only updates when used < limit, so two concurrent requests can't
-- both increment past the cap. Returns -1 when the cap is hit.

-- ── Table ─────────────────────────────────────────────────────────────────
create table if not exists duel_quotas (
  user_id    uuid not null references auth.users(id) on delete cascade,
  quota_date date not null default (now() at time zone 'utc')::date,
  text_used  int  not null default 0,
  image_used int  not null default 0,
  video_used int  not null default 0,
  primary key (user_id, quota_date)
);

alter table duel_quotas enable row level security;

-- Owner-read policy so the UI can show "X/N used today". Writes go
-- only through the SECURITY DEFINER function below.
drop policy if exists duel_quotas_own_read on duel_quotas;
create policy duel_quotas_own_read on duel_quotas
  for select using (auth.uid() = user_id);

-- ── Consume function ─────────────────────────────────────────────────────
-- Atomic check-and-increment for one mode.
-- Returns the count *after* increment, or -1 if the user is at/over the
-- cap (no row was modified).
create or replace function consume_duel_quota(
  p_user_id uuid,
  p_mode    text,
  p_limit   int,
  p_cost    int default 1
)
returns int
language plpgsql
security definer
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used  int;
begin
  insert into duel_quotas (user_id, quota_date)
    values (p_user_id, v_today)
    on conflict (user_id, quota_date) do nothing;

  -- Atomic per-mode increment, guarded by the cap: the whole cost must
  -- fit under the limit or nothing is consumed.
  case p_mode
    when 'text' then
      update duel_quotas
        set text_used = text_used + p_cost
        where user_id = p_user_id
          and quota_date = v_today
          and text_used + p_cost <= p_limit
        returning text_used into v_used;
    when 'image' then
      update duel_quotas
        set image_used = image_used + p_cost
        where user_id = p_user_id
          and quota_date = v_today
          and image_used + p_cost <= p_limit
        returning image_used into v_used;
    when 'video' then
      update duel_quotas
        set video_used = video_used + p_cost
        where user_id = p_user_id
          and quota_date = v_today
          and video_used + p_cost <= p_limit
        returning video_used into v_used;
    else
      raise exception 'consume_duel_quota: invalid mode %', p_mode;
  end case;

  return coalesce(v_used, -1);
end;
$$;

drop function if exists consume_duel_quota(uuid, text, int);
revoke all on function consume_duel_quota(uuid, text, int, int) from public;
grant execute on function consume_duel_quota(uuid, text, int, int) to service_role;

create or replace function refund_duel_quota(
  p_user_id uuid,
  p_mode    text,
  p_cost    int default 1
)
returns void
language plpgsql
security definer
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  case p_mode
    when 'text' then
      update duel_quotas set text_used  = greatest(0, text_used  - p_cost)
        where user_id = p_user_id and quota_date = v_today;
    when 'image' then
      update duel_quotas set image_used = greatest(0, image_used - p_cost)
        where user_id = p_user_id and quota_date = v_today;
    when 'video' then
      update duel_quotas set video_used = greatest(0, video_used - p_cost)
        where user_id = p_user_id and quota_date = v_today;
  end case;
end;
$$;

drop function if exists refund_duel_quota(uuid, text);
revoke all on function refund_duel_quota(uuid, text, int) from public;
grant execute on function refund_duel_quota(uuid, text, int) to service_role;
