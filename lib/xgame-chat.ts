// lib/xgame-chat.ts — the chats of a table where two people play (Oct 21).
// SERVER-ONLY.
//
// Owner: "we enable the chat room by default and have a low cost fast model
// to be as commenter? it will 解說戰局 by default but users can hire private
// AI to help. and opponent can only see you hire someone but don't know what
// they tell you"; "private and public chat room in the same game page"; the
// house commentator "is by system for sure"; GPT-6 Luna.
//
// Two chats, one table (xgame_messages, supabase/148 + 149, service role
// only), read and written only through /api/xgame/chat after the seat check
// (lib/xgame-duo.ts seatOf):
//   - PUBLIC (private_to null): both players and the HOUSE commentator, GPT-6
//     Luna at its quickest, paid by the house up to XGAME_HOUSE_DAILY_USD a
//     Taipei day ($5 unset). It explains the game after every 4th move, a
//     check and the end, and answers @Luna / @AI. It never picks a move for
//     either side: advice is what a helper is for.
//   - PRIVATE (private_to = the player): a player and the AI HELPER they
//     hired (xtalk_sessions.chat_ais, one per player), paid by them at list
//     price, remark by remark (wallet checked first; sub-cent charges carried
//     by accrueFraction). It answers every message there and, if asked to,
//     speaks up after the opponent's moves. The opponent learns only that a
//     helper was hired, never which model or what it says.
// The table's Realtime channel only says "something changed" (pingTable), as
// for moves. A person's message is checked like an X體育 room's
// (lib/moderation, refused when the check cannot run) and rate-limited. One
// AI speaks at a time per table: the lease column (step_until, supabase/147;
// a table of people never asks a model for a MOVE, so the lease is free).

import { createClient, type User } from '@supabase/supabase-js'
import * as providers from './providers'
import { moderate } from './moderation'
import { sanitizeProviderError } from './provider-errors'
import { accrueFraction, debitCredits, InsufficientCreditsError } from './credits'
import { faceOf, isDuo, pingTable, seatOf, type DuoSeat } from './xgame-duo'
import { chessEngine } from './chess-engine'
import { boardText as chessBoard, sanLine } from './chess-board'
import { xiangqiEngine } from './xiangqi-engine'
import { boardText as xqBoard, wxfToChinese } from './xiangqi-board'

const LOG = '[xgame:chat]'
const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

export const CHAT_MAX = 500
/** Seconds between two messages from one person at a table. */
const SLOW_SECONDS = 2
/** How long a remark may take before the next one may start. */
const LEASE_SECONDS = 120

/** The house commentator (the same row X體育's cheap pair uses). */
export const HOUSE = { provider: 'openai', model_name: 'gpt-6-luna', name: 'GPT-6 Luna' }
/** It explains the game after every this many plies (and a check, the end). */
const HOUSE_EVERY = 4
const houseDailyUsd = () => Number(process.env.XGAME_HOUSE_DAILY_USD) || 5

/** How often a helper speaks up unasked: never, after every 3rd move of the
 *  opponent, or after each one (a check or the end always counts, except
 *  for 'asked'). */
export type Talk = 'asked' | 'normal' | 'chatty'
export const TALKS: Talk[] = ['asked', 'normal', 'chatty']
const EVERY: Record<Talk, number> = { asked: 0, normal: 3, chatty: 1 }

export type Helper = {
  modelId: string; name: string; provider: string
  /** Who hired it, pays for it, and alone reads it. */
  hiredBy: string; hirerName: string; seat: number
  talk: Talk
}

export type ChatGame = 'chess' | 'xiangqi'
export const isChatGame = (g: unknown): g is ChatGame => g === 'chess' || g === 'xiangqi'

type Row = { id: string; user_id: string; game: string; status: string; human_seat: number | null; players: (DuoSeat & { side?: string; color?: string })[]; pending: any; chat_ais?: Helper[] | null; title: string | null; updated_at: string }
const ROW = 'id, user_id, game, status, human_seat, players, pending, chat_ais, title, updated_at'

/** The table of two people, and the asker's seat (−1: not seated, so no chat). */
export async function loadTable(id: unknown, userId: string): Promise<{ row: Row; seat: number } | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await admin().from('xtalk_sessions').select(ROW).eq('id', id).maybeSingle()
  // Two people only: a game against a model holds the lease for its moves.
  if (!data || !isChatGame(data.game) || !Array.isArray(data.players) || !isDuo(data.players)) return null
  const row = data as Row
  const seat = seatOf(row, userId)
  return { row, seat }
}

export const helpersOf = (row: Pick<Row, 'chat_ais'>): Helper[] => Array.isArray(row.chat_ais) ? row.chat_ais : []

/** What @ calls a model: the last word of its name with a letter in it
 *  (GPT-6 Luna → Luna, Claude Opus 5.5 → Opus, Grok 4.7 → Grok). */
export const shortName = (name: string) => name.split(/\s+/).filter(w => /\p{L}/u.test(w)).pop() ?? name

/** The helpers as one player's page sees them: their own in full; of the
 *  opponent's, only that one was hired (owner: "opponent can only see you
 *  hire someone"). Never an account id. */
export function helpersFor(row: Row, viewerId: string) {
  const all = helpersOf(row)
  const mine = all.find(h => h.hiredBy === viewerId)
  const theirs = all.find(h => h.hiredBy !== viewerId)
  return {
    helper: mine ? { modelId: mine.modelId, name: mine.name, short: shortName(mine.name), talk: mine.talk } : null,
    opponentHired: theirs ? theirs.hirerName : null,
  }
}

/** Change the helpers: a compare-and-set on updated_at, so two people hiring
 *  at once cannot drop each other's (a move saved meanwhile only costs a
 *  retry). */
export async function setHelpers(tableId: string, change: (list: Helper[]) => Helper[] | null): Promise<Row | null> {
  for (let i = 0; i < 3; i++) {
    const { data } = await admin().from('xtalk_sessions').select(ROW).eq('id', tableId).maybeSingle()
    if (!data) return null
    const row = data as Row
    const next = change(helpersOf(row))
    if (!next) return row
    const { data: saved } = await admin().from('xtalk_sessions')
      .update({ chat_ais: next, updated_at: new Date().toISOString() })
      .eq('id', tableId).eq('updated_at', row.updated_at).select('id')
    if (saved?.length) { await pingTable(tableId); return { ...row, chat_ais: next } }
  }
  return null
}

export type ChatMessage = {
  id: number; kind: 'human' | 'ai'; name: string; handle: string | null; avatar: string | null
  model: string | null; content: string; costUsd: number; mine: boolean; at: string
}

const COLS = 'id, kind, user_id, author_name, author_handle, author_avatar, model_name, content, cost_usd, created_at'
const toMessage = (viewerId: string) => (m: any): ChatMessage => ({
  id: Number(m.id), kind: m.kind, name: m.author_name, handle: m.author_handle, avatar: m.author_avatar,
  model: m.model_name, content: m.content, costUsd: Number(m.cost_usd) || 0,
  // A helper's remark is "mine" when I hired (and pay for) it.
  mine: !!viewerId && m.user_id === viewerId, at: m.created_at,
})

/** One chat, oldest first (the newest `limit`): the public one (`privateTo`
 *  null) or a player's private one. */
export async function listMessages(tableId: string, viewerId: string, privateTo: string | null, limit = 200): Promise<ChatMessage[]> {
  let q = admin().from('xgame_messages').select(COLS).eq('table_id', tableId).eq('deleted', false)
  q = privateTo ? q.eq('private_to', privateTo) : q.is('private_to', null)
  const { data, error } = await q.order('id', { ascending: false }).limit(limit)
  if (error) { console.warn(`${LOG} list ${tableId}:`, error.message); return [] }
  return (data ?? []).reverse().map(toMessage(viewerId))
}

export type PostResult = { ok: true; id: number; name: string } | { ok: false; code: 'empty' | 'long' | 'slow' | 'refused' | 'check_unavailable' | 'failed' }

/** A person's message, to the public chat or (`priv`) to their helper:
 *  trimmed, at most CHAT_MAX, one every 2 s, moderated. */
export async function postHuman(tableId: string, user: User, raw: unknown, priv: boolean): Promise<PostResult> {
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) return { ok: false, code: 'empty' }
  if (content.length > CHAT_MAX) return { ok: false, code: 'long' }
  const { data: last } = await admin().from('xgame_messages').select('created_at')
    .eq('user_id', user.id).eq('kind', 'human').order('created_at', { ascending: false }).limit(1)
  if (last?.[0] && Date.now() - new Date(last[0].created_at).getTime() < SLOW_SECONDS * 1000) return { ok: false, code: 'slow' }
  const verdict = await moderate({ text: content })
  if (verdict === 'refused') return { ok: false, code: 'refused' }
  if (verdict === 'unavailable') return { ok: false, code: 'check_unavailable' }
  const face = await faceOf(user)
  const { data, error } = await admin().from('xgame_messages').insert({
    table_id: tableId, kind: 'human', user_id: user.id, private_to: priv ? user.id : null,
    author_name: face.name, author_handle: face.handle, author_avatar: face.avatar, content,
  }).select('id').single()
  if (error || !data) { console.warn(`${LOG} post ${tableId}:`, error?.message); return { ok: false, code: 'failed' } }
  await pingTable(tableId)
  return { ok: true, id: Number(data.id), name: face.name }
}

/** Take back your own message. */
export async function deleteOwn(tableId: string, userId: string, messageId: unknown): Promise<boolean> {
  const id = Number(messageId)
  if (!Number.isInteger(id)) return false
  const { data } = await admin().from('xgame_messages').update({ deleted: true })
    .eq('id', id).eq('table_id', tableId).eq('user_id', userId).eq('kind', 'human').select('id')
  if (data?.length) await pingTable(tableId)
  return !!data?.length
}

/** Does a public message call the house commentator (@Luna, @GPT-6 Luna,
 *  @AI)? */
export function callsHouse(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes(`@${HOUSE.name.toLowerCase()}`) || lower.includes(`@${shortName(HOUSE.name).toLowerCase()}`) || /@ai\b/i.test(text)
}

/** The start of today in Taipei, as an instant (the house's day, as X體育's). */
function taipeiDayStart(): string {
  const d = new Date(Date.now() + 8 * 3600_000)
  d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() - 8 * 3600_000).toISOString()
}

/** Has the house commentator used up today's budget? Its remarks are the
 *  only ones without a payer. Fails closed: no read = quiet. */
export async function houseQuiet(): Promise<boolean> {
  const { data, error } = await admin().from('xgame_messages').select('cost_usd')
    .eq('kind', 'ai').is('user_id', null).gte('created_at', taipeiDayStart())
  if (error) { console.warn(`${LOG} house spend:`, error.message); return true }
  const spent = (data ?? []).reduce((s, m: any) => s + (Number(m.cost_usd) || 0), 0)
  return spent >= houseDailyUsd()
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese as used in Taiwan (繁體中文)',
  'zh-Hans': 'Simplified Chinese (简体中文)', ja: 'Japanese (日本語)', ko: 'Korean (한국어)',
}
const quickest = (levels: string[]): string | null => ['none', 'thinking_false', 'minimal', 'low'].find(l => levels.includes(l)) ?? null
const sideName = (game: string, seat: number) => game === 'chess' ? (seat === 0 ? 'White' : 'Black') : (seat === 0 ? 'Red' : 'Black')

/** The game as the AI reads it: the board, whose move, the moves. */
async function describe(row: Row, lang: string): Promise<string> {
  const moves: string[] = row.pending?.moves ?? []
  const name = (i: number) => row.players[i]?.name || '…'
  // The winner by name, so a remark never says "Black won" in Chinese.
  const end = row.pending?.end
  const over = row.status !== 'over' ? ''
    : !end || end.winner === 'draw' ? `The game is over: a draw (${end?.reason ?? ''}).`
    : `The game is over (${end.reason}): ${name(end.winner === 'black' ? 1 : 0)} won.`
  if (row.game === 'chess') {
    const e = await chessEngine()
    const pos = e.position(moves)
    return [
      `Chess. White: ${name(0)}. Black: ${name(1)}.`,
      `Moves so far: ${moves.length ? sanLine(pos.sanHistory) : '(none yet)'}`,
      `Position (FEN): ${pos.fen}`,
      chessBoard(pos.fen),
      over || `${pos.turn === 'w' ? 'White' : 'Black'} (${name(pos.turn === 'w' ? 0 : 1)}) is to move${pos.check ? ', in check' : ''}.`,
    ].join('\n')
  }
  const e = await xiangqiEngine()
  const pos = e.position(moves)
  const named = pos.history.map((h, i) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'} ${wxfToChinese(h.wxf, i % 2 ? 'b' : 'w', lang)} (${h.wxf})`).join(' ')
  return [
    `Xiangqi (Chinese chess). Red: ${name(0)}. Black: ${name(1)}.`,
    `Moves so far: ${named || '(none yet)'}`,
    `Position (FEN): ${pos.fen}`,
    xqBoard(pos.fen),
    over || `${pos.turn === 'w' ? 'Red' : 'Black'} (${name(pos.turn === 'w' ? 0 : 1)}) is to move${pos.check ? ', in check' : ''}.`,
  ].join('\n')
}

async function claimLease(tableId: string): Promise<boolean> {
  const now = new Date()
  const { data } = await admin().from('xtalk_sessions')
    .update({ step_until: new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString() })
    .eq('id', tableId).or(`step_until.is.null,step_until.lt.${now.toISOString()}`).select('id')
  return !!data?.length
}
const releaseLease = (tableId: string) => admin().from('xtalk_sessions').update({ step_until: null }).eq('id', tableId)

const MODEL_COLS = 'id, provider, model_name, display_name, modes, model_pricing, input_config, output_config, enabled'

/** Who speaks: the house commentator in the public chat, or a player's
 *  helper in their private one. */
export type Speaker = { kind: 'house' } | { kind: 'helper'; helper: Helper }

/** One remark: after a move, or an answer to the person who asked. */
export async function speak(tableId: string, who: Speaker, opts: { lang: string; asker?: { name: string; text: string }; wait?: boolean }): Promise<void> {
  let claimed = false
  for (let i = 0; i < (opts.wait ? 20 : 1) && !claimed; i++) {
    claimed = await claimLease(tableId)
    if (!claimed && opts.wait) await new Promise(r => setTimeout(r, 1500))
  }
  if (!claimed) return
  const label = who.kind === 'house' ? HOUSE.name : who.helper.name
  try {
    const { data } = await admin().from('xtalk_sessions').select(ROW).eq('id', tableId).maybeSingle()
    if (!data) return
    const row = data as Row
    const lang = LANG_NAMES[opts.lang] ?? LANG_NAMES.en
    const players = row.players.map((p, i) => `${p.name || '…'} (${sideName(row.game, i)})`)
    let model: any, system: string, history: ChatMessage[], cue: string
    let payer: string | null = null, privateTo: string | null = null

    if (who.kind === 'house') {
      if (await houseQuiet()) return
      const { data: m } = await admin().from('ai_models').select(MODEL_COLS)
        .eq('provider', HOUSE.provider).eq('model_name', HOUSE.model_name).eq('enabled', true).maybeSingle()
      model = m
      history = await listMessages(tableId, '', null, 20)
      system = [
        `You are ${HOUSE.name}, the commentator in the public chat of a game between ${players.join(' and ')}. Both players read this chat.`,
        `Write in ${lang}. Be brief: one to three sentences, plain text, no markdown, no lists.`,
        'Explain what is happening on the board: the ideas behind the moves, threats, who stands better and why. Be fair to both sides.',
        'Never tell either player which move to play, even when asked: explain the position instead, and say that each player may hire a private AI helper for advice.',
        'Never pretend to be a player, and never claim a move was played unless it is in the move list.',
      ].join('\n')
      cue = opts.asker
        ? `${opts.asker.name} asked you: ${opts.asker.text}\n[Answer ${opts.asker.name} by name, briefly.]`
        : '[A move was just played. Explain it or the position now in one or two sentences. No greeting, no question.]'
    } else {
      const h = who.helper
      // Still hired? (It may have been dismissed or replaced while waiting.)
      if (!helpersOf(row).some(x => x.hiredBy === h.hiredBy && x.modelId === h.modelId)) return
      const { data: wallet } = await admin().from('user_credits').select('balance_cents').eq('user_id', h.hiredBy).maybeSingle()
      if ((Number(wallet?.balance_cents) || 0) < 1) { console.warn(`${LOG} ${tableId}: ${h.name}'s hirer is out of credits`); return }
      const { data: m } = await admin().from('ai_models').select(MODEL_COLS).eq('id', h.modelId).eq('enabled', true).maybeSingle()
      model = m
      payer = h.hiredBy; privateTo = h.hiredBy
      history = await listMessages(tableId, h.hiredBy, h.hiredBy, 20)
      const opponent = row.players[h.seat === 0 ? 1 : 0]?.name || '…'
      system = [
        `You are ${h.name}, a private AI helper hired by ${h.hirerName}, who plays ${sideName(row.game, h.seat)} against ${opponent}. Only ${h.hirerName} reads this chat; the opponent cannot.`,
        `Write in ${lang}. Be brief: two to four sentences, plain text, no markdown, no lists.`,
        `Help ${h.hirerName} play well: explain the position, warn about threats, and suggest good moves with the reason, in the notation of the move list.`,
        'Never claim a move was played unless it is in the move list.',
      ].join('\n')
      cue = opts.asker
        ? `${h.hirerName} asks you: ${opts.asker.text}\n[Answer briefly.]`
        : `[${opponent} just moved. Tell ${h.hirerName} what that move does and what to watch for or consider now: one to three sentences.]`
    }
    if (!model) return

    const chat = history.map(m => `${m.kind === 'ai' ? `${m.name} (AI)` : m.name}: ${m.content}`).join('\n')
    const prompt = `${await describe(row, opts.lang)}\n\nThe chat so far:\n${chat || '(empty)'}\n\n${cue}`
    const levels: string[] = model.output_config?.text?.thinking_levels ?? []
    let cost = 0
    const text = await new Promise<string>((resolve) => {
      let out = '', settled = false
      const done = (v: string) => { if (!settled) { settled = true; resolve(v) } }
      const timer = setTimeout(() => done(''), 60_000)
      providers.streamText(model, [{ role: 'user', content: prompt }], {
        onDelta: d => { out += d },
        onDone: r => { cost = Number(r?.cost) || 0; clearTimeout(timer); done(out.trim()) },
        onError: m => { console.warn(`${LOG} ${label}:`, sanitizeProviderError(m)); clearTimeout(timer); done('') },
      }, [], { userId: payer, surface: 'xgame-chat' } as any, { system, thinking: quickest(levels), search: false })
        .then(() => { clearTimeout(timer); done(out.trim()) }, () => { clearTimeout(timer); done('') })
    })
    if (payer && cost > 0) {
      const carried = await accrueFraction(payer, cost * 1e6)
      const cents = carried ?? Math.round(cost * 100)
      if (cents > 0) await debitCredits({
        userId: payer, amountCents: cents, referenceType: 'xgame_chat',
        referenceId: tableId, description: `XGame helper: ${label}`, metadata: { model: label },
      }).catch(err => { if (!(err instanceof InsufficientCreditsError)) console.warn(`${LOG} debit failed:`, err) })
    }
    if (!text) return
    const { error } = await admin().from('xgame_messages').insert({
      table_id: tableId, kind: 'ai', user_id: payer, private_to: privateTo,
      author_name: label.slice(0, 80), model_id: model.id, model_name: label,
      content: text.slice(0, 1000), cost_usd: cost,
    })
    if (error) console.warn(`${LOG} save ${tableId}:`, error.message)
    else await pingTable(tableId)
  } catch (e: any) {
    console.warn(`${LOG} ${tableId} ${label}:`, e?.message ?? e)
  } finally {
    await releaseLease(tableId)
  }
}

/** After a move at a table of people (`moverSeat` just moved, making ply
 *  `ply`): the house commentator when it is due, then the OPPONENT's
 *  helper when its talk level says so. `special`: a check or the end. */
export async function remarkAfterMove(tableId: string, opts: { ply: number; moverSeat: number; special: boolean; lang: string }): Promise<void> {
  if (opts.special || opts.ply % HOUSE_EVERY === 0) await speak(tableId, { kind: 'house' }, { lang: opts.lang })
  const { data: row } = await admin().from('xtalk_sessions').select('chat_ais').eq('id', tableId).maybeSingle()
  // The mover's own moves so far: seat 0 makes the odd plies.
  const moverMoves = opts.moverSeat === 0 ? Math.ceil(opts.ply / 2) : Math.floor(opts.ply / 2)
  for (const h of row ? helpersOf(row) : []) {
    if (h.seat === opts.moverSeat || h.talk === 'asked') continue
    if (opts.special || moverMoves % EVERY[h.talk] === 0) await speak(tableId, { kind: 'helper', helper: h }, { lang: opts.lang, wait: true })
  }
}

export const langOf = (v: unknown) => (typeof v === 'string' && v in LANG_NAMES ? v : 'en')
