// scripts/director-harness.ts — run the director's STORYBOARD phase
// headlessly: the real system prompt, the real skill, the real tool schema,
// the real list_models, the real three-view cast guard — against the
// director's model, with no auth and NO generation (start_generation is
// refused). For checking what the director WRITES before a user pays for
// it. House-paid (ANTHROPIC_API_KEY), a few cents per run.
//
//   node --env-file=.env.local --import tsx scripts/director-harness.ts --skill music-video --brief-file brief.txt [--max-scenes 10]
//
// Exit 1 when a CAST asset is not three-view or the scene cap is exceeded.

import fs from 'node:fs/promises'
import { buildDirectorSystemPrompt } from '../lib/xdirector-prompt'
import { loadSkill, wrapSkillForPrompt, listSkillFiles, describeSkillFiles, readSkillFile } from '../lib/skills'
import { TOOLS, READ_SKILL_FILE_TOOL, execListModels, cleanScenes, countCards, MAX_SCENES, MAX_ASSETS, type StoryScene } from '../lib/xdirector-tools'
import { singleViewCastSheets, isThreeView, isCastAsset, THREE_VIEW_RULE } from '../lib/cast-sheet'
import { houseCall } from '../lib/house-llm'

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }

async function main() {
  const skillName = arg('--skill') ?? null
  const briefFile = arg('--brief-file')
  const brief = briefFile ? await fs.readFile(briefFile, 'utf8') : (arg('--brief') ?? '')
  const maxScenes = Number(arg('--max-scenes') ?? 8)
  // --force-reject-once: reject the first valid storyboard as if a cast sheet
  // were single-view, to watch the director's resend (does it keep every
  // other card and fix only the sheet?).
  let forceReject = process.argv.includes('--force-reject-once')
  if (!brief.trim()) throw new Error('--brief or --brief-file required')
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY')
  }
  const model = process.env.XDIRECTOR_MODEL || 'claude-sonnet-5'

  let system = buildDirectorSystemPrompt()
  let tools: any[] = TOOLS
  if (skillName) {
    const skill = await loadSkill(skillName)
    if (!skill) throw new Error(`skill "${skillName}" not found`)
    const files = await listSkillFiles(skill.name)
    system += wrapSkillForPrompt(skill) + describeSkillFiles(files)
    if (files.length > 0) tools = [...TOOLS, READ_SKILL_FILE_TOOL]
  }
  console.log(`model ${model} · skill ${skillName ?? 'none'} · system ${system.length.toLocaleString()} chars · brief ${brief.length} chars\n`)

  const messages: any[] = [{ role: 'user', content: brief }]
  let board: StoryScene[] | null = null
  let rejections = 0, rounds = 0
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }

  while (rounds++ < 8) {
    const j: any = await houseCall({
      tag: '[harness]',
      models: [model],
      maxTokens: 9000,
      disableThinking: true,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages, tools,
    })
    usage.input += j.usage?.input_tokens ?? 0; usage.output += j.usage?.output_tokens ?? 0
    usage.cacheWrite += j.usage?.cache_creation_input_tokens ?? 0; usage.cacheRead += j.usage?.cache_read_input_tokens ?? 0

    const text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    const uses = (j.content ?? []).filter((b: any) => b.type === 'tool_use')
    messages.push({ role: 'assistant', content: j.content })
    if (text) console.log(`💬 ${text}\n`)
    if (j.stop_reason !== 'end_turn' && j.stop_reason !== 'tool_use') console.log(`⚠️ stop_reason=${j.stop_reason} (out ${j.usage?.output_tokens})`)
    const truncated = j.stop_reason === 'max_tokens'
    if (uses.length === 0) break

    const results: any[] = []
    for (const tu of uses) {
      const err = (content: string) => ({ type: 'tool_result', tool_use_id: tu.id, content, is_error: true })
      const ok  = (content: string) => ({ type: 'tool_result', tool_use_id: tu.id, content })
      if (tu.name === 'list_models') {
        const medium = tu.input?.medium === 'image' ? 'image' : 'video'
        console.log(`🔧 list_models(${medium})`)
        results.push(ok(await execListModels(medium)))
      } else if (tu.name === 'set_storyboard') {
        const cards = countCards(tu.input?.scenes)
        if (cards.scenes > MAX_SCENES || cards.assets > MAX_ASSETS) {
          console.log(`⛔ over cap: ${cards.scenes} scenes / ${cards.assets} assets`)
          results.push(err(`Rejected: ${cards.scenes} scene(s) and ${cards.assets} asset(s) — the board holds at most ${MAX_SCENES} scenes and ${MAX_ASSETS} assets (assets do not count as scenes). Merge or cut on purpose so the ending survives, then call set_storyboard again with the FULL list.`))
          continue
        }
        const scenes = cleanScenes(tu.input?.scenes)
        if (!scenes) {
          console.log(`❌ set_storyboard with ${truncated ? 'a TRUNCATED' : 'an invalid'} payload (keys: ${Object.keys(tu.input ?? {}).join(',') || 'none'})`)
          results.push(err(truncated
            ? `Your reply hit the output limit, so the storyboard arrived cut off and nothing reached the board. Send it again MORE COMPACTLY: at most 5 assets and 10 scenes, each shot 60-90 words, script one sentence — everything else unchanged.`
            : 'Invalid storyboard: scenes must be a non-empty array with id, title, script, shot and duration_s.'))
          continue
        }
        const prior = new Map((board ?? []).map(sc => [sc.id, sc as any]))
        let flat = singleViewCastSheets(scenes, prior)
        if (flat.length === 0 && forceReject) { flat = scenes.filter(sc => isCastAsset(sc as any)); forceReject = false; console.log('🧪 forcing one rejection to watch the resend') }
        if (flat.length > 0) {
          rejections++
          console.log(`⛔ guard rejected ${flat.map(a => a.id).join(', ')} (single-view cast sheet)`)
          results.push(err(`Rejected: ${flat.map(a => `${a.id} ("${a.title}")`).join(', ')} ${flat.length === 1 ? 'is a CAST sheet written as a single view' : 'are CAST sheets written as single views'}. ${THREE_VIEW_RULE} Rewrite ONLY those shot texts to say so explicitly (e.g. "Character sheet, three views of the same person side by side — front, three-quarter, profile — identical outfit, hair and light, plain background: …"), keep every other card unchanged, and call set_storyboard again with the FULL list.`))
          continue
        }
        board = scenes
        console.log(`🎬 set_storyboard → ${scenes.filter(s => (s as any).asset).length} asset(s) + ${scenes.filter(s => !(s as any).asset).length} scene(s)`)
        results.push(ok(`Storyboard of ${scenes.length} scene(s) is now on the user's board for review. Do not generate anything until they ask.`))
      } else if (tu.name === 'ask_user') {
        const opt = Array.isArray(tu.input?.options) && tu.input.options.length ? String(tu.input.options[0]) : 'yes'
        console.log(`❓ ${tu.input?.question ?? JSON.stringify(tu.input)} → "${opt}"`)
        results.push(ok(JSON.stringify({ answer: opt })))
      } else if (tu.name === 'read_skill_file') {
        results.push(ok((skillName && await readSkillFile(skillName, String(tu.input?.path ?? ''))) || 'No readable file.'))
      } else if (tu.name === 'start_generation') {
        console.log(`🚫 start_generation refused (harness)`)
        results.push(err('Harness: generation is disabled in this test. Do not retry; end your turn.'))
      } else results.push(err(`Unknown tool ${tu.name}`))
    }
    messages.push({ role: 'user', content: results })
  }

  // Sonnet 5 list prices: $2/M in, $10/M out; cache write 1.25×, read 0.1×.
  const cost = (usage.input * 2 + usage.output * 10 + usage.cacheWrite * 2.5 + usage.cacheRead * 0.2) / 1e6
  console.log(`\n— ${rounds} round(s), ${rejections} guard rejection(s), ~$${cost.toFixed(3)} (in ${usage.input} / cache w ${usage.cacheWrite} r ${usage.cacheRead} / out ${usage.output})`)

  if (!board) { console.log('NO STORYBOARD'); process.exit(1) }
  let bad = 0
  const assets = board.filter(s => (s as any).asset), scenes = board.filter(s => !(s as any).asset)
  for (const a of assets) {
    const cast = isCastAsset(a as any), tv = isThreeView(a.shot)
    if (cast && !tv) bad++
    console.log(`  ${cast ? (tv ? '✅' : '❌') : '•'} ${a.id} · ${a.title} · ${(a as any).still_model_name ?? '(no still model)'}\n     ${a.shot.slice(0, 220)}${a.shot.length > 220 ? '…' : ''}`)
  }
  console.log(`  scenes: ${scenes.length} (cap ${maxScenes})${scenes.length > maxScenes ? ' ❌ OVER CAP' : ''}`)
  for (const s of scenes) console.log(`     ${s.id} · ${s.title} · ${s.duration_s}s · ${s.model_name ?? '?'} / still ${(s as any).still_model_name ?? '?'}${(s as any).continues ? ' · cut' : ''}`)
  if (scenes.length > maxScenes) bad++
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error('HARNESS FAILED:', e?.message ?? e); process.exit(1) })
