-- supabase/136_xsports_room_media.sql — a picture or a short clip on an
-- X體育 room message (owner, Oct 15: "can she take selfie or someone take
-- photo of her 喊加油? or dancing?" → "and post the photos in the public
-- chat room").
--
--   xsports_room_messages.media_url    https link to the picture or clip
--   xsports_room_messages.media_kind   'image' | 'video'
--
-- Only the server writes messages (service role); anyone may read the two
-- new columns, like the message's other public columns (131), so Realtime
-- delivers them to open rooms. Today only 晴晴 posts them, from her
-- reviewed set (lib/xsports-cheer-media.ts). Until this runs she posts
-- words only. Safe to re-run. Run by hand. Dev and prod share this database.

begin;

alter table public.xsports_room_messages add column if not exists media_url text
  check (media_url is null or media_url ~ '^https://');
alter table public.xsports_room_messages add column if not exists media_kind text
  check (media_kind is null or media_kind in ('image', 'video'));

grant select (media_url, media_kind) on public.xsports_room_messages to anon, authenticated;

commit;

-- Check after running: the publishable key can select media_url and
-- media_kind on xsports_room_messages, still gets 42501 on user_id and on
-- insert; the service key inserts a row with media_kind 'gif' and gets
-- 23514 (nothing stored).
