-- 71_xdirector_storyboard.sql — the storyboard is a work product, not a chat
-- message (CC, Aug 6).
--
-- XDirect's director now answers every VIDEO request by drafting scenes onto
-- the board instead of describing a plan in the dialog. The scenes are the
-- artifact the user reviews and edits, so they persist with the conversation
-- they belong to — same row, same lifetime, same owner check.
--
-- Shape (jsonb array, one object per scene):
--   { id: "s1", title: "Hook", script: "...", shot: "...", duration_s: 4,
--     model_id?, model_name?, recipe?, estimate?,
--     status?: "draft"|"generating"|"done"|"error", row_id?, url?, cost? }
--
-- Additive and nullable: conversations from before this migration read as
-- "no storyboard yet", and the API routes tolerate the column being absent
-- so a not-yet-migrated database degrades to in-session storyboards rather
-- than breaking saves.

alter table public.xdirector_conversations
  add column if not exists storyboard jsonb;

comment on column public.xdirector_conversations.storyboard is
  'Scene list drafted by the director and edited by the user on the XDirect board. See 71_xdirector_storyboard.sql for the shape.';
