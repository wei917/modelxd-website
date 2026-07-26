-- 53: workflow lineage for xcreates (CC, July 26 2026)
--
-- A "workflow" is the chain of runs hanging off one creation: generate ->
-- edit -> edit... parent_id records the immediate ancestor; root_id makes
-- fetching a whole chain a single indexed equality instead of a recursive
-- walk. Roots carry root_id = their own id (backfilled below; new rows get
-- it set by the API right after insert).
alter table xcreates add column if not exists parent_id uuid references xcreates(id) on delete set null;
alter table xcreates add column if not exists root_id uuid;
update xcreates set root_id = id where root_id is null;
create index if not exists idx_xcreates_root   on xcreates(root_id);
create index if not exists idx_xcreates_parent on xcreates(parent_id);
