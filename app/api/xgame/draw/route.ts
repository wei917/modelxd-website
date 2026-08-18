// app/api/xgame/draw/route.ts
// Draw & Guess (owner design, Aug 6). Every round: ONE secret term, TWO
// pre-generated drawings of it by two anonymous image models, side by
// side. The user guesses (45s, host hints on demand), then votes which
// drawing was better; after 5 rounds the models are revealed with the
// vote tally. A blind image duel wearing a party game's clothes.
//
// ZERO live generation: rounds are assembled ONLY from drawings that
// already exist in draw_images (filled offline by
// scripts/fill-draw-images.ts). The only live AI is the host — a cheap
// text model that chats hints, house-paid, with a hard guard that its
// reply never contains the answer.
//
// Masking discipline (same as blind gomoku duels): the term and the model
// names live server-side only. view() reveals the term at the vote step
// and the names only when the match is over. Image URLs are opaque by
// construction: bucket paths are <model_secret>/<term_id> — nothing a
// DevTools reader can translate.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'
import { matchAnswer, normalizeAnswer, DRAW_LANGS, type DrawLang } from '@/lib/drawsomething-engine'

const LOG = '[xgame:draw]'
const ROUNDS = 5
const ROUND_MS = 45_000
const MAX_HINTS = 2
// Five real tries per round (owner, Aug 7: "we should limit it") — with
// two hints that's generous, and it keeps the term bank un-brute-forceable.
// Burning the last one ENDS the round (reveal + vote), labeled honestly as
// out-of-guesses, never left as a silent no-op or a fake "time's up".
const MAX_ATTEMPTS = 5
const GAMES_PER_DAY = 10

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const publicUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xgame-draw/${path}`

type Round = {
  termId: string; term: string; aliases: string[]; tier: string
  pathA: string; pathB: string
  chat: Array<{ who: 'you' | 'host'; text: string; correct?: boolean }>
  hints: number
  got: boolean | null          // null = still guessing
  noMore?: boolean             // lost by running out of guesses (vs clock)
  ms?: number                  // time to the correct guess
  vote?: 'A' | 'B' | 'skip'
}

// Canned fallback hints if the host model is down or leaks the answer.
const CANNED_HINT: Record<DrawLang, string> = {
  en: 'Look at the overall shape first — is it a thing, a place, or something happening?',
  'zh-Hant': '先看整體形狀——它是東西、地點，還是一件正在發生的事？',
  'zh-Hans': '先看整体形状——它是东西、地点，还是一件正在发生的事？',
  ja: 'まず全体の形を見て——物？場所？それとも何かの出来事？',
  ko: '먼저 전체 모양을 보세요 — 사물인가요, 장소인가요, 아니면 어떤 일인가요?',
}
const LANG_NAME: Record<DrawLang, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese (Taiwan)', 'zh-Hans': 'Simplified Chinese',
  ja: 'Japanese', ko: 'Korean',
}

/** The host: one short hint from a cheap text model, house-paid. Hard
 *  guard: a reply containing the answer (or an alias) is discarded for
 *  the canned hint — the host must tease, never tell. */
async function hostHint(lang: DrawLang, term: string, aliases: string[], wrongGuesses: string[], hintNo: number): Promise<string> {
  const model = process.env.XGAME_HOST_MODEL || process.env.SITE_AGENT_MODEL || 'claude-haiku-4-5-20251001'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model, max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            `You are the playful host of a Pictionary-style guessing game. The secret answer is "${term}" (language: ${LANG_NAME[lang]}).`,
            wrongGuesses.length ? `The player's wrong guesses so far: ${wrongGuesses.slice(-4).join(', ')}.` : 'The player has not guessed yet.',
            `Give hint #${hintNo} of ${MAX_HINTS}, in ${LANG_NAME[lang]}: hint 1 is vague (category / where you meet it), hint 2 is more concrete. React to their wrong guesses if any ("not food — bigger!").`,
            'STRICT RULES: never write, spell, or transliterate the answer itself. Max 25 words. Reply with the hint text only.',
          ].join('\n'),
        }],
      }),
    })
    const d: any = await res.json().catch(() => null)
    const text: string = d?.content?.[0]?.text?.trim() ?? ''
    if (!text) return CANNED_HINT[lang]
    // The guard: leaked answer (or alias) → canned hint instead.
    const norm = normalizeAnswer(text, lang)
    for (const a of [term, ...aliases]) {
      const na = normalizeAnswer(a, lang)
      if (na && norm.includes(na)) return CANNED_HINT[lang]
    }
    return text.slice(0, 300)
  } catch {
    return CANNED_HINT[lang]
  }
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  // ── create ────────────────────────────────────────────────────────────
  if (body.action === 'create') {
    const lang: DrawLang = DRAW_LANGS.includes(body.lang) ? body.lang : 'en'
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
    const { count } = await svc().from('xtalk_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('game', 'draw')
      .gte('created_at', dayStart.toISOString())
    if ((count ?? 0) >= GAMES_PER_DAY) {
      return Response.json({ error: 'No games left today — come back tomorrow.' }, { status: 429 })
    }

    // Coverage-driven casting: rounds are assembled ONLY from existing
    // drawings, so the eligible models and terms fall out of one query.
    // Easy tier is RETIRED (owner, Aug 6): it never enters the pool, even
    // where its drawings exist. A game that opens with "cat" is a game
    // nobody remembers.
    const { data: cov } = await svc().from('draw_images')
      .select('term_id, model_id, variant, storage_path, draw_terms!inner(id, lang, term, aliases, tier, enabled)')
      .eq('draw_terms.lang', lang).eq('draw_terms.enabled', true)
      .neq('draw_terms.tier', 'easy')
    const byModel = new Map<string, Map<string, any[]>>()   // model → term → image rows
    for (const r of (cov ?? []) as any[]) {
      if (!byModel.has(r.model_id)) byModel.set(r.model_id, new Map())
      const m = byModel.get(r.model_id)!
      if (!m.has(r.term_id)) m.set(r.term_id, [])
      m.get(r.term_id)!.push(r)
    }
    // Every model pair that shares ≥ ROUNDS covered terms can host a game.
    const modelIds = [...byModel.keys()]
    const pairs: Array<{ a: string; b: string; shared: string[] }> = []
    for (let i = 0; i < modelIds.length; i++) for (let j = i + 1; j < modelIds.length; j++) {
      const A = byModel.get(modelIds[i])!, B = byModel.get(modelIds[j])!
      const shared = [...A.keys()].filter(t => B.has(t))
      if (shared.length >= ROUNDS) pairs.push({ a: modelIds[i], b: modelIds[j], shared })
    }
    if (pairs.length === 0) {
      return Response.json({ error: 'Not enough pre-drawn art in this language yet — run the fill tool for at least two models.' }, { status: 503 })
    }
    // Prefer the pair with the RICHEST shared coverage (weighted random
    // across the top) — a pair that only shares the 5 easiest terms would
    // otherwise be picked as often as one sharing forty.
    pairs.sort((x, y) => y.shared.length - x.shared.length)
    const pick = pairs[Math.floor(Math.random() * Math.min(3, pairs.length))]
    // A/B sides are shuffled so side position never encodes the model.
    const [sideA, sideB] = Math.random() < 0.5 ? [pick.a, pick.b] : [pick.b, pick.a]
    // DIFFICULTY RAMP (owner, Aug 6): medium opens, hard closes. There is
    // no easy tier in this game — it was retired the same day it shipped.
    const tierOf = new Map<string, string>()
    for (const tid of pick.shared) {
      const row = byModel.get(pick.a)!.get(tid)![0]
      tierOf.set(tid, row.draw_terms?.tier ?? 'medium')
    }
    const pool: Record<string, string[]> = { medium: [], hard: [] }
    for (const tid of pick.shared) (pool[tierOf.get(tid)!] ?? pool.medium).push(tid)
    for (const k of Object.keys(pool)) pool[k].sort(() => Math.random() - 0.5)
    const RAMP: Array<string[]> = [
      ['medium', 'hard'],
      ['medium', 'hard'],
      ['medium', 'hard'],
      ['hard', 'medium'],
      ['hard', 'medium'],
    ]
    const termIds: string[] = []
    for (const prefs of RAMP.slice(0, ROUNDS)) {
      const tier = prefs.find(t2 => pool[t2].length > 0)
      if (!tier) break
      termIds.push(pool[tier].pop()!)
    }

    const { data: models } = await svc().from('ai_models')
      .select('id, display_name').in('id', [sideA, sideB])
    const nameOf = (id: string) => models?.find(m => m.id === id)?.display_name ?? 'Unknown'
    const randOf = (rows: any[]) => rows[Math.floor(Math.random() * rows.length)]

    const rounds: Round[] = termIds.map(tid => {
      const rowA = randOf(byModel.get(sideA)!.get(tid)!)
      const rowB = randOf(byModel.get(sideB)!.get(tid)!)
      const t = rowA.draw_terms
      return {
        termId: tid, term: t.term, aliases: t.aliases ?? [], tier: t.tier,
        pathA: rowA.storage_path, pathB: rowB.storage_path,
        chat: [], hints: 0, got: null,
      }
    })

    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'draw', status: 'active', human_seat: 0,
      players: [
        { side: 'A', modelId: sideA, name: nameOf(sideA), isHuman: false },
        { side: 'B', modelId: sideB, name: nameOf(sideB), isHuman: false },
      ],
      phase: 'guess', day: 1, turn_order: [], transcript: [],
      pending: { lang, round: 1, rounds, deadlineAt: new Date(Date.now() + ROUND_MS).toISOString() },
      title: 'Draw & Guess — blind match',
    }).select('id').single()
    if (error || !data) {
      console.warn(`${LOG} create failed:`, error?.message)
      return Response.json({ error: 'Could not create the game — is migration 73 applied?' }, { status: 503 })
    }
    body.id = data.id; body.action = 'state'
  }

  // ── load + owner check ────────────────────────────────────────────────
  const { data: row } = await svc().from('xtalk_sessions')
    .select('*').eq('id', body.id).maybeSingle()
  if (!row || row.user_id !== user.id || row.game !== 'draw') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const s = row as any

  const save = async (patch: Record<string, any>) => {
    Object.assign(s, patch)
    await svc().from('xtalk_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id)
  }

  // Server-side expiry: any action past the deadline flips the round to
  // the vote step (answer revealed, no score) before the action applies —
  // a stalled client can never freeze the clock.
  const expireIfDue = async () => {
    const p = s.pending
    if (s.status !== 'over' && s.phase === 'guess' && p.deadlineAt && Date.now() > new Date(p.deadlineAt).getTime() + 1500) {
      const r: Round = p.rounds[p.round - 1]
      r.got = false
      await save({ phase: 'vote', pending: { ...p } })
    }
  }

  const finishIfLastVoted = async () => {
    const p = s.pending
    const r: Round = p.rounds[p.round - 1]
    if (p.round < ROUNDS) {
      await save({
        phase: 'guess', day: p.round + 1,
        pending: { ...p, round: p.round + 1, deadlineAt: new Date(Date.now() + ROUND_MS).toISOString() },
      })
    } else {
      const tally = { A: 0, B: 0 }
      for (const rr of p.rounds as Round[]) { if (rr.vote === 'A') tally.A++; if (rr.vote === 'B') tally.B++ }
      const [pa, pb] = s.players
      await save({
        status: 'over', phase: 'over',
        winner: tally.A === tally.B ? 'draw' : (tally.A > tally.B ? 'black' : 'white'),
        title: `${pa.name} 🎨 ${tally.A} : ${tally.B} 🎨 ${pb.name}`,
        pending: { ...p },
      })
    }
    void r
  }

  const view = () => {
    const p = s.pending
    const over = s.status === 'over'
    const cur: Round = p.rounds[p.round - 1]
    const revealTerm = over || s.phase === 'vote'
    const tally = { A: 0, B: 0 }
    for (const rr of p.rounds as Round[]) { if (rr.vote === 'A') tally.A++; if (rr.vote === 'B') tally.B++ }
    return Response.json({
      id: s.id, status: s.status, phase: s.phase, lang: p.lang,
      round: p.round, rounds: ROUNDS,
      // The two drawings — opaque URLs, side order already shuffled.
      imgA: publicUrl(cur.pathA), imgB: publicUrl(cur.pathB),
      term: revealTerm ? cur.term : null,
      tier: cur.tier,
      chat: cur.chat, hints: cur.hints, maxHints: MAX_HINTS,
      attempts: cur.chat.filter(c => c.who === 'you').length, maxAttempts: MAX_ATTEMPTS,
      got: cur.got, noMore: cur.noMore ?? false, vote: cur.vote ?? null,
      remainingMs: s.phase === 'guess' && p.deadlineAt
        ? Math.max(0, new Date(p.deadlineAt).getTime() - Date.now()) : 0,
      // Past rounds for the recap strip (terms of finished rounds are public).
      history: (p.rounds as Round[]).slice(0, p.round - (s.phase === 'guess' ? 1 : 0)).map((rr, i) => ({
        n: i + 1, term: rr.term, got: rr.got, vote: rr.vote ?? null,
        imgA: publicUrl(rr.pathA), imgB: publicUrl(rr.pathB),
      })),
      tally,
      players: over
        ? s.players.map((x: any) => ({ side: x.side, name: x.name }))
        : s.players.map((x: any) => ({ side: x.side, name: x.side === 'A' ? 'Model A' : 'Model B' })),
      winner: s.winner ?? null,
    })
  }

  await expireIfDue()

  // ── guess ─────────────────────────────────────────────────────────────
  if (body.action === 'guess') {
    const p = s.pending
    const r: Round = p.rounds[p.round - 1]
    if (s.status === 'over' || s.phase !== 'guess') return view()
    const text = String(body.text ?? '').slice(0, 80).trim()
    if (!text || r.chat.filter(c => c.who === 'you').length >= MAX_ATTEMPTS) return view()
    const correct = matchAnswer(text, r.term, r.aliases, p.lang)
    r.chat.push({ who: 'you', text, ...(correct ? { correct: true } : {}) })
    if (correct) {
      r.got = true
      r.ms = ROUND_MS - Math.max(0, new Date(p.deadlineAt).getTime() - Date.now())
      await save({ phase: 'vote', pending: { ...p } })
    } else if (r.chat.filter(c => c.who === 'you').length >= MAX_ATTEMPTS) {
      // That was the last try — the round ends now, honestly labeled.
      r.got = false
      r.noMore = true
      await save({ phase: 'vote', pending: { ...p } })
    } else {
      await save({ pending: { ...p } })
    }
    return view()
  }

  // ── hint — the live host ──────────────────────────────────────────────
  if (body.action === 'hint') {
    const p = s.pending
    const r: Round = p.rounds[p.round - 1]
    if (s.status === 'over' || s.phase !== 'guess' || r.hints >= MAX_HINTS) return view()
    r.hints++
    await save({ pending: { ...p } })   // reserve the slot before the slow call
    const wrong = r.chat.filter(c => c.who === 'you' && !c.correct).map(c => c.text)
    const hint = await hostHint(p.lang, r.term, r.aliases, wrong, r.hints)
    r.chat.push({ who: 'host', text: hint })
    await save({ pending: { ...p } })
    return view()
  }

  // ── timeout (client noticed the clock; server re-checks in expireIfDue) ─
  if (body.action === 'timeout') return view()

  // ── vote → next round / finish ────────────────────────────────────────
  if (body.action === 'vote') {
    const p = s.pending
    const r: Round = p.rounds[p.round - 1]
    if (s.status === 'over' || s.phase !== 'vote' || r.vote) return view()
    const c = body.choice
    r.vote = c === 'A' ? 'A' : c === 'B' ? 'B' : 'skip'
    await save({ pending: { ...p } })
    await finishIfLastVoted()
    return view()
  }

  if (body.action === 'state') return view()
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
