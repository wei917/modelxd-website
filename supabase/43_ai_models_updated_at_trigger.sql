-- ModelXD: auto-maintain ai_models.updated_at on every UPDATE.
--
-- The column already exists (was added in an earlier migration) but
-- nothing enforced it being current — only the /admin/models route
-- bothered to set it. Direct SQL editor edits, RPC calls, and ad-hoc
-- scripts would skip it.
--
-- Result before this trigger: updated_at lied about when a row was
-- actually touched. Useful for triaging "who's disabling models?"
-- moments to know it has to be a recent change.
--
-- Idempotent — safe to re-run.

create or replace function ai_models_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_models_updated_at on ai_models;
create trigger trg_ai_models_updated_at
  before update on ai_models
  for each row
  execute function ai_models_set_updated_at();
