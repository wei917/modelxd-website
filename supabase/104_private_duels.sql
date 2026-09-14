-- supabase/104_private_duels.sql — the duels table stops being world-readable;
-- the public gets a view with only the public columns.
--
-- Since 02, `duels` was `for select using (true)`: every column of every row
-- to anyone holding the publishable key. Beyond what XVote shows, that was
-- the creator's user_id (groups one account's duels; since 102 it no longer
-- resolves to a name), attachment_id, vote1_model_id / vote2_model_id, and
-- deleted rows. Nothing needed the table itself: XVote, XBoard, voting, the
-- rating refit and the permalink all read with the service key. The one
-- browser reader of OTHER people's duels is /feed, which now reads the view.
-- Your own duels on /profile and in XCut's asset bin match on user_id and
-- keep working under the owner policy.
--
-- The view is deliberately NOT security_invoker: it runs as its owner
-- (postgres, the table's owner, who is not subject to the table's RLS), so
-- it shows every live duel to everyone. That is the point: a public window
-- whose columns are an explicit allow-list. Supabase's linter will call this
-- a "security definer view"; here that is the design. `slots` stays in the
-- view because /feed renders the model names on purpose (a revealed archive).
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Deploy the
-- code that reads `duels_public` AFTER this runs; until then /feed reads the
-- table and shows nothing.

begin;

create or replace view public.duels_public
  with (security_invoker = false)
as
  select id, mode, prompt, slots, vote1, vote2, community_vote_count,
         created_at, input_media, search
    from public.duels
   where deleted_at is null;

grant select on public.duels_public to anon, authenticated;

drop policy if exists "duels: public read" on public.duels;
drop policy if exists "duels: owner read"  on public.duels;
create policy "duels: owner read" on public.duels
  for select using (auth.uid() = user_id);

commit;

notify pgrst, 'reload schema';

-- Verify (read-only):
--   select policyname, cmd, qual from pg_policies
--    where schemaname = 'public' and tablename = 'duels' order by 1;
--   -- want: no SELECT policy with qual = 'true'
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'duels_public' order by ordinal_position;
--   -- want: no user_id, attachment_id, vote1_model_id, vote2_model_id, deleted_at
