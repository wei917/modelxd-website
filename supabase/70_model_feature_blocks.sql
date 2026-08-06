-- 70_model_feature_blocks.sql — per-feature model availability (CC, Aug 5)
--
-- Some models are fine in general but wrong for one particular surface. The
-- first case is latency: XTalk Werewolf makes one server round trip PER ACT,
-- so a model that routinely exceeds the per-call timeout turns its turns into
-- "did not answer" abstentions — which silently changes who gets lynched, and
-- means the game the leaderboard records is not the game the models played.
-- Kimi K3 runs ~26 tok/s with a large default reasoning budget (measured 75s+
-- per turn against a 90s ceiling), so it is blocked there. It stays fully
-- available in Discussion and everywhere else, where a slow reply costs
-- patience rather than correctness.
--
-- Deliberately a COLUMN on ai_models rather than a join table: availability is
-- a property of the model, it is read on every picker open, and an admin
-- editing one row is the whole workflow. Blocking a model for a feature is a
-- data change, not a deploy.
--
-- Feature keys are free text by design so a new surface does not need a
-- migration; the ones in use are listed in lib/model-features.ts. Current
-- keys: 'xtalk_werewolf', 'xtalk_discussion', 'xduel', 'xcreate'.

alter table public.ai_models
  add column if not exists blocked_features text[] not null default '{}';

comment on column public.ai_models.blocked_features is
  'Feature keys this model must not be offered for (see lib/model-features.ts). Empty = available everywhere it otherwise qualifies.';

-- Index only helps if we ever filter server-side across all models; cheap.
create index if not exists ai_models_blocked_features_idx
  on public.ai_models using gin (blocked_features);

-- The one rule we have today.
update public.ai_models
   set blocked_features = array['xtalk_werewolf']
 where model_name = 'kimi-k3'
   and not ('xtalk_werewolf' = any(blocked_features));
