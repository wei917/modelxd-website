-- 74_feedback.sql — in-app bug reports (owner, Aug 7)
-- Reports land HERE (table + private bucket), not in anyone's inbox:
-- the form offers the contact address as click-to-copy instead. Service-
-- role only; screenshots are private — they show whatever the user had
-- on screen, which can include their own generations and balances.

create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  email           text,
  page            text not null default '',
  description     text not null,
  context         jsonb not null default '{}'::jsonb,
  screenshot_path text,
  created_at      timestamptz not null default now()
);

alter table feedback enable row level security;
-- No policies on purpose: service-role reads/writes only.

insert into storage.buckets (id, name, public)
  values ('feedback', 'feedback', false)
  on conflict (id) do nothing;
