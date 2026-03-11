-- =============================================================
-- ModelXD Storage Buckets
-- Run this in Supabase SQL Editor
-- =============================================================

-- 1. ai-videos  — AI generated videos (public, server-written, auto-expiry via cron)
-- 2. ai-images  — AI generated images (public, server-written)
-- 3. user-images — User uploaded images (public CDN, owner-managed)
-- 4. user-videos — User uploaded videos (private by default, signed URLs for sharing)

-- -------------------------------------------------------------
-- Create buckets
-- -------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'ai-videos',
    'ai-videos',
    true,   -- public: AI output anyone can watch
    52428800, -- 50 MB
    array['video/mp4', 'video/webm', 'video/quicktime']
  ),
  (
    'ai-images',
    'ai-images',
    true,   -- public: AI output anyone can view
    10485760, -- 10 MB
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  ),
  (
    'user-images',
    'user-images',
    true,   -- public CDN: images are meant to be shared/embedded
    10485760, -- 10 MB
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  ),
  (
    'user-videos',
    'user-videos',
    false,  -- private: users control sharing via signed URLs
    524288000, -- 500 MB
    array['video/mp4', 'video/webm', 'video/quicktime', 'video/mov']
  )
on conflict (id) do nothing;


-- =============================================================
-- RLS Policies
-- =============================================================

-- -------------------------------------------------------------
-- ai-videos: server can write, everyone can read
-- -------------------------------------------------------------

create policy "ai-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'ai-videos' );

-- Only service role (server) can insert/delete — no user policy needed
-- (service role bypasses RLS)


-- -------------------------------------------------------------
-- ai-images: server can write, everyone can read
-- -------------------------------------------------------------

create policy "ai-images: public read"
  on storage.objects for select
  using ( bucket_id = 'ai-images' );

-- Only service role (server) can insert/delete — no user policy needed
-- (service role bypasses RLS)


-- -------------------------------------------------------------
-- user-images: owner can write, everyone can read
-- -------------------------------------------------------------

create policy "user-images: public read"
  on storage.objects for select
  using ( bucket_id = 'user-images' );

create policy "user-images: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'user-images'
    and auth.uid() is not null
    -- enforce path: userId/filename so users can't write into others' folders
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'user-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -------------------------------------------------------------
-- user-videos: owner can write/read, others need signed URL
-- -------------------------------------------------------------

create policy "user-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-videos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'user-videos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-videos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'user-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
