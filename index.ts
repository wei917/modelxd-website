import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

// Generate short ID (8 chars, URL-safe)
function nanoid(size = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);

    // ─── GET /save-itinerary?id=xxx → Load itinerary (public, no auth) ───
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "Missing id parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("itineraries")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "Itinerary not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Increment view count (fire and forget)
      supabase
        .from("itineraries")
        .update({ views: (data.views || 0) + 1 })
        .eq("id", id)
        .then(() => {});

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── POST /save-itinerary → Save itinerary (auth required) ───
    if (req.method === "POST") {
      // Verify auth
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get user from token
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { destination, itinerary, hero_image, journey_map_image, day_images } = body;

      if (!itinerary) {
        return new Response(JSON.stringify({ error: "Missing itinerary data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const id = nanoid();

      const { data, error } = await supabase
        .from("itineraries")
        .insert({
          id,
          user_id: user.id,
          destination: destination || itinerary.destination || "Unknown",
          itinerary,
          hero_image: hero_image || null,
          journey_map_image: journey_map_image || null,
          day_images: day_images || null,
          views: 0,
        })
        .select()
        .single();

      if (error) {
        console.error("Insert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ id, url: `/precap/${id}` }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── PATCH /save-itinerary → Update itinerary images (auth required) ───
    if (req.method === "PATCH") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { id, hero_image, journey_map_image, day_images, ai_video_job_id, ai_video_status, ai_video_url, itinerary, destination } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: "Missing id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build update object with only provided fields
      const updates: Record<string, unknown> = {};
      if (hero_image !== undefined) updates.hero_image = hero_image;
      if (journey_map_image !== undefined) updates.journey_map_image = journey_map_image;
      if (day_images !== undefined) updates.day_images = day_images;
      if (ai_video_job_id !== undefined) updates.ai_video_job_id = ai_video_job_id;
      if (ai_video_status !== undefined) updates.ai_video_status = ai_video_status;
      if (ai_video_url !== undefined) updates.ai_video_url = ai_video_url;
      if (itinerary !== undefined) updates.itinerary = itinerary;
      if (destination !== undefined) updates.destination = destination;

      if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("itineraries")
        .update(updates)
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) {
        console.error("Update error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
