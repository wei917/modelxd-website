-- XDRating data columns for duels table
-- vote_changed: true when user switched their vote after price reveal (vote1 != vote2)
-- This powers XDR-S (Stickiness) — how often a model retains votes post-reveal.

alter table duels add column if not exists vote_changed boolean;

-- Backfill: compute vote_changed for existing duels that have both votes
update duels
set vote_changed = (vote1_model_id is distinct from vote2_model_id)
where vote1 is not null and vote2 is not null and vote_changed is null;
