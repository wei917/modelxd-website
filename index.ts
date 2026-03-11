// supabase/functions/generate-the-video/index.ts
//
// Two actions:
//   POST { action: "start", prompt, ... }  → Creates Sora job, returns video_id immediately
//   POST { action: "check", video_id }     → Checks status, downloads + saves to storage if completed
//
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createVideoJob,
  downloadVideo,
} from "./_shared/openai-api.ts";
import {
  getSupabaseUserClient,
  saveBytesToStorage,
} from "./_shared/storage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("Missing OPENAI_API_KEY secret");
  return key;
}

// Lightweight status check — single call, no polling loop
async function checkVideoStatus(videoId: string): Promise<{ status: string; progress: number; error?: string; raw: Record<string, unknown> }> {
  const resp = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  const respStatus = resp.status;
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => { respHeaders[k] = v; });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[checkVideoStatus] HTTP ${respStatus}`, errText);
    console.error(`[checkVideoStatus] headers:`, JSON.stringify(respHeaders));
    throw new Error(`OpenAI GET /v1/videos/${videoId} failed (${respStatus}): ${errText}`);
  }

  const data = await resp.json();

  // Log full response (excluding any binary data)
  const safeLog = { ...data };
  // Remove large fields if they exist
  if (safeLog.content) safeLog.content = `[${typeof safeLog.content}, length=${String(safeLog.content).length}]`;
  console.log(`[checkVideoStatus] HTTP ${respStatus} response:`, JSON.stringify(safeLog));

  return {
    status: data.status,
    progress: data.progress ?? 0,
    error: data.status === "failed" ? (data.error?.message || data.error || "Generation failed") : undefined,
    raw: safeLog,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed.", { status: 405, headers: corsHeaders });
  }

  const logs: string[] = [];
  const t0 = Date.now();
  const log = (msg: string) => {
    const line = `[${Date.now() - t0}ms] ${msg}`;
    console.log(`[generate-the-video] ${line}`);
    logs.push(line);
  };

  try {
    log("Request received");

    const { supabase, user } = await getSupabaseUserClient(req);
    log(`Auth OK: user=${user.id}`);

    const body = await req.json();
    const action = String(body.action ?? "start");

    // ═══ ACTION: start ═══
    if (action === "start") {
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing 'prompt'", logs }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const model = String(body.model ?? "sora-2");
      const size = String(body.size ?? "1280x720");
      const seconds = String(body.seconds ?? "8");
      const input_image_url = body.input_image_url ? String(body.input_image_url) : undefined;

      log(`START: model=${model} size=${size} seconds=${seconds} has_image=${!!input_image_url}`);
      log(`Prompt (${prompt.length} chars): ${prompt.substring(0, 120)}...`);
      if (input_image_url) log(`Input image URL: ${input_image_url.substring(0, 100)}...`);
      console.log(`[generate-the-video] FULL PROMPT:\n${prompt}`);

      const job = await createVideoJob(prompt, { model, size, seconds, input_image_url });
      log(`Job created: video_id=${job.id} status=${job.status}`);

      return new Response(JSON.stringify({
        action: "start",
        video_id: job.id,
        status: job.status,
        logs,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: check ═══
    if (action === "check") {
      const videoId = String(body.video_id ?? "").trim();
      if (!videoId) {
        return new Response(JSON.stringify({ error: "Missing 'video_id'", logs }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log(`CHECK: video_id=${videoId}`);

      const status = await checkVideoStatus(videoId);
      log(`Status: ${status.status} progress=${status.progress}%`);
      log(`OpenAI raw: ${JSON.stringify(status.raw)}`);

      // Still in progress
      if (status.status === "queued" || status.status === "in_progress") {
        return new Response(JSON.stringify({
          action: "check",
          video_id: videoId,
          status: status.status,
          progress: status.progress,
          openai_raw: status.raw,
          logs,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Failed
      if (status.status === "failed") {
        log(`FAILED: ${status.error}`);
        log(`OpenAI raw: ${JSON.stringify(status.raw)}`);
        return new Response(JSON.stringify({
          action: "check",
          video_id: videoId,
          status: "failed",
          error: status.error,
          openai_raw: status.raw,
          logs,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Completed — download and save to storage
      log("Completed — downloading video...");
      const videoData = await downloadVideo(videoId);
      log(`Downloaded: ${(videoData.bytes.length / 1024 / 1024).toFixed(2)}MB`);

      const bucket = String(body.bucket ?? "user-uploads").trim();
      const folder = String(body.folder ?? "videos").trim();

      log("Saving to storage...");
      const saved = await saveBytesToStorage({
        supabase,
        userId: user.id,
        bytes: videoData.bytes,
        mime: videoData.contentType,
        bucket,
        folder,
        expiresIn: 60 * 60 * 24 * 7,
      });
      log(`Saved: path=${saved.path} url=${saved.url ? "yes" : "null"}`);
      log(`DONE! Total: ${Date.now() - t0}ms`);

      return new Response(JSON.stringify({
        action: "check",
        video_id: videoId,
        status: "completed",
        storage: {
          bucket,
          path: saved.path,
          url: saved.url,
          expires_in: saved.expires_in,
        },
        logs,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}`, logs }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = String(e?.message ?? e ?? "Unknown error");
    log(`ERROR: ${msg}`);
    console.error("[generate-the-video] exception:", e);
    const status = msg.includes("Authorization") || msg.includes("Invalid or expired token") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg, status, logs }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
