// lib/xsports-store.ts — X體育 saved chats (supabase/130): xsports_chats and
// xsports_messages. Only the server writes, with the service role, so every
// function here takes the caller's verified user id and puts it in the
// query (RLS does not bind the service role; the query must). Signed-in
// users read their own rows directly (owner-read policies), e.g. the nav.

import { createClient } from '@supabase/supabase-js'

export function xsportsAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('xsportsAdmin: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

export interface ChatRow {
  id: string
  league: string
  game_id: string
  title: string | null
  model_id: string | null
  since: string | null
  spent_usd: number
  created_at: string
  updated_at: string
}

export interface MessageRow {
  seq: number
  kind: 'viewer' | 'remark' | 'note'
  content: string
  cue: string | null
  trigger: string | null
  after_event: string | null
  model_id: string | null
  model_name: string | null
  cost: number | null
  created_at: string
}

const CHAT_COLS = 'id, league, game_id, title, model_id, since, spent_usd, created_at, updated_at'
const MSG_COLS = 'seq, kind, content, cue, trigger, after_event, model_id, model_name, cost, created_at'

export const isChatId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

export async function createChat(userId: string, league: string, gameId: string, title: string | null): Promise<ChatRow> {
  const { data, error } = await xsportsAdmin().from('xsports_chats')
    .insert({ user_id: userId, league, game_id: gameId, title: title?.slice(0, 200) ?? null })
    .select(CHAT_COLS).single()
  if (error) throw new Error(error.message)
  return data as ChatRow
}

/** The caller's chat, or null when it is not theirs (or does not exist). */
export async function getChat(userId: string, id: string): Promise<ChatRow | null> {
  if (!isChatId(id)) return null
  const { data } = await xsportsAdmin().from('xsports_chats').select(CHAT_COLS).eq('id', id).eq('user_id', userId).maybeSingle()
  return (data as ChatRow) ?? null
}

export async function listChats(userId: string, opts: { league?: string; gameId?: string; limit?: number } = {}): Promise<ChatRow[]> {
  let q = xsportsAdmin().from('xsports_chats').select(CHAT_COLS).eq('user_id', userId)
  if (opts.league) q = q.eq('league', opts.league)
  if (opts.gameId) q = q.eq('game_id', opts.gameId)
  const { data } = await q.order('updated_at', { ascending: false }).limit(opts.limit ?? 20)
  return (data ?? []) as ChatRow[]
}

/** Messages in order; the newest `limit` when given. */
export async function getMessages(chatId: string, limit?: number): Promise<MessageRow[]> {
  let q = xsportsAdmin().from('xsports_messages').select(MSG_COLS).eq('chat_id', chatId)
  if (limit) {
    const { data } = await q.order('seq', { ascending: false }).limit(limit)
    return ((data ?? []) as MessageRow[]).reverse()
  }
  const { data } = await q.order('seq', { ascending: true }).limit(2000)
  return (data ?? []) as MessageRow[]
}

export async function addMessage(chatId: string, m: Partial<MessageRow> & { kind: MessageRow['kind']; content: string; input_tokens?: number | null }): Promise<void> {
  const { error } = await xsportsAdmin().from('xsports_messages').insert({ chat_id: chatId, ...m })
  if (error) console.warn('[xsports/store] add message failed:', error.message)
}

/** What a chat's remarks cost, counted from the remarks themselves (each
 *  stores its own list cost); null when they cannot be read. */
export async function chatCost(chatId: string): Promise<number | null> {
  const db = xsportsAdmin()
  let spent = 0
  // PostgREST hands out at most 1000 rows a request.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('xsports_messages').select('cost')
      .eq('chat_id', chatId).eq('kind', 'remark').order('seq', { ascending: true }).range(from, from + 999)
    if (error) { console.warn('[xsports/store] chat cost failed:', error.message); return null }
    for (const r of data ?? []) spent += Number((r as { cost: number | null }).cost) || 0
    if (!data || data.length < 1000) return spent
  }
}

/** After a turn: how far the commentator has been told, which model spoke
 *  first, and the chat's total. The total is counted again from the stored
 *  remarks (each keeps its own cost), and written only if it is not below
 *  the stored one: costs never go down, so a turn that counted before
 *  another turn's remark was saved (two tabs, two server instances) cannot
 *  overwrite the larger total with its smaller one (Codex review, Oct 13).
 *  Returns the chat's total afterwards, or null when it could not be read. */
export async function touchChat(chatId: string, patch: { since?: string | null; modelId?: string | null }): Promise<number | null> {
  const db = xsportsAdmin()
  const { error } = await db.from('xsports_chats').update({
    ...(patch.since !== undefined ? { since: patch.since } : {}),
    ...(patch.modelId !== undefined ? { model_id: patch.modelId } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', chatId)
  if (error) console.warn('[xsports/store] touch chat failed:', error.message)
  const counted = await chatCost(chatId)
  if (counted !== null) {
    const { data, error: e2 } = await db.from('xsports_chats').update({ spent_usd: counted })
      .eq('id', chatId).lte('spent_usd', counted).select('spent_usd')
    if (e2) console.warn('[xsports/store] chat total failed:', e2.message)
    else if (data?.length) return counted
  }
  // Not written (a larger total is already there) or not counted: the
  // stored total is the one to show.
  const { data } = await db.from('xsports_chats').select('spent_usd').eq('id', chatId).maybeSingle()
  return data ? Number((data as { spent_usd: number }).spent_usd) || 0 : counted
}

/** Every chat of this person's for one game (one chat per game since Oct
 *  14; older games may have several): 清除對話 empties the game. Returns how
 *  many went (their messages go with them, cascade). */
export async function deleteChatsFor(userId: string, league: string, gameId: string): Promise<number> {
  const { data, error } = await xsportsAdmin().from('xsports_chats').delete()
    .eq('user_id', userId).eq('league', league).eq('game_id', gameId).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

export async function deleteChat(userId: string, id: string): Promise<boolean> {
  if (!isChatId(id)) return false
  const { data, error } = await xsportsAdmin().from('xsports_chats').delete().eq('id', id).eq('user_id', userId).select('id')
  return !error && (data ?? []).length > 0
}

type Turn = { role: 'user' | 'assistant'; content: string }

const OTHER_CHARS = 280      // one remark of another model, as context
const HEARD_CHARS = 1000     // all of them before one cue

/** Other models' words as one block, newest kept when it runs long. */
function heardBlock(lines: string[]): string {
  const out: string[] = []
  let used = 0
  for (const l of [...lines].reverse()) {
    if (used + l.length > HEARD_CHARS && out.length) break
    out.unshift(l)
    used += l.length
  }
  return `Other AI commentators in this chat said:\n${out.join('\n')}`
}

/** The conversation as ONE model rereads it (the viewer may pick several
 *  models, Oct 13). Its own remarks are its turns, each after the cue it
 *  answered. What the other models said comes in the viewer's turns,
 *  labeled with their names, so a model never takes another's words for its
 *  own. Remarks with the same cue answered the same turn (one question, a
 *  model each). Returns the turns, alternating and ending with this model's
 *  last remark, and what the others said after it (`heard`), which goes
 *  before the new cue. A viewer message whose remark failed has no pair and
 *  is left out; it still reaches the model as one of the viewer's earlier
 *  words (viewerNotes). */
export function historyFor(rows: MessageRow[], self: string): { turns: Turn[]; heard: string | null } {
  const turns: Turn[] = []
  let others: string[] = []
  const remarks = rows.filter(r => r.kind === 'remark' && r.cue && r.content.trim())
  for (let i = 0; i < remarks.length;) {
    // One turn: the same cue, each model once (a question asked twice with
    // nothing new on the field repeats the cue but is two turns).
    let j = i + 1
    const seen = new Set([remarks[i].model_id])
    while (j < remarks.length && remarks[j].cue === remarks[i].cue && !seen.has(remarks[j].model_id)) seen.add(remarks[j++].model_id)
    const group = remarks.slice(i, j)
    i = j
    const own = group.find(r => r.model_id === self)
    const said = group.filter(r => r !== own).map(r => `[${r.model_name ?? 'AI'}] ${r.content.trim().slice(0, OTHER_CHARS)}`)
    if (own) {
      const before = others.length ? `${heardBlock(others)}\n\n` : ''
      turns.push({ role: 'user', content: `${before}${own.cue}` }, { role: 'assistant', content: own.content.trim() })
      // Said at the same time as this model: it hears them on its next turn.
      others = said
    } else {
      // A turn this model sat out: what it was about, and who said what.
      others.push(`(${group[0].cue!.replace(/\s+/g, ' ').slice(0, 160)})`, ...said)
    }
  }
  return { turns, heard: others.length ? heardBlock(others) : null }
}
