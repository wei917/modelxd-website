-- ModelXD: add `mode` column to ai_models
--
-- Single canonical input-shape pattern per row. Subsumes the per-modality
-- `pattern` we briefly carried inside input_config — that field is going
-- away in favour of one row-level enum.
--
-- Possible values (validated in the admin UI, not the DB):
--   text-output:   text_to_text, vision_to_text
--   image-output:  text_to_image, image_edit, reference_frames
--   video-output:  text_to_video, image_to_video, video_to_video,
--                  start_end_frames, reference_frames
--
-- Always nullable. Null means "no canonical mode set" — the UI falls
-- back to a default rendering based on input_modalities.

ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS mode text;
