-- ModelXD: drop ai_models.mode, add ai_models.modes (text[])
--
-- A single `mode` was wrong: a model declares the *set* of input shapes
-- it supports, and the user picks one at generation time. e.g. Veo 3
-- supports text_to_video / image_to_video / video_to_video /
-- start_end_frames in the same row.
--
-- We drop the briefly-introduced `mode` column from migration 32 and
-- replace it with `modes text[]` defaulted to empty.

ALTER TABLE ai_models DROP COLUMN IF EXISTS mode;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS modes text[] NOT NULL DEFAULT '{}';
