-- 78: per-character voice speed (owner ask, Aug 8). The speed is part of
-- the character's identity — a languid 0.75× drawl or a caffeinated 1.5×
-- patter — so it lives on the row next to the voice, set in the builder.
-- Applied client-side at the audio element (playbackRate), so it works for
-- presets and designed voices alike. Default 1 = natural speed.

alter table public.x_characters add column if not exists voice_rate real default 1;
