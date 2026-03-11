-- =============================================================
-- Cleanup: drop existing policies and buckets (safe to re-run)
-- =============================================================

-- Drop policies
drop policy if exists "xduel-images: public read"  on storage.objects;
drop policy if exists "xduel-videos: public read"  on storage.objects;
drop policy if exists "create-images: owner read"   on storage.objects;
drop policy if exists "create-images: owner insert" on storage.objects;
drop policy if exists "create-images: owner delete" on storage.objects;
drop policy if exists "create-videos: owner read"   on storage.objects;
drop policy if exists "create-videos: owner insert" on storage.objects;
drop policy if exists "create-videos: owner delete" on storage.objects;

-- Also clean up any old bucket names from previous versions
drop policy if exists "ai-videos: public read"    on storage.objects;
drop policy if exists "ai-images: public read"    on storage.objects;
drop policy if exists "user-images: public read"  on storage.objects;
drop policy if exists "user-images: owner insert" on storage.objects;
drop policy if exists "user-images: owner delete" on storage.objects;
drop policy if exists "user-videos: owner read"   on storage.objects;
drop policy if exists "user-videos: owner insert" on storage.objects;
drop policy if exists "user-videos: owner delete" on storage.objects;

-- Delete all files then drop buckets
delete from storage.objects where bucket_id in ('xduel-images','xduel-videos','create-images','create-videos','ai-videos','ai-images','user-images','user-videos','videos');
delete from storage.buckets  where id          in ('xduel-images','xduel-videos','create-images','create-videos','ai-videos','ai-images','user-images','user-videos','videos');


-- =============================================================
-- ModelXD Storage Buckets
-- Run this in Supabase SQL Editor
-- =============================================================

-- XDuel mode  — public benchmark battles, anyone can view results
-- Create mode — private user creations, owner-controlled sharing

-- 1. xduel-images  — AI generated images from XDuel (public)
-- 2. xduel-videos  — AI generated videos from XDuel (public)
-- 3. create-images — Images in Create mode: AI output + user uploads (private)
-- 4. create-videos — Videos in Create mode: AI output + user uploads (private)

-- -------------------------------------------------------------
-- Create buckets
-- -------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'xduel-images',
    'xduel-images',
    true,   -- public: battle results anyone can view/share
    10485760, -- 10 MB
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  ),
  (
    'xduel-videos',
    'xduel-videos',
    true,   -- public: battle results anyone can view/share
    52428800, -- 50 MB
    array['video/mp4', 'video/webm', 'video/quicktime']
  ),
  (
    'create-images',
    'create-images',
    false,  -- private: user's own creations
    10485760, -- 10 MB
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  ),
  (
    'create-videos',
    'create-videos',
    false,  -- private: user's own creations
    524288000, -- 500 MB
    array['video/mp4', 'video/webm', 'video/quicktime', 'video/mov']
  )
on conflict (id) do nothing;


-- =============================================================
-- RLS Policies
-- =============================================================

-- -------------------------------------------------------------
-- xduel-images / xduel-videos: public read, server writes
-- -------------------------------------------------------------

create policy "xduel-images: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-images' );

create policy "xduel-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-videos' );

-- Server (service role) writes — no user insert policy needed


-- -------------------------------------------------------------
-- create-images: owner read/write, signed URL for sharing
-- -------------------------------------------------------------

create policy "create-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'create-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'create-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- create-videos: owner read/write, signed URL for sharing
-- -------------------------------------------------------------

create policy "create-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-videos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'create-videos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "create-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'create-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
