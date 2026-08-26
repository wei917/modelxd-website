-- 87_referrals.sql — referral credits.
--
--   any new user      $10  at signup                     (68_welcome_credit)
--   referred user (B) +$5  when B binds a payment card    -> $15 total
--   referrer     (A)  $5   when B binds a payment card
--
-- The card is the point. Google's email_verified proves someone controls a
-- Google account, not that they are a distinct person: Gmail is free and a
-- domain owner gets ~50 free Cloud Identity accounts. Phone verification never
-- appears in the OAuth token. A Stripe card fingerprint is the only uniqueness
-- signal we can actually obtain, and it is the same string for the same
-- physical card across every account — so one card funds one referral, ever.
--
-- The $10 welcome stays card-free on purpose: a referral link must always be an
-- upgrade, never a demand for a card. Gating the whole $15 would make the link
-- worse than signing up directly, and nobody would click it.
--
-- Accepted, deliberately: a person with one card and two Google accounts can
-- collect the pair ONCE ($30 rather than $10). It is not repeatable — the
-- second attempt reuses the fingerprint — and stopping it would mean asking
-- every referrer for a card.

-- A short, human-typeable code per user. Not sequential: a guessable code lets
-- someone attribute their signup to a stranger.
create table if not exists referral_codes (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  code        text not null unique,
  created_at  timestamptz not null default now()
);

-- One row per referred signup. UNIQUE on referee_id: an account can be
-- referred once, by one person, forever.
create table if not exists referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references auth.users(id) on delete cascade,
  referee_id      uuid not null unique references auth.users(id) on delete cascade,
  code            text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'paid', 'rejected')),
  -- Why a pending referral was refused, for support answers later.
  rejected_reason text,
  -- Signals recorded but NEVER enforced (owner, Aug 25): if abuse appears we
  -- want to see its shape, and this history cannot be reconstructed after the
  -- fact. Nothing reads these to make a decision.
  referee_email_domain text,
  referee_signup_ip    inet,
  card_fingerprint     text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  constraint referral_not_self check (referrer_id <> referee_id)
);

create index if not exists referrals_referrer_idx on referrals (referrer_id, status);
create index if not exists referrals_fingerprint_idx on referrals (card_fingerprint)
  where card_fingerprint is not null;

-- One card, one referral bonus, ever — across every account. A partial unique
-- index on PAID rows only: a rejected duplicate keeps its fingerprint for the
-- audit trail without blocking the legitimate holder.
create unique index if not exists referrals_one_card_once
  on referrals (card_fingerprint) where status = 'paid' and card_fingerprint is not null;

-- Cards seen anywhere, so a fingerprint that first appeared on a NON-referral
-- account still counts as used. Without this, someone could fund an ordinary
-- account with a card and then reuse it to claim a referral.
create table if not exists payment_fingerprints (
  fingerprint text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  first_seen  timestamptz not null default now(),
  primary key (fingerprint, user_id)
);

alter table referral_codes      enable row level security;
alter table referrals           enable row level security;
alter table payment_fingerprints enable row level security;

-- Owner-read only. Every write goes through the service role: a client that
-- could insert a referral could pay itself.
drop policy if exists "referral_codes: owner read" on referral_codes;
create policy "referral_codes: owner read" on referral_codes
  for select using (auth.uid() = user_id);

drop policy if exists "referrals: referrer read" on referrals;
create policy "referrals: referrer read" on referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referee_id);

-- payment_fingerprints: no policy at all — service role only. A user learning
-- which fingerprints exist would learn how to probe for other people's cards.

-- Codes for everyone who already exists; new users get one on first visit to
-- the profile page (the API mints on demand, so no trigger to keep in sync).
insert into referral_codes (user_id, code)
select id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
from auth.users
on conflict (user_id) do nothing;
