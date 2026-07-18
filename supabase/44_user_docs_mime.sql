-- 44_user_docs_mime.sql
-- Allow PDF + plain-text uploads to the user-attachment buckets so XDuel
-- (and XCreate) text mode can accept documents. Previously these buckets
-- only permitted image MIME types, which silently rejected PDF uploads.
--
-- No new buckets or RLS policies are needed — the existing
-- "owner insert" policies only require an authenticated user, and
-- attachments still land under originals/<uuid>.<ext> as before. PDFs
-- simply reuse the *-user-images bucket (name is a slight misnomer but
-- avoids a second bucket + policy set).
--
-- Run once in the Supabase SQL editor.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf','text/plain'
]
where id in ('xduel-user-images', 'xcreate-user-images');
