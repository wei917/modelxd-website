// lib/xdirector-tools.ts — the director's tool schema, its storyboard
// validation and the server-side list_models executor, lifted VERBATIM out
// of app/api/xdirector/route.ts (Aug 22) so that scripts/director-harness.ts
// can run the director's storyboard phase headlessly with the real schema
// and the real catalog. The route imports everything back; behaviour is
// unchanged. Comments below are the originals.

import { createClient } from '@supabase/supabase-js'
import { THREE_VIEW_RULE } from './cast-sheet'

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

// ── Storyboard validation ──────────────────────────────────────────────────
// The scenes the model emits go straight to the user's board and back into
// future prompts, so clamp everything: count, string lengths, duration.
// Unknown fields are dropped, not passed through.
export const MAX_SCENES = 12
export type StoryScene = {
  id: string
  continues?: boolean
  title: string
  script: string
  shot: string
  duration_s: number
  model_id?: string
  model_name?: string
  /** The KEY STILL is its own shot with its own model and its own price
   *  (owner, Aug 11). Per-shot model choice is the differentiator — it
   *  applies to the keyframe as much as to the clip. */
  still_model_id?: string
  still_model_name?: string
  recipe?: string
  estimate?: number
  /** The scene's approved key still (KEYFRAME mode), set by the client. */
  still_row_id?: string
  /** The user asked for straight-to-video on this scene. */
  direct?: boolean
  no_speech?: boolean
  /** Card-level reference uploads (owner, Aug 8). Board-owned: the user
   *  puts them there, the director only ever READS them (as filenames in
   *  the storyboard context) — generation for that scene consumes them. */
  refs?: Array<{ storagePath: string; bucket: string; mediaType: string; fileName: string; fileSize: number }>
}
export function cleanScenes(raw: unknown): StoryScene[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const s = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : ''
  const out: StoryScene[] = []
  for (const [i, sc] of raw.slice(0, MAX_SCENES).entries()) {
    if (!sc || typeof sc !== 'object') continue
    const dur = Number((sc as any).duration_s)
    out.push({
      id:       s((sc as any).id, 24) || `s${i + 1}`,
      title:    s((sc as any).title, 80),
      script:   s((sc as any).script, 500),
      shot:     s((sc as any).shot, 1200),
      duration_s: Number.isFinite(dur) ? Math.min(Math.max(Math.round(dur), 2), 15) : 6,
      ...((sc as any).continues === true ? { continues: true } : {}),
      ...(typeof (sc as any).model_id   === 'string' ? { model_id:   s((sc as any).model_id, 64) }    : {}),
      ...(typeof (sc as any).model_name === 'string' ? { model_name: s((sc as any).model_name, 80) }  : {}),
      ...(typeof (sc as any).still_model_id   === 'string' ? { still_model_id:   s((sc as any).still_model_id, 64) }   : {}),
      ...(typeof (sc as any).still_model_name === 'string' ? { still_model_name: s((sc as any).still_model_name, 80) } : {}),
      ...(typeof (sc as any).recipe     === 'string' ? { recipe:     s((sc as any).recipe, 48) }      : {}),
      ...(Number.isFinite(Number((sc as any).estimate)) ? { estimate: Number((sc as any).estimate) }  : {}),
      // KEYFRAME state, round-tripped so the video guard below can see it:
      // still_row_id is set by the CLIENT when a key still finishes; direct
      // is the user's explicit "straight to video" opt-out.
      ...(typeof (sc as any).still_row_id === 'string' ? { still_row_id: s((sc as any).still_row_id, 64) } : {}),
      ...((sc as any).direct === true ? { direct: true } : {}),
      ...((sc as any).no_speech === true ? { no_speech: true } : {}),
      ...((sc as any).asset === true ? { asset: true } : {}),
      ...(Array.isArray((sc as any).refs) && (sc as any).refs.length > 0 ? {
        refs: (sc as any).refs.slice(0, 4)
          .map((r: any) => ({
            storagePath: s(r?.storagePath, 300), bucket: s(r?.bucket, 64),
            mediaType: s(r?.mediaType, 64), fileName: s(r?.fileName, 120),
            fileSize: Number(r?.fileSize) || 0,
          }))
          .filter((r: any) => r.storagePath && r.bucket),
      } : {}),
    })
  }
  return out.length > 0 ? out : null
}

export const TOOLS: any[] = [
  {
    name: 'list_models',
    description: 'List the AI models currently enabled on ModelXD for a given medium, with live pricing, supported recipes (modes) AND their ModelXD leaderboard scores from real head-to-head user votes (xd_score, quality, value, votes). Always call this before recommending a model or generating. Pass medium="image" for stills and medium="video" for motion — the leaderboard is scored separately per medium, so asking for the wrong one gives you the wrong ranking.',
    input_schema: {
      type: 'object' as const,
      properties: {
        medium: { type: 'string', enum: ['image', 'video'], description: 'which board to read; defaults to video' },
      },
      required: [],
    },
  },
  {
    name: 'ask_user',
    description: "Ask the user ONE question they answer by clicking, when a detail genuinely changes the video and you cannot reasonably assume it. Do NOT use this for things you can decide yourself (model, recipe, duration, prompt wording) — decide those. Never ask more than one question before generating.",
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'short question, one line' },
        options:  {
          type: 'array',
          description: '2-4 short clickable answers, most likely first',
          items: { type: 'string' },
        },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'start_generation',
    description: 'Start one generation on ModelXD — a still image or a video. The result arrives later as a tool result (ok/url/cost or an error). Use exactly one model per call. recipe MUST be one of the modes returned by list_models for that model.',
    input_schema: {
      type: 'object' as const,
      properties: {
        model_id:        { type: 'string',  description: 'id from list_models' },
        recipe:          { type: 'string',  description: 'a mode string copied exactly from that model\'s modes array, e.g. text_to_video' },
        prompt:          { type: 'string',  description: 'the full generation prompt you wrote' },
        duration:        { type: 'number',  description: 'seconds; omit unless the user asked for a specific length' },
        use_attachments: { type: 'boolean', description: 'true to pass the user\'s attached photos as reference inputs' },
        use_files:       { type: 'array', items: { type: 'number' }, description: 'WHICH attached files to feed this generation, by the 1-based numbers shown to the user (e.g. [1,2] for the two character photos). Order matters: the first is slot 0, the opening frame for recipes that take one. Omit to use every attached image. Use it to keep STYLE frames out of a video generation — reference-to-video treats every input as a subject anchor, so a style frame there corrupts the character.' },
        medium:          { type: 'string', enum: ['image', 'video'], description: 'image for a still, video for motion. Must match the board you took model_id from.' },
        aspect_ratio:    { type: 'string', description: 'e.g. "9:16" for Threads/Reels, "1:1", "16:9". Always set this for social posts.' },
        resolution:      { type: 'string', description: 'video resolution key from that model\'s per_video_second pricing, e.g. "720p" or "1080p" — pass it when the user configured one; omit for the default' },
        scene_id:        { type: 'string', description: 'when this generation IS one of the storyboard scenes, its scene id (e.g. "s2") — the result then fills that scene card on the board' },
        chain_from_scene: { type: 'string', description: 'scene id this scene CONTINUES from. Whatever that scene has is fed as this generation\'s starting image: its approved key still, or the final frame of its finished clip. Use it for the STILL of any cut marked continues (with image_edit — the new still is an edit of the previous one, so place, wardrobe and face carry over) and for a video that opens where the previous clip ended (with image_to_video). The source scene must already have a still or a clip.' },
        from_still:      { type: 'boolean', description: 'true to open this scene\'s VIDEO on the key still already approved for the same scene_id. The still is fed as the opening frame, so the character likeness and the look baked into it carry into the motion. Use with an image_to_video recipe. Requires that scene to have a finished still.' },
      },
      required: ['model_id', 'recipe', 'prompt', 'medium'],
    },
  },
  {
    name: 'set_storyboard',
    description: 'Put a scene-by-scene storyboard on the user\'s board — the FIRST move for every video request, before any generation. Each scene card shows your script and shot plan for the user to review and EDIT on the board; nothing generates and nothing is charged until they say so. Also use this to revise scenes after feedback: resend the full list, reusing the existing scene ids for scenes you keep (edited or not) and new ids only for new scenes. The user\'s own edits reach you in the CURRENT STORYBOARD context — treat their text as truth.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scenes: {
          type: 'array',
          description: '1-8 scenes in play order',
          items: {
            type: 'object',
            properties: {
              id:         { type: 'string', description: 'stable id, "s1"..."s8"; REUSE ids from the current storyboard when revising' },
              title:      { type: 'string', description: '2-4 words, e.g. "The Hook"' },
              script:     { type: 'string', description: '1-2 sentences in the user\'s language: what this scene says/shows, written for the user to read and edit' },
              shot:       { type: 'string', description: 'the full generation prompt paragraph for this scene — subject, camera, lighting, style — same craft rules as any prompt you write' },
              duration_s: { type: 'number', description: 'seconds, 2-15' },
              continues:  { type: 'boolean', description: 'true when this card is a CUT — it continues the PREVIOUS card\'s action in the same space and will be chained from its final frame at generation. false/omitted = a fresh scene (new location or time).' },
              model_id:   { type: 'string', description: 'id from list_models for this scene' },
              model_name: { type: 'string', description: 'display name of that model, shown on the card' },
              still_model_id:   { type: 'string', description: 'id from list_models of the IMAGE model that shoots this scene\'s key still. Set it on every scene unless the user asked to go straight to video.' },
              still_model_name: { type: 'string', description: 'display name of that image model, shown on the card' },
              asset:      { type: 'boolean', description: 'true = this is an ASSET on the shelf (cast sheet, look frame, key prop) — a named reusable STILL outside the film. Assets take title (e.g. "CAST · 她"), shot (the image prompt) and still_model fields ONLY: no duration, no video model, no place in the sequence. Scenes chain from assets via chain_from_scene. NEVER use a scene card for a cast sheet — the film starts at S1. ' + THREE_VIEW_RULE },
              no_speech:  { type: 'boolean', description: 'PERFORMANCE ONLY — the cast never sings, speaks or mouths words in this shot. Set true on EVERY scene of a music video unless the user explicitly asks for singing on camera: there is no lip-sync on this product, so invented mouth articulation follows the prompt\'s language rather than the song and always reads wrong.' },
              recipe:     { type: 'string', description: 'mode string copied exactly from that model\'s modes' },
              estimate:   { type: 'number', description: 'estimated $ for THIS scene at duration_s' },
            },
            required: ['id', 'title', 'script', 'shot', 'duration_s'],
          },
        },
      },
      required: ['scenes'],
    },
  },
]

// Offered only when a skill is active, so the agent never sees a door that
// leads nowhere.
export const READ_SKILL_FILE_TOOL = {
  name: 'read_skill_file',
  description: 'Read one reference file bundled with the ACTIVE skill (e.g. references/SCENES.md). Only call this when the current step needs that file.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'relative path exactly as listed, e.g. references/SCENES.md' },
    },
    required: ['path'],
  },
}

// ── Tool executors (server-side ones only) ─────────────────────────────────

export async function execListModels(medium: 'image' | 'video' = 'video'): Promise<string> {
  const svc = serviceClient()
  const [{ data, error }, { data: ratings }] = await Promise.all([
    svc.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_modalities')
      .eq('enabled', true),
    // THE LEADERBOARD (CC, July 28). Leaving this out was not a cosmetic
    // gap: without scores the agent recommended Grok Imagine Video as the
    // smart buy when it is LAST on ModelXD's own video board (xd 890,
    // quality 798), and pitched Veo 3.1 as the premium upgrade at 5x the
    // price when it scores quality 900 — below the Gemini Omni Flash
    // (quality 1206) the user picked unaided. The whole point of this
    // product is that the community already knows which model wins.
    svc.from('model_ratings')
      .select('model_id, quality_rating, value_rating, xd_score, total_votes')
      .eq('mode', medium),
  ])
  if (error) return JSON.stringify({ error: error.message })
  const byId = new Map((ratings ?? []).map((r: any) => [r.model_id, r]))
  // output_modalities is THE rule (CLAUDE.md: the table is the single
  // source of truth). The old substring-on-modes heuristic silently hid
  // every model whose only recipes lack the word "video" — the whole
  // reference_frames family — until the director declared HappyHorse 1.1
  // Reference to Video "not a real model" to the owner's face (Aug 9).
  const vids = (data ?? []).filter((m: any) =>
    ((m.output_modalities ?? []) as string[]).includes(medium))
  // Compact per-model summary — the agent needs prices, modes and scores,
  // not the whole row. per_video_second keys are resolutions ('720p'...).
  const out = vids.map((m: any) => {
    const r: any = byId.get(m.id)
    return {
      id:           m.id,
      name:         m.display_name,
      provider:     m.provider,
      modes:        m.modes ?? [],
      pricing:      m.model_pricing ?? {},
      input_config: m.input_config ?? null,
      // Unrated models get nulls rather than zeros so the agent can tell
      // "no data yet" from "voted down".
      xd_score:     r?.xd_score       ?? null,
      quality:      r?.quality_rating ?? null,
      value:        r?.value_rating   ?? null,
      votes:        r?.total_votes    ?? 0,
    }
  })
  // Pre-sorted best-first so the ranking is obvious even if the agent skims.
  out.sort((a: any, b: any) => (b.xd_score ?? -1) - (a.xd_score ?? -1))
  return JSON.stringify({
    models: out,
    scoring: 'xd_score blends quality and value from head-to-head user votes on ModelXD (~1000 = average). Higher is better. Treat scores with fewer than 3 votes as weak evidence.',
  })
}
