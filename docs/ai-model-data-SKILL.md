---
name: modelxd-ai-model-data
description: Generate importable catalog rows for ModelXD's ai_models Supabase table. Use when asked to add a new AI model (text, image, or video) to the ModelXD catalog — research the provider's official docs, then emit one JSON object per model matching the schema below. Output is reviewed and imported by another agent; never write to the database yourself.
---

# ModelXD `ai_models` — data generation skill

You are generating catalog rows for ModelXD, a product that runs the same prompt
against multiple AI models side-by-side and lets users vote. Every field you
emit drives real UI and real billing estimates, so **accuracy beats coverage**.

## The one rule that matters most

**Every capability and price MUST come from the provider's official docs or SDK
types — never from memory, never inferred from a similar model.** If you cannot
verify a field, set it to `null` and add it to `unverified_fields` in your
output notes. Wrong data here silently mis-bills users or renders broken
config UI.

## Output contract

Emit a JSON array of row objects (one per model), plus a short notes section
listing sources consulted and any `unverified_fields`. Do NOT emit SQL. Do NOT
include `id`, `created_at`, or `updated_at` — the importer handles those.

## Table schema

| column              | type        | required | notes |
|---------------------|-------------|----------|-------|
| `provider`          | text        | ✅ | lowercase vendor key. Existing: `openai`, `google`, `alibaba`. New providers need app-side support first — flag, don't invent. |
| `model_name`        | text        | ✅ | the EXACT provider-side API identifier (e.g. `gemini-3.1-flash-image`, `veo-3.1-generate-preview`). Natural key together with `provider`. |
| `display_name`      | text        | ✅ | human name shown in UI, may include nickname (e.g. `Nano Banana 2 - Gemini 3.1 Flash Image`). |
| `enabled`           | boolean     |    | default `false` for new rows — a human flips it on after a live smoke test. |
| `is_popular`        | boolean     |    | default `false`. At most ONE popular model per output modality. |
| `released_at`       | timestamptz |    | provider's public release date, `YYYY-MM-DDT00:00:00Z`. Drives "newest first" ordering. |
| `tags`              | text[]      |    | optional freeform; usually `[]`. |
| `input_modalities`  | text[]      |    | subset of `text`, `image`, `video`, `audio`, `pdf`. |
| `output_modalities` | text[]      |    | which UI mode(s) the model appears in: `text`, `image`, `video`. |
| `modes`             | text[]      | ✅ | processing recipes — see vocabulary below. |
| `input_config`      | jsonb       |    | input limits — see shapes below. |
| `output_config`     | jsonb       |    | selectable output options — see shapes below. |
| `model_pricing`     | jsonb       |    | pricing — see shapes below. |

## `modes` vocabulary (closed list — do not invent new values)

```
text:  text_to_text, image_to_text, vision_to_text, video_to_text,
       audio_to_text, pdf_to_text
image: text_to_image, image_edit, reference_frames
video: text_to_video, image_to_video, video_to_video,
       start_end_frames, reference_frames
```

`reference_frames` means the model accepts MULTIPLE input images as subject/
style references. `image_edit` means it transforms ONE primary input image.
List a mode only if the provider docs explicitly support it.

## `input_config` shape

```jsonc
{ "image": { "count": 3 } }   // max input/reference images PER REQUEST
```
`null` if the model takes no image input. Use the documented hard limit, not a
recommendation (e.g. Veo 3.1 referenceImages = 3; gpt-image-2 edits = 16;
Gemini 3.x image = 14).

## `output_config` shapes

```jsonc
// image models
{ "image": {
    "sizes":         ["1024x1024", "1536x1024"],   // exact WxH strings the API accepts
                                                    // (Gemini uses bare "1024"/"2048"/"4096" tiers)
    "qualities":     ["low", "medium", "high"],    // ONLY if the API has a quality param
    "aspect_ratios": ["1:1", "16:9", "9:16"],
    "max_count":     4                              // max images per request (n param);
                                                    // for Gemini (no n param) = sensible parallel-call cap
} }

// video models
{ "video": {
    "sizes": ["720p", "1080p", "4k"],
    "aspect_ratios": ["16:9", "9:16"],
    "durations_by_resolution": {
      "720p":  [4, 6, 8],                 // discrete list of allowed seconds…
      "1080p": { "min": 3, "max": 15 }    // …or a min/max range — both forms allowed
    }
} }

// text models (only when the API exposes reasoning-effort levels)
{ "text": { "thinking_levels": ["none", "low", "medium", "high"] } }
```

## `model_pricing` shapes (all prices in USD)

```jsonc
// token pricing — USD per 1 MILLION tokens
{ "tokens": {
    "text_input":   5,
    "text_output":  30,                   // or { "default": 30, "by_level": { "high": 40 } }
    "image_input":  8,
    "image_output": 30
} }

// image models — flat USD per generated image.
// Include BOTH "quality:size" combo keys AND single-key fallbacks;
// the estimator looks up "quality:size" → size → quality → "medium" → "default".
{ "per_image": {
    "medium":           0.0527,
    "medium:1024x1024": 0.0527,
    "high:1024x1024":   0.2107
} }

// video models — USD per second of output, keyed by resolution
{ "per_video_second": { "720p": 0.4, "1080p": 0.4, "4k": 0.6 } }
```

Image models may carry BOTH `tokens` and `per_image` (e.g. gpt-image-2:
token-priced under the hood, per_image derived from measured token counts).
When the provider prices per token, compute per_image as
`output_tokens_for_that_size × price_per_token` and say so in your notes.

## Complete example row

```json
{
  "provider": "google",
  "model_name": "veo-3.1-generate-preview",
  "display_name": "Veo 3.1",
  "enabled": false,
  "is_popular": false,
  "released_at": "2026-05-20T00:00:00Z",
  "tags": [],
  "input_modalities": ["text", "image"],
  "output_modalities": ["video"],
  "modes": ["text_to_video", "image_to_video", "video_to_video", "start_end_frames", "reference_frames"],
  "input_config": { "image": { "count": 3 } },
  "output_config": { "video": {
    "sizes": ["720p", "1080p", "4k"],
    "durations_by_resolution": { "720p": [4, 6, 8], "1080p": [8], "4k": [8] }
  } },
  "model_pricing": { "per_video_second": { "720p": 0.4, "1080p": 0.4, "4k": 0.6 } }
}
```

## Checklist before you emit

1. `model_name` copied character-for-character from the provider's API docs.
2. Every mode, size, duration, count and price traceable to an official source.
3. `enabled: false`.
4. Sizes/aspect_ratios are values the API literally accepts (not marketing copy).
5. Notes section: sources (URLs) + `unverified_fields` list (may be empty).
