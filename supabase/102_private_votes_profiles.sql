-- supabase/102_private_votes_profiles.sql — votes and profiles stop being
-- world-readable, and MBTI stops publishing its prompts.
--
-- Probed live Sep 14 with nothing but the publishable key, the one every
-- browser holds:
--   duel_votes   every vote, with the voter's user_id
--   profiles     every user's display_name, bio, language, country, last_seen_at
-- Joined, that is who voted for what, from which country, and when they were
-- last online. The notice on /profile and Privacy Policy §3 both promise that
-- votes are private.
--
-- Nothing in the app needed that access. Every BROWSER read of these tables is
-- the signed-in user's own row (app/profile/page.tsx, app/xduel/[id]/page.tsx,
-- the profile update in app/auth/callback). Every read of anyone else's row
-- goes through an API route holding the service key (xvote/feed,
-- xduel/community-vote, xduel/view, credits/ensure-daily), which bypasses RLS.
--
-- mbti_results is different. Model results are public on purpose (88), and all
-- 24 live rows are model rows with no user_id. What should not be public is
-- the system and format prompts. A table-level SELECT grant covers every
-- column, so it is revoked and granted back column by column, minus those two.
-- Any future client insert must ask for explicit columns back, not `*`.
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

-- ── 1. duel_votes: you see your own votes; nobody sees anyone else's ───────
drop policy if exists "duel_votes: public read" on public.duel_votes;
drop policy if exists "duel_votes: owner read"  on public.duel_votes;
create policy "duel_votes: owner read" on public.duel_votes
  for select using (auth.uid() = user_id);

-- ── 2. profiles: you read your own profile, and only yours ──────────────────
drop policy if exists "profiles: public read" on public.profiles;
drop policy if exists "profiles: owner read"  on public.profiles;
create policy "profiles: owner read" on public.profiles
  for select using (auth.uid() = id);

-- ── 3. mbti_results: results stay published, the prompts do not ────────────
revoke select on public.mbti_results from public, anon, authenticated;
grant select (id, subject_kind, model_name, display_name, provider, effort, user_id,
              run_index, mbti_type, tally, answers, cost_usd, question_set, created_at)
  on public.mbti_results to anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Verify (read-only):
--   select tablename, policyname, cmd, qual from pg_policies
--    where schemaname = 'public' and tablename in ('profiles', 'duel_votes', 'mbti_results')
--    order by 1, 2;
--   -- want: no SELECT policy with qual = 'true' on profiles or duel_votes
--   select has_column_privilege('anon', 'public.mbti_results', 'system_prompt', 'select') as prompt_public,  -- want false
--          has_column_privilege('anon', 'public.mbti_results', 'mbti_type',     'select') as result_public;  -- want true
