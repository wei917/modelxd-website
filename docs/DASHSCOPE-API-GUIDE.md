# Alibaba Cloud DashScope API Guide for ModelXD

> **Context:** ModelXD (modelxd.com) is an AI model comparison platform. This guide covers how to integrate Alibaba Cloud's DashScope models (text, image, video) into the platform. The project uses Next.js App Router, Supabase, and Vercel. All provider calls should be raw `fetch` — do NOT use the OpenAI SDK for DashScope calls.

---

## 1. Account & Authentication

- **Region:** International (Singapore)
- **Base URL:** `https://dashscope-intl.aliyuncs.com`
- **API Key env var:** `DASHSCOPE_API_KEY`
- **Auth header:** `Authorization: Bearer ${process.env.DASHSCOPE_API_KEY}`
- **Key management:** https://www.alibabacloud.com/help/en/model-studio/get-api-key
- **CRITICAL:** Singapore, US (Virginia), and China (Beijing) API keys are NOT interchangeable. Use Singapore keys with `dashscope-intl` URLs only.

---

## 2. Text Generation (Qwen models)

### Endpoint
```
POST https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
```

### Available Models (International/Singapore)
| Model | Input $/1M tokens | Output $/1M tokens | Context |
|---|---|---|---|
| qwen3-max | $1.20 (≤32K) | $6.00 (≤32K) | 262K |
| qwen3.5-plus | $0.40 (≤256K) | $2.40 (≤256K) | 1M |
| qwen-plus | $0.40 (≤256K) | $1.20 non-thinking / $4.00 thinking (≤256K) | 1M |
| qwen3.5-flash | $0.10 (≤256K) | $0.40 (≤256K) | 1M |
| qwen-flash | $0.05 | $0.40 | 1M |

Note: qwen3-max, qwen-plus, and qwen3.5-plus have **tiered pricing** — price increases at higher input token counts (32K, 128K, 256K thresholds). See pricing page for full tiers.

### Example (raw fetch, TypeScript)
```typescript
const res = await fetch(
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "qwen-plus", // or qwen3-max, qwen3.5-flash, etc.
      messages: [{ role: "user", content: "Hello" }],
    }),
  }
);

const data = await res.json();
// data.choices[0].message.content → text response
```

This endpoint is OpenAI-compatible in shape (same request/response format as OpenAI Chat Completions), but we use raw fetch instead of the OpenAI SDK to keep the provider module clean.

### Docs
- API reference: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
- DashScope native API: https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope
- Model list: https://www.alibabacloud.com/help/en/model-studio/models
- Pricing: https://www.alibabacloud.com/help/en/model-studio/model-pricing

---

## 3. Image Generation

DashScope has TWO families of image models with DIFFERENT endpoints:

### 3a. Qwen-Image Models (sync, higher quality, Singapore region only)

**Models:** `qwen-image-2.0-pro`, `qwen-image-2.0`, `qwen-image-max`, `qwen-image-plus`

**Pricing (approx per image):**
| Model | Price |
|---|---|
| qwen-image-2.0-pro | ~$0.034 |
| qwen-image-2.0 / qwen-image-max | ~$0.023 |
| qwen-image-plus | ~$0.011 |

#### Sync Endpoint (qwen-image-2.0-pro, qwen-image-2.0, qwen-image-max)
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

```typescript
const res = await fetch(
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "qwen-image-max",
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: "A cat wearing sunglasses on a beach" }],
          },
        ],
      },
      parameters: {
        size: "1024*1024", // NOTE: asterisk (*), not "x"
      },
    }),
  }
);

const data = await res.json();
const imageUrl = data.output.choices[0].message.content[0].image;
// imageUrl is a temporary URL — expires in 24 hours!
// You MUST download and re-upload to Supabase Storage immediately.
```

#### Async Endpoint (qwen-image-plus, qwen-image)
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis
```
Requires header: `X-DashScope-Async: enable`

```typescript
// Step 1: Create task
const createRes = await fetch(
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "qwen-image-plus",
      input: { prompt: "A cat wearing sunglasses on a beach" },
      parameters: { size: "1024*1024", n: 1 },
    }),
  }
);
const { output } = await createRes.json();
const taskId = output.task_id;

// Step 2: Poll for result
const pollRes = await fetch(
  `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
  {
    headers: { "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}` },
  }
);
const result = await pollRes.json();
// result.output.task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
// result.output.results[0].url → image URL (expires 24hrs)
```

### 3b. Wan Image Models (sync, available in more regions)

**Models:** `wan2.6-image`

Uses the same multimodal-generation endpoint:
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

Supports text-to-image, image editing, and interleaved text+image output. See: https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-api-reference

### Important Image Notes
- Size format uses **asterisk**: `"1024*1024"`, `"720*1280"`, NOT `"1024x1024"`
- All image URLs **expire after 24 hours** — download and save to Supabase Storage immediately
- Qwen-Image models are ONLY available in the International (Singapore) region, NOT in US/Global
- Wan image models are available in both Singapore and US (Virginia) Global regions

### Image Docs
- Qwen-Image API: https://www.alibabacloud.com/help/en/model-studio/qwen-image-api
- Wan Image API: https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-api-reference

---

## 4. Video Generation (Wan models)

ALL video generation is **asynchronous**: create task → poll for result.

### Text-to-Video

**Endpoint:**
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
```
Header: `X-DashScope-Async: enable`

**Available models (Singapore):**
- `wan2.6-t2v` — latest, best quality
- `wan2.6-t2v-turbo` — faster, lower quality
- `wan2.1-t2v-turbo` and `wan2.1-t2v-plus` — older versions

```typescript
// Step 1: Create video task
const createRes = await fetch(
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "wan2.6-t2v",
      input: {
        prompt: "A cinematic shot of mountains at sunrise, golden light filtering through clouds",
      },
      parameters: {
        resolution: "720P",  // or "1080P", "480P"
        duration: 5,         // seconds (model-dependent max)
        prompt_extend: true, // auto-enhance short prompts
        watermark: false,
        // seed: 12345,      // optional for reproducibility
      },
    }),
  }
);
const createData = await createRes.json();
const taskId = createData.output.task_id;

// Step 2: Poll (every 15 seconds, tasks take 1-5 minutes)
const poll = async () => {
  const pollRes = await fetch(
    `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
    {
      headers: { "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}` },
    }
  );
  const result = await pollRes.json();
  // result.output.task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
  // On SUCCEEDED: result.output.video_url → MP4 URL (expires 24hrs)
  return result;
};
```

### Image-to-Video (First Frame)

**Endpoint:** Same as text-to-video
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
```

**Models:** `wan2.6-i2v`, `wan2.6-i2v-flash`, `wan2.7-i2v` (latest, supports first+last frame and video continuation)

```typescript
body: JSON.stringify({
  model: "wan2.6-i2v-flash",
  input: {
    prompt: "The camera slowly zooms in on the subject",
    img_url: "https://your-public-image-url.com/image.png",
    // For wan2.7-i2v, you can also add:
    // last_frame_url: "https://...",  // for first+last frame mode
  },
  parameters: {
    resolution: "720P",
    duration: 5,
    prompt_extend: true,
    watermark: false,
    // shot_type: "multi",  // wan2.6 only, enables multi-shot narrative
  },
})
```

### First-and-Last-Frame-to-Video (older API, wan2.2)

**Endpoint (different path!):**
```
POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis
```
Note the different path: `image2video` vs `video-generation`.

**Model:** `wan2.2-kf2v-flash`

### Reference-to-Video

Uses the same video-synthesis endpoint with reference images/videos for character consistency.

### Video Editing (Wan VACE)

**Endpoint:** Same video-synthesis endpoint with model `wan2.6-vace`

### Video Docs
- Text-to-video API: https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference
- Image-to-video API (wan2.6): https://www.alibabacloud.com/help/en/model-studio/image-to-video-api-reference
- Image-to-video API (wan2.7, new): https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference
- First+last frame API: https://www.alibabacloud.com/help/en/model-studio/image-to-video-by-first-and-last-frame-api-reference
- Video editing (VACE): https://www.alibabacloud.com/help/en/model-studio/wanx-vace-api-reference
- Prompt guide: https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt
- Video model comparison: https://www.alibabacloud.com/help/en/model-studio/use-video-generation

---

## 5. HappyHorse 1.0 (Video) — AVAILABLE NOW on DashScope

### Overview
- HappyHorse 1.0 is Alibaba's #1-ranked video model (Elo 1333 T2V, 1392 I2V on Artificial Analysis)
- Built by Future Life Lab at Taotian Group (Alibaba), led by Zhang Di
- 15B parameter unified 40-layer self-attention Transformer, generates video+audio jointly in single forward pass
- Native 1080p, 3-15 seconds, aspect ratios: 16:9, 9:16, 1:1, 4:3, 3:4
- Lip-sync across 7 languages: English, Mandarin, Cantonese, Japanese, Korean, German, French

### DashScope Models & Pricing

| Model ID | Type | 720P | 1080P | Free Quota |
|---|---|---|---|---|
| `happyhorse-1.0-t2v` | Text-to-video | $0.14/sec | $0.24/sec | 10 seconds |
| `happyhorse-1.0-i2v` | Image-to-video (first frame) | $0.14/sec | $0.24/sec | 10 seconds |

**Region:** International (Singapore) only. Uses same `DASHSCOPE_API_KEY` and `dashscope-intl.aliyuncs.com` base URL as all other DashScope models.

**Billing:** Per-second of successfully generated video output. Failed generations are not billed.

### API Reference Docs
- Text-to-video: https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference
- Image-to-video: https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference
- Try online: https://modelstudio.console.alibabacloud.com/?tab=dashboard#/efm/model_experience_center/vision?currentTab=videoGenerate

### Text-to-Video Example (TypeScript)

Same async pattern as Wan video models:

```typescript
// Step 1: Create task
const createRes = await fetch(
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "happyhorse-1.0-t2v",
      input: {
        prompt: "A cinematic shot of mountains at sunrise, golden light filtering through clouds",
      },
      parameters: {
        resolution: "1080P",  // or "720P"
        duration: 5,          // 3-15 seconds
        prompt_extend: true,
        watermark: false,
      },
    }),
  }
);
const createData = await createRes.json();
const taskId = createData.output.task_id;

// Step 2: Poll (every 15 seconds, tasks take 1-5 minutes)
const pollRes = await fetch(
  `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
  {
    headers: { "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}` },
  }
);
const result = await pollRes.json();
// result.output.task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
// On SUCCEEDED: result.output.video_url → MP4 URL (expires 24hrs)
```

### Image-to-Video Example (TypeScript)

```typescript
const createRes = await fetch(
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "happyhorse-1.0-i2v",
      input: {
        prompt: "The camera slowly zooms in on the subject",
        img_url: "https://your-public-image-url.com/image.png",
      },
      parameters: {
        resolution: "720P",
        duration: 5,
        prompt_extend: true,
        watermark: false,
      },
    }),
  }
);
// Same polling pattern as above
```

**NOTE:** The exact request body fields (especially for HappyHorse-specific features like native audio generation, multi-shot, aspect ratio control) should be verified against the official API reference docs linked above. The examples above follow the Wan video pattern which HappyHorse likely shares, but there may be additional HappyHorse-specific parameters.

### Alternative: fal.ai (official API partner)
fal.ai is also an official API partner with four HappyHorse endpoints:
- `https://fal.ai/models/alibaba/happy-horse/text-to-video`
- `https://fal.ai/models/alibaba/happy-horse/image-to-video`
- `https://fal.ai/models/alibaba/happy-horse/reference-to-video`
- `https://fal.ai/models/alibaba/happy-horse/video-edit`

fal uses its own API key (separate from DashScope). For ModelXD's "real price" principle, prefer DashScope direct since fal adds a markup.

### WARNING: Fake Sites
Most "HappyHorse official" websites are NOT affiliated with Alibaba. The only confirmed legitimate sources are:
1. **Alibaba Cloud Model Studio (Bailian)** — official, direct pricing
2. **fal.ai** — official API partner
3. **Qwen App** — Alibaba's consumer AI app
Do NOT enter API keys or payment info on happyhorse-ai.com, happyhorsesai.com, happyhorses-ai.com, ai-happyhorse.github.io, or similar domains.

---

## 6. Common Patterns & Gotchas

### Async Task Polling Pattern (reusable)
```typescript
async function pollDashScopeTask(
  taskId: string,
  intervalMs = 15000,
  maxAttempts = 40 // ~10 minutes
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
      }
    );
    const data = await res.json();
    const status = data.output?.task_status;

    if (status === "SUCCEEDED") return data;
    if (status === "FAILED") throw new Error(
      `DashScope task failed: ${data.output?.message || "unknown error"}`
    );

    // PENDING or RUNNING — wait and retry
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("DashScope task timed out");
}
```

### Key Gotchas
1. **Size format:** Use asterisk `"1024*1024"`, NOT `"1024x1024"`
2. **URLs expire in 24 hours** — download images/videos and upload to Supabase Storage immediately
3. **Cross-region = failure** — Singapore key + Singapore URL only. Never mix regions.
4. **No free quota on Global/US** — Singapore International DOES have free trial credits (1M tokens per model, 90 days)
5. **Video tasks take 1-5 minutes** — poll every 15 seconds, don't tight-loop
6. **task_id valid for 24 hours** — store it in your generations table
7. **Qwen-Image models are Singapore-only** — not available in US/Global regions
8. **Wan models are available in both Singapore and US** regions
9. **The text endpoint is OpenAI-compatible** (`/compatible-mode/v1/chat/completions`), but image and video endpoints use DashScope's native API format — different request/response shapes

---

## 7. Reference Links

| Resource | URL |
|---|---|
| Model list (all regions) | https://www.alibabacloud.com/help/en/model-studio/models |
| Pricing (all models) | https://www.alibabacloud.com/help/en/model-studio/model-pricing |
| Get API key | https://www.alibabacloud.com/help/en/model-studio/get-api-key |
| Text API (OpenAI-compat) | https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope |
| Text API (DashScope native) | https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope |
| Qwen-Image API | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Wan Image API | https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-api-reference |
| Text-to-video API | https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference |
| Image-to-video API (wan2.6) | https://www.alibabacloud.com/help/en/model-studio/image-to-video-api-reference |
| Image-to-video API (wan2.7) | https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference |
| Video editing (VACE) | https://www.alibabacloud.com/help/en/model-studio/wanx-vace-api-reference |
| Video model comparison | https://www.alibabacloud.com/help/en/model-studio/use-video-generation |
| Prompt guide | https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt |
| Regions & deployment modes | https://www.alibabacloud.com/help/en/model-studio/regions |
| AI SDK Alibaba provider | https://ai-sdk.dev/providers/ai-sdk-providers/alibaba |
| fal.ai HappyHorse | https://fal.ai/happyhorse-1.0 |
