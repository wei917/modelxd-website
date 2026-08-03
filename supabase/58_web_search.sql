-- 58_web_search.sql
--
-- Built-in web search for text models: per-call price + capability flag.
--
-- Two separate things on purpose:
--
--   model_pricing.per_search              -- $ per search call
--   output_config.text.capabilities[]     -- contains 'web_search'
--
-- The picker gates on the CAPABILITY. The price is only for the bill. A
-- model may legitimately be search-capable with no rate on file (we would
-- undercount, not crash), and we never infer capability from a price.
--
-- Rates verified 2026-08-02:
--   OpenAI     web_search           $10 / 1k calls   -> 0.01
--   Anthropic  web_search_20250305  $10 / 1k calls   -> 0.01
--   Google     Grounding w/ Search  $14 / 1k queries -> 0.014
--   Alibaba    enable_search/agent  $10 / 1k calls   -> 0.01
--
-- The Alibaba rate is endpoint-dependent and this is the ONE that bites:
-- dashscope-intl (what DASHSCOPE_BASE_URL defaults to) bills $10/1k, while
-- the mainland endpoint bills ~$0.57/1k. Change the base URL and this rate
-- is wrong by 17x.
--
-- Search content tokens are billed at normal model rates on top of this and
-- are already captured by the existing token accounting — do NOT try to
-- fold them in here.
--
-- Idempotent: re-running changes nothing.

-- ── per-search rates ────────────────────────────────────────────────────────

update ai_models
   set model_pricing = coalesce(model_pricing, '{}'::jsonb)
                       || jsonb_build_object('per_search', 0.01)
 where provider in ('openai', 'anthropic', 'alibaba')
   and output_modalities @> array['text'];

update ai_models
   set model_pricing = coalesce(model_pricing, '{}'::jsonb)
                       || jsonb_build_object('per_search', 0.014)
 where provider = 'google'
   and output_modalities @> array['text'];

-- ── capability flag ─────────────────────────────────────────────────────────
--
-- Merge rather than overwrite: output_config.text may already carry
-- thinking_levels or other capabilities, and jsonb_set cannot create the
-- intermediate `text` object when it is absent.

update ai_models
   set output_config =
         coalesce(output_config, '{}'::jsonb)
         || jsonb_build_object(
              'text',
              coalesce(output_config -> 'text', '{}'::jsonb)
              || jsonb_build_object(
                   'capabilities',
                   (select jsonb_agg(distinct v)
                      from (
                        select jsonb_array_elements_text(
                                 coalesce(output_config -> 'text' -> 'capabilities', '[]'::jsonb)
                               ) as v
                        union
                        select 'web_search'
                      ) s)
                 )
            )
 where provider in ('openai', 'anthropic', 'google', 'alibaba')
   and output_modalities @> array['text']
   and not coalesce(output_config -> 'text' -> 'capabilities', '[]'::jsonb) @> '["web_search"]'::jsonb;

-- Moonshot (Kimi) stays unflagged. Its $web_search is a builtin_function
-- that needs a client-side tool-call loop our single-shot stream does not
-- have, and Moonshot's own current guidance is that the tool is mid-revision
-- and not for production. Unflagged means Kimi simply drops out of the
-- picker when search is on. Revisit when upstream settles.
--
-- Qwen IS flagged, but only because lib/providers/alibaba.ts now switches to
-- the native DashScope protocol when search is on. The OpenAI-compatible
-- endpoint runs the search and reports no count at all, which would have put
-- a silently-wrong number in the cost column.

-- ── verify ──────────────────────────────────────────────────────────────────

select provider,
       model_name,
       model_pricing -> 'per_search'            as per_search,
       output_config -> 'text' -> 'capabilities' as text_caps
  from ai_models
 where output_modalities @> array['text']
 order by provider, model_name;
