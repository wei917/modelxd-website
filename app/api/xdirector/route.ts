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
const MODEL_CANDIDATES = [
  process.env.XDIRECTOR_MODEL,
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
  'claude-sonnet-4-5',
].filter(Boolean) as string[]
let workingModel: string | null = null

const TOOLS: any[] = [
  {
    name: 'list_models',
    description: 'List the video-capable AI models currently enabled on ModelXD, with live pricing, supported recipes (modes) AND their ModelXD leaderboard scores from real head-to-head user votes (xd_score, quality, value, votes). Always call this before recommending a model or generating.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
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
    description: 'Start one video generation on ModelXD. The result arrives later as a tool result (ok/videoUrl/cost or an error). Use exactly one model per call. recipe MUST be one of the modes returned by list_models for that model.',
    input_schema: {
      type: 'object' as const,
      properties: {
        model_id:        { type: 'string',  description: 'id from list_models' },
        recipe:          { type: 'string',  description: 'a mode string copied exactly from that model\'s modes array, e.g. text_to_video' },
        prompt:          { type: 'string',  description: 'the full generation prompt you wrote' },
        duration:        { type: 'number',  description: 'seconds; omit unless the user asked for a specific length' },
        use_attachments: { type: 'boolean', description: 'true to pass the user\'s attached photos as reference inputs' },
      },
      required: ['model_id', 'recipe', 'prompt'],
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

async function execListModels(): Promise<string> {
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
      .eq('mode', 'video'),
  ])
  if (error) return JSON.stringify({ error: error.message })
  const byId = new Map((ratings ?? []).map((r: any) => [r.model_id, r]))
  const vids = (data ?? []).filter((m: any) =>
    (m.modes ?? []).some((x: string) => x.includes('video')))
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
      body: JSON.stringify({ model, max_tokens: 1500, system, messages, tools }),
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

  // The loop. Every message appended here (assistant turns + server-side
  // tool results) is returned to the client, which owns conversation state.
  const newMessages: any[] = []
  const convo = [...messages]

  try {
    for (let hop = 0; hop < 5; hop++) {
      const resp = await callClaude(system, convo, tools)
      const assistantMsg = { role: 'assistant', content: resp.content }
      convo.push(assistantMsg)
      newMessages.push(assistantMsg)

      if (resp.stop_reason !== 'tool_use') {
        return Response.json({ newMessages, action: null })
      }

      const toolUses = (resp.content ?? []).filter((b: any) => b.type === 'tool_use')
      const results: any[] = []
      let action: any = null
      for (const tu of toolUses) {
        if (tu.name === 'read_skill_file') {
          const rel = typeof tu.input?.path === 'string' ? tu.input.path : ''
          const content = activeSkill ? await readSkillFile(activeSkill, rel) : null
          results.push({
            type: 'tool_result', tool_use_id: tu.id,
            content: content ?? `No readable file at "${rel}" in this skill.`,
            ...(content ? {} : { is_error: true }),
          })
        } else if (tu.name === 'list_models') {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: await execListModels() })
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
        return Response.json({ newMessages, action, pendingToolResults: results })
      }

      const resultMsg = { role: 'user', content: results }
      convo.push(resultMsg)
      newMessages.push(resultMsg)
    }
    // Loop cap hit — return what we have so the client isn't stranded.
    console.warn(`${LOG} hop cap reached for user ${user.id}`)
    return Response.json({ newMessages, action: null })
  } catch (err: any) {
    console.error(`${LOG} agent turn failed:`, err)
    return Response.json({ error: err?.message ?? 'Agent error' }, { status: 502 })
  }
}
