-- 76_x_characters_photos_search.sql (owner feedback, Aug 8)
-- Photos at creation time (a gallery, not just the icon) and a per-character
-- web-search toggle. Both additive — safe on the shared project.

alter table x_characters
  add column if not exists photos text[] not null default '{}',
  add column if not exists search boolean not null default false;
