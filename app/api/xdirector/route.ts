// app/api/xdirector/route.ts
// XDirector: the conversational video-director agent (CC, July 26 2026).
//
// Architecture — a hybrid tool loop:
//   * list_models runs HERE (fast DB read), inside the loop.
//   * start_generation is NOT executed here. It's returned to the client as
//     a pending action; the client fires the normal /api/xcreate pipeline
//     (reserve/settle billing, job polling, workflow lineage — all already
//     built), then POSTs back with a tool_result and the loop continues.
//     Video generation takes minutes; holding this request open for it
//     would blow through serverless limits. The client already knows how
//     to babysit a job.
//
// Billing: agent tokens are free in v1 (fractions of a cent per turn on a
// small model). Generations bill exactly as they always have, client-side
// through /api/xcreate.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'
import { buildDirectorSystemPrompt } from '@/lib/xdirector-prompt'
import { loadSkill, wrapSkillForPrompt, listSkillFiles, describeSkillFiles, readSkillFile } from '@/lib/skills'

const LOG = '[xdirector]'

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

// Model candidates, tried in order when Anthropic rejects the id — keeps
// the route working across model deprecations without a deploy. Override
// with XDIRECTOR_MODEL. The working id is cached for the process lifetime.
//
// Sonnet 5 first (CC, Aug 6): the director now writes multi-scene storyboards
// — scripts and shot prompts in the user's language, mostly zh-Hant/ja — and
// that is creative writing, not routing. Same reasoning as the site agent's
// upgrade, but stronger: here the model's prose IS the product. (This also
// retires claude-3-5-haiku-latest, which was pointing at a model retired in
// Feb 2026 — a fallback that could never catch.)
const MODEL_CANDIDATES = [
  process.env.XDIRECTOR_MODEL,
  'claude-sonnet-5',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
].filter(Boolean) as string[]
let workingModel: string | null = null

// ── Storyboard validation ──────────────────────────────────────────────────
// The scenes the model emits go straight to the user's board and back into
// future prompts, so clamp everything: count, string lengths, duration.
// Unknown fields are dropped, not passed through.
const MAX_SCENES = 12
export type StoryScene = {
  id: string
  title: string
  script: string
  shot: string
  duration_s: number
  model_id?: string
  model_name?: string
  recipe?: string
  estimate?: number
}
function cleanScenes(raw: unknown): StoryScene[] | null {
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
      ...(typeof (sc as any).model_id   === 'string' ? { model_id:   s((sc as any).model_id, 64) }    : {}),
      ...(typeof (sc as any).model_name === 'string' ? { model_name: s((sc as any).model_name, 80) }  : {}),
      ...(typeof (sc as any).recipe     === 'string' ? { recipe:     s((sc as any).recipe, 48) }      : {}),
      ...(Number.isFinite(Number((sc as any).estimate)) ? { estimate: Number((sc as any).estimate) }  : {}),
    })
  }
  return out.length > 0 ? out : null
}

const TOOLS: any[] = [
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
        medium:          { type: 'string', enum: ['image', 'video'], description: 'image for a still, video for motion. Must match the board you took model_id from.' },
        aspect_ratio:    { type: 'string', description: 'e.g. "9:16" for Threads/Reels, "1:1", "16:9". Always set this for social posts.' },
        scene_id:        { type: 'string', description: 'when this generation IS one of the storyboard scenes, its scene id (e.g. "s2") — the result then fills that scene card on the board' },
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
              model_id:   { type: 'string', description: 'id from list_models for this scene' },
              model_name: { type: 'string', description: 'display name of that model, shown on the card' },
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
const READ_SKILL_FILE_TOOL = {
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

async function execListModels(medium: 'image' | 'video' = 'video'): Promise<string> {
  const svc = serviceClient()
  const [{ data, error }, { data: ratings }] = await Promise.all([
    svc.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, input_config')
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
  // An image model is one with a non-video generating mode. Matching on
  // "image" alone missed image_to_video and, worse, matched nothing for
  // models whose still mode is just "text_to_image".
  const vids = (data ?? []).filter((m: any) => {
    const modes: string[] = m.modes ?? []
    return medium === 'video'
      ? modes.some(x => x.includes('video'))
      : modes.some(x => x.includes('image') && !x.includes('to_video'))
  })
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

// ── Anthropic call with model fallback ─────────────────────────────────────

async function callClaude(system: string, messages: any[], tools: any[] = TOOLS): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const candidates = workingModel ? [workingModel] : MODEL_CANDIDATES
  let lastErr = ''
  for (const model of candidates) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      // max_tokens covers a full 8-scene storyboard (8 shot paragraphs of
      // JSON); 1500 truncated one mid-object in testing. thinking is pinned
      // off on the 4.6+ models: they run ADAPTIVE thinking when the field is
      // omitted, and thinking spends from this same max_tokens budget — the
      // storyboard would pay a reasoning tax and risk truncation for latency
      // we don't want on a chat surface. Older fallbacks (haiku-4-5,
      // sonnet-4-5) never think unless asked, and predate the field's
      // "disabled" value, so they get no thinking field at all.
      body: JSON.stringify({
        model, max_tokens: 4000, system, messages, tools,
        ...(/sonnet-5|opus-5|sonnet-4-6|opus-4-6|opus-4-7|opus-4-8/.test(model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (res.ok) {
      workingModel = model
      return res.json()
    }
    const body = await res.text()
    lastErr = `${res.status} ${body.slice(0, 300)}`
    // Only fall through the candidate list on "no such model"-shaped errors.
    if (!(res.status === 404 || (res.status === 400 && body.includes('model')))) break
  }
  throw new Error(`Anthropic API error: ${lastErr}`)
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await assertFeature('xdirector')
  if (gate) return gate

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : []
  if (messages.length === 0) return Response.json({ error: 'messages required' }, { status: 400 })
  // Crude context cap: the client sends the whole conversation each turn.
  if (JSON.stringify(messages).length > 400_000) {
    return Response.json({ error: 'Conversation too long — start a new session.' }, { status: 413 })
  }

  // A selected skill is appended AFTER our own rules, fenced, so its text is
  // craft guidance and can never outrank pricing honesty or the refusals.
  let system = buildDirectorSystemPrompt()
  let tools: any[] = TOOLS
  let activeSkill: string | null = null
  const skillName = typeof body?.skill === 'string' ? body.skill : null
  if (skillName) {
    try {
      const skill = await loadSkill(skillName)
      if (skill) {
        activeSkill = skill.name
        const files = await listSkillFiles(skill.name)
        // Body now; bundled files only on request. The file LIST is cheap,
        // the files themselves are not.
        system += wrapSkillForPrompt(skill) + describeSkillFiles(files)
        if (files.length > 0) tools = [...TOOLS, READ_SKILL_FILE_TOOL]
        console.log(`${LOG} skill "${skill.name}" active for ${user.id} (${files.length} bundled file(s))`)
      } else {
        console.warn(`${LOG} skill "${skillName}" not found — running unskilled`)
      }
    } catch (err: any) {
      console.warn(`${LOG} skill "${skillName}" failed to load:`, err?.message)
    }
  }

  // The user's current storyboard rides in with every request so the agent
  // revises THEIR text, not its own last draft. Injected at the end of the
  // system prompt: it changes every turn, and this route builds its prompt
  // fresh each call anyway.
  const clientBoard = cleanScenes(body?.storyboard)
  if (clientBoard) {
    system += '\n\n## CURRENT STORYBOARD (the user may have edited this — it is the truth)\n'
      + JSON.stringify(clientBoard)
  }

  // The loop. Every message appended here (assistant turns + server-side
  // tool results) is returned to the client, which owns conversation state.
  // A set_storyboard call resolves inline — the board updates and the agent
  // keeps talking in the same turn — and the validated scenes ride back to
  // the client on whichever response ends the POST.
  const newMessages: any[] = []
  const convo = [...messages]
  let storyboardOut: StoryScene[] | null = null

  try {
    for (let hop = 0; hop < 5; hop++) {
      const resp = await callClaude(system, convo, tools)
      const assistantMsg = { role: 'assistant', content: resp.content }
      convo.push(assistantMsg)
      newMessages.push(assistantMsg)

      if (resp.stop_reason !== 'tool_use') {
        return Response.json({ newMessages, action: null, storyboard: storyboardOut })
      }

      const toolUses = (resp.content ?? []).filter((b: any) => b.type === 'tool_use')
      const results: any[] = []
      let action: any = null
      for (const tu of toolUses) {
        if (tu.name === 'set_storyboard') {
          const scenes = cleanScenes(tu.input?.scenes)
          if (scenes) {
            storyboardOut = scenes
            results.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: `Storyboard of ${scenes.length} scene(s) is now on the user's board for review. Do not generate anything until they ask.`,
            })
          } else {
            results.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: 'Invalid storyboard: scenes must be a non-empty array with id, title, script, shot and duration_s.',
              is_error: true,
            })
          }
        } else if (tu.name === 'read_skill_file') {
          const rel = typeof tu.input?.path === 'string' ? tu.input.path : ''
          const content = activeSkill ? await readSkillFile(activeSkill, rel) : null
          results.push({
            type: 'tool_result', tool_use_id: tu.id,
            content: content ?? `No readable file at "${rel}" in this skill.`,
            ...(content ? {} : { is_error: true }),
          })
        } else if (tu.name === 'list_models') {
          const med = tu.input?.medium === 'image' ? 'image' : 'video'
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: await execListModels(med) })
        } else if (tu.name === 'ask_user') {
          // Chips. Same hand-off shape as a generation: the loop pauses and
          // resumes when the client posts the clicked answer back as this
          // tool's result.
          action = { kind: 'ask', toolUseId: tu.id, input: tu.input }
          break
        } else if (tu.name === 'start_generation') {
          // Hand off to the client. Loop pauses here; it resumes when the
          // client POSTs back with the matching tool_result appended.
          action = { kind: 'generate', toolUseId: tu.id, input: tu.input }
          break
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool', is_error: true })
        }
      }

      if (action) {
        // Any list_models results resolved in the same assistant turn ride
        // along; the client must include them (in order) in the tool_result
        // message it sends back, before the generation's own result.
        return Response.json({ newMessages, action, pendingToolResults: results, storyboard: storyboardOut })
      }

      const resultMsg = { role: 'user', content: results }
      convo.push(resultMsg)
      newMessages.push(resultMsg)
    }
    // Loop cap hit — return what we have so the client isn't stranded.
    console.warn(`${LOG} hop cap reached for user ${user.id}`)
    return Response.json({ newMessages, action: null, storyboard: storyboardOut })
  } catch (err: any) {
    console.error(`${LOG} agent turn failed:`, err)
    return Response.json({ error: err?.message ?? 'Agent error' }, { status: 502 })
  }
}
