// app/api/xsports/talk/route.ts — one turn of the private chat. SSE stream.
//
// The page decides WHEN (a new play, a quiet stretch, the viewer's message,
// joining); this route decides nothing about timing and everything about
// content: the game state is fetched HERE from MLB, never taken from the
// client, so the model only ever sees a score this server read.
//
// The viewer may pick several models (Oct 13, up to 4 as in XCreate). A
// question goes to every one of them, one after another (lib/xsports-turn):
// the viewer's words are stored once, then each model answers, is debited
// and has its remark saved before the next one starts; one that fails does
// not stop the others, and a page that went away stops the ones not
// started. A remark nobody asked for (open / event / lull) comes from ONE
// model at a time; the page takes turns among them.
//
// The viewer chose the models, so house rules apply (CLAUDE.md, "WHO CHOSE
// the model"): bill list price per remark, never substitute; an account
// failure on our side surfaces through sanitizeProviderError.
//
// Events: meta { cue, through, trigger, models: [{ i, id, name, provider,
// model_name }] }, then per model start { i }, delta { i, text }, and done
// { i, cost, chars } or error { i, message }; last, end { cost, spent,
// skipped, stopped } (`spent` is the chat's total, counted again from its
// remarks; `stopped` is 'no_credits' when the wallet ran out before a model
// could start, which the page treats like a refused turn: watching pauses,
// top-up offered).
//
// The wallet is checked before the first model and again before each next
// one (Codex review, Oct 13: with 1 cent and model A costing 1 cent, model
// B must not start), and a debit refused for lack of credits stops the rest.

export const runtime = 'nodejs'
// Up to four models one after another, each possibly at a deep thinking
// level the viewer chose.
export const maxDuration = 800

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { FEATURE, isBlockedFor } from '@/lib/model-features'
import { getGame, getSchedule, getPlayers, isGamePk, mlbToday, type GameCard, type GameState } from '@/lib/mlb'
import { getNbaGame, getNbaSchedule, isNbaId } from '@/lib/nba'
import { systemText, stateBlock, cueText, lastTurn, newSince, lastEventId, playersBlock, involved, asLang, TRIGGERS, type Trigger } from '@/lib/xsports-prompt'
import { getChat, getMessages, addMessage, touchChat, historyFor, isChatId, type ChatRow } from '@/lib/xsports-store'
import { speak, inTurn } from '@/lib/xsports-turn'

const LOG = '[xsports/talk]'
const MESSAGE_MAX = 1000
const HISTORY_MAX = 40          // messages (20 exchanges)
const TURN_CHARS = 1500
const NOTES_MAX = 10
/** As many models as XCreate puts side by side. */
const MAX_MODELS = 4
// A remark the viewer did not ask for, at most this often per viewer (per
// instance: a floor against a runaway page, not the pacing, which is the
// page's).
const SELF_MIN_GAP_MS = 8_000
const lastSelf = new Map<string, number>()

const PING = new TextEncoder().encode(': ping\n\n')
const sse = (event: string, data: object) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

const tzOf = (v: unknown): string => {
  if (typeof v === 'string' && v.length < 64) { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v } catch { /* not a zone */ } }
  return 'Asia/Taipei'
}

type Msg = { role: 'user' | 'assistant'; content: string }

/** The page's copy of the conversation, made safe to send: user/assistant
 *  only, alternating, starting with the user and ending with the commentator
 *  (the new user turn goes after it), the newest part only. */
function cleanHistory(v: unknown): Msg[] {
  if (!Array.isArray(v)) return []
  const out: Msg[] = []
  for (const m of v.slice(-HISTORY_MAX * 2)) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m?.content !== 'string') continue
    const content = m.content.slice(0, TURN_CHARS).trim()
    if (!content) continue
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${content}`.slice(-TURN_CHARS * 2)
    else out.push({ role: m.role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  while (out.length && out[out.length - 1].role !== 'assistant') out.pop()
  const kept = out.slice(-HISTORY_MAX)
  while (kept.length && kept[0].role !== 'user') kept.shift()
  return kept
}

/** Live commentary wants the first word fast: the lowest thinking setting
 *  the row declares, or the provider's default when it declares none. */
function quickest(levels: string[]): string | null {
  for (const l of ['none', 'thinking_false', 'minimal', 'low']) if (levels.includes(l)) return l
  return null
}

/** The thinking level for one model: the one the viewer chose for it, if
 *  the row declares it (owner, Oct 13: "each model should have config"),
 *  else its quickest. */
function thinkingFor(model: any, chosen: unknown): string | null {
  const levels: string[] = model.output_config?.text?.thinking_levels ?? []
  const want = chosen && typeof chosen === 'object' ? (chosen as Record<string, unknown>)[String(model.id)] : undefined
  return typeof want === 'string' && levels.includes(want) ? want : quickest(levels)
}

/** Told to each model when the chat has more than one. */
const groupNote = (name: string) => `\n\nThe viewer picked more than one AI commentator for this private chat. You are ${name}. What the others said reaches you in the viewer's turns, labeled with their names. Speak only for yourself: never repeat them, never answer for them, and never start your reply with a name label.`

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const refuse = (code: string, error: string, status = 400) => Response.json({ error, code }, { status })

  const league = body?.league === 'nba' ? 'nba' : 'mlb'
  if (!(league === 'nba' ? isNbaId(body?.pk) : isGamePk(body?.pk))) return refuse('bad_game', 'bad game id')
  const pk = Number(body.pk)
  const fetchGame = (fresh = false) => (league === 'nba' ? getNbaGame(pk, { fresh }) : getGame(pk, { fresh }))
  let trigger: Trigger = (TRIGGERS as readonly string[]).includes(body?.trigger) ? body.trigger : 'user'
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, MESSAGE_MAX) : ''
  if (trigger === 'user' && !message) return refuse('message_required', 'write something')

  // The models, in the page's order (`modelId` alone is the one-model form).
  const raw: unknown[] = Array.isArray(body?.modelIds) ? body.modelIds : typeof body?.modelId === 'string' ? [body.modelId] : []
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64))]
  if (!ids.length) return refuse('model_required', 'modelIds required')
  if (ids.length > MAX_MODELS) return refuse('too_many_models', `at most ${MAX_MODELS} models`)
  // Unasked remarks take one model at a time, so watching costs what one
  // model costs; only a question goes to all of them.
  if (trigger !== 'user' && ids.length !== 1) return refuse('one_model', 'a remark nobody asked for comes from one model')
  const models: any[] = await Promise.all(ids.map(id => getModelById(id)))
  for (const model of models) {
    if (!model || model.enabled === false) return refuse('model_unavailable', 'model not available')
    if (isBlockedFor(model, FEATURE.xsports)) return refuse('model_blocked', 'model not offered for XSports')
    if (!(model.output_modalities ?? []).includes('text')) return refuse('wrong_modality', 'not a text model')
    if (!(model.output_config?.text?.capabilities ?? []).includes('web_search')) return refuse('model_no_search', 'XSports needs a model that can search the web')
  }

  // Every remark is billed, so an empty wallet stops the commentator before
  // the provider is called (the page pauses and says why), and is asked
  // again before each next model of the turn.
  const walletCents = async () => {
    const { data: wallet } = await sb.from('user_credits').select('balance_cents').eq('user_id', user.id).maybeSingle()
    return wallet ? Number(wallet.balance_cents) || 0 : 0
  }
  if ((await walletCents()) < 1) return refuse('no_credits', 'no credits', 402)

  // A saved chat (supabase/130): the conversation the model rereads, how far
  // into the plays it has been told, and what it has cost come from our own
  // rows, not from the page.
  let chat: ChatRow | null = null
  if (body?.chatId !== undefined && body?.chatId !== null) {
    if (!isChatId(body.chatId)) return refuse('bad_chat', 'bad chat id')
    chat = await getChat(user.id, body.chatId)
    if (!chat) return refuse('chat_not_found', 'chat not found', 404)
    if (chat.game_id !== String(pk) || chat.league !== league) return refuse('chat_other_game', 'that chat is for another game')
  }

  if (trigger !== 'user') {
    const last = lastSelf.get(user.id) ?? 0
    if (Date.now() - last < SELF_MIN_GAP_MS) return refuse('too_soon', 'too soon', 429)
    lastSelf.set(user.id, Date.now())
    if (lastSelf.size > 5000) lastSelf.clear()
  }

  let game
  try {
    game = await fetchGame()
    // The page saw a play this instance's copy does not have yet: read again.
    const seen = typeof body?.seen === 'string' ? body.seen : null
    if (seen && !game.events.some(e => e.id === seen)) game = await fetchGame(true)
  } catch (e: any) {
    console.warn(LOG, 'feed', pk, e?.message ?? e)
    return refuse('feed_unavailable', 'game feed unavailable', 502)
  }
  const others: GameCard[] = await (league === 'nba' ? getNbaSchedule(mlbToday()) : getSchedule(mlbToday())).catch(() => [])
  // When the viewer speaks they may ask about any game: the day's other
  // games come with their box scores then (cached like this one; live first,
  // at most 8).
  const otherBox: GameState[] = trigger === 'user' && league === 'mlb'
    ? (await Promise.all(
        others.filter(c => c.pk !== pk && c.status !== 'preview')
          .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live'))
          .slice(0, 8)
          .map(c => getGame(c.pk).catch(() => null)),
      )).filter((x): x is GameState => !!x)
    : []

  const since = chat ? chat.since : (typeof body?.since === 'string' ? body.since.slice(0, 20) : null)
  const fresh = newSince(game, since)
  // Nothing new after all (the page's copy ran ahead of ours): still worth
  // a word, as a quiet-stretch remark.
  if (trigger === 'event' && !fresh.length) trigger = 'lull'

  const lang = asLang(body?.lang)
  const tz = tzOf(body?.tz)
  const cue = cueText(trigger, game, fresh, message)
  let stored: Awaited<ReturnType<typeof getMessages>> = []
  if (chat) stored = await getMessages(chat.id, 240).catch(() => [])
  // The newest 80 stored messages are the conversation; the viewer's words
  // before that ride along as notes.
  const recent = stored.slice(-80)
  const notes: string[] = chat
    ? stored.slice(0, -80).filter(m => m.kind === 'viewer').map(m => m.content.slice(0, 200)).slice(-NOTES_MAX)
    : Array.isArray(body?.viewerNotes)
      ? body.viewerNotes.filter((n: unknown): n is string => typeof n === 'string' && !!n.trim()).slice(-NOTES_MAX).map((n: string) => n.slice(0, 200))
      : []
  // Player cards (owner, Oct 12: "you don't have each player's data?"):
  // the whole roster with careers when the viewer asks something, the
  // season and postseason in a quiet stretch or a greeting, and only the
  // players in the new plays when reacting to them, so a costly model does
  // not pay for forty cards on every remark.
  const cards = league === 'mlb' ? await getPlayers([...game.roster.away, ...game.roster.home], game.season).catch(() => []) : []
  const players = trigger === 'user' ? playersBlock(game, cards, 'full')
    : trigger === 'event' ? playersBlock(game, cards, 'season', involved(game, fresh))
    : playersBlock(game, cards, 'season')
  const state = stateBlock(game, { tz, others, otherBox })

  /** What one model reads: its own past remarks as its turns, the other
   *  models' words labeled in the viewer's turns (lib/xsports-store). */
  const messagesFor = (model: any): Msg[] => {
    if (!chat) return [...cleanHistory(body?.history), { role: 'user', content: lastTurn(state, cue, notes, players) }]
    const { turns, heard } = historyFor(recent, String(model.id))
    return [...cleanHistory(turns), { role: 'user', content: lastTurn(state, heard ? `${heard}\n\n${cue}` : cue, notes, players) }]
  }
  const nameOf = (model: any): string => model.display_name ?? model.model_name
  const group = (model: any) => models.length > 1 || recent.some(m => m.kind === 'remark' && m.model_id !== String(model.id))

  // Web search is always on (owner, Oct 12: "it's a real time game chat").
  // The model decides when to search and a search is billed only when it
  // runs: in a test on Oct 12 GPT-6 Luna searched once in five turns, for an
  // injury question, never for plays the feed already had.
  const search = true
  const session = typeof body?.session === 'string' && /^[0-9a-f-]{36}$/i.test(body.session) ? body.session : null
  const through = lastEventId(game)
  const seenId = typeof body?.seen === 'string' ? body.seen.slice(0, 20) : through
  // The viewer's words are kept once, as they arrive, so they sort before
  // the remarks that answer them.
  if (chat && trigger === 'user') await addMessage(chat.id, { kind: 'viewer', content: message, after_event: seenId })

  let open = true
  const stream = new ReadableStream({
    start(controller) {
      const emit = (chunk: Uint8Array) => { if (!open) return; try { controller.enqueue(chunk) } catch { open = false } }
      const beat = setInterval(() => emit(PING), 15_000)
      let settle = () => {}
      const settled = new Promise<void>(r => { settle = r })
      const end = () => { clearInterval(beat); settle(); if (!open) return; open = false; try { controller.close() } catch { /* gone */ } }
      // What the page keeps: the cue, how far into the plays the models have
      // now been told, and who answers, in order.
      emit(sse('meta', {
        cue, through, trigger,
        models: models.map((m, i) => ({ i, id: String(m.id), name: nameOf(m), provider: m.provider, model_name: m.model_name })),
      }))

      // A debit refused for lack of credits: the models after it do not start.
      let broke = false
      /** Before model i (the first was checked above): is there still money?
       *  A wallet that cannot be read counts as empty. */
      const gate = async (i: number): Promise<string | null> => {
        if (i === 0) return null
        if (broke) return 'no_credits'
        try { return (await walletCents()) < 1 ? 'no_credits' : null } catch { return 'no_credits' }
      }

      /** One model, start to saved: billed at list price, its remark stored
       *  before the next model starts. */
      const answer = (i: number) => {
        const model = models[i]
        emit(sse('start', { i }))
        return speak(
          callbacks => providers.streamText(
            model, messagesFor(model), callbacks, [], { userId: user.id },
            { system: systemText(lang, league) + (group(model) ? groupNote(nameOf(model)) : ''), thinking: thinkingFor(model, body?.thinking), search },
          ),
          {
            onDelta: text => emit(sse('delta', { i, text })),
            persist: async (text, r) => {
              const cost = Number(r.cost) || 0
              const carried = await accrueFraction(user.id, cost * 1e6)
              const cents = carried ?? Math.round(cost * 100)
              if (cents > 0) {
                await debitCredits({
                  userId: user.id, amountCents: cents,
                  // One chat is one row in the credit history.
                  referenceType: 'xsports', referenceId: chat?.id ?? session ?? `${league}-${pk}`,
                  description: `XSports ${league.toUpperCase()} commentary (${model.model_name})`,
                  metadata: { pk, trigger, modelName: model.model_name, search },
                }).catch(err => {
                  if (err instanceof InsufficientCreditsError) { broke = true; console.warn(`${LOG} insufficient credits (${cents}¢)`) }
                  else console.warn(`${LOG} debit failed:`, err)
                })
              }
              if (chat && text.trim()) {
                await addMessage(chat.id, {
                  kind: 'remark', content: text.trim(), cue, trigger, after_event: through,
                  model_id: String(model.id), model_name: nameOf(model) ?? null,
                  input_tokens: r.inputTokens ?? null, cost,
                })
              }
            },
          },
        ).then(spoken => {
          if (spoken.error) emit(sse('error', { i, message: sanitizeProviderError(spoken.error) }))
          else emit(sse('done', { i, cost: spoken.cost, chars: spoken.text.length }))
          return spoken
        })
      }

      // A viewer who leaves mid-remark is still billed for what was made:
      // after() keeps the function alive until the debit is done. The models
      // not started by then stay silent.
      after((async () => {
        const { spoken, skipped, halted } = await inTurn(models.length, answer, () => !open || req.signal.aborted, gate)
        const cost = spoken.reduce((sum, s) => sum + s.cost, 0)
        const spoke = spoken.some(s => !s.error && s.text.trim())
        const spent = chat && spoke ? await touchChat(chat.id, { since: through, modelId: String(models[0].id) }) : null
        emit(sse('end', { cost, spent, skipped, stopped: halted }))
        end()
      })().catch(e => { emit(sse('error', { message: sanitizeProviderError(String(e?.message ?? e)) })); end() }).then(() => settled))
    },
    cancel() { open = false },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
