-- 16_community_features.sql
-- Adds: soft-delete for duels/xcreates, community vote tracking,
-- vote_count for popularity sorting.

-- ── 1. Soft-delete columns ──────────────────────────────────────────────
alter table duels    add column if not exists deleted_at timestamptz default null;
alter table xcreates add column if not exists deleted_at timestamptz default null;

-- ── 2. Community vote tracking ──────────────────────────────────────────
-- Records that a user completed the vote flow on someone else's duel.
-- One row per (user, duel). The actual choice isn't critical — we just
-- need to know they voted so we can (a) hide it from their feed and
-- (b) count popularity.
create table if not exists duel_votes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  duel_id     uuid not null references duels(id) on delete cascade,
  vote_choice text,               -- slot index '0'-'3' or 'T'
  created_at  timestamptz not null default now(),
  unique(user_id, duel_id)
);

create index if not exists duel_votes_user_idx on duel_votes(user_id);
create index if not exists duel_votes_duel_idx on duel_votes(duel_id);

alter table duel_votes enable row level security;
drop policy if exists "duel_votes: public read"  on duel_votes;
drop policy if exists "duel_votes: owner insert" on duel_votes;
create policy "duel_votes: public read"  on duel_votes for select using (true);
create policy "duel_votes: owner insert" on duel_votes for insert with check (auth.uid() = user_id);

-- ── 3. Vote count on duels for popularity sorting ───────────────────────
alter table duels add column if not exists community_vote_count int not null default 0;

-- Trigger to auto-increment community_vote_count on insert into duel_votes
create or replace function increment_duel_vote_count()
returns trigger as $$
begin
  update duels set community_vote_count = community_vote_count + 1
  where id = NEW.duel_id;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_increment_duel_vote_count on duel_votes;
create trigger trg_increment_duel_vote_count
  after insert on duel_votes
  for each row execute function increment_duel_vote_count();

-- ── 4. Update RLS on duels for soft delete visibility ───────────────────
-- Drop and recreate the public read policy so deleted duels are hidden
-- from everyone except the owner.
drop policy if exists "duels: public read" on duels;
create policy "duels: public read" on duels for select
  using (deleted_at is null or auth.uid() = user_id);

-- Allow owner to soft-delete (update deleted_at)
-- The existing "duels: owner update" policy already covers this.

-- ── 5. Update RLS on xcreates for soft delete ───────────────────────────
drop policy if exists "xcreates: owner read" on xcreates;
create policy "xcreates: owner read" on xcreates for select
  using (auth.uid() = user_id);
-- xcreates are private anyway (owner-only), so deleted_at is just for
-- the profile UI to know which ones to hide by default.
