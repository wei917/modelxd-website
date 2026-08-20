-- 83_price_history.sql — pricing audit stamps + price change history
--
-- Two records the catalog was missing (owner ask, 2026-08-20):
--   1. WHEN was each row last price-AUDITED (verified against the
--      provider's official page — docs/price-audit.md), including rows
--      found correct that no write ever touches.
--   2. WHAT changed WHEN: an append-only history of every model_pricing
--      change, written by trigger so admin-UI edits, audit scripts, and
--      any future write path are all captured without cooperation.
--
-- Separate table on purpose: ai_models stays a small mutable catalog row;
-- history is append-only, indexable by time, and survives model deletion
-- (provider/model_name are denormalized; model_id nulls out on delete).

-- 1) Audit stamp -------------------------------------------------------
alter table ai_models add column if not exists pricing_audited_at timestamptz;

comment on column ai_models.pricing_audited_at is
  'Last time model_pricing was verified against the provider''s official pricing page (procedure: docs/price-audit.md). Stamped even when the price was correct and unchanged. NOT bumped by ordinary edits.';

-- 2) History table -----------------------------------------------------
create table if not exists ai_model_price_history (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid references ai_models(id) on delete set null,
  provider    text not null,
  model_name  text not null,
  old_pricing jsonb,                    -- null = row creation
  new_pricing jsonb,                    -- null = row deletion
  source      text not null default 'change',  -- 'change' | 'baseline'
  changed_at  timestamptz not null default now()
);

create index if not exists idx_price_history_model
  on ai_model_price_history (provider, model_name, changed_at desc);

-- Server-only: RLS on, no policies. The service role bypasses RLS;
-- browser clients get nothing. Open it up later if we ever want a public
-- "price drop" feed.
alter table ai_model_price_history enable row level security;

-- 3) Trigger -----------------------------------------------------------
create or replace function log_ai_model_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into ai_model_price_history
      (model_id, provider, model_name, old_pricing, new_pricing)
    values (new.id, new.provider, new.model_name, null, new.model_pricing);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.model_pricing is distinct from new.model_pricing then
      insert into ai_model_price_history
        (model_id, provider, model_name, old_pricing, new_pricing)
      values (new.id, new.provider, new.model_name,
              old.model_pricing, new.model_pricing);
    end if;
    return new;
  else  -- DELETE: model_id must be null (the referenced row is gone)
    insert into ai_model_price_history
      (model_id, provider, model_name, old_pricing, new_pricing)
    values (null, old.provider, old.model_name, old.model_pricing, null);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_ai_model_price_history on ai_models;
create trigger trg_ai_model_price_history
  after insert or update or delete on ai_models
  for each row execute function log_ai_model_price_change();

-- 4) Baseline snapshot --------------------------------------------------
-- Seed one row per model so every model has a starting point and
-- "price at date X" is answerable for any X after this migration runs.
insert into ai_model_price_history
  (model_id, provider, model_name, old_pricing, new_pricing, source)
select id, provider, model_name, null, model_pricing, 'baseline'
from ai_models;

-- Useful queries -------------------------------------------------------
-- Price of a model on a given date:
--   select new_pricing from ai_model_price_history
--   where model_name = 'X' and changed_at <= '2026-09-01'
--   order by changed_at desc limit 1;
--
-- Rows never audited or stale (>60 days):
--   select provider, model_name, pricing_audited_at from ai_models
--   where enabled and (pricing_audited_at is null
--                      or pricing_audited_at < now() - interval '60 days')
--   order by pricing_audited_at nulls first;
