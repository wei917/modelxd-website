// app/api/xgame/chat/route.ts — a table's two chats (Oct 21;
// lib/xgame-chat.ts): the public one, with the house commentator, and each
// player's private one, with the AI helper they hired. Only the table's
// seated players get past the door; anyone else is told it is not found, as
// the game is. A player receives the public chat and their OWN private chat,
// never the opponent's.
//
// Actions (POST): list · send {content, private?, lang} · delete {messageId}
// · hire {modelId} · dismiss · talk {talk}.
// An answer comes after the response (`after`), so the page shows the
// person's message at once and the answer arrives by ping.

export const runtime = 'nodejs'
// An answer may wait for the speaking lock (≤ 30 s) and take up to 60 s.
export const maxDuration = 120

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  CHAT_MAX, HOUSE, TALKS, callsHouse, deleteOwn, helpersFor, helpersOf, houseQuiet, langOf,
  listMessages, loadTable, postHuman, setHelpers, shortName, speak, type Talk,
} from '@/lib/xgame-chat'
import { faceOf } from '@/lib/xgame-duo'

const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
/** A helper's hirer pays every remark: one whose hirer has no credit stays
 *  quiet, and the page is told why. */
const hasCredit = async (userId: string) => {
  const { data } = await svc().from('user_credits').select('balance_cents').eq('user_id', userId).maybeSingle()
  return (Number(data?.balance_cents) || 0) >= 1
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const t = await loadTable(body.id, user.id)
  if (!t || t.seat < 0) return Response.json({ error: 'Not found' }, { status: 404 })
  const { row, seat } = t
  const view = async (extra: Record<string, unknown> = {}) => {
    const fresh = (await loadTable(row.id, user.id))?.row ?? row
    const [pub, priv, quiet] = await Promise.all([
      listMessages(row.id, user.id, null),
      listMessages(row.id, user.id, user.id),
      houseQuiet(),
    ])
    return Response.json({
      public: pub, private: priv,
      house: { name: HOUSE.name, short: shortName(HOUSE.name), quiet },
      ...helpersFor(fresh, user.id),
      maxChars: CHAT_MAX, ...extra,
    })
  }

  if (body.action === 'list') return view()

  if (body.action === 'send') {
    const priv = body.private === true
    const mine = helpersOf(row).find(h => h.hiredBy === user.id)
    if (priv && !mine) return Response.json({ error: 'No helper.', code: 'nohelper' }, { status: 400 })
    const r = await postHuman(row.id, user, body.content, priv)
    if (!r.ok) return Response.json({ error: r.code, code: r.code }, { status: r.code === 'refused' ? 422 : r.code === 'check_unavailable' ? 503 : r.code === 'slow' ? 429 : 400 })
    const lang = langOf(body.lang)
    const asker = { name: r.name, text: String(body.content).slice(0, CHAT_MAX) }
    if (priv && mine) {
      // Every private message is a question to the helper.
      if (!(await hasCredit(user.id))) return view({ unpaid: mine.name })
      after(() => speak(row.id, { kind: 'helper', helper: mine }, { lang, asker, wait: true }))
      return view({ asked: mine.name })
    }
    if (!priv && callsHouse(String(body.content))) {
      if (await houseQuiet()) return view()
      after(() => speak(row.id, { kind: 'house' }, { lang, asker, wait: true }))
      return view({ asked: HOUSE.name })
    }
    return view()
  }

  if (body.action === 'delete') {
    await deleteOwn(row.id, user.id, body.messageId)
    return view()
  }

  if (body.action === 'hire') {
    // One helper per player; hiring another replaces it.
    const { data: model } = await svc().from('ai_models')
      .select('id, provider, display_name, modes, output_modalities, enabled')
      .eq('id', String(body.modelId ?? '')).eq('enabled', true).maybeSingle()
    if (!model || !(model.output_modalities ?? []).includes('text') || !(model.modes ?? []).includes('text_to_text')) {
      return Response.json({ error: 'That model cannot help here.' }, { status: 400 })
    }
    if (!(await hasCredit(user.id))) return Response.json({ error: 'No credit left.', code: 'broke' }, { status: 402 })
    const face = await faceOf(user)
    const talk: Talk = TALKS.includes(body.talk) ? body.talk : 'asked'
    await setHelpers(row.id, list => [
      ...list.filter(h => h.hiredBy !== user.id),
      { modelId: model.id, name: model.display_name, provider: model.provider, hiredBy: user.id, hirerName: face.name, seat, talk },
    ])
    return view()
  }

  if (body.action === 'dismiss') {
    await setHelpers(row.id, list => list.some(h => h.hiredBy === user.id) ? list.filter(h => h.hiredBy !== user.id) : null)
    return view()
  }

  if (body.action === 'talk') {
    const talk: Talk | null = TALKS.includes(body.talk) ? body.talk : null
    if (talk) await setHelpers(row.id, list => list.some(h => h.hiredBy === user.id)
      ? list.map(h => (h.hiredBy === user.id ? { ...h, talk } : h)) : null)
    return view()
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
