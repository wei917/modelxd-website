-- 88_mbti.sql — XMind: MBTI-style assessment results for models (and people).
--
-- One row per RUN, never one per model. Models are not deterministic, so a
-- single pass gives one type and a dimension decided 8-7 can flip on a re-run.
-- Keeping every run lets the page say "INTJ, 3 of 3 runs" instead of asserting
-- a personality from one sample.
--
-- `answers` keeps all 60 raw letters. A type without its answers cannot be
-- checked, and the whole point of publishing this is that someone can.

create table if not exists mbti_results (
  id            uuid primary key default gen_random_uuid(),
  -- 'model' for an AI run; 'user' for a person who took it on the page.
  subject_kind  text not null default 'model' check (subject_kind in ('model', 'user')),

  -- Model subjects
  model_name    text,
  display_name  text,
  provider      text,
  effort        text,

  -- Human subjects (nullable: taking the test signed-out is fine)
  user_id       uuid references auth.users(id) on delete cascade,

  run_index     integer not null default 0,
  mbti_type     text not null check (mbti_type ~ '^[EI][SN][TF][JP]$'),
  -- {"E":2,"I":13,"S":5,"N":10,...} — the margin matters as much as the type
  tally         jsonb not null,
  -- [{"n":1,"letter":"B","raw":"B"}, ...]
  answers       jsonb not null,
  cost_usd      numeric(10,6),

  -- Exactly what was asked, so a result can be reproduced or challenged
  system_prompt text,
  format_prompt text,
  question_set  text,

  created_at    timestamptz not null default now()
);

create index if not exists mbti_results_model_idx on mbti_results (model_name, created_at desc);
create index if not exists mbti_results_kind_idx  on mbti_results (subject_kind, created_at desc);

alter table mbti_results enable row level security;

-- Model results are published on purpose — the page is the point.
drop policy if exists "mbti: public read models" on mbti_results;
create policy "mbti: public read models" on mbti_results
  for select using (subject_kind = 'model');

-- A person sees only their own result.
drop policy if exists "mbti: owner read" on mbti_results;
create policy "mbti: owner read" on mbti_results
  for select using (auth.uid() = user_id);

drop policy if exists "mbti: owner insert" on mbti_results;
create policy "mbti: owner insert" on mbti_results
  for insert with check (auth.uid() = user_id and subject_kind = 'user');

-- Model rows are written by the script with the service role, which bypasses RLS.
