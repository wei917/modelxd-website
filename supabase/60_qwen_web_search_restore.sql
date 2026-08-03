-- 60_qwen_web_search_restore.sql
--
-- Reverts 59. 59 removed Alibaba's web_search flag on the strength of a test
-- that was invalid: the probe forcing the multimodal endpoint also forced
-- `searchOn = search && !multimodal` to false, so that run never sent
-- enable_search at all. The model correctly said it could not browse. I read
-- that as "the endpoint ignores the flag".
--
-- Retested properly, hitting DashScope directly:
--
--   POST /api/v1/services/aigc/multimodal-generation/generation
--   parameters: { enable_search: true, search_options: { search_strategy:
--                 'agent', enable_source: true }, incremental_output: true }
--
--   -> same-day headlines, search_info.search_results = 30 entries,
--      usage.plugins.search = { count: 1, strategy: 'agent' }
--
-- So Qwen searches AND reports a billable count, which is everything the
-- cost column needs. per_search was left in place by 59, so only the
-- capability flag comes back here.
--
-- One live constraint worth recording: DashScope rejects search in
-- non-streaming mode ("Non-streaming mode does not support Web Search in
-- thinking mode"). lib/providers/alibaba.ts always streams, so this is
-- satisfied — but that error message is the signature to look for if Qwen
-- ever stops searching.
--
-- Idempotent.

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
 where provider = 'alibaba'
   and output_modalities @> array['text']
   and not coalesce(output_config -> 'text' -> 'capabilities', '[]'::jsonb) @> '["web_search"]'::jsonb;

-- ── verify: everything except moonshot should now carry the flag ───────────

select provider,
       model_name,
       model_pricing -> 'per_search'             as per_search,
       output_config -> 'text' -> 'capabilities' as text_caps
  from ai_models
 where output_modalities @> array['text']
 order by provider, model_name;
