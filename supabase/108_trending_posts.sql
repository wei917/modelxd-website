-- supabase/108_trending_posts.sql — the "Trending on social media" list.
--
-- XCreate's Studio and Templates tabs show the week's most-liked AI videos
-- (and later images) whose creators shared the prompt, as each platform's own
-- embed. Owner, Sep 26: the list lives in a table so a new week goes live
-- without a deploy; it keeps the top 20 per kind per week; and it must hold
-- images and other platforms (Instagram, Threads, Facebook) as well as X
-- video. `platform` is plain text on purpose, so adding one needs no
-- migration; the code decides how to embed it.
--
-- One row per post. `kind` is the XCreate mode that shows it. `models` are
-- the models the creator names (a post that names none doesn't belong here,
-- nor one made through an LLM agent). `likes` is the count when found, for
-- ranking only; the embed shows the live count. `summary` is our own one line
-- per site language {en, zh-Hant, zh-Hans, ja, ko}, never the creator's text.
-- `week` is the Monday of the week it trended; `rank` orders a week's live
-- posts of one kind. The weekly job will insert candidates as 'pending' and
-- the owner flips the chosen ones to 'live'; 'hidden' pulls one without
-- deleting it.
--
-- Read and written only by server code holding the service key, so RLS is on
-- with no policies and anon/authenticated are revoked: the public list goes
-- out through /api/trending, never through PostgREST (pitfall 16).
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

create table if not exists public.trending_posts (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null,                  -- 'x', 'instagram', 'threads', 'facebook', …
  post_id     text not null,                  -- the platform's own id
  handle      text not null,                  -- creator, without the @
  url         text not null,
  kind        text not null check (kind in ('video', 'image')),
  models      text[] not null default '{}',
  likes       integer,
  summary     jsonb not null default '{}'::jsonb,
  week        date not null,
  rank        smallint check (rank between 1 and 20),
  status      text not null default 'pending' check (status in ('pending', 'live', 'hidden')),
  found_by    text,                           -- 'grok_x_search', 'manual', …
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (platform, post_id)
);

create index if not exists trending_posts_live
  on public.trending_posts (kind, week desc, rank)
  where status = 'live';

alter table public.trending_posts enable row level security;
revoke all on public.trending_posts from public, anon, authenticated;

-- Week of Sep 21 (Grok x_search over Sep 19–26): the five X videos on the
-- first draft. Same rows as FALLBACK_TRENDING in app/xcreate/trending.ts.
insert into public.trending_posts (platform, post_id, handle, url, kind, models, likes, summary, week, rank, status, found_by) values
  ('x', '2103337966416621703', 'nawalsehar', 'https://x.com/nawalsehar/status/2103337966416621703', 'video',
   array['Seedance 2.5'], 3965, jsonb_build_object(
     'en',      $$A 30-second photoreal phone vlog: one rainy morning, from bed to the lecture hall.$$,
     'zh-Hant', $$30 秒寫實手機 vlog：一個下雨的早晨，從起床到走進教室。$$,
     'zh-Hans', $$30 秒写实手机 vlog：一个下雨的早晨，从起床到走进教室。$$,
     'ja',      $$30 秒のリアルなスマホ vlog。雨の朝、ベッドから講義室まで。$$,
     'ko',      $$30초 실사 스마트폰 브이로그. 비 오는 아침, 침대에서 강의실까지.$$),
   '2026-09-21', 1, 'live', 'grok_x_search'),
  ('x', '2102365054389899695', 'Scenario_gg', 'https://x.com/Scenario_gg/status/2102365054389899695', 'video',
   array['Seedance 2.5'], 3226, jsonb_build_object(
     'en',      $$One café scene re-shot from thirteen new camera angles, same performance and sound.$$,
     'zh-Hant', $$同一段咖啡館畫面，以十三個新機位重拍，表演和聲音完全不變。$$,
     'zh-Hans', $$同一段咖啡馆画面，以十三个新机位重拍，表演和声音完全不变。$$,
     'ja',      $$カフェの一場面を 13 の新しいカメラアングルで撮り直し。演技も音もそのまま。$$,
     'ko',      $$카페 장면 하나를 13가지 새 카메라 앵글로 다시 촬영. 연기와 소리는 그대로.$$),
   '2026-09-21', 2, 'live', 'grok_x_search'),
  ('x', '2102028142294483208', 'GlitterPixely', 'https://x.com/GlitterPixely/status/2102028142294483208', 'video',
   array['Midjourney', 'Seedance 2.5'], 1528, jsonb_build_object(
     'en',      $$A fantasy “getting ready on Monday” montage: an elf dragon-slayer’s morning routine.$$,
     'zh-Hant', $$奇幻版「週一出門準備」蒙太奇：精靈屠龍者的早晨日常。$$,
     'zh-Hans', $$奇幻版“周一出门准备”蒙太奇：精灵屠龙者的早晨日常。$$,
     'ja',      $$ファンタジー版「月曜の朝の身支度」モンタージュ。エルフのドラゴンスレイヤーの朝の日課。$$,
     'ko',      $$판타지판 '월요일 아침 준비' 몽타주. 엘프 드래곤 슬레이어의 아침 루틴.$$),
   '2026-09-21', 3, 'live', 'grok_x_search'),
  ('x', '2103329257149898940', 'AIwithkhan', 'https://x.com/AIwithkhan/status/2103329257149898940', 'video',
   array['Seedance 2.5'], 1042, jsonb_build_object(
     'en',      $$A 30-second home video of a slow Friday morning in an old Seoul neighborhood, the woman kept consistent from one reference photo.$$,
     'zh-Hant', $$30 秒家庭錄影風格：首爾老社區悠閒的週五早晨，以一張參考照鎖定人物外觀。$$,
     'zh-Hans', $$30 秒家庭录像风格：首尔老社区悠闲的周五早晨，用一张参考照锁定人物外观。$$,
     'ja',      $$ソウルの古い住宅街で過ごす金曜の朝を 30 秒のホームビデオ風に。参考写真 1 枚で人物の見た目を固定。$$,
     'ko',      $$서울 옛 동네의 여유로운 금요일 아침을 담은 30초 홈비디오. 참고 사진 한 장으로 인물 외형을 유지.$$),
   '2026-09-21', 4, 'live', 'grok_x_search'),
  ('x', '2103188197933187179', 'Mayz1169', 'https://x.com/Mayz1169/status/2103188197933187179', 'video',
   array['GPT Image 2', 'Seedance 2.5'], 940, jsonb_build_object(
     'en',      $$A 15-second anime chase in one unbroken shot: a character sheet from GPT Image 2, animated with Seedance 2.5.$$,
     'zh-Hant', $$15 秒一鏡到底的動畫追逐：先用 GPT Image 2 做角色設定圖，再用 Seedance 2.5 動起來。$$,
     'zh-Hans', $$15 秒一镜到底的动画追逐：先用 GPT Image 2 做角色设定图，再用 Seedance 2.5 动起来。$$,
     'ja',      $$ワンカットで描く 15 秒のアニメ追走劇。GPT Image 2 で作ったキャラクターシートを Seedance 2.5 でアニメ化。$$,
     'ko',      $$끊김 없는 원테이크 15초 애니메이션 추격전. GPT Image 2로 만든 캐릭터 시트를 Seedance 2.5로 움직였습니다.$$),
   '2026-09-21', 5, 'live', 'grok_x_search')
on conflict (platform, post_id) do nothing;

commit;

-- Check after running (should be false: nobody reads the table but the server):
--   select has_table_privilege('anon', 'public.trending_posts', 'select');
