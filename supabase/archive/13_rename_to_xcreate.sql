-- ModelXD: rename "create" → "xcreate"
--
-- Aligns the studio feature with the X-prefixed family (XDuel, XCreate).
-- This rename is safe because no users are on the old URLs yet — we're
-- not adding compatibility views or redirects.
--
-- Affected tables:
--   creates          → xcreates
--   create_jobs      → xcreate_jobs
--   create_job_slots → xcreate_job_slots
--
-- Renames covered:
--   - table names (preserves data, PKs, FKs, indexes, RLS policies)
--   - index names (cosmetic but avoids future grep confusion)
--   - RLS policy names (labels only; the rules themselves are unchanged)
--   - trigger + function names
--
-- Idempotent: uses `alter ... rename to` which fails loudly if the source
-- doesn't exist, but guarded by `do $$ ... $$` blocks that check pg_class
-- first so re-running after partial application is safe.

begin;

-- ── Rename tables ─────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_class where relname = 'creates' and relkind = 'r') then
    execute 'alter table creates rename to xcreates';
  end if;
  if exists (select 1 from pg_class where relname = 'create_jobs' and relkind = 'r') then
    execute 'alter table create_jobs rename to xcreate_jobs';
  end if;
  if exists (select 1 from pg_class where relname = 'create_job_slots' and relkind = 'r') then
    execute 'alter table create_job_slots rename to xcreate_job_slots';
  end if;
end $$;

-- ── Rename xcreate_jobs.create_id → xcreate_id ───────────────────────────
-- This column points at the finished row in xcreates. Renamed to match
-- the new parent table.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'xcreate_jobs' and column_name = 'create_id'
  ) then
    execute 'alter table xcreate_jobs rename column create_id to xcreate_id';
  end if;
end $$;

-- ── Rename indexes ────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_class where relname = 'creates_user_id_idx' and relkind = 'i') then
    execute 'alter index creates_user_id_idx rename to xcreates_user_id_idx';
  end if;
  if exists (select 1 from pg_class where relname = 'creates_created_at_idx' and relkind = 'i') then
    execute 'alter index creates_created_at_idx rename to xcreates_created_at_idx';
  end if;
  if exists (select 1 from pg_class where relname = 'create_jobs_user_status_idx' and relkind = 'i') then
    execute 'alter index create_jobs_user_status_idx rename to xcreate_jobs_user_status_idx';
  end if;
  if exists (select 1 from pg_class where relname = 'create_jobs_created_at_idx' and relkind = 'i') then
    execute 'alter index create_jobs_created_at_idx rename to xcreate_jobs_created_at_idx';
  end if;
  if exists (select 1 from pg_class where relname = 'create_job_slots_job_idx' and relkind = 'i') then
    execute 'alter index create_job_slots_job_idx rename to xcreate_job_slots_job_idx';
  end if;
end $$;

-- ── Rename RLS policies ───────────────────────────────────────────────────
-- Policy names are labels; the underlying rules (owner read/insert/etc.)
-- stay bound to the renamed tables automatically. We rename them so logs
-- and the Supabase dashboard read cleanly.

do $$
begin
  -- xcreates policies
  if exists (select 1 from pg_policies where tablename = 'xcreates' and policyname = 'creates: owner read') then
    execute 'alter policy "creates: owner read" on xcreates rename to "xcreates: owner read"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreates' and policyname = 'creates: owner insert') then
    execute 'alter policy "creates: owner insert" on xcreates rename to "xcreates: owner insert"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreates' and policyname = 'creates: owner delete') then
    execute 'alter policy "creates: owner delete" on xcreates rename to "xcreates: owner delete"';
  end if;

  -- xcreate_jobs policies
  if exists (select 1 from pg_policies where tablename = 'xcreate_jobs' and policyname = 'create_jobs: owner read') then
    execute 'alter policy "create_jobs: owner read" on xcreate_jobs rename to "xcreate_jobs: owner read"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreate_jobs' and policyname = 'create_jobs: owner insert') then
    execute 'alter policy "create_jobs: owner insert" on xcreate_jobs rename to "xcreate_jobs: owner insert"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreate_jobs' and policyname = 'create_jobs: owner update') then
    execute 'alter policy "create_jobs: owner update" on xcreate_jobs rename to "xcreate_jobs: owner update"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreate_jobs' and policyname = 'create_jobs: owner delete') then
    execute 'alter policy "create_jobs: owner delete" on xcreate_jobs rename to "xcreate_jobs: owner delete"';
  end if;

  -- xcreate_job_slots policies
  if exists (select 1 from pg_policies where tablename = 'xcreate_job_slots' and policyname = 'create_job_slots: owner read') then
    execute 'alter policy "create_job_slots: owner read" on xcreate_job_slots rename to "xcreate_job_slots: owner read"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreate_job_slots' and policyname = 'create_job_slots: owner insert') then
    execute 'alter policy "create_job_slots: owner insert" on xcreate_job_slots rename to "xcreate_job_slots: owner insert"';
  end if;
  if exists (select 1 from pg_policies where tablename = 'xcreate_job_slots' and policyname = 'create_job_slots: owner update') then
    execute 'alter policy "create_job_slots: owner update" on xcreate_job_slots rename to "xcreate_job_slots: owner update"';
  end if;
end $$;

-- ── Rename the touch_updated_at trigger + its function ───────────────────
-- Triggers are renamed on their (now renamed) table; the shared function
-- touch_create_jobs_updated_at is renamed to touch_xcreate_jobs_updated_at.

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'create_jobs_touch') then
    execute 'alter trigger create_jobs_touch on xcreate_jobs rename to xcreate_jobs_touch';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'create_job_slots_touch') then
    execute 'alter trigger create_job_slots_touch on xcreate_job_slots rename to xcreate_job_slots_touch';
  end if;
  if exists (select 1 from pg_proc where proname = 'touch_create_jobs_updated_at') then
    execute 'alter function touch_create_jobs_updated_at() rename to touch_xcreate_jobs_updated_at';
  end if;
end $$;

-- ── Rename storage buckets ───────────────────────────────────────────────
-- Supabase storage uses storage.buckets.id as the bucket name in all API
-- calls. storage.objects.bucket_id references storage.buckets.id via an FK.
--
-- Supabase installs a `storage.protect_delete()` trigger that blocks DELETE
-- on storage tables from SQL — you have to go through the Storage API /
-- dashboard for that. So this migration does only what SQL is allowed to do:
--   1. Ensure the destination bucket row exists (cloning config from source).
--   2. Re-point storage.objects.bucket_id rows from source → destination.
--
-- After the migration, the OLD buckets (create-ai-images, create-ai-videos,
-- create-user-images, create-user-videos) will still exist but be empty.
-- Delete them manually via the Supabase Dashboard → Storage → bucket → ⋯ → Delete.
-- This is a one-time cleanup — once done, re-running this migration is still
-- safe because the `if not exists` guards make every step idempotent.
--
-- The physical objects (bytes in S3/Storage) are keyed by (bucket_id, name)
-- — re-pointing the bucket_id column in the metadata row is what moves the
-- object's logical location. On hosted Supabase this is the supported way to
-- rename a bucket.

do $$
declare
  rename_map text[][] := array[
    array['create-ai-images',   'xcreate-ai-images'],
    array['create-ai-videos',   'xcreate-ai-videos'],
    array['create-user-images', 'xcreate-user-images'],
    array['create-user-videos', 'xcreate-user-videos']
  ];
  pair text[];
begin
  foreach pair slice 1 in array rename_map loop
    -- Skip if the source bucket doesn't exist.
    if not exists (select 1 from storage.buckets where id = pair[1]) then
      continue;
    end if;

    -- Ensure the destination bucket exists, cloning the source's config.
    if not exists (select 1 from storage.buckets where id = pair[2]) then
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      select pair[2], pair[2], public, file_size_limit, allowed_mime_types
      from storage.buckets where id = pair[1];
    end if;

    -- Move all object metadata rows to the new bucket (idempotent: no-op once
    -- the source bucket has zero objects).
    update storage.objects set bucket_id = pair[2] where bucket_id = pair[1];

    -- NOTE: we cannot `delete from storage.buckets` — Supabase blocks it.
    -- Leave the empty source bucket and delete it via the Dashboard.
  end loop;
end $$;

-- Rename the storage.objects policies by dropping+recreating. Postgres
-- doesn't allow ALTER POLICY to change the USING/WITH CHECK clause, and
-- these reference the bucket_id string literal. The new policies mirror
-- supabase/storage.sql exactly.

drop policy if exists "create-ai-images: owner read"   on storage.objects;
drop policy if exists "create-ai-videos: owner read"   on storage.objects;
drop policy if exists "create-user-images: owner read"   on storage.objects;
drop policy if exists "create-user-images: owner insert" on storage.objects;
drop policy if exists "create-user-images: owner delete" on storage.objects;
drop policy if exists "create-user-videos: owner read"   on storage.objects;
drop policy if exists "create-user-videos: owner insert" on storage.objects;
drop policy if exists "create-user-videos: owner delete" on storage.objects;

-- Re-running supabase/storage.sql will recreate the xcreate-* policies
-- with the new bucket_id literals. Do that after applying this migration.

commit;
