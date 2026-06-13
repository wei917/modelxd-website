-- ModelXD: provider_calls — append-only event log for AI provider calls.
--
-- Two rows per provider request:
--   1. event='start' inserted right before the call goes out
--   2. event='end'   inserted when the call returns (success or failed)
-- Both rows share the same `request_id` so they pair up.
--
-- Rows are immutable — there is no UPDATE path. If the end row is
-- missing, the start row is the breadcrumb that the request happened
-- (most likely the Lambda froze, or the provider hung past maxDuration).
--
-- Both inserts are written by the `log-provider-call` Edge Function,
-- which is invoked fire-and-forget from lib/providers/index.ts. The
-- provider request never waits on either log write.
--
-- Retention: forever (no auto-prune cron). Volume is modest — a duel
-- writes 4-8 rows; an xcreate writes 2-N depending on slot count.

create table if not exists provider_calls (
  id            uuid        primary key default gen_random_uuid(),
  -- Correlation id shared by the start and end events of one request.
  -- Generated client-side in Next.js so both events can fire async.
  request_id    uuid        not null,
  event         text        not null     check (event in ('start','end')),
  created_at    timestamptz not null     default now(),

  -- Request descriptors (present on both events for query convenience —
  -- no join needed to ask "how many image calls did Google get today").
  provider      text        not null     check (provider in ('openai','google','alibaba')),
  model_name    text        not null,                            -- API id, e.g. 'gpt-5.4'
  model_id      uuid        references ai_models(id) on delete set null,
  mode          text        not null     check (mode in ('text','image','video')),
  user_id       uuid        references auth.users(id) on delete set null,

  -- Outcome — only populated on event='end'.
  status        text                     check (status in ('success','failed')),
  error_message text,
  latency_ms    integer,
  -- Usage / cost — only populated on event='end' when the provider surfaces it.
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12, 6)
);

-- Hot paths: per-model dashboards, recent activity, per-user attribution,
-- pairing start ↔ end events.
create index if not exists idx_provider_calls_request_id     on provider_calls (request_id);
create index if not exists idx_provider_calls_provider_model on provider_calls (provider, model_name);
create index if not exists idx_provider_calls_created_at     on provider_calls (created_at desc);
create index if not exists idx_provider_calls_user_id        on provider_calls (user_id);
create index if not exists idx_provider_calls_event          on provider_calls (event, created_at desc);

-- Lock down: no public reads, no public writes. The Edge Function uses
-- the service role key, which bypasses RLS. Admin queries should also
-- run as service role (e.g. via the Supabase SQL editor).
alter table provider_calls enable row level security;
