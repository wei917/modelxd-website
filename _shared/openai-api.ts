// supabase/functions/generate-the-video/_shared/openai-api.ts

export type GenerateVideoOptions = {
  model?: string;   // "sora-2" | "sora-2-pro"
  size?: string;    // "1280x720" (landscape) | "720x1280" (portrait)
  seconds?: string; // "4" | "8" | "12" (Sora API valid values)
  input_image_url?: string; // URL of image to use as first frame reference
};

function getApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("Missing OPENAI_API_KEY secret");
  return key;
}

/**
 * Create a video generation job via OpenAI Sora API.
 * Returns the video job object with { id, status }.
 *
 * POST https://api.openai.com/v1/videos
 * Content-Type: multipart/form-data
 */
export async function createVideoJob(
  prompt: string,
  opts: GenerateVideoOptions = {},
): Promise<{ id: string; status: string; raw: unknown }> {
  const model = opts.model ?? "sora-2";
  const size = opts.size ?? "1280x720";
  const seconds = opts.seconds ?? "8";

  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", prompt);
  fd.append("size", size);
  fd.append("seconds", seconds);

  // If an image URL is provided, fetch it and attach as input_reference
  // Sora requires input_reference to exactly match the video size (e.g. 1280x720)
  // We skip the reference if we can't verify the size matches (no resize available in Deno)
  if (opts.input_image_url) {
    console.log(`[openai.createVideoJob] Fetching input reference image: ${opts.input_image_url.substring(0, 80)}...`);
    try {
      const imgResp = await fetch(opts.input_image_url);
      if (imgResp.ok) {
        const origBytes = new Uint8Array(await imgResp.arrayBuffer());
        console.log(`[openai.createVideoJob] Fetched image: ${(origBytes.length/1024).toFixed(0)}KB`);

        // Try to read image dimensions from PNG/JPEG headers
        let imgW = 0, imgH = 0;
        // PNG: width at bytes 16-19, height at bytes 20-23
        if (origBytes[0] === 0x89 && origBytes[1] === 0x50) {
          imgW = (origBytes[16] << 24) | (origBytes[17] << 16) | (origBytes[18] << 8) | origBytes[19];
          imgH = (origBytes[20] << 24) | (origBytes[21] << 16) | (origBytes[22] << 8) | origBytes[23];
        }
        // JPEG: scan for SOF0 marker (0xFF 0xC0)
        if (origBytes[0] === 0xFF && origBytes[1] === 0xD8) {
          for (let i = 2; i < origBytes.length - 9; i++) {
            if (origBytes[i] === 0xFF && (origBytes[i+1] === 0xC0 || origBytes[i+1] === 0xC2)) {
              imgH = (origBytes[i+5] << 8) | origBytes[i+6];
              imgW = (origBytes[i+7] << 8) | origBytes[i+8];
              break;
            }
          }
        }

        const [targetW, targetH] = size.split("x").map(Number);
        console.log(`[openai.createVideoJob] Image dimensions: ${imgW}x${imgH}, video target: ${targetW}x${targetH}`);

        if (imgW === targetW && imgH === targetH) {
          const imgBlob = new Blob([origBytes], { type: "image/jpeg" });
          const imgFile = new File([imgBlob], "reference.jpeg", { type: "image/jpeg" });
          fd.append("input_reference", imgFile, "reference.jpeg");
          console.log(`[openai.createVideoJob] Attached input_reference: ${(origBytes.length/1024).toFixed(0)}KB (exact match)`);
        } else {
          console.warn(`[openai.createVideoJob] Size mismatch (${imgW}x${imgH} vs ${targetW}x${targetH}) — skipping reference. Generate hero at ${size} to enable video reference.`);
        }
      } else {
        console.warn(`[openai.createVideoJob] Failed to fetch: ${imgResp.status} — skipping`);
      }
    } catch (imgErr) {
      console.warn(`[openai.createVideoJob] Input reference error — skipping:`, imgErr);
    }
  }

  console.log(`[openai.createVideoJob] model=${model} size=${size} seconds=${seconds}`);
  console.log(`[openai.createVideoJob] FULL PROMPT:\n${prompt}`);

  // Log curl equivalent for debugging
  const apiKey = getApiKey();
  const maskedKey = apiKey.slice(0, 8) + "..." + apiKey.slice(-4);
  console.log(`[openai.createVideoJob] CURL EQUIVALENT:\ncurl -X POST "https://api.openai.com/v1/videos" \\\n  -H "Authorization: Bearer ${maskedKey}" \\\n  -F "model=${model}" \\\n  -F "prompt=${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" \\\n  -F "size=${size}" \\\n  -F "seconds=${seconds}"`);

  const resp = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      // Do NOT set Content-Type — fetch adds correct boundary for FormData
    },
    body: fd,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[openai.createVideoJob] RESPONSE STATUS:", resp.status);
    console.error("[openai.createVideoJob] RESPONSE BODY:", errText);
    throw new Error(`OpenAI POST /v1/videos failed: ${errText}`);
  }

  const data = await resp.json();
  console.log(`[openai.createVideoJob] RESPONSE STATUS: ${resp.status}`);
  console.log(`[openai.createVideoJob] RESPONSE BODY: ${JSON.stringify(data)}`);
  console.log(`[openai.createVideoJob] job created: id=${data.id} status=${data.status}`);

  return { id: data.id, status: data.status, raw: data };
}

/**
 * Poll a video job until it completes or fails.
 * GET https://api.openai.com/v1/videos/{video_id}
 *
 * Returns the completed video object.
 */
export async function pollVideoJob(
  videoId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<{ id: string; status: string; raw: unknown }> {
  const maxAttempts = opts.maxAttempts ?? 60;  // ~10 min with 10s interval
  const intervalMs = opts.intervalMs ?? 10000; // 10 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const apiKey = getApiKey();
    const maskedKey = apiKey.slice(0, 8) + "..." + apiKey.slice(-4);

    if (attempt === 1) {
      console.log(`[openai.pollVideoJob] CURL EQUIVALENT:\ncurl "https://api.openai.com/v1/videos/${videoId}" \\\n  -H "Authorization: Bearer ${maskedKey}"`);
    }

    const resp = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[openai.pollVideoJob] attempt ${attempt} STATUS: ${resp.status}`);
      console.error(`[openai.pollVideoJob] attempt ${attempt} BODY:`, errText);
      throw new Error(`OpenAI GET /v1/videos/${videoId} failed: ${errText}`);
    }

    const data = await resp.json();
    const progress = data.progress ?? 0;
    console.log(`[openai.pollVideoJob] attempt ${attempt}: status=${data.status} progress=${progress}%`);
    if (data.status === "completed" || data.status === "failed") {
      console.log(`[openai.pollVideoJob] FINAL RESPONSE: ${JSON.stringify(data)}`);
    }

    if (data.status === "completed") {
      return { id: data.id, status: data.status, raw: data };
    }

    if (data.status === "failed") {
      const errMsg = data.error?.message || data.error || "Video generation failed";
      throw new Error(`Video generation failed: ${errMsg}`);
    }

    // Still in progress — wait before next poll
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(`Video generation timed out after ${maxAttempts} attempts (${(maxAttempts * intervalMs / 1000 / 60).toFixed(1)} min)`);
}

/**
 * Download the completed video as bytes.
 * GET https://api.openai.com/v1/videos/{video_id}/content
 */
export async function downloadVideo(
  videoId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const resp = await fetch(`https://api.openai.com/v1/videos/${videoId}/content`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[openai.downloadVideo] error:", errText);
    throw new Error(`OpenAI GET /v1/videos/${videoId}/content failed: ${errText}`);
  }

  const contentType = resp.headers.get("content-type") || "video/mp4";
  const arrayBuf = await resp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  console.log(`[openai.downloadVideo] downloaded ${(bytes.length / 1024 / 1024).toFixed(2)}MB, type=${contentType}`);

  return { bytes, contentType };
}
