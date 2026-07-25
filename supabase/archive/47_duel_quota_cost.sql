-- 47_duel_quota_cost.sql
--
-- Multi-model duels consume proportional quota (CC, July 19):
-- a 3- or 4-model duel counts as ceil(n/2) = 2 daily duels, since the
-- house pays roughly per-model. Adds a p_cost arg (default 1) to the
-- consume/refund functions and drops the old 3-arg overloads so RPC
-- name resolution stays unambiguous.

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
