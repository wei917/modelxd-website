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
// 180 (was 60, Aug 22): a story board — up to 5 cast sheets + 10 scenes in
// one set_storyboard — is ~7k output tokens, which alone runs past a minute.
export const maxDuration = 180

import { createClient } from '@supabase/supabase-js'
import { buildDirectorSystemPrompt } from '@/lib/xdirector-prompt'
import { loadSkill, wrapSkillForPrompt, listSkillFiles, describeSkillFiles, readSkillFile } from '@/lib/skills'
import { singleViewCastSheets, THREE_VIEW_RULE } from '@/lib/cast-sheet'
import { cleanScenes, TOOLS, READ_SKILL_FILE_TOOL, execListModels, type StoryScene } from '@/lib/xdirector-tools'
export type { StoryScene }

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

// Storyboard validation, the tool schema and execListModels live in
// lib/xdirector-tools.ts (lifted verbatim, Aug 22) so the director harness
// can exercise them without this route's auth.

// ── Anthropic call with model fallback ─────────────────────────────────────

async function callClaude(system: string, messages: any[], tools: any[] = TOOLS): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const candidates = workingModel ? [workingModel] : MODEL_CANDIDATES
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  let lastErr = ''
  // Transient failures get RETRIED, not surfaced: a single corrupted TLS
  // record on a reused keep-alive socket ("SSL alert bad record mac", seen
  // live Aug 6) was reaching the user as "⚠ fetch failed" and killing the
  // turn. Three attempts per model with a short backoff — a thrown fetch
  // gets a fresh socket, a 5xx/529 gets a moment to recover. Model-shaped
  // 400/404s still fall through the candidate list; other client errors
  // stop immediately (retrying a 401 helps nobody).
  outer: for (const model of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response
      try {
        res = await callAnthropicOnce(key, model, system, messages, tools)
      } catch (err: any) {
        lastErr = `network: ${err?.cause?.code ?? err?.message ?? err}`
        if (attempt < 2) { await sleep(500 + attempt * 900); continue }
        continue outer
      }
      if (res.ok) {
        workingModel = model
        const j = await res.json()
        // Same signal the site agent logs: warm traffic with cache_read=0
        // means something re-broke the prefix. The owner pays these tokens.
        const u = j?.usage ?? {}
        console.log(`${LOG} model=${j?.model} in=${u.input_tokens} cache_write=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} out=${u.output_tokens}`)
        return j
      }
      const body = await res.text()
      lastErr = `${res.status} ${body.slice(0, 300)}`
      if (res.status === 404 || (res.status === 400 && body.includes('model'))) continue outer
      if (res.status >= 500 || res.status === 429) {
        if (attempt < 2) { await sleep(700 + attempt * 1200); continue }
        continue outer
      }
      break outer
    }
  }
  throw new Error(`Anthropic API error: ${lastErr}`)
}

function callAnthropicOnce(key: string, model: string, system: string, messages: any[], tools: any[]): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      // max_tokens covers the BIGGEST board: a Story to Video plan of 5
      // cast sheets + 10 scenes is ~7k tokens of JSON (4000 cut one off
      // mid-array, Aug 22 — the director then retried the same oversize
      // call four times). The loop below turns a max_tokens cut into a
      // "resend more compactly" tool error instead. thinking is pinned
      // off on the 4.6+ models: they run ADAPTIVE thinking when the field is
      // omitted, and thinking spends from this same max_tokens budget — the
      // storyboard would pay a reasoning tax and risk truncation for latency
      // we don't want on a chat surface. Older fallbacks (haiku-4-5,
      // sonnet-4-5) never think unless asked, and predate the field's
      // "disabled" value, so they get no thinking field at all.
      //
      // system carries breakpoint 1: tools render before system, so this one
      // marker caches tools + director prompt + skill together. Sonnet 5's
      // cache minimum is 1024 tokens (met); on a fallback below the minimum
      // the marker is silently ignored — full price, never an error.
      body: JSON.stringify({
        model, max_tokens: 9000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages, tools,
        ...(/sonnet-5|opus-5|sonnet-4-6|opus-4-6|opus-4-7|opus-4-8/.test(model) ? { thinking: { type: 'disabled' } } : {}),
      }),
  })
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
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
  // revises THEIR text, not its own last draft. It is injected as an EXTRA
  // user message after the client's last one — never into `system`, and
  // never returned to the client, so it doesn't persist into the protocol.
  // Placement is load-bearing for prompt caching: system renders before
  // messages, so a storyboard in `system` would invalidate the entire
  // cached conversation on every scene edit. As a trailing message it sits
  // AFTER both breakpoints and invalidates nothing. (CC, Aug 6)
  const clientBoard = cleanScenes(body?.storyboard)

  // ── Prompt caching (CC, Aug 6) ─────────────────────────────────────────
  // The client re-sends the whole conversation every turn, so without
  // caching every turn re-bills the director prompt, the skill, every
  // vision block and every prior tool result at full price. Two stable
  // breakpoints fix that:
  //   1. the system block (covers tools + prompt + skill — fixed per
  //      conversation), set in callClaude;
  //   2. the last block of the last CLIENT message — marked here, BEFORE
  //      the storyboard context is appended, so the marker's position is
  //      byte-identical when this same message returns as history next
  //      turn. The storyboard message stays unmarked and last: it changes
  //      on every edit, and back here it invalidates nothing.
  const markLastBlock = (msgs: any[]): any[] => {
    if (msgs.length === 0) return msgs
    const out = msgs.slice()
    const last = { ...out[out.length - 1] }
    const content = typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : (Array.isArray(last.content) ? last.content.map((b: any) => ({ ...b })) : [])
    if (content.length === 0) return msgs
    content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } }
    last.content = content
    out[out.length - 1] = last
    return out
  }

  // The loop. Every message appended here (assistant turns + server-side
  // tool results) is returned to the client, which owns conversation state.
  // A set_storyboard call resolves inline — the board updates and the agent
  // keeps talking in the same turn — and the validated scenes ride back to
  // the client on whichever response ends the POST.
  const newMessages: any[] = []
  const convo = markLastBlock(messages)
  if (clientBoard) {
    convo.push({
      role: 'user',
      content: [{
        type: 'text',
        text: 'CURRENT STORYBOARD (live board state; the user may have edited it and their text is the truth; reuse these scene ids when revising):\n'
          // refs shrink to filenames here: the director needs to KNOW a
          // scene has its own references, never their storage paths.
          + JSON.stringify(clientBoard.map(sc => sc.refs && sc.refs.length > 0
              ? { ...sc, refs: sc.refs.map(r => r.fileName || r.mediaType) }
              : sc)),
      }],
    })
  }
  let storyboardOut: StoryScene[] | null = null

  // Step-by-step turn log (owner ask, Aug 9): every hop, tool and hand-off
  // prints to the dev terminal so "nothing happened" is never unexplained.
  console.log(`${LOG} turn: ${messages.length} msgs in, board=${clientBoard?.length ?? 0} scenes, skill=${activeSkill ?? 'none'}`)

  try {
    for (let hop = 0; hop < 6; hop++) {
      const resp = await callClaude(system, convo, tools)
      const assistantMsg = { role: 'assistant', content: resp.content }
      convo.push(assistantMsg)
      newMessages.push(assistantMsg)
      console.log(`${LOG} hop ${hop}: stop=${resp.stop_reason} tools=[${(resp.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => b.name).join(',') || '-'}]`)

      const toolUses = (resp.content ?? []).filter((b: any) => b.type === 'tool_use')
      // A reply cut off at max_tokens mid-tool-call used to fall through
      // here as "text only": the client got half a sentence and NO board,
      // silently (Aug 22). A truncated tool call is answered below instead,
      // so the director resends a more compact board rather than the user
      // seeing nothing happen.
      const truncated = resp.stop_reason === 'max_tokens'
      if (truncated) console.warn(`${LOG} hop ${hop}: reply truncated at max_tokens (${toolUses.length} tool call(s) affected)`)
      if (resp.stop_reason !== 'tool_use' && !(truncated && toolUses.length > 0)) {
        console.log(`${LOG} → done (text only)`)
        return Response.json({ newMessages, action: null, storyboard: storyboardOut })
      }
      const results: any[] = []
      let action: any = null
      for (const tu of toolUses) {
        if (tu.name === 'set_storyboard') {
          const scenes = cleanScenes(tu.input?.scenes)
          // A TEXT-ONLY MODEL ON A KEYFRAME SCENE IS ALWAYS WRONG AT PLAN
          // TIME (owner, Aug 12: the director seated Text to Video across
          // six KEYFRAME scenes — a model that ignores the approved still
          // entirely). Reference-family models stay plannable: likeness
          // survives there and the card's ⚠ + the user's choice govern.
          // This guard aims at the DIRECTOR's planning, never the user's
          // picker — it runs only on set_storyboard input.
          if (scenes) {
            const prior = new Map((clientBoard ?? []).map(sc => [sc.id, sc as any]))
            // A CAST SHEET IS THREE VIEWS OR IT IS NOT A CAST SHEET (owner,
            // Aug 22: "3 views is for all templates"). The skills have said
            // so since Aug 14 and every stored cast asset was still a
            // single-view portrait — prose alone does not hold. Only the
            // director's own writing is checked: a shot byte-identical to
            // the client's copy is the user's text and stands as written.
            const flat = singleViewCastSheets(scenes, prior)
            if (flat.length > 0) {
              results.push({
                type: 'tool_result', tool_use_id: tu.id, is_error: true,
                content: `Rejected: ${flat.map(a => `${a.id} ("${a.title}")`).join(', ')} ${flat.length === 1 ? 'is a CAST sheet written as a single view' : 'are CAST sheets written as single views'}. ${THREE_VIEW_RULE} Rewrite ONLY those shot texts to say so explicitly (e.g. "Character sheet, three views of the same person side by side — front, three-quarter, profile — identical outfit, hair and light, plain background: …"), keep every other card unchanged, and call set_storyboard again with the FULL list.`,
              })
              continue
            }
            const named = scenes.filter(sc => !(sc as any).asset && (sc as any).direct !== true && (sc.model_id || sc.model_name))
            if (named.length > 0) {
              const { data: vids } = await serviceClient()
                .from('ai_models').select('id, display_name, modes')
                .eq('enabled', true)
              const byId = new Map((vids ?? []).map((m: any) => [m.id, m]))
              const byName = new Map((vids ?? []).map((m: any) => [m.display_name, m]))
              const broken = named.map(sc => {
                const m: any = (sc.model_id && byId.get(sc.model_id)) || (sc.model_name && byName.get(sc.model_name))
                const modes: string[] = m?.modes ?? []
                const canOpen = modes.length === 0 || modes.includes('image_to_video')
                  || modes.includes('reference_frames') || modes.includes('start_end_frames')
                return canOpen ? null : { id: sc.id, model: m?.display_name ?? sc.model_name, modes }
              }).filter(Boolean) as Array<{ id: string; model: string; modes: string[] }>
              if (broken.length > 0) {
                results.push({
                  type: 'tool_result', tool_use_id: tu.id, is_error: true,
                  content: `Rejected: ${broken.map(b => `${b.id} names "${b.model}" (modes: ${b.modes.join(', ')})`).join('; ')} — these scenes are KEYFRAME (they animate FROM an approved key still) and that model takes no input picture, so the still would be ignored entirely. Reseat each with a model whose modes include image_to_video, then call set_storyboard again. Only a scene the user explicitly marked direct:true may carry a text-only model.`,
                })
                continue
              }
            }
            // A REVISION MUST NOT DESTROY WHAT WAS ALREADY SHOT (owner, Aug
            // 11: rewriting two shot prompts wiped every approved key still
            // on the board — three paid generations gone, and the director
            // announced it had to re-shoot them). set_storyboard carries only
            // the DIRECTING fields; the generation state (which still was
            // approved, which clip filled the card, its takes, its cost, the
            // user's own refs and mode) lives on the client's copy and is
            // merged back here by scene id. The director revises words; it
            // does not get to delete pictures. (`prior` is hoisted above.)
            const KEPT = ['still_row_id', 'still_url', 'row_id', 'url', 'cost', 'status', 'takes', 'refs', 'direct', 'error'] as const
            storyboardOut = scenes.map(sc => {
              const was = prior.get(sc.id)
              if (!was) return sc
              const carried: any = {}
              for (const k of KEPT) if (was[k] !== undefined) carried[k] = was[k]
              return { ...sc, ...carried }
            })
            const rescued = storyboardOut.filter(sc => (sc as any).still_row_id || (sc as any).row_id).length
            if (rescued > 0) console.log(`${LOG} set_storyboard: carried generation state forward on ${rescued} scene(s)`)
            results.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: `Storyboard of ${scenes.length} scene(s) is now on the user's board for review. Do not generate anything until they ask.`,
            })
          } else {
            results.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: truncated
                ? 'Your reply hit the output limit, so the storyboard arrived cut off and nothing reached the board. Send it again MORE COMPACTLY — at most 5 assets and 10 scenes, each shot 60-90 words, script one sentence, everything else unchanged.'
                : 'Invalid storyboard: scenes must be a non-empty array with id, title, script, shot and duration_s.',
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
          // ENFORCEMENT, not etiquette (CC, Aug 6): a video generation must
          // reference a scene on the actual board. The prompt says so too,
          // but a photo attached to an imperative "generate me an ad" beat
          // the prompt in the wild within the hour — the director anchored
          // on the reference flow and skipped the storyboard. Prompts guide;
          // this rejects. The model gets the error as a tool result and
          // self-corrects into set_storyboard in the same POST.
          const inp: any = tu.input ?? {}
          // The RECIPE decides what this is, not the medium label: within an
          // hour of the first guard shipping, a skill-guided turn slipped a
          // video recipe through as medium:"image" (image_to_video on the
          // clean-plate step). Every *_to_video / video_* recipe produces
          // motion whatever the label says; image recipes (image_edit,
          // text_to_image) contain no "video" substring.
          const isVideo = inp.medium === 'video'
            || (typeof inp.recipe === 'string' && inp.recipe.includes('video'))
          const knownScenes = new Set([...(clientBoard ?? []), ...(storyboardOut ?? [])].map(s => s.id))
          const sceneOk = typeof inp.scene_id === 'string' && knownScenes.has(inp.scene_id)
          if (isVideo && !sceneOk) {
            results.push({
              type: 'tool_result', tool_use_id: tu.id, is_error: true,
              content: 'Rejected: video generations only run from storyboard scenes. Call set_storyboard to put the scenes on the board (this is free), tell the user to review them, and generate only when they ask — then pass the scene_id.',
            })
            continue
          }
          // A RECIPE THAT EATS A PICTURE NEEDS A PICTURE (owner bug, Aug 11:
          // a DIRECT opener went out as image_to_video with no still, no
          // refs and nothing to chain from; the provider answered "the
          // model failed to generate a response", which reads as a broken
          // product rather than an impossible request). Catch it here,
          // before it costs a call.
          if (isVideo && sceneOk) {
            const board: any[] = (storyboardOut ?? clientBoard ?? []) as any[]
            const scene: any = board.find(sc => sc.id === inp.scene_id)
            if (scene?.asset === true) {
              results.push({
                type: 'tool_result', tool_use_id: tu.id, is_error: true,
                content: `Rejected: ${inp.scene_id} is an ASSET (a reusable still on the shelf), not a scene — assets never become clips. Chain a SCENE's still from it instead (chain_from_scene: "${inp.scene_id}").`,
              })
              continue
            }
            const eatsImage = typeof inp.recipe === 'string'
              && ['image_to_video', 'reference_frames', 'start_end_frames', 'video_edit', 'extend_video'].includes(inp.recipe)
            const fed = inp.from_still === true
              || typeof inp.chain_from_scene === 'string'
              || (Array.isArray(scene?.refs) && scene.refs.length > 0)
              || (Array.isArray(inp.use_files) && inp.use_files.length > 0)
              || inp.use_attachments === true
            if (eatsImage && !fed) {
              results.push({
                type: 'tool_result', tool_use_id: tu.id, is_error: true,
                content: `Rejected: recipe "${inp.recipe}" consumes an input picture and scene ${inp.scene_id} has none — no key still, no references, and nothing to chain from. Either use a text_to_video recipe (and a model whose modes include it), or give it an input first: generate the scene's key still and pass from_still=true, or pass chain_from_scene=<the previous scene id>.`,
              })
              continue
            }
          }
          // A CUT'S STILL CONTINUES THE PREVIOUS CUT'S STILL (owner bug,
          // Aug 11: S1C2's still ignored S1C1's image). The director wrote
          // "continuing from the provided frame" into the prompt and passed
          // no frame — continuity described in words is not continuity. The
          // same philosophy as the guard below: the prompt asks, this makes
          // it true.
          if (!isVideo && sceneOk && typeof inp.chain_from_scene !== 'string') {
            const board: any[] = (storyboardOut ?? clientBoard ?? []) as any[]
            const at = board.findIndex(sc => sc.id === inp.scene_id)
            const scene: any = at >= 0 ? board[at] : null
            const prev: any = at > 0 ? board[at - 1] : null
            if (scene?.continues && (prev?.still_row_id || prev?.row_id)) {
              results.push({
                type: 'tool_result', tool_use_id: tu.id, is_error: true,
                content: `Rejected: scene ${inp.scene_id} is a CUT that continues ${prev.id}, so its key still must be generated FROM ${prev.id}'s frame, not described from scratch. Call start_generation again with the same scene_id, chain_from_scene="${prev.id}" and an image_edit recipe, and write the prompt as what CHANGES from that frame — the space, the wardrobe and the face carry over in the picture.`,
              })
              continue
            }
          }
          // STILLS COME FIRST (owner, Aug 11: "the agent should generate the
          // images first and let users decide to generate video or not").
          // Same enforcement philosophy as the storyboard guard above: the
          // prompt asks for it, this makes it true. A still costs cents and
          // a video costs dollars, so the look gets settled on the cheap
          // artifact and the user chooses whether to spend on motion. The
          // one way past is the user's own "straight to video" (direct).
          if (isVideo && sceneOk) {
            const scene: any = [...(clientBoard ?? []), ...(storyboardOut ?? [])]
              .find(sc => sc.id === inp.scene_id)
            if (scene && !scene.still_row_id && scene.direct !== true) {
              results.push({
                type: 'tool_result', tool_use_id: tu.id, is_error: true,
                content: `Rejected: scene ${inp.scene_id} has no key still yet. Generate the still FIRST — start_generation with medium="image", the same scene_id, an image recipe (image_edit or text_to_image) and every reference — then show it to the user and let THEM decide whether to spend on the video. Only if the user explicitly says "straight to video" for this scene do you set direct:true on it via set_storyboard and skip the still.`,
              })
              continue
            }
          }
          // Hand off to the client. Loop pauses here; it resumes when the
          // client POSTs back with the matching tool_result appended.
          action = { kind: 'generate', toolUseId: tu.id, input: tu.input }
          break
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool', is_error: true })
        }
      }

      if (action) {
        console.log(`${LOG} → action ${action.kind}: model=${action.input?.model_id ?? '-'} scene=${action.input?.scene_id ?? '-'} recipe=${action.input?.recipe ?? '-'} res=${action.input?.resolution ?? '-'}`)
        // A tool call AFTER the hand-off never ran — the loop broke here.
        // Say so explicitly (owner bug, Aug 10: the director asked TWO
        // questions in one turn, the user could only answer the first, and
        // the second was healed as "user replied in chat instead" — so the
        // director sailed on as though it had an answer it never got).
        // Naming it as unasked makes the model re-ask after this reply.
        const answered = new Set(results.map((r: any) => r.tool_use_id))
        answered.add(action.toolUseId)
        for (const tu of toolUses) {
          if (answered.has(tu.id)) continue
          results.push({
            type: 'tool_result', tool_use_id: tu.id, is_error: true,
            content: tu.name === 'ask_user'
              ? 'NOT ASKED: only one question is shown to the user per turn, and another question in this same turn took that slot. This question was never seen and has NO answer. If you still need it, ask it again in a later turn — never assume an answer.'
              : 'Not run: the turn handed off to the user before this call was reached. Re-issue it later if still needed.',
          })
          console.warn(`${LOG} dropped extra ${tu.name} in the same turn as ${action.kind}`)
        }
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
