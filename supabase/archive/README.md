# Archived migrations

These SQL files have already been applied to all live ModelXD databases
(prod + dev). They are kept here for **history / audit only**. Do not run
them against a live database — many depend on a schema state that no
longer exists.

## Why they're archived

The top-level `supabase/` directory holds the *canonical* schema files
that define the current state of each table. A fresh database should be
bootstrapped from those alone:

```
01_models.sql              ai_models
02_duels.sql               duels
03_xcreates.sql            xcreates
04_attachments.sql         attachments
05_profiles.sql            profiles + activity_logs
07_xcreate_jobs.sql        xcreate_jobs
11_credits.sql             credit_balances + credit_transactions
12_stripe.sql              stripe_events
16_community_features.sql  soft-delete + vote audit
17_xcreate_chat_history.sql xcreate chat columns
23_provider_calls.sql      provider_calls telemetry
38_drop_gpt_image_1.sql    pending: removes gpt-image-1 catalog rows
storage.sql                Storage buckets
```

The migrations in this folder *led to* that state, but rerunning them
on a fresh DB after the canonical files have been applied is at best a
no-op and at worst will fail (e.g. dropping a column that doesn't exist
yet, or renaming something already at its new name).

## What's in here

A roughly chronological set of one-off schema changes from April–May 2026:

- **OpenRouter era**: `08_openrouter_rebuild`, `21_drop_openrouter` —
  added then removed OpenRouter as a provider.
- **Column adds/renames**: `09_flagship_column`, `10_released_at`,
  `13_rename_to_xcreate`, `14_xdrating_columns`, `26_rename_name_to_display_name`,
  `30_rename_flagship_to_popular`, `36_rename_vision_to_image`.
- **Pricing schema evolution**: `25_consolidate_pricing`, `27_consolidate_text_pricing`,
  `34_consolidate_model_pricing` — collapsed many per-tier columns into
  one `model_pricing` jsonb.
- **Modes / config**: `31_input_output_config`, `32_add_mode_column`,
  `33_replace_mode_with_modes` — replaced the single `mode` text column
  with a `modes text[]`.
- **Catalog cleanup**: `15_disable_older_models`, `18_qwen_models`,
  `19_direct_providers`, `20_rename_qwen_provider`, `37_drop_xai`.
- **Provider telemetry**: `35_provider_calls_telemetry` — early
  iteration; current state lives in `23_provider_calls.sql`.
- **One-time data ops**: `06_fix_video_models`, `22_reset_all_data`,
  `24_drop_redundant_columns`.

## If you need to recover a migration

The git history has the originals; `git log -- supabase/` shows when each
landed. To roll back a specific change, write a *new* migration at the
top level — don't replay an archived one.
