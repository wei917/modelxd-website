-- 142_duel_recipe.sql — video duels by kind of task (owner, Oct 19: "break
-- video xduel into detailed areas, ex: start frame, ... start+end frame,
-- reference frame, text, music"). Two additive pieces:
--
-- 1. duels.recipe: which kind of video task the duel was (lib/xduel-recipes.ts):
--    text_to_video, image_to_video (首幀), start_end_frames (首尾幀),
--    reference_frames (參考圖), video_to_video (改編影片), audio_to_video
--    (配樂/對嘴). The vote feed follows the chosen one, and XBoard can rank
--    video per kind once there are enough votes. Null for every duel before
--    this one and for text / image / speech duels. A shape check rather than
--    a list, so a new kind is a code change, not another migration.
--
-- 2. The xduel-user-audio bucket: the song or voice clip a 配樂/對嘴 duel is
--    made from. Public like the other XDuel upload buckets (duels are public
--    and voters hear the input), audio only, 25 MB (the page trims to 15 s
--    of WAV, ~2.6 MB). Signed-in users upload into their own folder
--    (<user id>/originals/...) and may delete their own files; there is NO
--    select policy, so the bucket cannot be listed: a public bucket serves
--    its files by address without one.
--
-- Until this runs, the duel route saves without `recipe` and the feed reads
-- without it (both retry once without the column). Run by hand in the
-- Supabase SQL editor (dev + prod share the project).

alter table public.duels add column if not exists recipe text;

alter table public.duels drop constraint if exists duels_recipe_check;
alter table public.duels add constraint duels_recipe_check
  check (recipe is null or recipe ~ '^[a-z][a-z_]{2,39}$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'xduel-user-audio', 'xduel-user-audio', true, 26214400,
  array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3',
        'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/flac']
)
on conflict (id) do nothing;

drop policy if exists "xduel-user-audio: owner insert" on storage.objects;
create policy "xduel-user-audio: owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'xduel-user-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "xduel-user-audio: owner delete" on storage.objects;
create policy "xduel-user-audio: owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'xduel-user-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Checks after running:
--   select id, public, file_size_limit from storage.buckets where id = 'xduel-user-audio';
--   update public.duels set recipe = 'Bad Value' where false;  -- shape check exists
--   an anonymous list of the bucket returns nothing; a WAV uploaded by a
--   signed-in user to <their id>/originals/x.wav is served at its public URL.
