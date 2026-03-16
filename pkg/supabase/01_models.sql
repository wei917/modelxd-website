-- ModelXD: ai_models table
-- Run in Supabase SQL Editor

create table if not exists ai_models (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,       -- 'openai' | 'google'
  model_name         text not null,       -- 'gpt-image-1.5' | 'gemini-3-flash-preview'
  name               text not null,       -- display name e.g. 'GPT Image 1.5'
  modes              text[] not null,     -- ['text'] | ['image'] | ['video'] | ['text','image']

  -- Text pricing (per 1M tokens)
  input_price        numeric,
  cached_input_price numeric,
  output_price       numeric,

  -- Image token pricing (per 1M tokens, token-based image billing)
  input_image_price  numeric,
  output_image_price numeric,

  -- Flat rate pricing
  image_pricing      jsonb,  -- {"low": 0.009, "medium": 0.034, "high": 0.133}
  video_pricing      jsonb,  -- {"720p": 0.10, "1080p": 0.50}

  -- Supported options
  image_sizes        text[], -- ['1024x1024', '1024x1536', '1536x1024']
  video_sizes        text[], -- ['720x1280', '1280x720', '1024x1792', '1792x1024']
  video_durations    int[],  -- [16, 20]

  -- Metadata
  context_window     bigint,
  max_output_tokens  bigint,
  tags               text[], -- ['reasoning', 'vision', 'audio']
  enabled            boolean default false,

  added_at           timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (provider, model_name)
);

create index if not exists ai_models_modes_idx    on ai_models using gin(modes);
create index if not exists ai_models_enabled_idx  on ai_models(enabled);
create index if not exists ai_models_provider_idx on ai_models(provider);

-- Auto-update updated_at on row changes
create or replace function update_ai_models_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger ai_models_updated_at
  before update on ai_models
  for each row execute procedure update_ai_models_updated_at();
-- ModelXD: seed ai_models with initial OpenAI + Google models
-- Run after 01_models.sql

-- ── OpenAI Text ───────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, input_price, cached_input_price, output_price, context_window, max_output_tokens, tags, enabled)
values
  ('openai', 'gpt-5.2',      'GPT-5.2',       array['text'], 1.75,  0.175,  14.00, 1050000, 128000, array['vision'],            true),
  ('openai', 'gpt-5',        'GPT-5',          array['text'], 1.25,  0.125,  10.00, 1050000, 128000, array['vision'],            true),
  ('openai', 'gpt-5-mini',   'GPT-5 Mini',     array['text'], 0.25,  0.025,   2.00,  400000, 128000, array['vision'],            true),
  ('openai', 'gpt-4.1',      'GPT-4.1',        array['text'], 2.00,  0.50,    8.00, 1000000,  32768, array['vision'],            true),
  ('openai', 'gpt-4.1-mini', 'GPT-4.1 Mini',   array['text'], 0.40,  0.10,    1.60, 1000000,  32768, array['vision'],            true),
  ('openai', 'gpt-4.1-nano', 'GPT-4.1 Nano',   array['text'], 0.10,  0.025,   0.40, 1000000,  32768, array['vision'],            true),
  ('openai', 'o3',           'o3',             array['text'], 2.00,  0.50,    8.00,  200000, 100000, array['reasoning','vision'], true),
  ('openai', 'o4-mini',      'o4-mini',        array['text'], 1.10,  0.275,   4.40,  200000, 100000, array['reasoning','vision'], true)
on conflict (provider, model_name) do nothing;

-- ── OpenAI Image ─────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, input_price, input_image_price, output_image_price, image_pricing, image_sizes, tags, enabled)
values
  ('openai', 'gpt-image-1.5',  'GPT Image 1.5',  array['image'], 5.00, 8.00, 32.00,
    '{"low": 0.009, "medium": 0.034, "high": 0.133}'::jsonb,
    array['1024x1024','1024x1536','1536x1024'],
    array['vision'], true),
  ('openai', 'gpt-image-1',    'GPT Image 1',    array['image'], 5.00, 10.00, 40.00,
    '{"low": 0.011, "medium": 0.042, "high": 0.167}'::jsonb,
    array['1024x1024','1024x1536','1536x1024'],
    array['vision'], true),
  ('openai', 'gpt-image-1-mini','GPT Image 1 Mini',array['image'], 2.00, 2.00, 8.00,
    '{"low": 0.005, "medium": 0.011, "high": 0.036}'::jsonb,
    array['1024x1024','1024x1536','1536x1024'],
    array['vision'], true)
on conflict (provider, model_name) do nothing;

-- ── OpenAI Video ─────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, video_pricing, video_sizes, video_durations, tags, enabled)
values
  ('openai', 'sora-2',     'Sora 2',     array['video'],
    '{"720p": 0.10}'::jsonb,
    array['1280x720','720x1280'],
    array[16, 20], array[]::text[], true),
  ('openai', 'sora-2-pro', 'Sora 2 Pro', array['video'],
    '{"720p": 0.30, "1080p": 0.50}'::jsonb,
    array['1280x720','720x1280','1792x1024','1024x1792'],
    array[16, 20], array[]::text[], true)
on conflict (provider, model_name) do nothing;

-- ── Google Text ───────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, input_price, cached_input_price, output_price, context_window, max_output_tokens, tags, enabled)
values
  ('google', 'gemini-3.1-pro-preview',   'Gemini 3.1 Pro',   array['text'], 2.00, null, 12.00, 1000000, 8192, array['vision','reasoning'], true),
  ('google', 'gemini-3-flash-preview',   'Gemini 3 Flash',   array['text'], 0.50, null,  3.00, 1000000, 8192, array['vision','reasoning'], true),
  ('google', 'gemini-2.5-pro',           'Gemini 2.5 Pro',   array['text'], 1.25, null, 10.00, 1000000, 8192, array['vision','reasoning'], true),
  ('google', 'gemini-2.5-flash',         'Gemini 2.5 Flash', array['text'], 0.30, null,  1.25, 1000000, 8192, array['vision'],             true),
  ('google', 'gemini-2.5-flash-lite',    'Gemini 2.5 Flash Lite', array['text'], 0.10, null, 0.40, 1000000, 8192, array['vision'],         true)
on conflict (provider, model_name) do nothing;

-- ── Google Image ─────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, input_image_price, output_image_price, image_pricing, image_sizes, tags, enabled)
values
  ('google', 'gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image',
    array['image'], 60.00, 60.00,
    '{"512px": 0.045, "1024px": 0.067, "2048px": 0.101, "4096px": 0.151}'::jsonb,
    array['512x512','1024x1024','2048x2048','4096x4096'],
    array['vision'], true),
  ('google', 'gemini-3-pro-image-preview', 'Gemini 3 Pro Image',
    array['image'], 120.00, 120.00,
    '{"1024px": 0.134, "2048px": 0.134, "4096px": 0.240}'::jsonb,
    array['1024x1024','2048x2048','4096x4096'],
    array['vision'], true)
on conflict (provider, model_name) do nothing;

-- ── Google Video ─────────────────────────────────────────────────────────────
insert into ai_models (provider, model_name, name, modes, video_pricing, video_sizes, video_durations, tags, enabled)
values
  ('google', 'veo-3.1-generate-preview', 'Veo 3.1',
    array['video'],
    '{"default": 0.60}'::jsonb,
    array['1280x720','720x1280'],
    array[4, 6, 8], array[]::text[], true),
  ('google', 'veo-3.1-fast-generate-preview', 'Veo 3.1 Fast',
    array['video'],
    '{"default": 0.40}'::jsonb,
    array['1280x720','720x1280'],
    array[4, 6, 8], array[]::text[], true)
on conflict (provider, model_name) do nothing;

-- RLS: public read, service role only for writes
alter table ai_models enable row level security;
create policy "ai_models: public read" on ai_models for select using (true);
-- Inserts/updates only via service role key (no authenticated user policy = blocked for anon/auth users)
