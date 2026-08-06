// app/api/agent/ask/route.ts
// The site agent behind the omnibox.
//
// Answers questions about ModelXD itself — what it does, where a feature
// lives, what things cost — and, when the question is really "where is X",
// hands back a route so the omnibox can offer to take you there.
//
// Its entire knowledge of the product is content/site-guide.md, read from
// disk on each request (the file is small, and reading it live means a
// product change ships by editing markdown rather than redeploying a
// prompt). It is told, firmly, not to invent anything the guide does not
// say — a confident wrong answer about your own product is worse than "I
// don't know". (CC, Aug 5)
//
// Deliberately NOT the same thing as XDirector: this one never generates,
// never spends the user's credits, and holds no conversation. It is the
// front desk, not the studio.

import { readFile } from 'fs/promises'
import path from 'path'

export const runtime     = 'nodejs'
export const maxDuration = 30

const MODEL_CANDIDATES = [
  process.env.SITE_AGENT_MODEL,
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
].filter(Boolean) as string[]
let workingModel: string | null = null

/** Every route the agent is allowed to send someone to. An allow-list, so a
 *  hallucinated path can never become a dead link in the UI. */
const ROUTES: Record<string, string> = {
  '/xduel':   'XDuel',
  '/xcreate': 'XCreate',
  '/xcreate?agent=1': 'Agent Mode',
  '/xtalk':   'XTalk',
  '/xvote':   'XVote',
  '/xboard':  'XBoard',
  '/profile': 'Profile',
}

const LANGS: Record<string, string> = {
  en: 'English',
  'zh-Hant': 'Traditional Chinese (繁體中文)',
  'zh-Hans': 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
}

let guideCache: { text: string; at: number } | null = null

// The landing agent is public and unauthenticated by design — a visitor has
// to be able to ask what the site is before signing up. That also means
// anyone, including a bot, can spend the site owner's Anthropic budget from
// it. This is a floor, not a wall: in-memory means per serverless instance,
// so a determined attacker across many instances gets through. It stops the
// accidental hammering that actually happens (a stuck retry loop, someone
// holding Enter) for zero infrastructure. Move to a shared store before any
// real traffic. (CC, Aug 5)
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12
const hits = new Map<string, number[]>()

function overLimit(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()   // crude bound; this is a cache, not a ledger
  return recent.length > MAX_PER_WINDOW
}

async function guide(): Promise<string> {
  // 60s cache: long enough that a burst of questions reads the file once,
  // short enough that editing the markdown shows up while you are working.
  if (guideCache && Date.now() - guideCache.at < 60_000) return guideCache.text
  const p = path.join(process.cwd(), 'content', 'site-guide.md')
  const text = await readFile(p, 'utf8')
  guideCache = { text, at: Date.now() }
  return text
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ error: 'agent_unavailable' }, { status: 503 })

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') || 'unknown'
  if (overLimit(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const q = String(body?.q ?? '').trim().slice(0, 500)
  // Prior turns from the landing conversation. Capped and sanitised: this is
  // user-supplied and goes straight into the model's context.
  const history = Array.isArray(body?.history)
    ? body.history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-8)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1000) }))
    : []
  const lang = LANGS[body?.lang as string] ?? LANGS.en
  if (!q) return Response.json({ error: 'empty' }, { status: 400 })

  const system = [
    'You are the ModelXD site guide. You answer questions about the ModelXD website itself:',
    'what it does, where a feature lives, how something works, and what it costs.',
    '',
    'RULES',
    `- Write your answer in ${lang}. This is the language the reader has chosen for`,
    `  the site, and it does NOT change just because the question was typed in`,
    `  another language. A visitor reading a ${lang} interface expects a ${lang} reply.`,
    '- Be short. Two or three sentences at most. This is a search box, not a chat.',
    '- Use ONLY the guide below. If it does not cover the question, say you are not sure',
    '  and suggest the closest surface. Never invent a feature, price, or page.',
    '- If the question is about WHERE something is, always set "route".',
    `- "route" must be exactly one of: ${Object.keys(ROUTES).join(', ')} — or null.`,
    '- You cannot generate anything yourself. If the user wants something MADE —',
    '  "make me an ad video", "generate a product photo", "turn this into a clip" —',
    '  set route to "/xcreate?agent=1" and tell them you are opening the director',
    '  with their request. That surface builds the board (multiple angles, then a',
    '  video from them) which a single generation cannot. Use plain "/xcreate" only',
    '  when they explicitly want to drive the models themselves.',
    '',
    'Reply with ONLY a JSON object, no markdown fence:',
    '{"answer": "...", "route": "/xtalk" or null}',
    '',
    `REMINDER: "answer" must be written in ${lang}, whatever language the question used.`,
    '',
    '--- SITE GUIDE ---',
    await guide(),
  ].join('\n')

  const candidates = workingModel ? [workingModel] : MODEL_CANDIDATES
  let lastErr = ''
  for (const model of candidates) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model, max_tokens: 400, system,
          messages: [...history, { role: 'user', content: q }],
        }),
      })
      if (!res.ok) { lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`; continue }
      workingModel = model
      const j = await res.json()
      const raw = (j?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()

      // Models sometimes fence the JSON despite being asked not to; salvage
      // the object rather than failing the whole answer over a code fence.
      let parsed: any = null
      try {
        const m = raw.match(/\{[\s\S]*\}/)
        parsed = m ? JSON.parse(m[0]) : null
      } catch { parsed = null }

      const answer = String(parsed?.answer ?? raw).slice(0, 600)
      const route  = typeof parsed?.route === 'string' && ROUTES[parsed.route] ? parsed.route : null
      return Response.json({ answer, route, routeLabel: route ? ROUTES[route] : null })
    } catch (e: any) {
      lastErr = String(e?.message ?? e)
    }
  }
  console.warn('[agent/ask] all models failed:', lastErr)
  return Response.json({ error: 'agent_failed' }, { status: 502 })
}
