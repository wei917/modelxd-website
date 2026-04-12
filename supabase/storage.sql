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
  -- XCreate — private
  ('xcreate-ai-images',   'xcreate-ai-images',   false, 10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('xcreate-ai-videos',   'xcreate-ai-videos',   false, 52428800,  array['video/mp4','video/webm','video/quicktime']),
  ('xcreate-user-images', 'xcreate-user-images', false, 10485760,  array['image/jpeg','image/png','image/gif','image/webp']),
  ('xcreate-user-videos', 'xcreate-user-videos', false, 524288000, array['video/mp4','video/webm','video/quicktime','video/mov'])
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
drop policy if exists "xcreate-ai-images: owner read" on storage.objects;
drop policy if exists "xcreate-ai-videos: owner read" on storage.objects;
drop policy if exists "xcreate-user-images: owner read" on storage.objects;
drop policy if exists "xcreate-user-images: owner insert" on storage.objects;
drop policy if exists "xcreate-user-images: owner delete" on storage.objects;
drop policy if exists "xcreate-user-videos: owner read" on storage.objects;
drop policy if exists "xcreate-user-videos: owner insert" on storage.objects;
drop policy if exists "xcreate-user-videos: owner delete" on storage.objects;


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
  );

create policy "xduel-user-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xduel-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- xcreate-ai-*  owner read, server (service role) writes
-- Files stored as userId/filename so owner filter works
-- -------------------------------------------------------------

create policy "xcreate-ai-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'xcreate-ai-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xcreate-ai-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'xcreate-ai-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- xcreate-user-*  owner read/write, signed URL for sharing
-- -------------------------------------------------------------

create policy "xcreate-user-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'xcreate-user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xcreate-user-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'xcreate-user-images'
    and auth.uid() is not null
  );

create policy "xcreate-user-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xcreate-user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xcreate-user-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'xcreate-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xcreate-user-videos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'xcreate-user-videos'
    and auth.uid() is not null
  );

create policy "xcreate-user-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xcreate-user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Avatars bucket (public) ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "avatars: public read"   on storage.objects;
drop policy if exists "avatars: owner insert"  on storage.objects;
drop policy if exists "avatars: owner update"  on storage.objects;
drop policy if exists "avatars: owner delete"  on storage.objects;

create policy "avatars: public read"
  on storage.objects for select using ( bucket_id = 'avatars' );

create policy "avatars: owner insert"
  on storage.objects for insert
  with check ( bucket_id = 'avatars' and auth.uid() is not null );

create policy "avatars: owner update"
  on storage.objects for update
  using ( bucket_id = 'avatars' and auth.uid() is not null );

create policy "avatars: owner delete"
  on storage.objects for delete
  using ( bucket_id = 'avatars' and auth.uid() is not null );
