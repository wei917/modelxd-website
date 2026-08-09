-- 77: character voice (stage 2 of voice — owner design, Aug 8).
-- A character may speak. `voice` holds a Qwen-TTS voice id: either a preset
-- name ("Cherry", "Momo", …) or the id returned by qwen-voice-design for a
-- text-DESIGNED voice — a novel voice belonging to no human. Cloning from
-- human samples was considered and rejected (owner, Aug 8): consent is
-- unverifiable, and nobody orders an AI friend in their own voice.
-- `voice_desc` stores the design description; its presence is what tells the
-- synthesis path to use the voice-design model instead of the preset model.
-- NULL voice = a silent character (the default; nothing changes for them).

alter table public.x_characters add column if not exists voice text;
alter table public.x_characters add column if not exists voice_desc text;
