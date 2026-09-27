-- supabase/110_trending_rank_range.sql — publish a big week, all at once.
--
-- 1. More than 20 live posts per kind a week. 108 capped `rank` at 1..20
--    because the list was going to hold one week's top 20 per kind. The owner
--    wants the month's supply ("only 11 posts in one month? you must be
--    kidding me", Sep 27: 50+), and one week's run can now bring more than 20
--    of a kind. The CHECK is enforced by the database, so the 21st live post
--    of a kind in a week cannot be ranked without this migration. Working
--    around it (null ranks, invented weeks) would bend the feed's order, which
--    is week DESC, rank ASC NULLS LAST, likes DESC, platform, post_id. rank
--    stays a smallint and must be positive; a page is still at most 20 posts
--    (TRENDING_MAX), and how many a week may hold is the app's
--    TRENDING_LIVE_MAX. The constraint's name was read from pg_constraint on
--    Sep 27 (trending_posts_rank_check = CHECK ((rank >= 1) AND (rank <= 20))),
--    so the drop cannot silently miss (pitfall: 106).
--
-- 2. One transaction per publish (Codex review, Sep 27). /admin/trending used
--    to update row by row, so a failure part-way (rank 21, before this) left a
--    week half published; bigger weeks make that likelier. PostgREST cannot
--    wrap several client calls in one transaction, so the publish is a
--    function: it locks the week, checks everything BEFORE writing, then puts
--    the chosen rows live (ranked per kind by likes, unknown last, then post
--    id: the same rule as lib/trending-publish.ts) and hides the rest of THAT
--    week. Other weeks are never touched: the feed shows every live week. It
--    refuses when the week holds a row the reviewer was not shown (a truncated
--    admin page, or a search that added candidates since the page loaded),
--    because those would be hidden unseen. Service role only: no EXECUTE for
--    public, anon or authenticated (pitfall 15), and SECURITY INVOKER, so it
--    has no rights of its own either.
--
-- 109 is taken twice on unmerged branches (xtell_daily, site_visits); this is
-- 110 on purpose. Run by hand. Dev and prod share this database. Safe to
-- re-run.

begin;

alter table public.trending_posts drop constraint if exists trending_posts_rank_check;
alter table public.trending_posts add constraint trending_posts_rank_check check (rank >= 1);

create or replace function public.publish_trending_week(
  p_week     date,
  p_ids      uuid[],     -- the rows to put live
  p_seen     uuid[],     -- every row of the week the reviewer was shown
  p_max_live integer     -- per kind (TRENDING_LIVE_MAX)
) returns table (live integer, hidden integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_week uuid[];
begin
  if p_week is null or p_ids is null or p_seen is null or p_max_live is null or p_max_live < 1 or p_max_live > 1000 then
    raise exception 'publish_trending_week: bad arguments';
  end if;
  -- One publish of a week at a time; the week's rows stay locked until commit.
  perform pg_advisory_xact_lock(hashtext('publish_trending_week'), hashtext(p_week::text));
  perform 1 from trending_posts where week = p_week for update;
  select coalesce(array_agg(id), '{}') into v_week from trending_posts where week = p_week;

  if exists (select 1 from unnest(v_week) w(id) where not (w.id = any (p_seen))) then
    raise exception 'publish_trending_week: week % has rows the reviewer was not shown; reload', p_week;
  end if;
  if exists (select 1 from unnest(p_ids) c(id) where not (c.id = any (v_week))) then
    raise exception 'publish_trending_week: a chosen row is not in week %', p_week;
  end if;
  if exists (select 1 from trending_posts where week = p_week and id = any (p_ids) group by kind having count(*) > p_max_live) then
    raise exception 'publish_trending_week: more than % posts of one kind chosen', p_max_live;
  end if;

  -- Both writes touch only the rows captured above. A search can insert a
  -- candidate into this week meanwhile (it doesn't take the lock, and row
  -- locks don't stop inserts); it must stay pending, not be hidden unseen
  -- (Codex review).
  with ranked as (
    select id, row_number() over (partition by kind order by likes desc nulls last, post_id asc) as r
      from trending_posts where id = any (v_week) and id = any (p_ids)
  )
  update trending_posts t set status = 'live', rank = ranked.r, updated_at = now()
    from ranked where t.id = ranked.id;
  get diagnostics live = row_count;
  update trending_posts set status = 'hidden', rank = null, updated_at = now()
   where id = any (v_week) and not (id = any (p_ids));
  get diagnostics hidden = row_count;
  return next;
end
$$;

revoke all on function public.publish_trending_week(date, uuid[], uuid[], integer) from public, anon, authenticated;
grant execute on function public.publish_trending_week(date, uuid[], uuid[], integer) to service_role;

commit;
