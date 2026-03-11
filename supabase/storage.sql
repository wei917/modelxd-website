-- =============================================================
-- ModelXD Storage Policies
-- 
-- STEP 1: Create these 8 buckets manually in Supabase Dashboard > Storage:
--
--   XDuel (public)
--   ├── xduel-ai-images      public  10MB   image/*
--   ├── xduel-ai-videos      public  50MB   video/*
--   ├── xduel-user-images    public  10MB   image/*
--   └── xduel-user-videos    public  500MB  video/*
--
--   Create (private)
--   ├── create-ai-images     private 10MB   image/*
--   ├── create-ai-videos     private 50MB   video/*
--   ├── create-user-images   private 10MB   image/*
--   └── create-user-videos   private 500MB  video/*
--
-- STEP 2: Run this file in Supabase SQL Editor (policies only)
-- =============================================================


-- =============================================================
-- XDUEL — public buckets
-- AI output: server writes, everyone reads
-- User uploads: authenticated users write, everyone reads
-- =============================================================

-- xduel-ai-images
create policy "xduel-ai-images: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-ai-images' );
-- server (service role) writes — no insert policy needed

-- xduel-ai-videos
create policy "xduel-ai-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-ai-videos' );
-- server (service role) writes — no insert policy needed

-- xduel-user-images
create policy "xduel-user-images: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-user-images' );

create policy "xduel-user-images: auth insert"
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

-- xduel-user-videos
create policy "xduel-user-videos: public read"
  on storage.objects for select
  using ( bucket_id = 'xduel-user-videos' );

create policy "xduel-user-videos: auth insert"
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


-- =============================================================
-- CREATE — private buckets
-- AI output: server writes, owner reads
-- User uploads: owner writes and reads, signed URL for sharing
-- =============================================================

-- create-ai-images
create policy "create-ai-images: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-ai-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- server (service role) writes — no insert policy needed

-- create-ai-videos
create policy "create-ai-videos: owner read"
  on storage.objects for select
  using (
    bucket_id = 'create-ai-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- server (service role) writes — no insert policy needed

-- create-user-images
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

-- create-user-videos
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
