-- 121_ai_models_official_price.sql — two prices per model (owner, Oct 1:
-- "we need have two prices in the database, one is official and another is
-- the price we got from 3rd party if we can't access the official one").
--
-- model_pricing KEEPS its meaning: the price of the route we actually use,
-- which is what we pay and what users are billed. Every cost path reads it
-- (estimateCost, the providers' cost math, the price history trigger), so
-- nothing about billing changes here.
--
--   official_pricing  the maker's own list price, same jsonb shape as
--                     model_pricing. Set only when we buy the model from a
--                     reseller; null means model_pricing IS the official
--                     price (every first-party row, 65 of 66 on Oct 1).
--   via               the reseller we buy through ('runway', 'replicate',
--                     …); null means the maker directly.
--
-- First use: Seedance 2.5, bought through Runway at about twice ByteDance's
-- official price at 480p (BytePlus does not sell it to US companies).
--
-- Additive only: two nullable columns, no defaults to backfill. Run by hand
-- in the Supabase SQL editor (dev + prod share the project).

alter table public.ai_models add column if not exists official_pricing jsonb;
alter table public.ai_models add column if not exists via text;

comment on column public.ai_models.official_pricing is
  'The maker''s own list price, same shape as model_pricing; set only when we buy through a reseller (via). Null = model_pricing is the official price.';
comment on column public.ai_models.via is
  'The reseller we buy this model through (runway, replicate, …); null = from the maker directly.';

-- Verify:
-- select model_name, via, official_pricing from ai_models where via is not null;
