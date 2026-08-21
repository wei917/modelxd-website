-- 84_eval_config.sql — the catalog declares XEval membership (owner design,
-- Aug 21): eval_config.efforts lists the effort levels this model is
-- evaluated at. Null/absent = not in eval. Removing an effort retires that
-- (model, effort) entry: XEval stops scheduling new runs/pairs for it, but
-- its historical games stay in every rating fit (no score adjustment —
-- Bradley-Terry is batch-fit over all recorded games). No timestamps kept:
-- retirement provenance is explicitly not tracked (owner, Aug 21).

alter table ai_models add column if not exists eval_config jsonb;

-- Declare the current XEval pilot pool (10 entries across 9 models).
update ai_models set eval_config = '{"efforts": ["low"]}'::jsonb
 where model_name in ('gpt-5.6-luna','claude-sonnet-5','claude-opus-5',
                      'claude-fable-5','gemini-3.7-flash','kimi-k3','grok-4.6');
update ai_models set eval_config = '{"efforts": ["low","none"]}'::jsonb
 where model_name = 'gpt-5.6-sol';
update ai_models set eval_config = '{"efforts": ["none"]}'::jsonb
 where model_name = 'gpt-5.6-terra';

-- Published ladder marks retired entries (derived: has games, not declared).
alter table xeval_ratings add column if not exists retired boolean default false;
