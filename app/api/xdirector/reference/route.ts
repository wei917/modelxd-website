// app/api/xdirector/reference/route.ts
// Read a reference music video from a link (owner, Aug 25: "user enter a
// youtube link ... we generate an mv with the same style").
//
// The director cannot watch anything — Claude takes no video. Gemini can, and
// it can be pointed at a URL so GOOGLE fetches the video rather than us. That
// distinction is the whole reason this route is allowed to exist: nothing here
// downloads, stores or re-hosts the reference. We read it and keep our notes.
//
// Two passes, because a reference carries two different things:
//   • LOOK lives in pixels  → style frames, which the generation pipeline
//     already consumes as reference_frames. Prose about a palette is just a
//     longer prompt; a frame carrying the palette is a reference image.
//   • RHYTHM lives in time  → cut lengths and how the edit escalates between
//     sections. No still frame can hold that, so it comes back as text.
//
// HOUSE-PAID, like /transcribe and the director's own turns: reading a link
// costs about a cent and a setup step shouldn't meter. The generations it
// leads to still bill the user normally.
//
// WHAT THIS DELIBERATELY WILL NOT DO: recreate the reference. Style — grade,
// lens, light, cutting rhythm — is craft and is fair to learn from. The
// performers' faces, the specific shots and any on-screen text are not ours,
// and the frame prompt below forbids all three. See skills/music-video for
// the same rule stated to the director.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { analyzeVideoUrl, generateImageFromVideoUrl, isSupportedVideoUrl } from '@/lib/providers/google'

const LOG = '[xdirector:reference]'
const BUCKET = 'xcreate-user-images'
const MAX_FRAMES = 3

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

/** What only exists in TIME. Deliberately not asked about colour — the
 *  frames answer that far better than any adjective could. */
const RHYTHM_PROMPT = `You are a picture editor breaking down a music video for a director who cannot see it.
Report ONLY on craft. Do NOT transcribe, quote, translate or paraphrase the lyrics — not one line.
Be concrete and brief. Use these headings exactly:

CUTTING — average shot length in seconds, and how it changes between intro, verse, chorus and bridge. Say which section is fastest.
CAMERA — the moves that recur (locked-off, handheld, gimbal push, crane, whip pan) and roughly how often each appears.
STRUCTURE — how the video escalates: what changes visually when the chorus lands, and what is held back for later.
PERFORMANCE — is there any to-camera singing, and how much of the runtime is performance vs narrative.
WORLD — the locations and the time of day, in one line each.
AVOID — anything about this video that would look wrong if imitated literally by an AI model.`

/** The guardrail lives in the prompt, not in a hope. */
const FRAME_PROMPT = (aspect: string) => `Watch this music video and generate ONE style-reference frame that reproduces its CINEMATOGRAPHY: colour palette, grade, contrast, black level, apparent focal length, depth of field, quality of light, and the atmosphere of its locations.

HARD RULES — this is a look reference for a colourist, not a copy:
- Do NOT depict any identifiable person from the video. Use an anonymous figure seen from behind, at distance, or in silhouette — or show the empty location with no one in it.
- Do NOT recreate any specific shot, composition or moment from the video.
- No text, captions, lyrics, titles, logos, watermarks or brand marks anywhere in the frame.

Compose it as a still at ${aspect}.`

async function requireUser() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const url    = typeof body?.url === 'string' ? body.url.trim() : ''
  const aspect = body?.aspect === '9:16' ? '9:16' : '16:9'
  const frames = Math.min(Math.max(Number(body?.frames) || 2, 1), MAX_FRAMES)

  if (!url) return Response.json({ error: 'A reference video URL is required.' }, { status: 400 })
  if (!isSupportedVideoUrl(url)) {
    return Response.json({ error: 'Only public YouTube links work as a reference video.' }, { status: 400 })
  }

  const sb = serviceClient()

  // Catalogue-driven, like every other model choice on the site: the watcher
  // must declare video input, the frame model must output images. Falling
  // back by capability rather than hardcoding an id means a catalogue swap
  // is a data change, not a deploy.
  const { data: models } = await sb.from('ai_models')
    .select('id, provider, model_name, display_name, model_pricing, modes, input_modalities, output_modalities')
    .eq('provider', 'google').eq('enabled', true)
  const pool = models ?? []

  const watcher = pool.find((m: any) => m.model_name === 'gemini-3.1-flash-lite')
    ?? pool.find((m: any) => (m.modes ?? []).includes('video_to_text'))
  const painter = pool.find((m: any) => m.model_name === 'gemini-3.1-flash-image')
    ?? pool.find((m: any) => (m.output_modalities ?? []).includes('image'))

  if (!watcher || !painter) {
    return Response.json({ error: 'No model available to read a reference video.' }, { status: 503 })
  }

  // Both passes at once — they are independent, and the frame call is the
  // slow one. Neither is allowed to sink the other: a reference with frames
  // but no rhythm notes is still worth having, and vice versa.
  const [look, art] = await Promise.allSettled([
    analyzeVideoUrl(watcher as any, RHYTHM_PROMPT, url),
    generateImageFromVideoUrl(painter as any, FRAME_PROMPT(aspect), url, { aspect_ratio: aspect, count: frames }),
  ])

  if (look.status === 'rejected' && art.status === 'rejected') {
    const msg = (art.reason?.message ?? look.reason?.message ?? 'Could not read that video.') as string
    console.error(`${LOG} both passes failed: ${msg}`)
    return Response.json({ error: msg }, { status: 502 })
  }

  // Store the frames so they can be attached as style references the same way
  // an uploaded image would be. Path is per-user; the client re-signs from
  // bucket+path rather than trusting the URL below to outlive the session.
  const stored: Array<{ bucket: string; path: string; url: string | null; mediaType: string }> = []
  if (art.status === 'fulfilled') {
    const all = [{ buffer: art.value.buffer, mediaType: art.value.mediaType }, ...(art.value.extras ?? [])]
    for (const img of all) {
      const ext  = img.mediaType.includes('png') ? 'png' : 'jpg'
      const path = `xdirect-reference/${user.id}/${crypto.randomUUID()}.${ext}`
      const up = await sb.storage.from(BUCKET).upload(path, img.buffer, { contentType: img.mediaType, upsert: true })
      if (up.error) { console.error(`${LOG} frame upload failed: ${up.error.message}`); continue }
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
      stored.push({ bucket: BUCKET, path, url: signed?.signedUrl ?? null, mediaType: img.mediaType })
    }
  }

  const cost = (look.status === 'fulfilled' ? look.value.cost : 0)
             + (art.status  === 'fulfilled' ? art.value.cost  : 0)
  console.log(`${LOG} ok frames=${stored.length} look=${look.status} (house-paid $${cost.toFixed(4)})`)

  return Response.json({
    look:   look.status === 'fulfilled' ? look.value.text : null,
    frames: stored,
    aspect,
    models: { watcher: watcher.display_name, painter: painter.display_name },
    // Surfaced so a partial result reads as partial in the UI instead of
    // silently looking like a complete one.
    partial: look.status === 'rejected' || art.status === 'rejected' || stored.length === 0,
  })
}
