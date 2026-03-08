-- ModelXD: ai_models table
-- Run this in Supabase SQL Editor

create table if not exists ai_models (
  id              text primary key,       -- 'openai/gpt-4o'
  name            text not null,          -- 'GPT-4o'
  provider        text not null,          -- 'openai'
  mode            text not null,          -- 'language' | 'image' | 'video'

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
  released_at     date,                 -- e.g. '2025-04-01', null if unknown

  -- enabled=false by default — review new models in dashboard before enabling
  enabled         boolean default false,

  raw             jsonb,
  synced_at       timestamptz default now()
);

create index if not exists ai_models_mode_idx    on ai_models(mode);
create index if not exists ai_models_enabled_idx on ai_models(enabled);
