-- 89_tripo_tasks.sql — Tripo3D proxy task ledger (the /api/v1/tripo/* routes).
--
-- Why a table at all (the spec's operational asks, verbatim):
--   "A lost connection must be recoverable ... please don't discard task ids"
--   "Task ids must chain" — rig-check/rig take {"input": "<task_id>"}
--
-- We do NOT rewrite Tripo's task ids — the id Tripo returns is the id the
-- caller polls and chains with, so there is no mapping to lose. This table
-- adds ownership (nobody polls or chains another user's task), recovery
-- (GET /api/v1/tripo/tasks lists yours), and settle-time billing.

create table if not exists tripo_tasks (
  task_id       text primary key,              -- Tripo's own id, verbatim
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('text_to_model','image_to_model','rig_check','rig')),
  input_task_id text,                          -- the chained-from task, when kind is rig_check/rig
  params        jsonb not null default '{}'::jsonb,
  -- Billing: debited at create from Tripo's published price table (P1 rates
  -- when the model string is unknown — the HIGHER rate, reconciled down);
  -- reconciled ONCE against the task's consumed_credit at first terminal poll.
  billed_cents  integer not null default 0,
  reconciled    boolean not null default false,
  status_cache  text,
  created_at    timestamptz not null default now()
);

create index if not exists tripo_tasks_user_idx on tripo_tasks (user_id, created_at desc);

alter table tripo_tasks enable row level security;

drop policy if exists "tripo: owner read" on tripo_tasks;
create policy "tripo: owner read" on tripo_tasks
  for select using (auth.uid() = user_id);
-- Writes: service role only (the routes). A client that could insert rows
-- could claim ownership of someone else's task id.
