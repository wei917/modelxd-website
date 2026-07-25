-- ModelXD: profiles locale columns for market analytics + last-seen.
-- Run in Supabase SQL Editor. Written by /api/credits/ensure-daily on
-- every authenticated page load (language = app language or
-- Accept-Language; country = Vercel x-vercel-ip-country geo header).
alter table profiles add column if not exists language     text;
alter table profiles add column if not exists country      text;
alter table profiles add column if not exists last_seen_at timestamptz;
