-- =============================================================
-- ModelXD Storage Setup
-- Run this in Supabase SQL Editor
-- =============================================================

-- =============================================================
-- STEP 1: Create 8 buckets
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- XDuel — public
  ('xduel-ai-images',    'xduel-ai-images',    true,  10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('xduel-ai-videos',    'xduel-ai-videos',    true,  52428800,  array['video/mp4','video/webm','video/quicktime']),
  ('xduel-user-images',  'xduel-user-images',  true,  10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('xduel-user-videos',  'xduel-user-videos',  true,  524288000, array['video/mp4','video/webm','video/quicktime','video/mov']),
  -- Create — private
  ('create-ai-images',   'create-ai-images',   false, 10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('create-ai-videos',   'create-ai-videos',   false, 52428800,  array['video/mp4','video/webm','video/quicktime']),
  ('create-user-images', 'create-user-images', false, 10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('create-user-videos', 'create-user-videos', false, 524288000, array['video/mp4','video/webm','video/quicktime','video/mov'])
on conflict (id) do nothing;


-- =============================================================
-- Drop existing policies (safe to re-run)
-- =============================================================

drop policy if exists "xduel-ai-images: public read" on storage.objects;
drop policy if exists "xduel-ai-videos: public read" on storage.objects;
drop policy if exists "xduel-user-images: public read" on storage.objects;
drop policy if exists "xduel-user-images: owner insert" on storage.objects;
drop policy if exists "xduel-user-images: owner delete" on storage.objects;
drop policy if exists "xduel-user-videos: public read" on storage.objects;
drop policy if exists "xduel-user-videos: owner insert" on storage.objects;
drop policy if exists "xduel-user-videos: owner delete" on storage.objects;
drop policy if exists "create-ai-images: owner read" on storage.objects;
drop policy if exists "create-ai-videos: owner read" on storage.objects;
drop policy if exists "create-user-images: owner read" on storage.objects;
drop policy if exists "create-user-images: owner insert" on storage.objects;
drop policy if exists "create-user-images: owner delete" on storage.objects;
drop policy if exists "create-user-videos: owner read" on storage.objects;
drop policy if exists "create-user-videos: owner insert" on storage.objects;
drop policy if exists "create-user-videos: owner delete" on storage.objects;


-- =============================================================
-- STEP 2: RLS Policies
-- =============================================================

-- -------------------------------------------------------------
-- xduel-ai-*  public read, server (service role) writes
-- -------------------------------------------------------------

create policy "xduel-ai-images: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-ai-images' );

create policy "xduel-ai-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-ai-videos' );


-- -------------------------------------------------------------
-- xduel-user-*  public read, authenticated users write own folder
-- -------------------------------------------------------------

create policy "xduel-user-images: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-user-images' );

create policy "xduel-user-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'xduel-user-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xduel-user-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xduel-user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xduel-user-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-user-videos' );

create policy "xduel-user-videos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'xduel-user-videos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xduel-user-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xduel-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- create-ai-*  owner read, server (service role) writes
-- Files stored as userId/filename so owner filter works
-- -------------------------------------------------------------

create policy "create-ai-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-ai-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-ai-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-ai-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- create-user-*  owner read/write, signed URL for sharing
-- -------------------------------------------------------------

create policy "create-user-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-user-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'create-user-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-user-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'create-user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-user-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-user-videos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'create-user-videos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-user-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'create-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
