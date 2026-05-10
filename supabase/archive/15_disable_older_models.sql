-- 15_disable_older_models.sql
-- Keep only the latest 3 text models per brand. Image/video models stay as-is.
--
-- OpenAI text KEEP: gpt-5.4, gpt-5.4-pro, gpt-5.4-mini
-- Google text KEEP: gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-3.1-flash-lite-preview
--
-- Everything else (older text models) gets disabled.

UPDATE ai_models SET enabled = false
WHERE model_name IN (
  -- OpenAI older text models
  'gpt-5.4-nano',
  'gpt-5.2',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'o4-mini',
  -- Google older text models
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
);
