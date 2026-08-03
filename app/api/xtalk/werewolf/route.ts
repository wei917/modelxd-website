// app/api/xtalk/werewolf/route.ts
// One request advances the game by ONE act, and returns the board as the
// caller's seat is entitled to see it.
//
// Why one act per request: a serverless function cannot hold a whole game
// open, and a game with a person in it must be able to wait indefinitely for
// them to type. So the client loops — but it loops over a state it does not
// own and cannot read ahead of.
//
//   POST { action: 'create', modelIds, humanName? }  → new session
//   POST { action: 'step',   sessionId }             → advance one act
//   POST { action: 'say',    sessionId, text, target? } → fulfil a human act

export const runtime     = 'nodejs'
export const maxDuration = 120

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits } from '@/lib/credits'
import {
  dealRoles, alive, wolves, winner, redact, forModel, dayOrder, tally, resolveSeat,
  type Seat, type Turn, type Phase,
} from '@/lib/werewolf-engine'
import { seatPrompt, outputContract, parseJsonReply } from '@/app/xtalk/werewolf'
import { M, languageRule } from '@/lib/werewolf-lang'

const LOG = '[xtalk/werewolf]'
const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Session = {
  id: string; user_id: string; status: string; human_seat: number | null
  players: Seat[]; phase: Phase; day: number; cursor: number
  turn_order: number[]; transcript: Turn[]; pending: any
  winner: string | null; cost_usd: number; game_id: string | null; title: string | null
}

/** The board, redacted for whoever is asking. */
function view(s: Session) {
  const me = s.human_seat
  return {
    sessionId: s.id,
    title: s.title ?? null,
    status: s.status,
    phase: s.phase,
    day: s.day,
    humanSeat: me,
    winner: s.winner,
    cost: Number(s.cost_usd),
    // Roles are revealed for the dead, for everyone once it is over, and to
    // the human about themselves. Never otherwise.
    players: s.players.map(p => ({
      seat: p.seat, name: p.name, provider: p.provider, alive: p.alive, isHuman: p.isHuman,
      role: (s.status === 'over' || !p.alive || me === null || p.seat === me ||
             (me !== null && s.players[me]?.role === 'wolf' && p.role === 'wolf')) ? p.role : null,
    })),
    transcript: redact(s.transcript, me),
    awaiting: awaitingHuman(s),
  }
}

/** What the human owes the game right now, if anything. */
function awaitingHuman(s: Session): null | { kind: 'kill' | 'check' | 'protect' | 'speak' | 'vote'; targets: { seat: number; name: string }[] } {
  if (s.status === 'over' || s.human_seat === null) return null
  const me = s.players[s.human_seat]
  if (!me?.alive) return null
  const names = (list: Seat[]) => list.map(p => ({ seat: p.seat, name: p.name }))
  if (s.phase === 'night_wolf' && me.role === 'wolf') {
    return { kind: 'kill', targets: names(alive(s.players).filter(p => p.role !== 'wolf')) }
  }
  if (s.phase === 'night_seer' && me.role === 'seer') {
    return { kind: 'check', targets: names(alive(s.players).filter(p => p.seat !== me.seat)) }
  }
  // The doctor may protect themselves, so no seat is excluded here.
  if (s.phase === 'night_doctor' && me.role === 'doctor') {
    return { kind: 'protect', targets: names(alive(s.players)) }
  }
  if ((s.phase === 'day' || s.phase === 'vote') && s.turn_order[s.cursor] === me.seat) {
    return s.phase === 'day'
      ? { kind: 'speak', targets: [] }
      : { kind: 'vote', targets: names(alive(s.players).filter(p => p.seat !== me.seat)) }
  }
  return null
}

async function askModel(seat: Seat, s: Session, prompt: string, field: string) {
  const model = seat.modelId ? await getModelById(seat.modelId) : null
  if (!model) return { say: '', reasoning: undefined as string | undefined, cost: 0, failed: true }

  const msgs: { role: 'user' | 'assistant'; content: any }[] = [{ role: 'user', content: prompt }]
  for (const t of forModel(s.transcript, seat.seat)) {
    msgs.push(t.seat === seat.seat
      ? { role: 'assistant', content: t.text }
      : { role: 'user', content: `${t.speaker} said: ${t.text}` })
  }
  if (msgs[msgs.length - 1].role === 'assistant') msgs.push({ role: 'user', content: 'Your turn.' })

  // One retry. A turn is not repeatable from the player's side — a dropped
  // call costs that seat its entire say for the round, and when it lands on
  // the seer on a decisive day it silently changes who wins. Retrying a
  // transient 429/500 is far cheaper than the game it would otherwise
  // distort. Cost accumulates across attempts: the first attempt may have
  // billed real tokens before dying. (CC, Aug 2)
  let full = '', cost = 0, lastError: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      console.warn(`${LOG} ${seat.name}: empty reply, retrying once`)
      await new Promise(r => setTimeout(r, 700))
    }
    let chunk = ''
    await new Promise<void>(resolve => {
      providers.streamText(model, msgs, {
        onDelta: (t) => { chunk += t },
        onDone:  (r) => { cost += r.cost ?? 0; resolve() },
        onError: (m) => { lastError = m; console.warn(`${LOG} ${seat.name}:`, m); resolve() },
      }, [], { userId: s.user_id, surface: 'xtalk-werewolf' } as any,
         { thinking: seat.thinking ?? null, search: seat.search === true }).catch((e) => {
        lastError = String(e?.message ?? e)
        resolve()
      })
    })
    if (chunk.trim()) { full = chunk; break }
  }

  // Extracting the public field is a SAFETY boundary, not a convenience.
  // The raw reply carries the model's private "reasoning"; if it ever
  // becomes the public `say`, every player reads the schemer's plan (a
  // human doctor saw a wolf's whole strategy this way — CC, Aug 3). So:
  //   1. clean JSON  → take the field, reasoning goes to its own slot;
  //   2. broken JSON → salvage BOTH fields with a tolerant regex (models
  //      routinely put raw newlines in string values, which JSON.parse
  //      rejects), so reasoning still lands in the redacted slot;
  //   3. a reply that mentions "reasoning" but yields no clean field is a
  //      malformed structured answer — it is DROPPED, never printed raw.
  // Only a reply with no structure at all falls through to plain prose.
  const o = parseJsonReply(full)
  const grab = (f: string): string | undefined => {
    if (o && typeof o[f] === 'string') return String(o[f]).trim()
    const m = new RegExp(`["']${f}["']\\s*:\\s*["']([\\s\\S]*?)["']\\s*[,}]`).exec(full)
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim() : undefined
  }
  const saidRaw   = grab(field)
  const reasoning = grab('reasoning')
  const looksStructured = /["']reasoning["']\s*:/.test(full) || new RegExp(`["']${field}["']\s*:`).test(full)
  const say = saidRaw !== undefined
    ? saidRaw
    // No clean field, but the reply was clearly a (broken) structured answer:
    // drop it rather than leak the reasoning baked into the raw text.
    : looksStructured ? '' : full.trim()
  return {
    say,
    reasoning,
    cost,
    failed: !full.trim() || (looksStructured && saidRaw === undefined),
    // Carried so the table can say WHY a seat went quiet. A silent turn that
    // reads as a strategic choice is worse than a visible error.
    error: !full.trim() ? (lastError ?? 'no response') : undefined,
  }
}

const nameOf = (s: Session, seat: number) => s.players[seat]?.name ?? `Seat ${seat}`
const mod = (text: string, kind: Turn['kind'], privateTo?: number[]): Turn =>
  ({ speaker: 'Moderator', system: true, text, kind, ...(privateTo ? { privateTo } : {}) })


/**
 * Write the finished game to the board.
 *
 * Derived here from the roles the server holds, so a result cannot be
 * faked by a caller. Failure is logged and swallowed: losing a row must
 * never stop a player seeing who won.
 */
async function record(db: any, s: Session, won: 'wolves' | 'village', total: number): Promise<string | null> {
  try {
    const { data: game, error } = await db.from('xtalk_games').insert({
      user_id:  s.user_id,
      players:  s.players.length,
      wolves:   s.players.filter(p => p.role === 'wolf').length,
      winner:   won,
      days:     s.day,
      cost_usd: total,
      transcript: s.transcript,
    }).select('id').single()
    if (error || !game) { console.warn(`${LOG} record failed:`, error?.message); return null }

    // The human seat has no model to credit, so it is left out of the board
    // — the rating is about models, and a person in the game is a condition
    // of that game, not a competitor in it.
    const rows = s.players
      .filter(p => !p.isHuman && p.modelId)
      .map(p => ({
        game_id:  game.id,
        seat:     p.seat,
        model_id: p.modelId,
        side:     p.role === 'wolf' ? 'wolf' : 'village',
        role:     p.role,
        won:      (p.role === 'wolf') === (won === 'wolves'),
        survived: p.alive,
      }))
    if (rows.length) {
      const { error: pErr } = await db.from('xtalk_game_players').insert(rows)
      if (pErr) console.warn(`${LOG} seats failed:`, pErr.message)
    }
    console.log(`${LOG} recorded ${game.id}: ${won}, ${s.players.length}p, day ${s.day}, $${total}`)
    return game.id as string
  } catch (e: any) {
    console.warn(`${LOG} record threw:`, e?.message)
    return null
  }
}

export async function POST(req: Request) {
  const guard = await assertFeature('xtalk')
  if (guard) return guard

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const lang = body.lang
  const L = M(lang)
  const RULE = languageRule(lang)
  const db = svc()

  // ── create ────────────────────────────────────────────────────────────
  if (body.action === 'create') {
    const modelIds: string[] = Array.isArray(body.modelIds) ? body.modelIds : []
    const humanName: string | null = typeof body.humanName === 'string' && body.humanName.trim()
      ? body.humanName.trim().slice(0, 24) : null
    const total = modelIds.length + (humanName ? 1 : 0)
    if (total < 4 || total > 8) return Response.json({ error: 'need 4–8 players' }, { status: 400 })

    const metas = await Promise.all(modelIds.map(id => getModelById(id)))
    if (metas.some(m => !m)) return Response.json({ error: 'unknown model' }, { status: 400 })

    // The human may ask for a role — being the wolf is the fun seat, and it
    // changes nothing for the models, who are dealt from the same bag.
    const wanted = ['wolf', 'seer', 'doctor', 'villager'].includes(body.humanRole) ? body.humanRole : null
    const humanSeat = humanName ? modelIds.length : -1
    const roles = dealRoles(total, (wanted && humanSeat >= 0) ? { seat: humanSeat, role: wanted } : undefined)
    const seats: Seat[] = []
    // Per-seat settings arrive keyed by model id; search is validated against
    // the model's declared capability here so a hand-rolled request can't ask
    // a model to search when the provider has no tool wired for it.
    const rawOpts = (body.seatOpts && typeof body.seatOpts === 'object') ? body.seatOpts : {}
    // A name is a player's identity in the transcript and the prompts, so it
    // MUST be unique — the same model can now take several chairs, and two
    // seats both called "Claude Fable 5" would make the game unplayable
    // (who is accusing whom?). The Nth copy of a name becomes "name (N)".
    // (CC, Aug 3)
    const nameCounts: Record<string, number> = {}
    const uniqueName = (base: string) => {
      const n = (nameCounts[base] = (nameCounts[base] ?? 0) + 1)
      return n === 1 ? base : `${base} (${n})`
    }
    metas.forEach((m, i) => {
      const o = rawOpts[m!.id] ?? {}
      const levels = m!.output_config?.text?.thinking_levels ?? []
      const caps   = m!.output_config?.text?.capabilities ?? []
      seats.push({
        seat: i, modelId: m!.id, name: uniqueName(m!.display_name), provider: m!.provider,
        role: roles[i], alive: true, isHuman: false,
        thinking: typeof o.thinking === 'string' && levels.includes(o.thinking) ? o.thinking : null,
        search:   o.search === true && caps.includes('web_search'),
      })
    })
    if (humanName) seats.push({
      seat: seats.length, modelId: null, name: uniqueName(humanName), provider: 'human',
      role: roles[seats.length], alive: true, isHuman: true,
    })

    const { data, error } = await db.from('xtalk_sessions').insert({
      user_id: user.id,
      human_seat: humanName ? seats.length - 1 : null,
      players: seats,
      phase: 'night_wolf',
      transcript: [mod(L.night(1), 'night')],
    }).select('*').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(view(data as Session))
  }

  // ── load ──────────────────────────────────────────────────────────────
  const { data: row, error: loadErr } = await db.from('xtalk_sessions')
    .select('*').eq('id', body.sessionId).eq('user_id', user.id).single()
  if (loadErr || !row) return Response.json({ error: 'session not found' }, { status: 404 })
  const s = row as Session

  // Read-only board fetch — /xtalk/<id> resuming after a reload or from the
  // nav history list. Never advances the game.
  if (body.action === 'state') return Response.json(view(s))

  if (s.status === 'over') return Response.json(view(s))

  const save = async (patch: Partial<Session>) => {
    const next = { ...s, ...patch }
    await db.from('xtalk_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id)
    Object.assign(s, next)
    return next
  }

  // ── say: the human fulfils whatever the game is waiting on ────────────
  if (body.action === 'say') {
    const need = awaitingHuman(s)
    if (!need) return Response.json({ error: 'not your turn' }, { status: 409 })
    const me = s.players[s.human_seat!]
    const text = String(body.text ?? '').slice(0, 2000)

    if (need.kind === 'speak') {
      s.transcript.push({ seat: me.seat, speaker: me.name, text: text || '(says nothing)', kind: 'day' })
      await save({ transcript: s.transcript, cursor: s.cursor + 1 })
      return Response.json(view(s))
    }
    const target = Number(body.target)
    if (!need.targets.some(t => t.seat === target)) {
      return Response.json({ error: 'invalid target' }, { status: 400 })
    }
    if (need.kind === 'kill') {
      s.transcript.push({ seat: me.seat, speaker: me.name, text: `Kills ${nameOf(s, target)}.`, kind: 'night', privateTo: wolves(s.players).map(w => w.seat) })
      await save({ transcript: s.transcript, pending: { ...s.pending, kill: target }, phase: 'night_seer', cursor: 0 })
    } else if (need.kind === 'protect') {
      s.transcript.push({ seat: me.seat, speaker: me.name, text: L.protects(nameOf(s, target)), kind: 'night', privateTo: [me.seat] })
      await save({ transcript: s.transcript, pending: { ...s.pending, save: target }, phase: 'dawn', cursor: 0 })
    } else if (need.kind === 'check') {
      const found = s.players[target]
      s.transcript.push({ seat: me.seat, speaker: me.name, text: `Investigates ${found.name}.`, kind: 'night', privateTo: [me.seat] })
      s.transcript.push(mod(L.seerResult(found.name, found.role === 'wolf'), 'night', [me.seat]))
      await save({ transcript: s.transcript, phase: 'night_doctor', cursor: 0 })
    } else if (need.kind === 'vote') {
      s.transcript.push({ seat: me.seat, speaker: me.name, text: `Votes ${nameOf(s, target)}.`, kind: 'vote' })
      await save({ transcript: s.transcript, pending: { ...s.pending, votes: { ...(s.pending.votes ?? {}), [me.seat]: target } }, cursor: s.cursor + 1 })
    }
    return Response.json(view(s))
  }

  // ── step: advance one act ─────────────────────────────────────────────
  if (body.action !== 'step') return Response.json({ error: 'unknown action' }, { status: 400 })
  if (awaitingHuman(s)) return Response.json(view(s))   // it is the human's move; do nothing

  let spent = 0
  const finish = async (extra: Partial<Session> = {}) => {
    await save({ ...extra, cost_usd: Number(s.cost_usd) + spent })
    if (spent > 0) {
      const cents = Math.round(spent * 100)
      if (cents > 0) debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xtalk_werewolf',
        referenceId: s.id, description: 'XTalk werewolf turn', metadata: {},
      }).catch(() => {})
    }
    return Response.json(view(s))
  }

  switch (s.phase) {
    case 'night_wolf': {
      const pack = wolves(s.players)
      if (!pack.length) return finish({ phase: 'night_seer' })
      const actor = pack[0]
      const targets = alive(s.players).filter(p => p.role !== 'wolf')
      const prompt = `${seatPrompt(
        { name: actor.name, role: actor.role } as any,
        s.players.map(p => ({ name: p.name })) as any,
        pack.filter(w => w.seat !== actor.seat).map(w => w.name),
      )}\n\nIt is night. Choose who the wolves kill. Living non-wolf players: ${targets.map(t => t.name).join(', ')}.\n\n${RULE}\n\n${outputContract('kill', 'the exact name of the player to kill')}`
      const r = await askModel(actor, s, prompt, 'kill')
      spent += r.cost
      const { seat: killSeat, exact } = resolveSeat(r.say, targets)
      s.transcript.push({
        seat: actor.seat, speaker: actor.name, kind: 'night', cost: r.cost, reasoning: r.reasoning,
        privateTo: pack.map(w => w.seat),
        text: r.failed ? L.noReply(actor.name, nameOf(s, killSeat)) : L.packKills(nameOf(s, killSeat)),
      })
      if (!exact && !r.failed) s.transcript.push(mod(`⚠ ${actor.name}'s target was inferred, not stated.`, 'night', pack.map(w => w.seat)))
      return finish({ transcript: s.transcript, pending: { ...s.pending, kill: killSeat }, phase: 'night_seer', cursor: 0 })
    }

    case 'night_seer': {
      const seer = alive(s.players).find(p => p.role === 'seer')
      if (!seer || seer.isHuman) return finish({ phase: 'night_doctor' })
      const targets = alive(s.players).filter(p => p.seat !== seer.seat)
      const prompt = `${seatPrompt({ name: seer.name, role: seer.role } as any, s.players.map(p => ({ name: p.name })) as any, [])}\n\nIt is night. Choose one player to investigate. Living players: ${targets.map(t => t.name).join(', ')}.\n\n${RULE}\n\n${outputContract('check', 'the exact name of the player to investigate')}`
      const r = await askModel(seer, s, prompt, 'check')
      spent += r.cost
      const { seat: checkSeat } = resolveSeat(r.say, targets)
      const found = s.players[checkSeat]
      s.transcript.push({
        seat: seer.seat, speaker: seer.name, kind: 'night', cost: r.cost, reasoning: r.reasoning,
        privateTo: [seer.seat],
        text: r.failed ? `⚠ no reply — moderator checked ${found.name}.` : `Investigates ${found.name}.`,
      })
      s.transcript.push(mod(L.seerResult(found.name, found.role === 'wolf'), 'night', [seer.seat]))
      return finish({ transcript: s.transcript, phase: 'night_doctor', cursor: 0 })
    }

    case 'night_doctor': {
      const doc = alive(s.players).find(p => p.role === 'doctor')
      if (!doc || doc.isHuman) return finish({ phase: 'dawn' })
      const targets = alive(s.players)   // may protect themselves
      const prompt = `${seatPrompt({ name: doc.name, role: doc.role } as any, s.players.map(p => ({ name: p.name })) as any, [])}\n\nIt is night. Choose one player to protect. Living players: ${targets.map(t => t.name).join(', ')}.\n\n${RULE}\n\n${outputContract('protect', 'the exact name of the player to protect')}`
      const r = await askModel(doc, s, prompt, 'protect')
      spent += r.cost
      const { seat: saveSeat } = resolveSeat(r.say, targets)
      s.transcript.push({
        seat: doc.seat, speaker: doc.name, kind: 'night', cost: r.cost, reasoning: r.reasoning,
        privateTo: [doc.seat],
        text: r.failed ? L.noReply(doc.name, nameOf(s, saveSeat)) : L.protects(nameOf(s, saveSeat)),
      })
      return finish({ transcript: s.transcript, pending: { ...s.pending, save: saveSeat }, phase: 'dawn', cursor: 0 })
    }

    case 'dawn': {
      const kill = s.pending?.kill
      const saved = s.pending?.save
      let players = s.players
      if (typeof kill === 'number' && kill === saved) {
        // Nobody is told WHO was saved — only that the night was quiet. That
        // silence is itself information: it tells the table a doctor exists.
        s.transcript.push(mod(L.dawnQuiet, 'result'))
      } else if (typeof kill === 'number') {
        players = players.map(p => p.seat === kill ? { ...p, alive: false } : p)
        s.transcript.push(mod(L.dawnDead(nameOf(s, kill)), 'result'))
      }
      const w = winner(players)
      if (w) {
        s.transcript.push(mod(w === 'wolves' ? L.wolvesWin : L.villageWin, 'result'))
        s.players = players
        const gid = await record(db, s, w, Number(s.cost_usd) + spent)
        return finish({ players, transcript: s.transcript, phase: 'over', status: 'over', winner: w, pending: {}, game_id: gid })
      }
      const order = dayOrder(players, s.day)
      s.players = players
      s.transcript.push(mod(L.day(s.day, alive(players).map(p => p.name).join(', ')), 'day'))
      return finish({ players, transcript: s.transcript, phase: 'day', cursor: 0, turn_order: order, pending: {} })
    }

    case 'day': {
      if (s.cursor >= s.turn_order.length) {
        return finish({ phase: 'vote', cursor: 0, turn_order: dayOrder(s.players, s.day), pending: { votes: {} } })
      }
      const actor = s.players[s.turn_order[s.cursor]]
      const mates = wolves(s.players).filter(w => w.seat !== actor.seat).map(w => w.name)
      const prompt = `${seatPrompt({ name: actor.name, role: actor.role } as any, s.players.map(p => ({ name: p.name })) as any, mates)}\n\nIt is day ${s.day}. The discussion is below. Say what you think — accuse someone, defend yourself, share what you know, or press someone on what they said. Do not state your role outright unless you have decided that revealing it is worth it.\n\n${RULE}\n\n${outputContract('say', 'what you actually say aloud, under 90 words, plain prose, no lists')}`
      const r = await askModel(actor, s, prompt, 'say')
      spent += r.cost
      s.transcript.push({
        seat: actor.seat, speaker: actor.name, kind: 'day', cost: r.cost, reasoning: r.reasoning,
        // Night and vote turns already flag a dead call; day used to print a
        // bare "(no reply)", which reads as the player choosing silence.
        text: r.failed ? `⚠ ${actor.name} 沒有回應（${r.error}）— 本回合視為棄權。` : r.say,
      })
      return finish({ transcript: s.transcript, cursor: s.cursor + 1 })
    }

    case 'vote': {
      if (s.cursor >= s.turn_order.length) {
        const { out, counts } = tally(s.pending?.votes ?? {})
        const summary = Object.entries(counts).map(([seat, n]) => `${nameOf(s, Number(seat))} ${n}`).join(' · ')
        let players = s.players
        if (out !== null) {
          const victim = players[out]
          players = players.map(p => p.seat === out ? { ...p, alive: false } : p)
          s.transcript.push(mod(L.votes(summary, victim.name, L.role[victim.role]), 'result'))
        } else {
          s.transcript.push(mod(L.votesTied(summary), 'result'))
        }
        const w = winner(players)
        if (w) {
          s.transcript.push(mod(w === 'wolves' ? L.wolvesWin : L.villageWin, 'result'))
          s.players = players
          const gid = await record(db, s, w, Number(s.cost_usd) + spent)
          return finish({ players, transcript: s.transcript, phase: 'over', status: 'over', winner: w, pending: {}, game_id: gid })
        }
        s.players = players
        s.transcript.push(mod(L.night(s.day + 1), 'night'))
        return finish({ players, transcript: s.transcript, phase: 'night_wolf', day: s.day + 1, cursor: 0, pending: {} })
      }
      const actor = s.players[s.turn_order[s.cursor]]
      const mates = wolves(s.players).filter(w => w.seat !== actor.seat).map(w => w.name)
      const targets = alive(s.players).filter(p => p.seat !== actor.seat)
      const prompt = `${seatPrompt({ name: actor.name, role: actor.role } as any, s.players.map(p => ({ name: p.name })) as any, mates)}\n\nDay ${s.day} voting. You may vote for: ${targets.map(t => t.name).join(', ')}.\n\n${RULE}\n\n${outputContract('vote', 'the exact name of the player you vote to eliminate')}\n\nYour "reasoning" is private. Say aloud nothing here — this turn is the ballot only.`
      const r = await askModel(actor, s, prompt, 'vote')
      spent += r.cost
      const { seat: v } = resolveSeat(r.say, targets)
      s.transcript.push({
        seat: actor.seat, speaker: actor.name, kind: 'vote', cost: r.cost, reasoning: r.reasoning,
        text: r.failed ? `⚠ no reply — moderator recorded a vote for ${nameOf(s, v)}.` : `Votes ${nameOf(s, v)}.`,
      })
      return finish({ transcript: s.transcript, cursor: s.cursor + 1, pending: { ...s.pending, votes: { ...(s.pending.votes ?? {}), [actor.seat]: v } } })
    }
  }

  return Response.json(view(s))
}
