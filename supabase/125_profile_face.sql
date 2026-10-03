-- 125_profile_face.sql — a profile picture and a website name of your own (Oct 2).
--
-- Owner, Oct 2: users choose their "profile image and website name", and
-- soon they will publish work and join online games, so both will be seen by
-- other people. They live on the existing profiles columns (avatar_url,
-- display_name), and from now on only /api/profile/face writes them, after
-- OpenAI's moderation check passes. Two changes:
--
--   1. A public storage bucket, avatars, for uploaded pictures and copies of
--      sign-in photos: <user id>/<name>.webp, 256 px squares, written only
--      with the service key (no storage policy lets a browser write here).
--      Public on purpose: a stored signed URL dies in 24 hours (pitfall 11),
--      and a picture meant to be seen by others needs a lasting one.
--
--   2. The browser stops writing profiles. 05 granted owner insert/update
--      through RLS, so any signed-in browser could set its own display_name
--      or avatar_url to anything and skip the check. Nothing in the app
--      writes profiles from the browser any more: the name and picture go
--      through /api/profile/face, language/country/last seen through
--      /api/credits/ensure-daily (service key), new rows through
--      handle_new_user (security definer). Revoking the table privilege also
--      revokes any column privilege on it. The owner-read policy (102) stays,
--      so a browser still reads its own row.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over.
--
-- Verify after running (all four should be false, then true):
--   select has_table_privilege('authenticated', 'public.profiles', 'update'),
--          has_table_privilege('authenticated', 'public.profiles', 'insert'),
--          has_table_privilege('anon', 'public.profiles', 'update'),
--          has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update');
--   select public from storage.buckets where id = 'avatars';

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 524288, allowed_mime_types = array['image/webp'];

revoke insert, update, delete on table public.profiles from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
