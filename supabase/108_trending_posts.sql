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
-- `prompt` is the creator's own shared prompt and `preset` what the "Use this
-- preset" button applies in XCreate (model_name, recipe, duration, aspect,
-- whether the user must add a picture); a post without one gets no button.
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
  prompt      text,                           -- the creator's shared prompt, for the preset button
  preset      jsonb,                          -- {model, recipe, duration?, aspect?, needsImage?}; null = no button
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
-- first draft. Generated from app/xcreate/trending-seed.json, the route's
-- fallback, so the two cannot drift.
insert into public.trending_posts (platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank, status, found_by) values
  ('x', '2103337966416621703', 'nawalsehar', 'https://x.com/nawalsehar/status/2103337966416621703', 'video',
   array['Seedance 2.5'], 3965,
   $tp${"en":"A 30-second photoreal phone vlog: one rainy morning, from bed to the lecture hall.","zh-Hant":"30 秒寫實手機 vlog：一個下雨的早晨，從起床到走進教室。","zh-Hans":"30 秒写实手机 vlog：一个下雨的早晨，从起床到走进教室。","ja":"30 秒のリアルなスマホ vlog。雨の朝、ベッドから講義室まで。","ko":"30초 실사 스마트폰 브이로그. 비 오는 아침, 침대에서 강의실까지."}$tp$::jsonb,
   $tp$Create a 30-second ultra-photorealistic live-action university vlog of a European brunette in her mid-20s waking to a rainy morning, making coffee, getting ready, grabbing her umbrella, walking through a wet city, and arriving at university just before class.

Modern smartphone vlog style: natural handheld movement, subtle shake, autofocus changes, realistic rain, puddles, reflections, traffic, umbrellas, wet clothing, natural expressions and believable human movement.

Dialogue: “Good morning… apparently, it’s raining.” → “First coffee. Then lecture.” → “Two minutes early. I’m impressed.” → “Okay, made it.”

Natural diegetic audio only. No music, narration, CGI look, artificial rain, face changes, distorted anatomy, impossible physics, subtitles, logos or watermark.

16:9 • 24fps • 4K • Ultra-photorealistic live action$tp$,
   $tp${"model":"seedance2_5","recipe":"text_to_video","duration":30,"aspect":"16:9"}$tp$::jsonb,
   '2026-09-21', 1, 'live', 'grok_x_search'),
  ('x', '2102365054389899695', 'Scenario_gg', 'https://x.com/Scenario_gg/status/2102365054389899695', 'video',
   array['Seedance 2.5'], 3226,
   $tp${"en":"One café scene re-shot from thirteen new camera angles, same performance and sound.","zh-Hant":"同一段咖啡館畫面，以十三個新機位重拍，表演和聲音完全不變。","zh-Hans":"同一段咖啡馆画面，以十三个新机位重拍，表演和声音完全不变。","ja":"カフェの一場面を 13 の新しいカメラアングルで撮り直し。演技も音もそのまま。","ko":"카페 장면 하나를 13가지 새 카메라 앵글로 다시 촬영. 연기와 소리는 그대로."}$tp$::jsonb,
   null,
   null,
   '2026-09-21', 2, 'live', 'grok_x_search'),
  ('x', '2102028142294483208', 'GlitterPixely', 'https://x.com/GlitterPixely/status/2102028142294483208', 'video',
   array['Midjourney', 'Seedance 2.5'], 1528,
   $tp${"en":"A fantasy “getting ready on Monday” montage: an elf dragon-slayer’s morning routine.","zh-Hant":"奇幻版「週一出門準備」蒙太奇：精靈屠龍者的早晨日常。","zh-Hans":"奇幻版“周一出门准备”蒙太奇：精灵屠龙者的早晨日常。","ja":"ファンタジー版「月曜の朝の身支度」モンタージュ。エルフのドラゴンスレイヤーの朝の日課。","ko":"판타지판 '월요일 아침 준비' 몽타주. 엘프 드래곤 슬레이어의 아침 루틴."}$tp$::jsonb,
   $tp$UPLOAD MAP:
@Image 1 = Character A identity, face, hairstyle, outfit, fantasy animation style

30 seconds, 16:9, image-to-video, rapid morning-routine micro-cut montage.

[REF] Preserve @Image 1 as Character A: original white-haired elf dragon-slayer, pointed ears, pale hair, face smudges, feathered outfit, soft painterly fantasy animation. No franchise logos or recognizable game symbols.

[BEATS]
Cut 01, 0.0-1.2s: extreme close-up, her eyes snap open as a tiny smoking dragon-scale alarm charm rattles.
Cut 02, 1.2-2.2s: she slaps the charm silent without looking; a puff of scale-smoke.
Cut 03, 2.2-3.6s: she sits up and throws off a rough blanket; feathers on the outfit bounce.
Cut 04, 3.6-5.0s: water splash across her face, droplets catch dawn light.
Cut 05, 5.0-6.3s: she drags two quick war-paint smudges under her eyes.
Cut 06, 6.3-7.6s: she yanks her braid tight; feathers bounce.
Cut 07, 7.6-8.8s: boot hits the floor, buckle snaps shut.
Cut 08, 8.8-10.0s: second boot stamps down, shin strap yanks tight.
Cut 09, 10.0-11.3s: wrist wrap pulls tight between her teeth.
Cut 10, 11.3-12.6s: armor charm clicks onto her shoulder.
Cut 11, 12.6-14.0s: belt cinches, small hunting pouch snaps shut.
Cut 12, 14.0-15.6s: she grabs toast, takes one serious bite like it is battle prep.
Cut 13, 15.6-17.2s: a little map on the table singes at the dragon mark.
Cut 14, 17.2-18.6s: she taps the burned mark once and gives a small confirming nod.
Cut 15, 18.6-20.2s: she swings her weapon strap over her shoulder.
Cut 16, 20.2-21.8s: brief gleam across a plain blade edge, then it slides home. No markings.
Cut 17, 21.8-23.4s: feathered cloak settles; she grabs a small pack off a hook.
Cut 18, 23.4-25.2s: door bursts open into blinding sunrise.
Cut 19, 25.2-27.2s: she steps onto the threshold, dawn wind lifts a few feathers.
Cut 20, 27.2-30.0s: held heroic close-up, tiny determined smile, distant dragon shadow crosses the warm sky.

[CAMERA] Fast clean cuts, snappy close-ups, rostrum-style 2D push-ins and pans. No long slow holds except the final heroic frame. Name every cut as a hard cut, not a morph.

[LIGHT] warm dawn light, golden dust motes, soft painted rim light, cozy hut interior shifting to bright outdoor glow.

[AUDIO] No music, no dialogue, no subtitles.
Ambience: cozy wooden-hut morning room tone, then outdoor dawn wind.
SFX: <alarm rattle, slap, blanket rustle, water splash, braid tug, boot thud, buckle click, leather wrap pull, charm click, pouch snap, toast crunch, map sizzle, strap slap, blade sheath, door creak, distant dragon rumble>

[LOCK] keep her face, ears, hair, outfit logic, painterly style, and body scale stable across every cut; keep hands simple; no text; no logos; no recognizable game symbols.$tp$,
   $tp${"model":"seedance2_5","recipe":"image_to_video","duration":30,"aspect":"16:9","needsImage":true}$tp$::jsonb,
   '2026-09-21', 3, 'live', 'grok_x_search'),
  ('x', '2103329257149898940', 'AIwithkhan', 'https://x.com/AIwithkhan/status/2103329257149898940', 'video',
   array['Seedance 2.5'], 1042,
   $tp${"en":"A 30-second home video of a slow Friday morning in an old Seoul neighborhood, the woman kept consistent from one reference photo.","zh-Hant":"30 秒家庭錄影風格：首爾老社區悠閒的週五早晨，以一張參考照鎖定人物外觀。","zh-Hans":"30 秒家庭录像风格：首尔老社区悠闲的周五早晨，用一张参考照锁定人物外观。","ja":"ソウルの古い住宅街で過ごす金曜の朝を 30 秒のホームビデオ風に。参考写真 1 枚で人物の見た目を固定。","ko":"서울 옛 동네의 여유로운 금요일 아침을 담은 30초 홈비디오. 참고 사진 한 장으로 인물 외형을 유지."}$tp$::jsonb,
   $tp$Create a 30-second ultra-realistic personal home-video of a young Korean woman enjoying a relaxed Friday morning in an older Seoul residential neighborhood. Use the attached image as the character reference and keep her face, long black messy side ponytail, pastel-blue fitted top, loose cream pants, black sneakers, silver necklace, and overall appearance perfectly consistent.

She leaves her home with a cheerful expression and walks casually through the quiet neighborhood. She reaches a nearby outdoor water tap, stops, splashes cool water onto her face, wipes her face with her hands, smiles and continues walking.

She arrives at a small neighborhood shop and buys a colorful lollipop for herself. She unwraps it immediately, puts it in her mouth and happily enjoys the candy while walking through the street.

A few school children pass by carrying their backpacks. She smiles, waves at them and casually says, “Hello!” as they walk past.

She then approaches a newspaper seller outside a small local shop, picks up a newspaper, gives him a few coins, thanks him with a smile and starts walking back toward home while holding the newspaper.

Near the end, she looks toward the camera with a happy smile, still enjoying her lollipop, and says, “Happy Friday!” before continuing home.

Use raw early-2000s consumer DV-camera footage: handheld shake, imperfect framing, autofocus hunting, exposure shifts, soft digital detail, mild digital noise, natural motion blur, occasional awkward zooms and authentic home-video imperfections. Natural Seoul neighborhood ambience only — footsteps, running water, children talking, shop sounds, newspaper rustling, distant traffic, birds and summer insects. No music, no narration, no subtitles, no polished commercial cinematography, no beauty-filter skin, no CGI look, no duplicate characters, no changing face, hairstyle or outfit.$tp$,
   $tp${"model":"seedance2_5","recipe":"reference_frames","duration":30,"needsImage":true}$tp$::jsonb,
   '2026-09-21', 4, 'live', 'grok_x_search'),
  ('x', '2103188197933187179', 'Mayz1169', 'https://x.com/Mayz1169/status/2103188197933187179', 'video',
   array['GPT Image 2', 'Seedance 2.5'], 940,
   $tp${"en":"A 15-second anime chase in one unbroken shot: a character sheet from GPT Image 2, animated with Seedance 2.5.","zh-Hant":"15 秒一鏡到底的動畫追逐：先用 GPT Image 2 做角色設定圖，再用 Seedance 2.5 動起來。","zh-Hans":"15 秒一镜到底的动画追逐：先用 GPT Image 2 做角色设定图，再用 Seedance 2.5 动起来。","ja":"ワンカットで描く 15 秒のアニメ追走劇。GPT Image 2 で作ったキャラクターシートを Seedance 2.5 でアニメ化。","ko":"끊김 없는 원테이크 15초 애니메이션 추격전. GPT Image 2로 만든 캐릭터 시트를 Seedance 2.5로 움직였습니다."}$tp$::jsonb,
   null,
   null,
   '2026-09-21', 5, 'live', 'grok_x_search')
on conflict (platform, post_id) do nothing;

commit;

-- Check after running (should be false: nobody reads the table but the server):
--   select has_table_privilege('anon', 'public.trending_posts', 'select');
