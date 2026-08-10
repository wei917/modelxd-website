-- 79_files_bucket.sql
-- One bucket for every NON-MEDIA upload (owner, Aug 10: "xcreate-user-files").
-- The boundary is serving behavior, not file type: images/videos get resize
-- and preview pipelines and keep their buckets; PDFs, audio, plain text and
-- whatever future document types arrive are opaque model inputs and live
-- here. Ends the misnomer of audio/PDF sitting in xcreate-user-images.
--
-- HISTORY IS UNTOUCHED: existing PDF/text objects stay in
-- xcreate-user-images and their stored attachment rows keep working —
-- reads are signed server-side from the stored bucket name, and MIME
-- allowlists apply only to uploads. Only NEW uploads route here.
-- (One historical audio object also remains there: the first Audio→Text
-- test upload, Aug 10. Its run references that path; leave it.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'xcreate-user-files', 'xcreate-user-files', false, 52428800,
  array['application/pdf','text/plain',
        'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac',
        'audio/wav','audio/x-wav','audio/webm','audio/flac','audio/ogg']
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "xcreate-user-files: owner read"   on storage.objects;
drop policy if exists "xcreate-user-files: owner insert" on storage.objects;
drop policy if exists "xcreate-user-files: owner delete" on storage.objects;

create policy "xcreate-user-files: owner read"
  on storage.objects for select
  using (
    bucket_id = 'xcreate-user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "xcreate-user-files: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'xcreate-user-files'
    and auth.uid() is not null
  );

create policy "xcreate-user-files: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'xcreate-user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The images bucket returns to its EXACT pre-audio allowlist. PDF/text
-- stay on it DELIBERATELY: prod's older code still uploads PDFs there
-- until the next deploy, and dev/prod share this database — stripping
-- them here would break prod's document features mid-flight. Once the
-- new routing is deployed everywhere, an optional later migration can
-- make this bucket strictly images.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/gif',
                                  'image/webp','application/pdf','text/plain']
 where id = 'xcreate-user-images';
