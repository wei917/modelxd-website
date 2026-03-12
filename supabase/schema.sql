-- ModelXD: ai_models table
-- Run this in Supabase SQL Editor

create table if not exists ai_models (
  id              text primary key,       -- 'openai/gpt-4o'
  name            text not null,          -- 'GPT-4o'
  provider        text not null,          -- 'openai'
  modes           text[] not null,        -- ['text'], ['image'], ['text','image','video']

  -- Text pricing (per 1M tokens)
  input_price     numeric,
  output_price    numeric,

  -- Image pricing (per image, by resolution)
  image_pricing   jsonb,                  -- {"1024x1024": 0.04, "1792x1024": 0.08}

  -- Video pricing (per second, by resolution)
  video_pricing   jsonb,                  -- {"480p": 0.05, "720p": 0.10, "1080p": 0.15}

  -- Metadata
  context_window  bigint,
  max_tokens      bigint,
  tags            text[],
  released_at     date,
  enabled         boolean default false,
  raw             jsonb,
  synced_at       timestamptz default now()
);

-- GIN index for fast ANY(modes) queries
create index if not exists ai_models_modes_idx   on ai_models using gin(modes);
create index if not exists ai_models_enabled_idx on ai_models(enabled);

-- Migration from old single 'mode' column (run if upgrading):
-- alter table ai_models add column if not exists modes text[];
-- update ai_models set modes = array[mode] where modes is null;
-- alter table ai_models alter column modes set not null;
-- alter table ai_models drop column if exists mode;


-- =============================================================
-- Duels table
-- =============================================================

create table if not exists duels (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  mode          text not null check (mode in ('text', 'image', 'video')),
  prompt        text not null,

  -- Array of model slots, each: { id, name, provider, outputPrice, priceLabel, text, isImage, isVideo, responseTime, cost }
  slots         jsonb not null default '[]',

  -- Votes: index of chosen model or 'T' for tie, null if not voted
  vote1          text,   -- blind vote slot index or 'T'
  vote2          text,   -- informed vote slot index or 'T'
  vote1_model_id text,   -- model id of blind vote winner (null for tie)
  vote2_model_id text,   -- model id of informed vote winner (null for tie)

  created_at    timestamptz not null default now()
);

create index if not exists duels_user_id_idx  on duels(user_id);
create index if not exists duels_mode_idx     on duels(mode);
create index if not exists duels_created_at_idx on duels(created_at desc);

-- RLS: anyone can read, only owner can write
alter table duels enable row level security;

create policy "duels: public read"
  on duels for select using (true);

create policy "duels: owner insert"
  on duels for insert
  with check (auth.uid() = user_id);

create policy "duels: owner update"
  on duels for update
  using (auth.uid() = user_id);
