// app/api/xtell/cookie/note/route.ts — the short note under a fortune-cookie
// slip, streamed as it is written (Sep 29). The chart route draws the slip
// and returns at once with `notePending`; the page then asks here, and the
// note is written once per cookie, in the language the slip was drawn in,
// by the same quick house model (lib/xtell-daily-model.ts). Nothing is
// charged here: a cookie past the meal's free two was paid when cracked.
//
// Written once: the first request lowers `notePending` in the same UPDATE
// that checks it, so a second tab (or React's double effect in dev) finds it
// down and is told the note is being written; it asks again shortly and gets
// the saved note. The note is saved even if the reader has left.

export const runtime = 'nodejs'
export const maxDuration = 60

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { xtellAdmin } from '@/lib/xtell-admin'
import { dailyText } from '@/lib/xtell-daily-model'
import { noteBrief, noteFacts, parseNote } from '@/lib/xtell-cookie'
import { ndjsonResponse } from '@/lib/partial-json'

/** How long a claimed note counts as still being written. */
const WRITING_MS = 60_000

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId) ? body.readingId : null
  if (!id) return Response.json({ error: 'cookie_missing' }, { status: 400 })

  // The service client, with this user's id in every query (lib/xtell-admin.ts).
  const db = xtellAdmin()
  const { data: row } = await db.from('xtell_readings').select('chart').eq('id', id).eq('user_id', user.id).eq('temple', 'cookie').is('deleted_at', null).maybeSingle()
  const chart = row?.chart
  if (!chart?.fortune) return Response.json({ error: 'cookie_missing' }, { status: 404 })
  const note = typeof chart.note === 'string' ? chart.note : null
  const writing = (c: any) => !c.note && typeof c.noteStarted === 'string' && Date.now() - Date.parse(c.noteStarted) < WRITING_MS
  if (chart.notePending !== true) return Response.json({ note, writing: writing(chart) })

  const started = { ...chart, notePending: false, noteStarted: new Date().toISOString() }
  const { data: claimed } = await db.from('xtell_readings').update({ chart: started })
    .eq('id', id).eq('user_id', user.id).eq('chart->>notePending', 'true').select('id')
  if (!claimed?.length) return Response.json({ note: null, writing: true })

  const lang = typeof chart.noteLang === 'string' ? chart.noteLang : 'zh-Hant'
  return ndjsonResponse(async emit => {
    const text = await dailyText({
      system: noteBrief(lang), content: noteFacts(chart), userId: user.id, accept: t => !!parseNote(t),
      onDelta: d => emit({ t: 'd', d }), onRestart: () => emit({ t: 'restart' }),
    }).catch(() => null)
    const note = text ? parseNote(text) : null
    await db.from('xtell_readings').update({ chart: { ...started, note } }).eq('id', id).eq('user_id', user.id)
    emit({ t: 'done', note })
  }, p => after(p))
}
