-- 59_qwen_no_web_search.sql
--
-- Undo the web_search capability that 58 gave Alibaba. 58 was written on the
-- assumption that Qwen could search once we moved to the native protocol.
-- Testing it live disproved that, in two steps:
--
--   1. qwen3.6-plus is REJECTED by the native text endpoint
--      (text-generation/generation -> "url error, please check url").
--      Being a VL/omni model, it must use multimodal-generation/generation.
--
--   2. The multimodal endpoint accepts `enable_search` and silently ignores
--      it. The model then answers that it has no live internet access, and
--      usage carries no search count.
--
-- So on the endpoint this model is required to use, search does not exist.
-- Leaving the flag on would have put Qwen in search-only duels where it
-- alone answered from memory while the others looked things up — the exact
-- unfairness the match-level toggle exists to prevent.
--
-- per_search stays on the row. It is the correct DashScope rate and costs
-- nothing while the capability is absent: the picker gates on capability,
-- never on price. A text-only Qwen (qwen3-max and friends) added later can
-- take the text endpoint, and then only the capability flag needs setting.
--
-- Idempotent.

update ai_models
   set output_config =
         jsonb_set(
           output_config,
           '{text,capabilities}',
           coalesce(
             (select jsonb_agg(v)
                from jsonb_array_elements_text(output_config -> 'text' -> 'capabilities') as t(v)
               where v <> 'web_search'),
             '[]'::jsonb
           )
         )
 where provider = 'alibaba'
   and coalesce(output_config -> 'text' -> 'capabilities', '[]'::jsonb) @> '["web_search"]'::jsonb;

-- ── verify: alibaba should now be the only text provider without the flag,
--            alongside moonshot ────────────────────────────────────────────

select provider,
       model_name,
       model_pricing -> 'per_search'             as per_search,
       output_config -> 'text' -> 'capabilities' as text_caps
  from ai_models
 where output_modalities @> array['text']
 order by provider, model_name;
