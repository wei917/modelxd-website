-- 81_input_ports.sql — the typed wiring of the canvas (owner, Aug 15:
-- "do it right, no backward compatibility" — ComfyUI-style typed ports).
--
-- Each xcreates row now carries its inputs as EXPLICIT typed wires instead
-- of filename conventions and attachment-order inference:
--
--   input_ports: [
--     { "port": "first_frame",     "type": "image",
--       "source": { "kind": "row",  "row_id": "<uuid>", "slot": 0 } },
--     { "port": "reference_audio", "type": "audio",
--       "source": { "kind": "file", "bucket": "xcreate-user-files",
--                   "path": "<uid>/originals/x.mp3", "name": "chorus.mp3" } }
--   ]
--
-- Port names are the model's API roles (first_frame, reference_image,
-- reference_audio, source_image, chain_from, extend_video …), derived per
-- model in lib/ports.ts from input_modalities + modes. parent_ids remains
-- as a derived index for cheap ancestry queries; input_ports is the truth.

alter table xcreates add column if not exists input_ports jsonb;

comment on column xcreates.input_ports is
  'Typed input wires: [{port, type, source:{kind:row|file,...}}]. Canonical; parent_ids is derived.';
