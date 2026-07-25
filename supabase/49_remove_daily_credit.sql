-- 49_remove_daily_credit.sql — daily $1 free credit REMOVED (CC, July 20).
-- Free XDuels are the free tier; XCreate credits are purchase-only.
-- The app no longer calls grant_daily_credits; this drops the function so
-- nothing can grant it by accident. Historical 'daily_credit' rows in
-- giveaway_daily and credit_transactions are kept for accounting.

drop function if exists grant_daily_credits(uuid, int);
