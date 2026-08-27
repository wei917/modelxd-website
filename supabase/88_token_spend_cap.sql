-- 88_token_spend_cap.sql — make the API-key spend cap hold under concurrency.
--
-- v1 (82_api_tokens.sql) checked spent_usd at request time and accumulated it
-- fire-and-forget at settle. That is a floor for a human clicking, and no wall
-- at all for an agent: ten parallel generations all read the same spent_usd,
-- all pass the check, and none of them has recorded anything yet. The cap was
-- documented as overshooting "by at most one generation" — really it overshoots
-- by however many calls are in flight, which for the MCP surface is the whole
-- point of the surface.
--
-- Fix is the same one the wallet already uses: RESERVE the estimate before
-- generating, adjust to the real cost at settle. Check-and-increment happens in
-- ONE statement, so Postgres serializes concurrent callers on the row and the
-- second one sees the first one's reservation.
--
-- The cap stays a LIFETIME ceiling per key. A rolling/daily window is a
-- separate decision (extra column + a window start), deliberately not bundled.

-- Atomic check-and-reserve. Returns the new spent_usd, or NO ROW when the
-- reservation would cross the cap — the caller reads "no row" as 402.
create or replace function reserve_token_spend(p_token_id uuid, p_usd numeric)
returns numeric
language sql
security definer
set search_path = public
as $$
  update api_tokens
     set spent_usd    = spent_usd + greatest(p_usd, 0),
         last_used_at = now()
   where id = p_token_id
     and revoked_at is null
     and (spend_cap_usd is null
          or spent_usd + greatest(p_usd, 0) <= spend_cap_usd)
  returning spent_usd;
$$;

revoke all on function reserve_token_spend(uuid, numeric) from public;

-- Settle: a SIGNED delta against the reservation (negative when the run came in
-- under estimate, or produced nothing). Unlike increment_token_spend this must
-- accept negatives, so the clamp is on the RESULT instead of the input — a key
-- can never be pushed below zero spend, and never below what it truly spent.
create or replace function adjust_token_spend(p_token_id uuid, p_usd numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update api_tokens
     set spent_usd    = greatest(spent_usd + p_usd, 0),
         last_used_at = now()
   where id = p_token_id;
$$;

revoke all on function adjust_token_spend(uuid, numeric) from public;
