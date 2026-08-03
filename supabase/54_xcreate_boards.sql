-- 54: product-video boards for xcreates (CC, July 28 2026)
--
-- 53 gave every run a single parent_id and a root_id, which models a chain.
-- The product-video pipeline is not a chain, it is a graph:
--
--   parent_ids  A stage-2 video derives from the ORIGINAL photo *and* the
--               generated angles; a multi-product scene derives from two
--               separate roots (bag + jacket). parent_id cannot express
--               either. It is KEPT as a mirror of parent_ids[1], so the
--               chain loader, the workflow strip and /api/xcreate all keep
--               working untouched.
--
--   board_id    root_id groups exactly one lineage. A board holding two
--               different products has two roots, so grouping needs its own
--               column.
--
--   node_kind   'source' (uploaded photo, zero cost) | 'input' | 'video' |
--               'shot'. Drives the node badge and which actions the canvas
--               offers for a given selection.
--
-- Node delete needs no new column — xcreates.deleted_at already exists.

alter table xcreates
  add column if not exists parent_ids uuid[],
  add column if not exists board_id   uuid,
  add column if not exists node_kind  text;

-- Boards load by board_id; fan-outs are looked up by parent membership.
create index if not exists idx_xcreates_board      on xcreates (board_id) where board_id is not null;
create index if not exists idx_xcreates_parent_ids on xcreates using gin (parent_ids);
create index if not exists idx_xcreates_node_kind  on xcreates (node_kind) where node_kind is not null;

-- Backfill 1: every existing row becomes its own board, so old creations
-- open on the canvas exactly as they do today.
update xcreates set board_id = coalesce(root_id, id) where board_id is null;

-- Backfill 2: existing single-parent rows get the array form too, so new
-- code can read parent_ids exclusively without special-casing old rows.
update xcreates set parent_ids = array[parent_id]
 where parent_id is not null and parent_ids is null;
