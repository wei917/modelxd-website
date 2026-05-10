-- supabase/36_rename_vision_to_image.sql
-- Rename the mode pattern 'vision_to_text' → 'image_to_text' so it matches
-- the rest of the catalog's naming convention (text_to_image, image_to_video,
-- etc.). Any rows that have 'vision_to_text' in their `modes` array get
-- the value swapped in-place.
--
-- The mode column is text[] so we use array_replace.

UPDATE ai_models
SET    modes = array_replace(modes, 'vision_to_text', 'image_to_text')
WHERE  'vision_to_text' = ANY(modes);
