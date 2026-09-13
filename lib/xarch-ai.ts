// lib/xarch-ai.ts — XArch server side: the architects, billing, storage.
//
// Every architect call goes through the provider router (lib/providers), so
// it is logged in provider_calls and priced by the same calcTextCost as
// XCreate. The user chose the architect, so it is never substituted (the
// "who chose the model" rule) and bills list price after the call.
//
// Why streaming matters here: a GPT-6 Astra read of a real blueprint took
// 374s and 21K output tokens (Sep 13). A non-streaming request to the same
// model dropped its connection twice; the router's streaming path keeps it
// alive.

import { createClient } from '@supabase/supabase-js'
import * as providers from './providers'
import { getModelByProviderName } from './models'
import { debitCredits, getUserCredits, InsufficientCreditsError } from './credits'
import { sanitizeProviderError } from './provider-errors'
import { ARCHITECTS, KINDS, applyOps, checkPlan, normalizePlan, type ArchitectId, type Op, type Plan, type Selection } from './xarch'

const LOG = '[xarch]'

export function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
}

export class NotEnoughCredits extends Error { constructor(public needCents: number) { super('insufficient_credits') } }

/** Refuse before spending when the balance can't cover a typical call. */
export async function assertBalance(userId: string, cents: number) {
  const c = await getUserCredits(userId).catch(() => null)
  if (!c || Number(c.balance_cents) < cents) throw new NotEnoughCredits(cents)
}

export async function bill(userId: string, costUsd: number, projectId: string, what: string, meta: Record<string, unknown>) {
  const cents = Math.max(1, Math.round(costUsd * 100))
  if (!(costUsd > 0)) return 0
  try {
    await debitCredits({ userId, amountCents: cents, referenceType: 'xarch', referenceId: projectId, description: `XArch ${what}`, metadata: meta })
  } catch (e) {
    if (e instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits settling ${cents}¢ for ${projectId}`)
    else console.error(`${LOG} debit failed for ${projectId}:`, (e as Error).message)
  }
  return cents
}

/** One architect call, collected. Returns the text and its list-price cost. */
async function ask(architect: ArchitectId, userId: string, system: string, prompt: string,
  image?: { buffer: Buffer; mediaType: string }): Promise<{ text: string; cost: number }> {
  const a = ARCHITECTS[architect]
  const model = await getModelByProviderName(a.provider, a.model)
  if (!model || !model.enabled) throw new Error(`${a.label} is not available right now.`)
  let text = '', cost = 0, failed: string | null = null
  await providers.streamText(
    model,
    [{ role: 'user', content: prompt }],
    {
      onDelta: d => { text += d },
      onDone: r => { cost = r.cost },
      onError: m => { failed = m },
    },
    image ? [{ buffer: image.buffer, mediaType: image.mediaType }] : [],
    { userId },
    { thinking: a.thinking, system, jsonMode: true },
  )
  if (failed) throw new Error(sanitizeProviderError(failed))
  return { text, cost }
}

function parseJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('The architect did not return a readable answer.')
  return JSON.parse(m[0])
}

// ── Read a plan ──────────────────────────────────────────────────────────

const READ_SYSTEM = `You are an architect reading a floor plan drawing into precise geometry.`
const readPrompt = (w: number, h: number) => `This is a floor plan image, ${w}x${h} pixels.
1. Read every dimension string and room label exactly as printed.
2. If the drawing has printed dimensions or a scale bar, determine the scale in IMAGE PIXELS PER FOOT and say how in one sentence. If it has none, return "scale": null.
3. Extract the geometry in IMAGE PIXEL coordinates (origin top-left). Walls as centerline segments with thickness in inches; approximate curved walls with several straight segments. Doors at the center of their opening.
Return ONLY JSON:
{"scale":{"px_per_ft":..,"method":".."} | null,
 "overall_ft":{"width":..,"depth":..} | null,
 "walls":[{"x1":..,"y1":..,"x2":..,"y2":..,"thickness_in":..,"exterior":true|false}],
 "doors":[{"x":..,"y":..,"width_in":..}],
 "windows":[{"x1":..,"y1":..,"x2":..,"y2":..}],
 "stairs":[{"x":..,"y":..,"w":..,"h":..,"direction":"up|down"}],
 "rooms":[{"name":"..","label_dims":"as printed, or null","polygon":[[x,y],...]}]}`

export async function readPlan(architect: ArchitectId, userId: string, image: { buffer: Buffer; mediaType: string; w: number; h: number }) {
  const { text, cost } = await ask(architect, userId, READ_SYSTEM, readPrompt(image.w, image.h), image)
  const plan = normalizePlan(parseJson(text), { w: image.w, h: image.h })
  if (plan.walls.length === 0) throw new Error('No walls were found. Is this a floor plan?')
  return { plan, cost }
}

// ── Edit a plan ──────────────────────────────────────────────────────────

const OPS_DOC = `Allowed ops (use ids from the plan; new ids must be unique):
 {"op":"delete","kind":"walls|doors|windows|rooms|stairs","id":"..."}
 {"op":"set","kind":"...","id":"...","value":{...the full element without id...}}
 {"op":"add","kind":"...","id":"...","value":{...}}
Keep the plan consistent: connected walls stay connected, doors stay in a wall opening, every affected room polygon is updated, rooms that become one space are merged. Use feet through the plan's scale when the user gives sizes.`

const EDIT_SYSTEM = `You are an architect editing a floor plan stored as JSON (image pixel coordinates; walls are centerlines; scale.px_per_ft converts pixels to feet when present).
The user selected an element (or nothing) and gave an instruction. Return ONLY JSON:
{"ops":[...], "notes":"one or two sentences on what you changed", "warnings":["structural, code or livability concerns, if any"]}
${OPS_DOC}
If the instruction is unsafe or impossible, return no ops and explain in notes.`

const planForPrompt = (plan: Plan) => JSON.stringify({ scale: plan.scale, overall_ft: plan.overall_ft, ...Object.fromEntries(KINDS.map(k => [k, plan[k]])) })

export async function editPlan(architect: ArchitectId, userId: string, plan: Plan, selection: Selection, instruction: string) {
  const prompt = `PLAN:\n${planForPrompt(plan)}\n\nSELECTED: ${selection ? `${selection.kind} ${selection.id}` : 'nothing'}\nINSTRUCTION: ${instruction}`
  const { text, cost } = await ask(architect, userId, EDIT_SYSTEM, prompt)
  const out = parseJson(text)
  const ops: Op[] = Array.isArray(out.ops) ? out.ops : []
  const result = applyOps(plan, ops)
  return { ...result, ops, notes: String(out.notes ?? ''), warnings: Array.isArray(out.warnings) ? out.warnings.map(String) : [], cost, newIssues: newIssues(plan, result.plan) }
}

/** Only problems the edit introduced. Real plans carry freestanding wall
 *  ends (chimney breasts, stub partitions), so absolute checks are noise. */
export function newIssues(before: Plan, after: Plan) {
  const had = new Set(checkPlan(before).map(i => `${i.id}|${i.issue}`))
  return checkPlan(after).filter(i => !had.has(`${i.id}|${i.issue}`))
}

export function applyAgentOps(plan: Plan, ops: Op[]) {
  const r = applyOps(plan, ops)
  return { plan: r.plan, errors: r.errors, issues: newIssues(plan, r.plan) }
}

// ── The agent ────────────────────────────────────────────────────────────

const AGENT_SYSTEM = `You are the XArch design agent: an architect and interior designer working with a homeowner on their floor plan and room photos.
You receive the plan JSON, what the user has selected, the rooms' photos (ids + room), and the conversation. Answer briefly and practically, in the user's language.
You can take ONE action per turn. Return ONLY JSON:
{"reply":"what you say to the user",
 "action": null
   | {"type":"edit_plan","ops":[...],"notes":"..","warnings":[".."]}
   | {"type":"edit_photo","media_id":"..","prompt":"a precise instruction for an image editor, describing only the change and asking to keep everything else identical"}}
Only act when the user asks for a change; for questions, answer with action null. Before a structural change, mention risks in warnings.
${OPS_DOC}`

export type AgentTurn = { role: 'user' | 'assistant'; text: string }

export async function agentTurn(architect: ArchitectId, userId: string, plan: Plan, selection: Selection,
  media: { id: string; room_id: string | null; prompt?: string | null }[], history: AgentTurn[], message: string) {
  const convo = history.slice(-12).map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n')
  const prompt = `PLAN:\n${planForPrompt(plan)}\n\nPHOTOS: ${JSON.stringify(media.map(m => ({ id: m.id, room_id: m.room_id, note: m.prompt ?? null })))}\nSELECTED: ${selection ? `${selection.kind} ${selection.id}` : 'nothing'}\n\nCONVERSATION SO FAR:\n${convo || '(none)'}\n\nUSER: ${message}`
  const { text, cost } = await ask(architect, userId, AGENT_SYSTEM, prompt)
  const out = parseJson(text)
  return { reply: String(out.reply ?? ''), action: out.action ?? null, cost }
}

// ── Room photo edits (GPT Image 2) ───────────────────────────────────────

export async function editPhoto(userId: string, src: { buffer: Buffer; mediaType: string }, prompt: string, mask?: Buffer | null) {
  const model = await getModelByProviderName('openai', 'gpt-image-2')
  if (!model || !model.enabled) throw new Error('The photo editor is not available right now.')
  const sharp = (await import('sharp')).default
  const meta = await sharp(src.buffer).metadata()
  const ratio = (meta.width ?? 1) / (meta.height ?? 1)
  const size = ratio > 1.2 ? '1536x1024' : ratio < 0.83 ? '1024x1536' : '1024x1024'
  const atts: any[] = [{ buffer: src.buffer, mediaType: src.mediaType }]
  if (mask) atts.push({ buffer: mask, mediaType: 'image/png', port: 'mask' })
  const full = `${prompt}\n\nKeep the room's architecture, camera angle, lighting and every other object exactly as they are; change only what is described.`
  const r = await providers.generateImage(model, full, 'medium', size, atts, null, null, { userId })
  // gpt-image-2 answers a 2.5MB PNG; a room photo doesn't need lossless.
  const jpeg = await sharp(r.buffer).jpeg({ quality: 88 }).toBuffer()
  return { buffer: jpeg, mediaType: 'image/jpeg', cost: r.cost }
}

export async function download(bucket: string, path: string): Promise<{ buffer: Buffer; mediaType: string }> {
  const { data, error } = await service().storage.from(bucket).download(path)
  if (error || !data) throw new Error('Could not read the file.')
  return { buffer: Buffer.from(await data.arrayBuffer()), mediaType: data.type || 'image/jpeg' }
}

export const LOGTAG = LOG
