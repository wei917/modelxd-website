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
