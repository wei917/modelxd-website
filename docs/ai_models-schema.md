# `ai_models` schema reference

Authoritative reference for the post-migration `ai_models` table. Use this when writing any process — cron job, sync script, manual SQL — that populates or updates rows.

> **State as of:** all migrations through `27_consolidate_text_pricing.sql` applied. 15 columns.

## Column list

| column | type | nullable | populated when | notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL (default `gen_random_uuid()`) | always | primary key. Don't write this on insert; let Postgres generate it. |
| `provider` | `text` | NOT NULL | always | One of: `openai`, `google`, `alibaba`. Used everywhere as a discriminator. Add a new value here only when the provider's runtime support is also wired up in `lib/providers/`. |
| `model_name` | `text` | NOT NULL | always | Exact API id used to call the model (e.g. `gpt-5.4`, `gemini-3.1-pro-preview`, `wan2.7-i2v`). Together with `provider` this is the natural key — sync upserts use `ON CONFLICT (provider, model_name)`. |
| `display_name` | `text` | NOT NULL | always | Human-facing label shown in the UI (e.g. `GPT-5.4 Pro`, `Nano Banana 2`, `Wan 2.7 I2V`). Should be short — fits in a leaderboard cell. |
| `enabled` | `bool` | NOT NULL (default `true`) | always | Only `enabled = true` rows are picked for duels and offered in XCreate. Use this to soft-hide deprecated models without losing their historical vote data. |
| `is_popular` | `bool` | NOT NULL (default `false`) | always | Drives the **POPULAR** badge on the leaderboard. Only set on the headline model per provider per mode. |
| `created_at` | `timestamptz` | NOT NULL (default `now()`) | auto | Row creation. Don't set explicitly. |
| `updated_at` | `timestamptz` | NOT NULL (default `now()`) | auto / on upsert | Update this whenever you touch a row. The sync scripts set it to `now()`. |
| `released_at` | `timestamptz` | nullable | mostly | When this exact model variant became publicly available. Month-precision is fine (use the 1st of the month). Hand-entered through `/admin/models`. Null is acceptable for legacy/deprecated rows. |
| `input_modalities` | `text[]` | NOT NULL | always | What the model **accepts**. Subset of `['text', 'image', 'video', 'audio']`. List a modality here **only if it's required** — purely text-prompted image generators have `['text']`, not `['text', 'image']`. The duel route uses this to decide whether a model needs an attachment. |
| `output_modalities` | `text[]` | NOT NULL | always | What the model **generates**. One of `['text']`, `['image']`, `['video']`, or `['text','image']` (for image models that may also return text). This is what `getModelsByMode()` queries — it's the canonical mode discriminator. |
| `tags` | `text[]` | NOT NULL (default `'{}'`) | always | Free-form labels: `'vision'`, `'reasoning'`, `'image-edit'`, `'video-i2v'`, etc. Used for filtering and provider-specific behavior. Empty array is fine. |
| `modes` | `text[]` | NOT NULL (default `'{}'`) | always | Set of input-shape patterns the model supports — a model declares the menu, the user picks one at generation time. e.g. Veo 3 supports `text_to_video`, `image_to_video`, `video_to_video`, and `start_end_frames`. See [`modes`](#modes). |
| `text_pricing` | `jsonb` | nullable | text models | `{ rates }` only. See [Pricing jsonbs](#pricing-jsonbs). |
| `image_pricing` | `jsonb` | nullable | image models | `{ rates }` only. See [Pricing jsonbs](#pricing-jsonbs). |
| `video_pricing` | `jsonb` | nullable | video models | `{ rates }` only. See [Pricing jsonbs](#pricing-jsonbs). |
| `input_config` | `jsonb` | nullable | only for non-default details | Per-modality count override + capability flags. The mode column does the heavy lifting. See [Input / Output config](#input--output-config). |
| `output_config` | `jsonb` | nullable | when the model produces image/video | Per-modality output options — pixel sizes, aspect ratios, durations, capability flags. See [Input / Output config](#input--output-config). |

## Pricing jsonbs

Pricing is purely about $ — every cell is just `{ rates }`. Sizes / durations / aspect ratios moved into [`output_config`](#input--output-config).

### `text_pricing`

```jsonc
{
  "rates": {
    "input":  21,    // $ per 1M input tokens
    "output": 168    // $ per 1M output tokens
  }
}
```

- Total cost = `(input_tokens × rates.input + output_tokens × rates.output) / 1_000_000`.

### `image_pricing`

```jsonc
{
  "rates": {
    "low":    0.009,    // $ per generated image
    "medium": 0.034,
    "high":   0.133
  }
}
```

- Variant keys are free-form. Common: `low` / `medium` / `high` (OpenAI), `default` (Google), or whatever the provider uses.
- Total cost = `rates[quality]` (per image).

### `video_pricing`

```jsonc
{
  "rates": {
    "720p":  0.10,
    "1080p": 0.20,
    "4k":    0.30
  }
}
```

- Variant keys are resolution tiers. Free-form — use `default` for models that don't differentiate.
- Total cost = `rates[resolution] × duration_seconds`.

## Input / Output config

These two columns capture model capabilities that aren't $ rates: how the model accepts inputs (slot count, role labels) and what it produces (sizes, aspect ratios, durations, capability flags). Both are keyed by modality.

### `modes`

Array of input-shape patterns the model supports. Each row declares its menu; the XCreate UI surfaces a mode picker populated from this array, and the user's choice drives how attachment slots render.

| mode | output | meaning |
|---|---|---|
| `text_to_text` | text | plain text in, text out |
| `vision_to_text` | text | text + 1 image, text out (vision text models) |
| `text_to_image` | image | prompt → image |
| `image_edit` | image | text + 1 image → image (single-image edit) |
| `text_to_video` | video | prompt → video |
| `image_to_video` | video | text + 1 image → video |
| `video_to_video` | video | text + 1 video → video (extension / edit) |
| `start_end_frames` | video | text + 2 images (start, end) → video |
| `reference_frames` | image or video | text + N reference images → image or video |

A model's modes are typically subsets within one output type (a Veo row has only video modes, a Gemini row has only text modes). The admin UI filters the checkbox options by `output_modalities`. Empty array is allowed for legacy rows that haven't been categorised yet.

**Examples:**

```jsonc
// Veo 3 — most flexible video model
{ "modes": ["text_to_video", "image_to_video", "video_to_video", "start_end_frames"] }

// Wan 2.7 i2v — image-to-video only
{ "modes": ["image_to_video"] }

// Wan kf2v
{ "modes": ["start_end_frames"] }

// Gemini 3 Pro Image Preview (Nano Banana Pro)
{ "modes": ["text_to_image", "image_edit", "reference_frames"] }
```

### `input_config`

Per-modality details that the row-level `mode` *doesn't* imply. Most rows have `input_config = null`. Only set entries when one of these applies:

- **Count override** — `mode = reference_frames` needs to know how many slots to expose. Set `input_config.image.count` (or `.video.count`).
- **Capability flags** — e.g. `veo_video_only` on a video input to constrain the picker.

```jsonc
// Multi-reference (3 references) → video
{
  "image": { "count": 3 }
}

// Veo extension — input_config narrows what kind of video is acceptable
{
  "video": { "capabilities": ["veo_video_only"] }
}
```

Per-modality fields:

- `count` — slot count override. Only meaningful for `mode = reference_frames`.
- `capabilities` — free-form flags consumed by the runtime / UI.

**Default (absent / null entry):** the mode field already encodes the shape; don't bother filling input_config unless you need a count override or capability flags.

### `output_config`

```jsonc
// Veo 3 — landscape + portrait, 4/6/8s clips, supports extension + frame-specific
{
  "video": {
    "sizes":         ["1280x720", "720x1280"],
    "aspect_ratios": ["16:9", "9:16"],
    "durations":     [4, 6, 8],
    "capabilities":  ["extension", "frame_specific"]
  }
}

// Nano Banana — four square sizes, 1:1 only
{
  "image": {
    "sizes":         ["512x512", "1024x1024", "2048x2048", "4096x4096"],
    "aspect_ratios": ["1:1"]
  }
}
```

Per-modality fields:

- `sizes` — pixel dimensions the model can output.
- `aspect_ratios` — supported aspect ratios. Common values: `16:9`, `9:16`, `1:1`.
- `durations` — supported lengths in integer seconds (video only).
- `capabilities` — free-form output-side flags (`extension`, `frame_specific`, etc.) used to gate UI features.

## Required fields on insert

Minimum payload to create a usable row:

```ts
{
  provider:           'openai',                  // required
  model_name:         'gpt-5.4',                 // required
  display_name:       'GPT-5.4',                 // required
  input_modalities:   ['text', 'image'],         // required
  output_modalities:  ['text'],                  // required
  text_pricing:       { rates: { input: 21, output: 168 } }, // required for billable text
}
```

Everything else has a sensible default or is allowed to be null.

## Conventions

- **`provider` is the source-of-truth for routing.** `lib/providers/index.ts` dispatches on this value. Setting `provider = 'fictional-co'` will throw at runtime even if the row inserts cleanly.
- **`model_name` is exact.** It must be the literal string the provider's API expects. No spaces, no display-formatting. Date-pinned variants (`gpt-4o-2024-11-20`) and preview suffixes (`-preview`) are part of the name.
- **Modality semantics.** `input_modalities` lists *required* attachment types. A vision-capable text model that *optionally* takes images still has `input_modalities: ['text']` — the model can run without an attachment. Image generators with native multi-turn editing (OpenAI image models) have `input_modalities: ['text', 'image']` only when image input is required to reach the model's full capability.
- **`output_modalities` is what `getModelsByMode()` queries.** A model with `output_modalities: ['text']` will be picked for text duels, regardless of what's in `input_modalities`.
- **Pricing nulls on out-of-mode columns.** A text model has `text_pricing` populated and `image_pricing` / `video_pricing` null. Don't set the wrong-mode pricing column to `'{}'::jsonb` — leave it null.
- **`released_at` precision.** Month-level is fine; pin to the 1st of the month (e.g. `2026-02-01T00:00:00Z`). The leaderboard formats it as `Feb 2026`.
- **Tags are advisory.** No app code currently depends on a tag being present. Examples in use: `vision`, `reasoning`, `alibaba`, `image-gen`, `image-edit`, `video-i2v`, `video-gen`, `video-edit`, `video-s2v`.

## Example rows

### Text model

```sql
INSERT INTO ai_models (
  provider, model_name, display_name,
  input_modalities, output_modalities,
  text_pricing,
  is_popular, tags, released_at
) VALUES (
  'openai', 'gpt-5.4-pro', 'GPT-5.4 Pro',
  ARRAY['text','image'], ARRAY['text'],
  '{"rates":{"input":21,"output":168}}'::jsonb,
  true, ARRAY['vision','reasoning'], '2026-03-01T00:00:00Z'
);
```

### Image model

```sql
INSERT INTO ai_models (
  provider, model_name, display_name,
  input_modalities, output_modalities,
  image_pricing, output_config,
  is_popular, tags, released_at
) VALUES (
  'google', 'gemini-3-pro-image-preview', 'Nano Banana Pro',
  ARRAY['text','image'], ARRAY['text','image'],
  '{ "rates": {"default": 0.04} }'::jsonb,
  '{ "image": { "sizes": ["1024x1024","2048x2048","4096x4096"], "aspect_ratios": ["1:1"] } }'::jsonb,
  true, ARRAY['vision'], '2025-11-01T00:00:00Z'
);
```

### Video model

```sql
INSERT INTO ai_models (
  provider, model_name, display_name,
  input_modalities, output_modalities,
  video_pricing, input_config, output_config,
  is_popular, tags, released_at
) VALUES (
  'alibaba', 'wan2.7-i2v', 'Wan 2.7 I2V',
  ARRAY['text','image'], ARRAY['video'],
  '{ "rates": {"720p": 0.10, "1080p": 0.20} }'::jsonb,
  null,
  '{ "video": { "sizes": ["1280x720","720x1280"], "aspect_ratios": ["16:9","9:16"], "durations": [5, 10] } }'::jsonb,
  false, ARRAY['alibaba','video-i2v'], '2026-04-01T00:00:00Z'
);
```

## Upsert pattern

For idempotent population (run the same script repeatedly without creating dupes):

```sql
INSERT INTO ai_models (provider, model_name, display_name, ...)
VALUES (...)
ON CONFLICT (provider, model_name) DO UPDATE SET
  display_name      = EXCLUDED.display_name,
  input_modalities  = EXCLUDED.input_modalities,
  output_modalities = EXCLUDED.output_modalities,
  text_pricing      = EXCLUDED.text_pricing,
  image_pricing     = EXCLUDED.image_pricing,
  video_pricing     = EXCLUDED.video_pricing,
  input_config      = EXCLUDED.input_config,
  output_config     = EXCLUDED.output_config,
  tags              = EXCLUDED.tags,
  is_popular        = EXCLUDED.is_popular,
  released_at       = COALESCE(ai_models.released_at, EXCLUDED.released_at),
  updated_at        = now();
```

The `COALESCE` on `released_at` keeps an existing date if the new payload doesn't have one (helpful when the cron source doesn't always know the date).

## Migration history

| migration | what it did |
|---|---|
| `01_models.sql` | Initial schema; added `input_modalities` / `output_modalities`. |
| `24_drop_redundant_columns.sql` | Dropped `modes`, `added_at`, `description`, `context_window`, `max_output_tokens`. |
| `25_consolidate_pricing.sql` | Folded `image_sizes`, `video_sizes`, `video_durations` into the existing pricing jsonbs as `sizes` / `durations`; dropped `cached_input_price`, `input_image_price`, `output_image_price`. Restructured `image_pricing` and `video_pricing` to nest rates under a `rates` key. |
| `26_rename_name_to_display_name.sql` | `name` → `display_name`. |
| `27_consolidate_text_pricing.sql` | New `text_pricing` jsonb; migrated `input_price` / `output_price` into it; dropped both flat columns. |
| `30_rename_flagship_to_popular.sql` | `is_flagship` → `is_popular`. |
| `31_input_output_config.sql` | Added `input_config` + `output_config` jsonb. Migrated `image_pricing.sizes`, `video_pricing.sizes`, `video_pricing.durations` into `output_config.{image,video}`. Pricing collapsed to `{ rates }` only. |
| `32_add_mode_column.sql` | Added the row-level `mode` text column (later replaced by `modes`). The pattern-based `input_config[modality].pattern` field added briefly in development is gone — `input_config` is now just count + capabilities. |
| `33_replace_mode_with_modes.sql` | A model can support multiple input shapes (Veo 3 supports text/image/video/keyframe-pair → video in the same row), so the singular `mode text` was wrong. Dropped and replaced with `modes text[]`. |
