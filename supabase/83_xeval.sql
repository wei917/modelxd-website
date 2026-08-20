-- 83_xeval.sql — XEval published results (pilot: GDPval-XD text pool)
--
-- Three tables mirroring the local pilot store (gdpval-xd/xeval.db), so the
-- /xeval page can show not just ratings but the runs and verdicts behind
-- them — auditability is the product. Written by the owner-triggered publish
-- script (service role); public read-only via RLS, like the catalog.

create table if not exists xeval_ratings (
  fit_id       text not null,
  ts           timestamptz not null,
  entry        text not null,             -- "GPT-5.6 Sol @ low"
  model_id     uuid references ai_models(id),
  model_name   text not null,
  effort       text,
  rating       integer not null,          -- 1000 + 400*log10(strength)
  games        integer not null,
  wins         integer not null,
  judge_filter text not null,             -- e.g. claude-opus-5@high+rules
  params       text not null,
  primary key (fit_id, entry)
);

create table if not exists xeval_runs (
  run_id        text primary key,
  task_id       text not null,
  task_set      text not null,            -- gdpval
  set_provider  text not null,            -- openai
  sector        text,
  occupation    text,
  model_id      uuid references ai_models(id),
  model_name    text not null,
  display_name  text not null,
  provider      text not null,
  effort        text,
  status        text not null,
  turns         integer,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric,
  wall_s        numeric,
  model_s       numeric,
  started_at    timestamptz,
  finished_at   timestamptz
);

create table if not exists xeval_judgments (
  id            bigint primary key,
  task_id       text not null,
  run_a         text not null,
  run_b         text not null,
  winner_run_id text not null,
  method        text not null,            -- llm | rule:no_deliverables
  judge_model   text,
  judge_effort  text,
  reason        text,
  cost_usd      numeric,
  wall_s        numeric,
  ts            timestamptz not null
);

alter table xeval_ratings   enable row level security;
alter table xeval_runs      enable row level security;
alter table xeval_judgments enable row level security;

create policy "public read xeval_ratings"   on xeval_ratings   for select using (true);
create policy "public read xeval_runs"      on xeval_runs      for select using (true);
create policy "public read xeval_judgments" on xeval_judgments for select using (true);
