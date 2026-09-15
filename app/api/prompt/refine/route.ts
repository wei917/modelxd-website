// POST /api/prompt/refine — a suggested rewrite of the prompt the user is
// about to send (XDuel, XCreate). Owner request, Sep 16: someone types
// 「畫張京都旅行圖」 and wants a button that improves it, then chooses.
//
// House-paid through lib/house-llm.ts (Claude first, OpenAI when the account
// cannot serve), like the site agent: the user is never charged and nothing
// is generated here. Signed-in users only, per-user and per-IP minute
// limits, bounded input and output. The reply is a SUGGESTION: the client
// shows it beside the original and replaces nothing until the user says so,
// and every detail the model added that the user did not state comes back
// in `added` so the UI can label it as a suggestion rather than a fact.
import { houseCall } from '@/lib/house-llm'
import { extractJson } from '@/lib/json-schema'

export const runtime     = 'nodejs'
export const maxDuration = 30

// Haiku first: a short rewrite, no reasoning needed, and the site agent's
// candidates already showed Haiku handles ja / zh-Hant copy well enough for
// a prompt. Sonnet stands behind it. PROMPT_REFINE_MODEL overrides.
const MODEL_CANDIDATES = [
  process.env.PROMPT_REFINE_MODEL,
  'claude-haiku-4-5',
  'claude-sonnet-5',
].filter(Boolean) as string[]

const MAX_INPUT_CHARS  = 2000
const PER_USER_PER_MIN = 20
const PER_IP_PER_MIN   = 40

// In-memory, per instance — a floor, not a wall (same caveat as the site
// agent's limiter, CLAUDE.md "Known Debt" 1). The auth requirement is the
// real gate; this stops a stuck client from looping.
const hits = new Map<string, number[]>()
function overLimit(key: string, max: number): boolean {
  const now = Date.now()
  const arr = (hits.get(key) ?? []).filter(t => now - t < 60_000)
  arr.push(now)
  hits.set(key, arr)
  if (hits.size > 5000) hits.clear()
  return arr.length > max
}

import { RULES_VERSION, MAX_OUTPUT_CHARS, NO_PEOPLE_RE, classifyRequest, detailLevel, buildSystemPrompt, sanitizeResult, type RefineMode } from '@/lib/prompt-refine/rules'

const MODES = new Set<RefineMode>(['text', 'image', 'video', 'game'])
const LANG_NAME: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese', 'zh-Hans': 'Simplified Chinese', ja: 'Japanese', ko: 'Korean',
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'unavailable' }, { status: 503 })
  }

  // Signed-in users only: this spends the owner's money, not the user's.
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') || 'unknown'
  if (overLimit(`u:${user.id}`, PER_USER_PER_MIN) || overLimit(`ip:${ip}`, PER_IP_PER_MIN)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const prompt = String(body?.prompt ?? '').trim()
  if (prompt.length < 2)               return Response.json({ error: 'empty' },    { status: 400 })
  if (prompt.length > MAX_INPUT_CHARS) return Response.json({ error: 'too_long' }, { status: 400 })
  const mode: RefineMode = MODES.has(body?.mode) ? body.mode : 'text'
  const surface = body?.surface === 'xcreate' ? 'xcreate' : 'xduel'
  const uiLang = LANG_NAME[String(body?.lang ?? '')] ?? null

  // The rules live in lib/prompt-refine/rules.ts (versioned): request type,
  // detail level and the person's own constraints shape the instructions.
  const requestType = classifyRequest(prompt, mode)
  const detail = detailLevel(prompt)
  const system = buildSystemPrompt({ mode, surface, requestType, detail, uiLang, noPeople: NO_PEOPLE_RE.test(prompt) })

  let resp: any
  try {
    resp = await houseCall({
      tag: '[prompt/refine]',
      models: MODEL_CANDIDATES,
      maxTokens: 900,
      disableThinking: true,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (e: any) {
    console.warn('[prompt/refine] no provider could answer:', e?.message ?? e)
    return Response.json({ error: 'refine_failed' }, { status: 502 })
  }

  const raw = (resp?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
  const result = sanitizeResult(extractJson(raw), prompt)
  if (!result) return Response.json({ error: 'refine_failed' }, { status: 502 })
  return Response.json({ ...result, requestType, detail, rulesVersion: RULES_VERSION })
}