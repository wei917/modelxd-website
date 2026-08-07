-- 73_draw_something.sql — Draw & Guess (owner design, Aug 6)
-- Terms are SERVER DATA (add rows, no deploy); drawings are PRE-GENERATED
-- offline by scripts/fill-draw-images.ts — the game itself has NO live
-- generation path. Model identity in image URLs is hidden behind a secret
-- token; term identity is the opaque row id. Service-role access only.

create table if not exists draw_terms (
  id         uuid primary key default gen_random_uuid(),
  lang       text not null check (lang in ('en','zh-Hant','zh-Hans','ja','ko')),
  term       text not null,
  aliases    text[] not null default '{}',
  tier       text not null default 'easy' check (tier in ('easy','medium','hard')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lang, term)
);

-- Opaque URL token per model, so a drawing's URL never names its artist.
create table if not exists draw_model_keys (
  model_id   uuid primary key references ai_models(id) on delete cascade,
  secret     text not null unique,
  created_at timestamptz not null default now()
);

-- The cache index: which (term, model, variant) drawings exist, and where.
create table if not exists draw_images (
  id           uuid primary key default gen_random_uuid(),
  term_id      uuid not null references draw_terms(id) on delete cascade,
  model_id     uuid not null references ai_models(id) on delete cascade,
  variant      smallint not null default 1,
  storage_path text not null,
  cost_usd     numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (term_id, model_id, variant)
);

alter table draw_terms      enable row level security;
alter table draw_model_keys enable row level security;
alter table draw_images     enable row level security;
-- No policies on purpose: service-role only. The game API is the reader.

-- Public bucket: drawings are house content served to every player; the
-- opaque path is the privacy layer, public read is the cache-friendly one.
insert into storage.buckets (id, name, public)
  values ('xgame-draw', 'xgame-draw', true)
  on conflict (id) do nothing;

-- ── Seed terms (model-drafted, PENDING NATIVE REVIEW per language) ──
insert into draw_terms (lang, term, aliases, tier) values ('en', 'cat', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'dog', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'sun', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'moon', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'star', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'fish', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'apple', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'house', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'tree', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'car', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'bicycle', array['bike']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'pizza', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'guitar', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'umbrella', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'rainbow', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'snowman', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'balloon', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'butterfly', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'lighthouse', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'volcano', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'penguin', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'castle', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'robot', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'astronaut', array['spaceman']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'waterfall', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'hamburger', array['burger']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'octopus', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'telescope', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'campfire', array['bonfire']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'windmill', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'mermaid', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'dinosaur', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'submarine', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'scarecrow', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'ferris wheel', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'hot air balloon', array['hot-air balloon','air balloon']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'skateboard', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'jellyfish', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'gravity', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'echo', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'nightmare', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'traffic jam', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'time machine', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'tug of war', array['tug-of-war']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'daydream', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'shadow', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'hiccup', array['hiccups']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'applause', array['clapping']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'insomnia', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('en', 'deja vu', array['déjà vu']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '貓', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '狗', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '太陽', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '月亮', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '星星', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '魚', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '蘋果', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '房子', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '樹', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '汽車', array['車']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '腳踏車', array['自行車','單車']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '珍珠奶茶', array['波霸奶茶','珍奶']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '彩虹', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '雨傘', array['傘']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '氣球', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '蝴蝶', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '西瓜', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '飯糰', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '101大樓', array['台北101','101']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '夜市', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '滷肉飯', array['魯肉飯']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '火鍋', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '燈籠', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '廟', array['寺廟']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '火山', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '企鵝', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '機器人', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '太空人', array['宇航員']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '瀑布', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '章魚', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '恐龍', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '摩天輪', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '熱氣球', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '高鐵', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '小籠包', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '媽祖', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '茶壺', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '稻田', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '塞車', array['堵車']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '回音', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '惡夢', array['噩夢']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '影子', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '打嗝', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '鼓掌', array['拍手']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '失眠', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '拔河', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '白日夢', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '地心引力', array['重力']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '時光機', array['時光機器']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hant', '排隊', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '猫', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '狗', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '太阳', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '月亮', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '星星', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '鱼', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '苹果', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '房子', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '树', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '汽车', array['车']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '自行车', array['单车']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '奶茶', array['珍珠奶茶']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '彩虹', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '雨伞', array['伞']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '气球', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '蝴蝶', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '西瓜', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '包子', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '长城', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '熊猫', array['大熊猫']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '火锅', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '灯笼', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '高铁', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '火山', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '企鹅', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '机器人', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '宇航员', array['太空人']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '瀑布', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '章鱼', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '恐龙', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '摩天轮', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '热气球', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '饺子', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '龙舟', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '兵马俑', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '糖葫芦', array['冰糖葫芦']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '茶壶', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '稻田', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '堵车', array['塞车']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '回声', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '噩梦', array['恶梦']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '影子', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '打嗝', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '鼓掌', array['拍手']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '失眠', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '拔河', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '白日梦', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '重力', array['地心引力']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '时光机', array['时光机器']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('zh-Hans', '排队', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ねこ', array['猫','ネコ']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'いぬ', array['犬','イヌ']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'たいよう', array['太陽']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'つき', array['月']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ほし', array['星']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'さかな', array['魚']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'りんご', array['リンゴ','林檎']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'いえ', array['家']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'き', array['木']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'くるま', array['車','自動車']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'じてんしゃ', array['自転車']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'おにぎり', array['お握り','おむすび']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'にじ', array['虹']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'かさ', array['傘']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ふうせん', array['風船']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ちょうちょ', array['蝶','ちょう']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'すいか', array['西瓜','スイカ']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'すし', array['寿司','鮨']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'さくら', array['桜','サクラ']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'しんかんせん', array['新幹線']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ふじさん', array['富士山']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'とりい', array['鳥居']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'まねきねこ', array['招き猫']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'たこやき', array['たこ焼き','タコヤキ']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'かざん', array['火山']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ぺんぎん', array['ペンギン']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ろぼっと', array['ロボット']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'うちゅうひこうし', array['宇宙飛行士']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'たき', array['滝']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'たこ', array['タコ','蛸']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'きょうりゅう', array['恐竜']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'かんらんしゃ', array['観覧車']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ききゅう', array['気球','熱気球']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'おんせん', array['温泉']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'だるま', array['ダルマ','達磨']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'こいのぼり', array['鯉のぼり']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'らーめん', array['ラーメン','らめん']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'かかし', array['案山子']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'じゅうたい', array['渋滞']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'やまびこ', array['山彦','こだま']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'あくむ', array['悪夢']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'かげ', array['影']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'しゃっくり', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'はくしゅ', array['拍手']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ふみん', array['不眠','不眠症']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'つなひき', array['綱引き']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ゆめ', array['夢']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'じゅうりょく', array['重力']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'たいむましん', array['タイムマシン']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ja', 'ぎょうれつ', array['行列']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '고양이', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '강아지', array['개']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '해', array['태양']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '달', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '별', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '물고기', array['생선']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '사과', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '집', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '나무', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '자동차', array['차']::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '자전거', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '김밥', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '무지개', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '우산', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '풍선', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '나비', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '수박', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '김치', array[]::text[], 'easy') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '남산타워', array['N서울타워','서울타워']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '한강', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '떡볶이', array['떡볶기']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '한복', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '지하철', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '화산', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '펭귄', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '로봇', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '우주인', array['우주비행사']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '폭포', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '문어', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '공룡', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '대관람차', array['관람차']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '열기구', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '경복궁', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '치킨', array['프라이드치킨']::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '눈사람', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '호랑이', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '주전자', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '허수아비', array[]::text[], 'medium') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '교통체증', array['차막힘']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '메아리', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '악몽', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '그림자', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '딸꾹질', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '박수', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '불면증', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '줄다리기', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '백일몽', array['공상']::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '중력', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '타임머신', array[]::text[], 'hard') on conflict (lang, term) do nothing;
insert into draw_terms (lang, term, aliases, tier) values ('ko', '줄서기', array['대기줄']::text[], 'hard') on conflict (lang, term) do nothing;
