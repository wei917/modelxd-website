-- ModelXD: Stripe webhook idempotency
--
-- The webhook handler in app/api/stripe/webhook/route.ts checks for an
-- existing credit_transactions row with reference_type='stripe_checkout_session'
-- and the session id as reference_id before calling grant_credits. That
-- check-then-insert is *not* atomic under concurrent retries — Stripe can
-- fire two retries in parallel if the first one is slow, both see "no
-- existing row", and both grant.
--
-- This unique partial index lets Postgres catch that race: the second
-- insert of the same session id will raise 23505 unique_violation, which
-- propagates back as an error from grant_credits, the webhook returns
-- 500, Stripe retries, the third attempt finds the existing row, and
-- everything settles correctly.
--
-- Partial index because reference_id is nullable and we only want
-- uniqueness on Stripe session rows, not on every ledger entry.

create unique index if not exists credit_transactions_stripe_session_uniq
  on credit_transactions (reference_id)
  where reference_type = 'stripe_checkout_session';
